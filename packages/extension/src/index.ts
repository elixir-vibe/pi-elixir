import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent'

import { registerBridgeCommands } from './bridge/plugin-commands.ts'
import { handleBridgeRequest } from './bridge/requests.ts'
import { showStartupInfo } from './bridge/startup-info.ts'
import { registerBridgeToolHooks } from './bridge/tool-hooks.ts'
import { applyBridgeUIEvent, updateStatus } from './bridge/ui-events.ts'
import { resolveUrl, getConnectionKind, sendBridgeEvent } from './connection/resolver.ts'
import { onStatusChange } from './connection/status.ts'
import {
  markTurnEnd,
  markTurnStart,
  recordDiagnostic,
  startEventLoopLagMonitor,
  withDiagnosticSpan,
  writeDiagnosticDump
} from './diagnostics.ts'
import {
  getBridgeInfo,
  onBridgeBusEvent,
  onBridgeRequest,
  onBridgeUIEvent,
  stopEmbedded
} from './embedded/stdio-process.ts'
import { flags } from './flags.ts'
import { resolveMixProjectCwd } from './mix/project.ts'
import { registerSessionCommands } from './sessions/commands.ts'
import { renderSessionMessage } from './sessions/render.ts'
import {
  clearSessionSnapshots,
  handleSessionEvent,
  loadSessionSnapshots
} from './sessions/state.ts'
import { discoverExecutableSkillPath } from './skills/executable-skills.ts'
import { register as registerEval } from './tools/eval.ts'
import { register as registerExAstReplace } from './tools/ex-ast-replace.ts'
import { register as registerExAstSearch } from './tools/ex-ast-search.ts'

interface StatusSubscription {
  cwd: string
  unsubscribeStatus: () => void
  unsubscribeUI: () => void
  unsubscribeBus: () => void
  unsubscribeRequests: () => void
}

function resolveElixirCwd(cwd: string): string | null {
  return resolveMixProjectCwd(cwd)
}

function subscriptionKey(ctx: ExtensionContext) {
  return `${ctx.cwd}:${ctx.sessionManager?.getSessionFile?.() ?? 'ephemeral'}`
}

function hasBridgePlugins(cwd: string): boolean {
  return (getBridgeInfo(cwd)?.plugins?.length ?? 0) > 0
}

export default function (pi: ExtensionAPI) {
  startEventLoopLagMonitor()

  const statusSubscriptions = new Map<string, StatusSubscription>()
  const registeredCommands = new Set<string>()
  if (flags.sessions()) {
    pi.registerMessageRenderer('elixir-sessions', renderSessionMessage)
    registerSessionCommands(pi, registeredCommands, resolveElixirCwd)
  }
  if (flags.plugins()) registerBridgeToolHooks(pi, resolveElixirCwd, hasBridgePlugins)

  if (!registeredCommands.has('elixir:debug')) {
    registeredCommands.add('elixir:debug')
    pi.registerCommand('elixir:debug', {
      description: 'Write a pi-elixir diagnostic snapshot',
      handler: async (_args, ctx) => {
        const beamCwd = resolveElixirCwd(ctx.cwd)
        const file = await writeDiagnosticDump('manual_debug', { cwd: beamCwd ?? ctx.cwd })
        ctx.ui.notify(`pi-elixir debug snapshot written:\n${file}`, 'info')
      }
    })
  }

  if (!registeredCommands.has('elixir:dogfood')) {
    registeredCommands.add('elixir:dogfood')
    pi.registerCommand('elixir:dogfood', {
      description: 'Install this checkout as the active pi-elixir package and reload pi',
      handler: async (_args, ctx) => {
        let packageJson: { name?: string }
        try {
          packageJson = JSON.parse(await readFile(join(ctx.cwd, 'package.json'), 'utf8')) as {
            name?: string
          }
        } catch {
          ctx.ui.notify('/elixir:dogfood must be run from the pi-elixir repository root', 'error')
          return
        }
        if (packageJson.name !== 'pi-elixir') {
          ctx.ui.notify('/elixir:dogfood must be run from the pi-elixir repository root', 'error')
          return
        }

        ctx.ui.notify('Installing local pi-elixir checkout...', 'info')
        const result = await pi.exec('pi', ['install', '.'], { cwd: ctx.cwd, timeout: 120_000 })
        if (result.code !== 0) {
          const output = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')
          ctx.ui.notify(
            `pi-elixir dogfood install failed:\n${output || `exit ${result.code}`}`,
            'error'
          )
          return
        }

        ctx.ui.notify('Local pi-elixir installed. Reloading pi...', 'info')
        await ctx.reload()
      }
    })
  }

  function clearStatusSubscription(key: string) {
    const subscription = statusSubscriptions.get(key)
    subscription?.unsubscribeStatus()
    subscription?.unsubscribeUI()
    subscription?.unsubscribeBus()
    subscription?.unsubscribeRequests()
    statusSubscriptions.delete(key)
  }

  function hasStatusSubscriptionForCwd(cwd: string) {
    return Array.from(statusSubscriptions.values()).some((subscription) => subscription.cwd === cwd)
  }

  pi.on('session_start', async (_event, ctx) => {
    await withDiagnosticSpan('hook_session_start', ctx.cwd, undefined, async () => {
      recordDiagnostic('session_start', ctx.cwd)
      const key = subscriptionKey(ctx)
      clearStatusSubscription(key)

      const sessionCwd = resolveElixirCwd(ctx.cwd)
      if (!sessionCwd) return
      const unsubscribeStatus = onStatusChange((cwd, kind) => {
        if (cwd === sessionCwd) updateStatus(ctx, kind)
      })
      const unsubscribeUI = onBridgeUIEvent((cwd, event) => {
        if (flags.plugins() && cwd === sessionCwd) applyBridgeUIEvent(ctx, event)
      })
      const unsubscribeBus = onBridgeBusEvent((cwd, event) => {
        if (cwd !== sessionCwd) return
        if (flags.sessions() && event.name === 'pi_session') handleSessionEvent(pi, ctx, cwd, event)
        if (flags.plugins() && event.name) pi.events.emit(event.name, event.data)
      })
      const unsubscribeRequests = onBridgeRequest(async (cwd, message, responder) => {
        if (cwd !== sessionCwd) return undefined
        return handleBridgeRequest(message, ctx, pi, responder)
      })
      statusSubscriptions.set(key, {
        cwd: sessionCwd,
        unsubscribeStatus,
        unsubscribeUI,
        unsubscribeBus,
        unsubscribeRequests
      })

      updateStatus(ctx, getConnectionKind(sessionCwd))

      void (async () => {
        recordDiagnostic('bridge_resolve_start', sessionCwd)
        const conn = await resolveUrl(sessionCwd)
        updateStatus(ctx, conn?.kind ?? getConnectionKind(sessionCwd))
        if (conn) await loadSessionSnapshots(ctx, sessionCwd, conn.url)
        const info = getBridgeInfo(sessionCwd)
        showStartupInfo(ctx, info)
        if (flags.plugins()) registerBridgeCommands(pi, info, registeredCommands, resolveElixirCwd)
        if (flags.plugins())
          await sendBridgeEvent(sessionCwd, { type: 'session_start', cwd: sessionCwd })
        recordDiagnostic('bridge_resolve_done', sessionCwd, { kind: conn?.kind ?? null })
      })().catch((error) => {
        recordDiagnostic('bridge_resolve_error', sessionCwd, {
          error: error instanceof Error ? error.message : String(error)
        })
      })
    })
  })

  pi.on('before_agent_start', async (event, ctx) => {
    await withDiagnosticSpan('hook_before_agent_start', ctx.cwd, undefined, async () => {
      const beamCwd = resolveElixirCwd(ctx.cwd)
      if (!beamCwd) return

      recordDiagnostic('before_agent_start', beamCwd, { promptBytes: event.prompt?.length ?? 0 })
      if (!flags.plugins()) return

      await sendBridgeEvent(beamCwd, {
        type: 'before_agent_start',
        cwd: ctx.cwd,
        prompt: event.prompt
      })
    })
  })

  pi.on('turn_start', async (event, ctx) => {
    await withDiagnosticSpan(
      'hook_turn_start',
      ctx.cwd,
      { turnIndex: event.turnIndex },
      async () => {
        const beamCwd = resolveElixirCwd(ctx.cwd)
        if (!beamCwd) return

        markTurnStart(beamCwd, ctx.sessionManager?.getSessionFile?.(), {
          turnIndex: event.turnIndex
        })
        if (!flags.plugins()) return

        await sendBridgeEvent(beamCwd, {
          type: 'turn_start',
          cwd: ctx.cwd,
          turnIndex: event.turnIndex
        })
      }
    )
  })

  pi.on('turn_end', async (event, ctx) => {
    await withDiagnosticSpan('hook_turn_end', ctx.cwd, { turnIndex: event.turnIndex }, async () => {
      const beamCwd = resolveElixirCwd(ctx.cwd)
      if (!beamCwd) return

      markTurnEnd(beamCwd, ctx.sessionManager?.getSessionFile?.(), { turnIndex: event.turnIndex })
      if (!flags.plugins()) return

      await sendBridgeEvent(beamCwd, { type: 'turn_end', cwd: ctx.cwd, turnIndex: event.turnIndex })
    })
  })

  pi.on('resources_discover', async (_event, ctx) => {
    return await withDiagnosticSpan('hook_resources_discover', ctx.cwd, undefined, async () => {
      const beamCwd = resolveElixirCwd(ctx.cwd)
      if (!beamCwd) return {}

      recordDiagnostic('resources_discover', beamCwd)
      const kind = getConnectionKind(beamCwd)
      if (kind !== 'embedded' && kind !== 'external') return {}
      if (!flags.skills()) return {}

      const skillPath = await discoverExecutableSkillPath(beamCwd)
      return skillPath ? { skillPaths: [skillPath] } : {}
    })
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    await withDiagnosticSpan('hook_session_shutdown', ctx.cwd, undefined, async () => {
      recordDiagnostic('session_shutdown', ctx.cwd)
      const key = subscriptionKey(ctx)
      clearStatusSubscription(key)

      const beamCwd = resolveElixirCwd(ctx.cwd)
      if (beamCwd) {
        if (flags.plugins())
          await sendBridgeEvent(beamCwd, { type: 'session_shutdown', cwd: ctx.cwd })
        clearSessionSnapshots(beamCwd)
        if (flags.sessions()) ctx.ui.setWidget('elixir-sessions', undefined)
      }

      if (beamCwd && !hasStatusSubscriptionForCwd(beamCwd)) {
        stopEmbedded(beamCwd)
      }
    })
  })

  registerEval(pi)
  registerExAstSearch(pi)
  registerExAstReplace(pi)
}

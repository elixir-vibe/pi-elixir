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
  writeDiagnosticDump
} from './diagnostics.ts'
import {
  getBridgeInfo,
  onBridgeBusEvent,
  onBridgeRequest,
  onBridgeUIEvent,
  stopEmbedded
} from './embedded/stdio-process.ts'
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
  pi.registerMessageRenderer('elixir-sessions', renderSessionMessage)
  registerSessionCommands(pi, registeredCommands, resolveElixirCwd)
  registerBridgeToolHooks(pi, resolveElixirCwd, hasBridgePlugins)

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
    recordDiagnostic('session_start', ctx.cwd)
    const key = subscriptionKey(ctx)
    clearStatusSubscription(key)

    const sessionCwd = resolveElixirCwd(ctx.cwd)
    if (!sessionCwd) return
    const unsubscribeStatus = onStatusChange((cwd, kind) => {
      if (cwd === sessionCwd) updateStatus(ctx, kind)
    })
    const unsubscribeUI = onBridgeUIEvent((cwd, event) => {
      if (cwd === sessionCwd) applyBridgeUIEvent(ctx, event)
    })
    const unsubscribeBus = onBridgeBusEvent((cwd, event) => {
      if (cwd !== sessionCwd) return
      if (event.name === 'pi_session') handleSessionEvent(pi, ctx, cwd, event)
      if (event.name) pi.events.emit(event.name, event.data)
    })
    const unsubscribeRequests = onBridgeRequest(async (cwd, message) => {
      if (cwd !== sessionCwd) return undefined
      return handleBridgeRequest(message, ctx, pi)
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
      registerBridgeCommands(pi, info, registeredCommands, resolveElixirCwd)
      await sendBridgeEvent(sessionCwd, { type: 'session_start', cwd: sessionCwd })
      recordDiagnostic('bridge_resolve_done', sessionCwd, { kind: conn?.kind ?? null })
    })().catch((error) => {
      recordDiagnostic('bridge_resolve_error', sessionCwd, {
        error: error instanceof Error ? error.message : String(error)
      })
    })
  })

  pi.on('before_agent_start', async (event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return

    recordDiagnostic('before_agent_start', beamCwd, { promptBytes: event.prompt?.length ?? 0 })
    await sendBridgeEvent(beamCwd, {
      type: 'before_agent_start',
      cwd: ctx.cwd,
      prompt: event.prompt
    })
  })

  pi.on('turn_start', async (event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return

    markTurnStart(beamCwd, ctx.sessionManager?.getSessionFile?.(), { turnIndex: event.turnIndex })
    await sendBridgeEvent(beamCwd, { type: 'turn_start', cwd: ctx.cwd, turnIndex: event.turnIndex })
  })

  pi.on('turn_end', async (event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return

    markTurnEnd(beamCwd, ctx.sessionManager?.getSessionFile?.(), { turnIndex: event.turnIndex })
    await sendBridgeEvent(beamCwd, { type: 'turn_end', cwd: ctx.cwd, turnIndex: event.turnIndex })
  })

  pi.on('resources_discover', async (_event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return {}

    recordDiagnostic('resources_discover', beamCwd)
    const kind = getConnectionKind(beamCwd)
    if (kind !== 'embedded' && kind !== 'external') return {}

    const skillPath = await discoverExecutableSkillPath(beamCwd)
    return skillPath ? { skillPaths: [skillPath] } : {}
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    recordDiagnostic('session_shutdown', ctx.cwd)
    const key = subscriptionKey(ctx)
    clearStatusSubscription(key)

    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (beamCwd) {
      await sendBridgeEvent(beamCwd, { type: 'session_shutdown', cwd: ctx.cwd })
      clearSessionSnapshots(beamCwd)
      ctx.ui.setWidget('elixir-sessions', undefined)
    }

    if (beamCwd && !hasStatusSubscriptionForCwd(beamCwd)) {
      stopEmbedded(beamCwd)
    }

    await writeDiagnosticDump('session_shutdown', { cwd: beamCwd ?? ctx.cwd }).catch(
      () => undefined
    )
  })

  registerEval(pi)
  registerExAstSearch(pi)
  registerExAstReplace(pi)
}

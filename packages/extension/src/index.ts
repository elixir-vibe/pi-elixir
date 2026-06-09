import { type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent'

import { registerBridgeCommands } from './bridge/plugin-commands.ts'
import { handleBridgeRequest } from './bridge/requests.ts'
import { showStartupInfo } from './bridge/startup-info.ts'
import { applyBridgeUIEvent, updateStatus } from './bridge/ui-events.ts'
import { callTool, resolveUrl, getConnectionKind, sendBridgeEvent } from './connection/resolver.ts'
import { onStatusChange } from './connection/status.ts'
import {
  getBridgeInfo,
  onBridgeBusEvent,
  onBridgeRequest,
  onBridgeUIEvent,
  stopEmbedded
} from './embedded/stdio-process.ts'
import { resolveMixProjectCwd } from './mix/project.ts'
import type { ToolArgs } from './protocol/types.ts'
import { registerSessionCommands } from './sessions/commands.ts'
import { renderSessionMessage } from './sessions/render.ts'
import {
  clearSessionSnapshots,
  handleSessionEvent,
  loadSessionSnapshots,
  refreshSessionSnapshots
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

interface PluginHookResponse {
  0?: string
  1?: string | ToolArgs
  block?: string
  ok?: ToolArgs
  error?: string
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

function parsePluginHookResponse(text: string): PluginHookResponse {
  try {
    return JSON.parse(text) as PluginHookResponse
  } catch {
    return {}
  }
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part !== 'object' || part === null) return ''
      const maybeText = (part as { text?: unknown }).text
      return typeof maybeText === 'string' ? maybeText : ''
    })
    .join('\n')
}

export default function (pi: ExtensionAPI) {
  const statusSubscriptions = new Map<string, StatusSubscription>()
  const registeredCommands = new Set<string>()
  pi.registerMessageRenderer('elixir-sessions', renderSessionMessage)
  registerSessionCommands(pi, registeredCommands, resolveElixirCwd)

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

    const conn = await resolveUrl(sessionCwd)
    updateStatus(ctx, conn?.kind ?? getConnectionKind(sessionCwd))
    if (conn) await loadSessionSnapshots(ctx, sessionCwd, conn.url)
    const info = getBridgeInfo(sessionCwd)
    showStartupInfo(ctx, info)
    registerBridgeCommands(pi, info, registeredCommands, resolveElixirCwd)
    await sendBridgeEvent(sessionCwd, { type: 'session_start', cwd: sessionCwd })
  })

  pi.on('before_agent_start', async (event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return

    await sendBridgeEvent(beamCwd, {
      type: 'before_agent_start',
      cwd: ctx.cwd,
      prompt: event.prompt
    })
  })

  pi.on('turn_start', async (event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return

    await sendBridgeEvent(beamCwd, { type: 'turn_start', cwd: ctx.cwd, turnIndex: event.turnIndex })
  })

  pi.on('turn_end', async (event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return

    await sendBridgeEvent(beamCwd, { type: 'turn_end', cwd: ctx.cwd, turnIndex: event.turnIndex })
  })

  pi.on('tool_call', async (event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return undefined

    await sendBridgeEvent(beamCwd, {
      type: 'tool_call',
      cwd: ctx.cwd,
      name: event.toolName
    })

    if (!hasBridgePlugins(beamCwd)) return undefined

    const conn = await resolveUrl(beamCwd)
    if (!conn) return undefined

    const result = await callTool(conn.url, 'pi_plugin_tool_call', {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input
    })
    const payload = parsePluginHookResponse(result.text)

    if (payload.block) return { block: true, reason: payload.block }
    if (payload.ok && typeof payload.ok === 'object') Object.assign(event.input, payload.ok)
    return undefined
  })

  pi.on('tool_result', async (event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return undefined

    if (event.toolName?.startsWith('elixir_'))
      await refreshSessionSnapshots(pi, ctx, resolveElixirCwd)

    await sendBridgeEvent(beamCwd, {
      type: 'tool_result',
      cwd: ctx.cwd,
      name: event.toolName,
      isError: event.isError
    })

    if (!hasBridgePlugins(beamCwd)) return undefined

    const conn = await resolveUrl(beamCwd)
    if (!conn) return undefined

    const result = await callTool(conn.url, 'pi_plugin_tool_result', {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input,
      content: textFromContent(event.content),
      isError: event.isError
    })
    const payload = parsePluginHookResponse(result.text)

    if (payload.ok && typeof payload.ok === 'object') {
      const patch = payload.ok
      return {
        content:
          typeof patch.content === 'string'
            ? [{ type: 'text' as const, text: patch.content }]
            : undefined,
        isError: typeof patch.isError === 'boolean' ? patch.isError : undefined
      }
    }

    return undefined
  })

  pi.on('resources_discover', async (_event, ctx) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return {}

    const skillPath = await discoverExecutableSkillPath(beamCwd)
    return skillPath ? { skillPaths: [skillPath] } : {}
  })

  pi.on('session_shutdown', async (_event, ctx) => {
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
  })

  registerEval(pi)
  registerExAstSearch(pi)
  registerExAstReplace(pi)
}

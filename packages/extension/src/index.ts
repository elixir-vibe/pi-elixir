import * as fs from 'node:fs'

import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'

import { showStartupInfo } from './bridge/startup-info.ts'
import {
  callTool,
  resolveUrl,
  getConnectionKind,
  sendBridgeEvent,
  type ConnectionKind
} from './connection/resolver.ts'
import { onStatusChange } from './connection/status.ts'
import {
  getBridgeInfo,
  onBridgeBusEvent,
  onBridgeRequest,
  onBridgeUIEvent,
  stopEmbedded,
  type BridgeUIEvent
} from './embedded/stdio-process.ts'
import type { BridgeInfo, BridgePluginCommand, StdioMessage, ToolArgs } from './protocol/types.ts'
import { discoverExecutableSkillPath } from './skills/executable-skills.ts'
import { register as registerEval } from './tools/eval.ts'
import { register as registerExAstReplace } from './tools/ex-ast-replace.ts'
import { register as registerExAstSearch } from './tools/ex-ast-search.ts'

interface StatusContext extends ExtensionContext {
  ui: ExtensionContext['ui'] & {
    theme: Theme
    setStatus: (id: string, text: string | undefined) => void
  }
}

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

interface PluginCommandResult {
  0?: string
  1?: string
  ok?: string
  error?: string
}

function isElixirProject(cwd: string): boolean {
  return fs.existsSync(`${cwd}/mix.exs`)
}

function subscriptionKey(ctx: ExtensionContext) {
  return `${ctx.cwd}:${ctx.sessionManager?.getSessionFile?.() ?? 'ephemeral'}`
}

function updateStatus(ctx: StatusContext, kind: ConnectionKind) {
  try {
    const t = ctx.ui.theme
    switch (kind) {
      case 'external':
        ctx.ui.setStatus('elixir', t.fg('success', '⬡') + ' ' + t.fg('muted', 'BEAM'))
        break
      case 'embedded':
        ctx.ui.setStatus('elixir', t.fg('success', '⬡') + ' ' + t.fg('muted', 'BEAM (embedded)'))
        break
      case 'starting':
        ctx.ui.setStatus('elixir', t.fg('warning', '⬡') + ' ' + t.fg('muted', 'BEAM starting…'))
        break
      case 'missing':
        ctx.ui.setStatus('elixir', t.fg('warning', '⬡') + ' ' + t.fg('muted', 'BEAM tools missing'))
        break
      default:
        ctx.ui.setStatus('elixir', t.fg('warning', '⬡') + ' ' + t.fg('muted', 'BEAM offline'))
    }
  } catch {
    // Status updates are best-effort. Session replacement can stale old UI contexts while embedded process callbacks are still finishing.
  }
}

function applyBridgeUIEvent(ctx: StatusContext, event: BridgeUIEvent) {
  try {
    const key = event.key ?? 'pi-bridge'

    switch (event.op) {
      case 'status':
        ctx.ui.setStatus(key, event.text)
        break
      case 'progress': {
        const title = event.title ?? key
        const value =
          typeof event.current === 'number' && typeof event.total === 'number'
            ? `${title} ${event.current}/${event.total}`
            : title
        ctx.ui.setStatus(key, value)
        break
      }
      case 'widget':
        ctx.ui.setWidget(key, event.lines, { placement: event.placement ?? 'belowEditor' })
        break
      case 'notify':
        ctx.ui.notify(event.message ?? '', event.level)
        break
    }
  } catch {
    // UI bridge events are best-effort; stale contexts can disappear during session replacement.
  }
}

function pluginCommandName(command: BridgePluginCommand): string | null {
  if (!command.name) return null
  return `elixir:${command.name}`
}

function registerBridgeCommands(
  pi: ExtensionAPI,
  info: BridgeInfo | undefined,
  registered: Set<string>
) {
  for (const command of info?.commands ?? []) {
    const name = pluginCommandName(command)
    if (!name || registered.has(name)) continue

    registered.add(name)
    pi.registerCommand(name, {
      description: command.description ?? `Run BEAM plugin command ${command.name}`,
      handler: async (args, ctx) => {
        const conn = await resolveUrl(ctx.cwd)
        if (!conn) {
          ctx.ui.notify('No BEAM connection for this project.', 'error')
          return
        }

        const result = await callTool(conn.url, 'pi_plugin_command', { name: command.name, args })
        const payload = parsePluginCommandResult(result.text)
        if (result.isError || payload.error) {
          ctx.ui.notify(payload.error ?? result.text, 'error')
          return
        }

        if (payload.ok) ctx.ui.notify(payload.ok, 'info')
      }
    })
  }
}

function parsePluginCommandResult(text: string): PluginCommandResult {
  try {
    return JSON.parse(text) as PluginCommandResult
  } catch {
    return { ok: text }
  }
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

async function handleBridgeRequest(
  message: StdioMessage,
  ctx: ExtensionContext,
  pi: ExtensionAPI
): Promise<Record<string, unknown> | undefined> {
  if (message.op === 'session_info') {
    return {
      ok: true,
      result: {
        cwd: ctx.cwd,
        mode: ctx.mode,
        hasUI: ctx.hasUI,
        sessionFile: ctx.sessionManager?.getSessionFile?.(),
        sessionName: pi.getSessionName(),
        leafId: ctx.sessionManager?.getLeafId?.(),
        isIdle: ctx.isIdle()
      }
    }
  }

  if (message.op === 'active_tools') {
    return { ok: true, result: { tools: pi.getActiveTools() } }
  }

  if (message.op === 'append_entry') {
    const customType = message.payload?.customType
    const data = message.payload?.data
    if (typeof customType !== 'string' || typeof data !== 'object' || data === null) {
      return { ok: false, error: 'append_entry requires customType and data' }
    }

    pi.appendEntry(customType, data as Record<string, unknown>)
    return { ok: true, result: 'ok' }
  }

  return undefined
}

export default function (pi: ExtensionAPI) {
  const statusSubscriptions = new Map<string, StatusSubscription>()
  const registeredCommands = new Set<string>()

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

    if (!isElixirProject(ctx.cwd)) return

    const sessionCwd = ctx.cwd
    const unsubscribeStatus = onStatusChange((cwd, kind) => {
      if (cwd === sessionCwd) updateStatus(ctx, kind)
    })
    const unsubscribeUI = onBridgeUIEvent((cwd, event) => {
      if (cwd === sessionCwd) applyBridgeUIEvent(ctx, event)
    })
    const unsubscribeBus = onBridgeBusEvent((cwd, event) => {
      if (cwd === sessionCwd && event.name) pi.events.emit(event.name, event.data)
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
    const info = getBridgeInfo(sessionCwd)
    showStartupInfo(ctx, info)
    registerBridgeCommands(pi, info, registeredCommands)
    await sendBridgeEvent(sessionCwd, { type: 'session_start', cwd: sessionCwd })
  })

  pi.on('before_agent_start', async (event, ctx) => {
    await sendBridgeEvent(ctx.cwd, {
      type: 'before_agent_start',
      cwd: ctx.cwd,
      prompt: event.prompt
    })
  })

  pi.on('turn_start', async (event, ctx) => {
    await sendBridgeEvent(ctx.cwd, { type: 'turn_start', cwd: ctx.cwd, turnIndex: event.turnIndex })
  })

  pi.on('turn_end', async (event, ctx) => {
    await sendBridgeEvent(ctx.cwd, { type: 'turn_end', cwd: ctx.cwd, turnIndex: event.turnIndex })
  })

  pi.on('tool_call', async (event, ctx) => {
    await sendBridgeEvent(ctx.cwd, {
      type: 'tool_call',
      cwd: ctx.cwd,
      name: event.toolName
    })

    const conn = await resolveUrl(ctx.cwd)
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
    await sendBridgeEvent(ctx.cwd, {
      type: 'tool_result',
      cwd: ctx.cwd,
      name: event.toolName,
      isError: event.isError
    })

    const conn = await resolveUrl(ctx.cwd)
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
    if (!isElixirProject(ctx.cwd)) return {}

    const skillPath = await discoverExecutableSkillPath(ctx.cwd)
    return skillPath ? { skillPaths: [skillPath] } : {}
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    const key = subscriptionKey(ctx)
    clearStatusSubscription(key)

    await sendBridgeEvent(ctx.cwd, { type: 'session_shutdown', cwd: ctx.cwd })

    if (!hasStatusSubscriptionForCwd(ctx.cwd)) {
      stopEmbedded(ctx.cwd)
    }
  })

  registerEval(pi)
  registerExAstSearch(pi)
  registerExAstReplace(pi)
}

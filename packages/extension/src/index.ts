import {
  keyHint,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

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
import { resolveMixProjectCwd } from './mix/project.ts'
import type {
  BridgeBusEvent,
  BridgeInfo,
  BridgePluginCommand,
  StdioMessage,
  ToolArgs
} from './protocol/types.ts'
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

interface SessionSnapshot {
  id?: string
  parentId?: string | null
  name?: string | null
  status?: string
  latest?: string | null
  messageCount?: number
  events?: Array<{ type?: string; at?: string | null }>
}

const sessionSnapshots = new Map<string, Map<string, SessionSnapshot>>()

function resolveElixirCwd(cwd: string): string | null {
  return resolveMixProjectCwd(cwd)
}

function subscriptionKey(ctx: ExtensionContext) {
  return `${ctx.cwd}:${ctx.sessionManager?.getSessionFile?.() ?? 'ephemeral'}`
}

function hasBridgePlugins(cwd: string): boolean {
  return (getBridgeInfo(cwd)?.plugins?.length ?? 0) > 0
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
        const beamCwd = resolveElixirCwd(ctx.cwd)
        const conn = beamCwd ? await resolveUrl(beamCwd) : null
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

function compact(text: string | null | undefined, limit = 72) {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value
}

function sessionIcon(status: string | undefined, theme: Theme) {
  switch (status) {
    case 'done':
      return theme.fg('success', '✓')
    case 'failed':
      return theme.fg('error', '✗')
    case 'cancelled':
      return theme.fg('warning', '○')
    case 'running':
      return theme.fg('warning', '●')
    default:
      return theme.fg('muted', '○')
  }
}

function renderSessionWidget(sessions: SessionSnapshot[], theme: Theme) {
  const roots = sessions.filter((session) => !session.parentId)
  const children = new Map<string, SessionSnapshot[]>()
  for (const session of sessions) {
    if (!session.parentId) continue
    const bucket = children.get(session.parentId) ?? []
    bucket.push(session)
    children.set(session.parentId, bucket)
  }

  const lines: string[] = []
  const render = (session: SessionSnapshot, depth: number) => {
    const label = session.name || session.id || 'session'
    const latest = compact(session.latest)
    const status = session.status && session.status !== 'idle' ? ` ${session.status}` : ''
    const prefix = depth > 0 ? `${'  '.repeat(depth - 1)}  └─ ` : ''
    lines.push(
      `${prefix}${sessionIcon(session.status, theme)} ${theme.fg('accent', label)}${theme.fg('muted', status)}${latest ? `  ${theme.fg('toolOutput', latest)}` : ''}`
    )

    for (const child of children.get(session.id ?? '') ?? []) render(child, depth + 1)
  }

  for (const root of roots.slice(0, 8)) render(root, 0)
  if (sessions.length > 8) lines.push(theme.fg('muted', `… ${sessions.length - 8} more`))
  if (sessions.length > 1)
    lines.push(theme.fg('muted', `  (${keyHint('app.tools.expand', 'to expand')})`))
  return new Text(lines.join('\n'), 0, 0)
}

function updateSessionWidget(ctx: StatusContext, cwd: string) {
  const snapshots = Array.from(sessionSnapshots.get(cwd)?.values() ?? [])
  if (snapshots.length === 0) {
    ctx.ui.setWidget('elixir-sessions', undefined)
    return
  }

  ctx.ui.setWidget('elixir-sessions', (_tui, theme) => renderSessionWidget(snapshots, theme), {
    placement: 'belowEditor'
  })
}

function handleSessionEvent(ctx: StatusContext, cwd: string, event: BridgeBusEvent) {
  const data = event.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return
  const session = (data as { session?: unknown }).session
  if (typeof session !== 'object' || session === null || Array.isArray(session)) return

  const snapshot = session as SessionSnapshot
  if (!snapshot.id) return
  const cwdSnapshots = sessionSnapshots.get(cwd) ?? new Map<string, SessionSnapshot>()
  cwdSnapshots.set(snapshot.id, snapshot)
  sessionSnapshots.set(cwd, cwdSnapshots)
  updateSessionWidget(ctx, cwd)
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
      if (event.name === 'pi_session') handleSessionEvent(ctx, cwd, event)
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
    const info = getBridgeInfo(sessionCwd)
    showStartupInfo(ctx, info)
    registerBridgeCommands(pi, info, registeredCommands)
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
      sessionSnapshots.delete(beamCwd)
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

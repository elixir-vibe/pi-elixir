import * as fs from 'node:fs'

import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'

import { showStartupInfo } from './bridge/startup-info.ts'
import {
  resolveUrl,
  getConnectionKind,
  sendBridgeEvent,
  type ConnectionKind
} from './connection/resolver.ts'
import { onStatusChange } from './connection/status.ts'
import {
  getBridgeInfo,
  onBridgeUIEvent,
  stopEmbedded,
  type BridgeUIEvent
} from './embedded/stdio-process.ts'
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

export default function (pi: ExtensionAPI) {
  const statusSubscriptions = new Map<
    string,
    { cwd: string; unsubscribeStatus: () => void; unsubscribeUI: () => void }
  >()

  function clearStatusSubscription(key: string) {
    const subscription = statusSubscriptions.get(key)
    subscription?.unsubscribeStatus()
    subscription?.unsubscribeUI()
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
    statusSubscriptions.set(key, { cwd: sessionCwd, unsubscribeStatus, unsubscribeUI })

    const conn = await resolveUrl(sessionCwd)
    updateStatus(ctx, conn?.kind ?? getConnectionKind(sessionCwd))
    showStartupInfo(ctx, getBridgeInfo(sessionCwd))
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
  })

  pi.on('tool_result', async (event, ctx) => {
    await sendBridgeEvent(ctx.cwd, {
      type: 'tool_result',
      cwd: ctx.cwd,
      name: event.toolName,
      isError: event.isError
    })
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

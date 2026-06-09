import { truncateLine } from '#src/helpers.ts'
import { keyHint, type Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

import type { SessionSnapshot, SessionUsage } from './types.ts'

const COMPACT_MAX_LINES = 12
const EXPANDED_MAX_LINES = 28
const STALE_ACTIVITY_MS = 30_000

function compact(text: string | null | undefined, limit = 72) {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value
}

function quotePreview(text: string | null | undefined, limit = 92) {
  const value = compact(text, limit)
  return value ? `“${value}”` : ''
}

function formatUsageNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`
}

function costDecimals(value: number) {
  if (value < 0.001) return 5
  if (value < 0.01) return 4
  if (value < 1) return 3
  return 2
}

function formatCost(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return `$${value.toFixed(costDecimals(value)).replace(/0+$/u, '').replace(/\.$/u, '')}`
}

function usageSummary(usage: SessionUsage | null | undefined) {
  if (!usage) return ''
  const input = formatUsageNumber(usage.input)
  const output = formatUsageNumber(usage.output)
  const cost = formatCost(usage.cost?.total)
  return [input ? `↑${input}` : undefined, output ? `↓${output}` : undefined, cost]
    .filter(Boolean)
    .join(' ')
}

function sumField(target: Record<string, number | undefined>, source: unknown, key: string) {
  if (typeof source !== 'object' || source === null) return
  const value = (source as Record<string, unknown>)[key]
  target[key] = (target[key] ?? 0) + (typeof value === 'number' ? value : 0)
}

function addUsage(total: SessionUsage, usage: SessionUsage | null | undefined) {
  if (!usage) return total

  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) {
    sumField(total as Record<string, number | undefined>, usage, key)
  }

  const cost = { ...total.cost }
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) {
    sumField(cost, usage.cost, key)
  }
  total.cost = cost
  return total
}

function aggregateUsage(sessions: SessionSnapshot[]) {
  const total = sessions.reduce<SessionUsage>((acc, session) => addUsage(acc, session.usage), {})
  return usageSummary(total)
}

function parseTime(value: string | null | undefined) {
  if (!value) return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

function formatDurationMs(ms: number | null | undefined) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1_000) return `${Math.round(ms)}ms`
  const seconds = ms / 1_000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m${remainder ? ` ${remainder}s` : ''}`
}

function expansionHint() {
  try {
    return keyHint('app.tools.expand', 'to expand')
  } catch {
    return 'expand for details'
  }
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

function countStatuses(sessions: SessionSnapshot[]) {
  return {
    done: sessions.filter((session) => session.status === 'done').length,
    running: sessions.filter((session) => session.status === 'running').length,
    failed: sessions.filter((session) => session.status === 'failed').length,
    cancelled: sessions.filter((session) => session.status === 'cancelled').length
  }
}

function activitySummary(session: SessionSnapshot, now = Date.now()) {
  if (session.status !== 'running') return ''
  const lastActivity = parseTime(session.lastActivityAt ?? session.updatedAt)
  const currentStarted = parseTime(session.currentStartedAt)
  if (lastActivity !== undefined && now - lastActivity >= STALE_ACTIVITY_MS) {
    return `no activity ${formatDurationMs(now - lastActivity)}`
  }
  if (session.current && currentStarted !== undefined) {
    return `${compact(session.current, 24)} ${formatDurationMs(now - currentStarted)}`
  }
  if (lastActivity === undefined) return 'active'
  const age = now - lastActivity
  return age < 1_000 ? 'active now' : `active ${formatDurationMs(age)} ago`
}

function statusSummary(counts: ReturnType<typeof countStatuses>) {
  return [
    counts.done > 0 ? `${counts.done} done` : undefined,
    counts.running > 0 ? `${counts.running} running` : undefined,
    counts.failed > 0 ? `${counts.failed} failed` : undefined,
    counts.cancelled > 0 ? `${counts.cancelled} cancelled` : undefined
  ].filter(Boolean)
}

function synthesis(
  session: SessionSnapshot,
  children: Map<string, SessionSnapshot[]>,
  theme: Theme
) {
  const tree = collectSessionTree(session, children, [])
  if (tree.length < 2) return undefined

  const parts = statusSummary(countStatuses(tree.slice(1)))
  const usage = aggregateUsage(tree)
  if (usage) parts.push(usage)
  return parts.length > 0 ? theme.fg('muted', parts.join(' · ')) : undefined
}

export function sessionChildren(sessions: SessionSnapshot[]) {
  const children = new Map<string, SessionSnapshot[]>()
  for (const session of sessions) {
    const parentId = session.parentId
    if (!parentId) continue
    const bucket = children.get(parentId) ?? []
    bucket.push(session)
    children.set(parentId, bucket)
  }
  return children
}

export function isTerminalSession(session: Pick<SessionSnapshot, 'status'>) {
  return session.status === 'done' || session.status === 'failed' || session.status === 'cancelled'
}

function aggregateStatus(
  session: SessionSnapshot,
  children: Map<string, SessionSnapshot[]>
): string | undefined {
  const childSessions = children.get(session.id ?? '') ?? []
  if (childSessions.length === 0) return session.status
  if (childSessions.some((child) => aggregateStatus(child, children) === 'running'))
    return 'running'
  if (childSessions.some((child) => aggregateStatus(child, children) === 'failed')) return 'failed'
  if (childSessions.every((child) => aggregateStatus(child, children) === 'cancelled'))
    return 'cancelled'
  if (
    childSessions.every((child) => isTerminalSession({ status: aggregateStatus(child, children) }))
  )
    return session.status === 'idle' ? 'done' : session.status
  return session.status
}

function livePreview(session: SessionSnapshot) {
  return session.recentOutput?.at(-1) ?? session.latest
}

function sessionPreview(session: SessionSnapshot) {
  if (session.status === 'running') return compact(livePreview(session))
  if (session.status === 'failed')
    return compact(session.error ?? session.response ?? session.latest)
  if (session.status === 'cancelled') return compact(session.latest ?? session.prompt)
  return compact(session.response ?? session.latest)
}

export function hasActiveSession(
  session: SessionSnapshot,
  children: Map<string, SessionSnapshot[]>
): boolean {
  if (session.status === 'running') return true
  return (children.get(session.id ?? '') ?? []).some((child) => hasActiveSession(child, children))
}

export function collectSessionTree(
  session: SessionSnapshot,
  children: Map<string, SessionSnapshot[]>,
  out: SessionSnapshot[] = []
) {
  out.push(session)
  for (const child of children.get(session.id ?? '') ?? []) collectSessionTree(child, children, out)
  return out
}

export function completedRootTrees(sessions: SessionSnapshot[]) {
  const children = sessionChildren(sessions)
  const roots = sessions.filter((session) => !session.parentId)
  return roots
    .filter((root) => {
      const tree = collectSessionTree(root, children, [])
      return (
        tree.length > 1 &&
        tree.every((session) => session.status === 'idle' || isTerminalSession(session))
      )
    })
    .map((root) => collectSessionTree(root, children, []))
}

export function activeSessionTree(sessions: SessionSnapshot[]) {
  const children = sessionChildren(sessions)
  const roots = sessions.filter((session) => !session.parentId)
  return roots
    .filter((root) => hasActiveSession(root, children))
    .flatMap((root) => collectSessionTree(root, children, []))
}

export function completionSignature(tree: SessionSnapshot[]) {
  return tree
    .map((session) =>
      [
        session.id,
        session.runCount,
        session.status,
        session.completedAt,
        session.updatedAt,
        session.result,
        session.error
      ]
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part ?? null)))
        .join(':')
    )
    .join('|')
}

function treePrefixes(prefix: string, isLast: boolean, isRoot: boolean) {
  if (isRoot) return { branch: '', detail: '    ', child: '  ' }
  return {
    branch: `${prefix}${isLast ? '└─ ' : '├─ '}`,
    detail: `${prefix}${isLast ? '   ' : '│  '}`,
    child: `${prefix}${isLast ? '   ' : '│  '}`
  }
}

function sessionStatusSuffix(status: string | undefined) {
  return status === 'failed' || status === 'cancelled' ? ` ${status}` : ''
}

function sessionRow(
  session: SessionSnapshot,
  children: Map<string, SessionSnapshot[]>,
  theme: Theme,
  branch: string
) {
  const label = session.name || session.id || 'session'
  const effectiveStatus = aggregateStatus(session, children)
  const latest = sessionPreview(session)
  const usage = usageSummary(session.usage)
  const activity = activitySummary(session)
  const suffix = [usage, activity].filter(Boolean).join(' · ')
  return `${branch}${sessionIcon(effectiveStatus, theme)} ${theme.fg('accent', label)}${theme.fg('muted', sessionStatusSuffix(session.status))}${latest ? `  ${theme.fg('toolOutput', latest)}` : ''}${suffix ? `  ${theme.fg('muted', suffix)}` : ''}`
}

function sessionTimeline(session: SessionSnapshot) {
  return session.events
    ?.map((sessionEvent) => sessionEvent.type)
    .filter((type): type is string => typeof type === 'string' && type.length > 0)
    .join(' → ')
}

function sessionDetailLines(session: SessionSnapshot, latest: string, theme: Theme) {
  const lines: string[] = []
  const prompt = quotePreview(session.prompt)
  if (prompt) lines.push(theme.fg('muted', prompt))

  const activity = activitySummary(session)
  if (activity) lines.push(theme.fg('warning', `… ${activity}`))
  else {
    const current = compact(session.current)
    if (current) lines.push(theme.fg('warning', `… ${current}`))
  }

  for (const output of session.recentOutput?.slice(-3) ?? []) {
    const preview = compact(output)
    if (preview && preview !== latest) lines.push(theme.fg('muted', `… ${preview}`))
  }

  const response = compact(session.response)
  if (response && response !== latest) lines.push(theme.fg('muted', `→ ${response}`))

  const error = compact(session.error)
  if (error && error !== latest) lines.push(theme.fg('error', `✗ ${error}`))

  const timeline = sessionTimeline(session)
  const duration = formatDurationMs(session.durationMs)
  const turns =
    session.turnCount && session.turnCount > 0
      ? `${session.turnCount} turn${session.turnCount === 1 ? '' : 's'}`
      : undefined
  const trail = [timeline, timeline ? duration : undefined, turns].filter(Boolean).join(' · ')
  if (trail) lines.push(theme.fg('muted', trail))
  return lines
}

function applyLineBudget(
  lines: string[],
  theme: Theme,
  expanded: boolean,
  showExpandHint: boolean
) {
  const maxLines = expanded ? EXPANDED_MAX_LINES : COMPACT_MAX_LINES
  const reserved = showExpandHint ? 1 : 0
  if (lines.length <= maxLines - reserved) {
    return showExpandHint ? [...lines, theme.fg('muted', `  (${expansionHint()})`)] : lines
  }

  const available = Math.max(1, maxLines - reserved - 1)
  const visible = lines.slice(0, available)
  const hidden = lines.length - visible.length

  visible.push(theme.fg('muted', `… ${hidden} hidden`))
  if (showExpandHint) visible.push(theme.fg('muted', `  (${expansionHint()})`))
  return visible
}

function sessionWidgetLines(sessions: SessionSnapshot[], theme: Theme, expanded = false) {
  const roots = sessions.filter((session) => !session.parentId)
  const children = sessionChildren(sessions)

  const lines: string[] = []
  const render = (session: SessionSnapshot, prefix = '', isLast = true, isRoot = false) => {
    const { branch, detail, child: childPrefix } = treePrefixes(prefix, isLast, isRoot)
    const latest = sessionPreview(session)
    lines.push(sessionRow(session, children, theme, branch))

    const summary = synthesis(session, children, theme)
    if (summary) lines.push(`${isRoot ? '  ' : detail}${summary}`)

    if (expanded) {
      for (const line of sessionDetailLines(session, latest, theme)) lines.push(`${detail}${line}`)
    }

    const childSessions = children.get(session.id ?? '') ?? []
    childSessions.forEach((child, index) => {
      render(child, childPrefix, index === childSessions.length - 1)
    })
  }

  roots.forEach((root, index) => render(root, '', index === roots.length - 1, true))
  return applyLineBudget(lines, theme, expanded, !expanded && sessions.length > 1)
}

export function renderSessionWidget(
  sessions: SessionSnapshot[],
  theme: Theme,
  expanded = false
): Component {
  return {
    render: (width) =>
      sessionWidgetLines(sessions, theme, expanded).map((line) => truncateLine(line, width)),
    invalidate: () => undefined
  }
}

export function renderSessionMessage(
  message: { details?: { sessions?: SessionSnapshot[] } },
  options: { expanded: boolean },
  theme: Theme
) {
  const sessions = message.details?.sessions
  if (!Array.isArray(sessions) || sessions.length === 0) return undefined
  return renderSessionWidget(sessions, theme, options.expanded)
}

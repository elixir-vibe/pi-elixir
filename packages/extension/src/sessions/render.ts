import { keyHint, type Theme } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import type { SessionSnapshot } from './types.ts'

function compact(text: string | null | undefined, limit = 72) {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value
}

function quotePreview(text: string | null | undefined, limit = 92) {
  const value = compact(text, limit)
  return value ? `“${value}”` : ''
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
  const childSessions = children.get(session.id ?? '') ?? []
  if (childSessions.length < 2) return undefined

  const parts = statusSummary(countStatuses(childSessions))
  return parts.length > 0 ? theme.fg('muted', `  ${parts.join(' · ')}`) : undefined
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

function sessionPreview(session: SessionSnapshot) {
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
      [session.id, session.status, session.updatedAt, session.result, session.error]
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
  return `${branch}${sessionIcon(effectiveStatus, theme)} ${theme.fg('accent', label)}${theme.fg('muted', sessionStatusSuffix(session.status))}${latest ? `  ${theme.fg('toolOutput', latest)}` : ''}`
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

  const response = compact(session.response)
  if (response && response !== latest) lines.push(theme.fg('muted', `→ ${response}`))

  const error = compact(session.error)
  if (error && error !== latest) lines.push(theme.fg('error', `✗ ${error}`))

  const timeline = sessionTimeline(session)
  const duration = formatDurationMs(session.durationMs)
  const trail = [timeline, timeline ? duration : undefined].filter(Boolean).join(' · ')
  if (trail) lines.push(theme.fg('muted', trail))
  return lines
}

export function renderSessionWidget(sessions: SessionSnapshot[], theme: Theme, expanded = false) {
  const roots = sessions.filter((session) => !session.parentId)
  const children = sessionChildren(sessions)

  const lines: string[] = []
  const render = (session: SessionSnapshot, prefix = '', isLast = true, isRoot = false) => {
    const { branch, detail, child: childPrefix } = treePrefixes(prefix, isLast, isRoot)
    const latest = sessionPreview(session)
    lines.push(sessionRow(session, children, theme, branch))

    const summary = synthesis(session, children, theme)
    if (summary) lines.push(`${branch}${summary}`)

    if (expanded) {
      for (const line of sessionDetailLines(session, latest, theme)) lines.push(`${detail}${line}`)
    }

    const childSessions = children.get(session.id ?? '') ?? []
    childSessions.forEach((child, index) => {
      render(child, childPrefix, index === childSessions.length - 1)
    })
  }

  roots.slice(0, 8).forEach((root) => render(root, '', true, true))
  if (sessions.length > 8) lines.push(theme.fg('muted', `… ${sessions.length - 8} more`))
  if (!expanded && sessions.length > 1)
    lines.push(theme.fg('muted', `  (${keyHint('app.tools.expand', 'to expand')})`))
  return new Text(lines.join('\n'), 0, 0)
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

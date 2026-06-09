import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { callTool, resolveUrl } from '../connection/resolver.ts'
import { recordDiagnostic } from '../diagnostics.ts'
import type { BridgeBusEvent } from '../protocol/types.ts'
import {
  activeSessionTree,
  completedRootTrees,
  completionSignature,
  renderSessionWidget
} from './render.ts'
import type { SessionSnapshot, StatusContext } from './types.ts'

const sessionSnapshots = new Map<string, Map<string, SessionSnapshot>>()
const emittedCompletedSessionRoots = new Map<string, Set<string>>()

export function storeSessionSnapshot(cwd: string, snapshot: SessionSnapshot) {
  if (!snapshot.id) return
  const cwdSnapshots = sessionSnapshots.get(cwd) ?? new Map<string, SessionSnapshot>()
  cwdSnapshots.set(snapshot.id, snapshot)
  sessionSnapshots.set(cwd, cwdSnapshots)
}

export function clearSessionSnapshots(cwd: string) {
  sessionSnapshots.delete(cwd)
  emittedCompletedSessionRoots.delete(cwd)
}

export function updateSessionWidget(ctx: StatusContext, cwd: string) {
  const snapshots = activeSessionTree(Array.from(sessionSnapshots.get(cwd)?.values() ?? []))
  if (snapshots.length === 0) {
    ctx.ui.setWidget('elixir-sessions', undefined)
    return
  }

  ctx.ui.setWidget('elixir-sessions', (_tui, theme) => renderSessionWidget(snapshots, theme), {
    placement: 'belowEditor'
  })
}

export function persistSessionSnapshots(pi: ExtensionAPI, cwd: string) {
  const sessions = Array.from(sessionSnapshots.get(cwd)?.values() ?? [])
  if (sessions.length === 0) return
  pi.appendEntry('elixir-sessions', { cwd, sessions })
}

export function emitCompletedSessionMessages(pi: ExtensionAPI, cwd: string) {
  const snapshots = Array.from(sessionSnapshots.get(cwd)?.values() ?? [])
  const emitted = emittedCompletedSessionRoots.get(cwd) ?? new Set<string>()
  for (const tree of completedRootTrees(snapshots)) {
    const root = tree[0]
    const rootId = root?.id
    if (!rootId) continue
    const signature = `${rootId}:${completionSignature(tree)}`
    if (emitted.has(signature)) continue
    emitted.add(signature)
    pi.sendMessage({
      customType: 'elixir-sessions',
      content: '',
      display: true,
      details: { cwd, sessions: tree }
    })
  }
  emittedCompletedSessionRoots.set(cwd, emitted)
}

export function handleSessionEvent(
  pi: ExtensionAPI,
  ctx: StatusContext,
  cwd: string,
  event: BridgeBusEvent
) {
  const data = event.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return
  const session = (data as { session?: unknown }).session
  if (typeof session !== 'object' || session === null || Array.isArray(session)) return

  const snapshot = session as SessionSnapshot
  if (!snapshot.id) return
  storeSessionSnapshot(cwd, snapshot)
  updateSessionWidget(ctx, cwd)
  persistSessionSnapshots(pi, cwd)
  emitCompletedSessionMessages(pi, cwd)
}

const SNAPSHOT_TIMEOUT_MS = 1_000

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms).unref()
  return controller.signal
}

export async function loadSessionSnapshots(ctx: StatusContext, cwd: string, connUrl: string) {
  try {
    recordDiagnostic('session_snapshots_start', cwd)
    const result = await callTool(
      connUrl,
      'pi_session_snapshots',
      {},
      timeoutSignal(SNAPSHOT_TIMEOUT_MS)
    )
    if (result.isError) return
    const payload = JSON.parse(result.text) as { sessions?: unknown }
    if (!Array.isArray(payload.sessions)) return
    for (const session of payload.sessions) {
      if (typeof session === 'object' && session !== null && !Array.isArray(session)) {
        storeSessionSnapshot(cwd, session as SessionSnapshot)
      }
    }
    updateSessionWidget(ctx, cwd)
    recordDiagnostic('session_snapshots_done', cwd)
  } catch (error) {
    recordDiagnostic('session_snapshots_error', cwd, {
      error: error instanceof Error ? error.message : String(error)
    })
    // Snapshot restore is best-effort.
  }
}

export async function refreshSessionSnapshots(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  resolveElixirCwd: (cwd: string) => string | null
) {
  const beamCwd = resolveElixirCwd(ctx.cwd)
  if (!beamCwd) return
  recordDiagnostic('session_snapshots_refresh_start', beamCwd)
  const conn = await resolveUrl(beamCwd)
  if (!conn) return
  await loadSessionSnapshots(ctx as StatusContext, beamCwd, conn.url)
  persistSessionSnapshots(pi, beamCwd)
  emitCompletedSessionMessages(pi, beamCwd)
  recordDiagnostic('session_snapshots_refresh_done', beamCwd)
}

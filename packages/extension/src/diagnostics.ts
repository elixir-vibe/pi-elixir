import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

interface DiagnosticEvent {
  timestamp: string
  kind: string
  cwd?: string
  data?: Record<string, unknown>
}

const MAX_EVENTS = 300
const LAG_THRESHOLD_MS = 250
const SAMPLE_INTERVAL_MS = 100

const events: DiagnosticEvent[] = []
const activeTurns = new Map<string, { cwd: string; startedAt: number }>()
let monitorStarted = false
let lastTick = Date.now()
let lastDumpAt = 0
let dumpCounter = 0

function sessionKey(cwd: string, sessionFile?: string): string {
  return `${cwd}:${sessionFile ?? 'ephemeral'}`
}

function push(event: DiagnosticEvent): void {
  events.push(event)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

export function recordDiagnostic(kind: string, cwd?: string, data?: Record<string, unknown>): void {
  push({ timestamp: new Date().toISOString(), kind, cwd, data })
}

export function markTurnStart(
  cwd: string,
  sessionFile?: string,
  data?: Record<string, unknown>
): void {
  activeTurns.set(sessionKey(cwd, sessionFile), { cwd, startedAt: Date.now() })
  recordDiagnostic('turn_start', cwd, data)
}

export function markTurnEnd(
  cwd: string,
  sessionFile?: string,
  data?: Record<string, unknown>
): void {
  activeTurns.delete(sessionKey(cwd, sessionFile))
  recordDiagnostic('turn_end', cwd, data)
}

export async function writeDiagnosticDump(
  reason: string,
  data?: Record<string, unknown>
): Promise<string> {
  const file = path.join(tmpdir(), `pi-elixir-debug-${process.pid}-${++dumpCounter}.json`)
  const now = Date.now()
  const payload = {
    reason,
    createdAt: new Date().toISOString(),
    pid: process.pid,
    activeTurns: Array.from(activeTurns.values()).map((turn) => ({
      cwd: turn.cwd,
      activeMs: now - turn.startedAt
    })),
    events,
    data
  }
  await writeFile(file, JSON.stringify(payload, null, 2))
  recordDiagnostic('debug_dump', undefined, { reason, file })
  return file
}

export function startEventLoopLagMonitor(): void {
  if (monitorStarted) return
  monitorStarted = true
  lastTick = Date.now()

  setInterval(() => {
    const now = Date.now()
    const lagMs = now - lastTick - SAMPLE_INTERVAL_MS
    lastTick = now

    if (lagMs < LAG_THRESHOLD_MS || activeTurns.size === 0) return

    recordDiagnostic('event_loop_lag', undefined, { lagMs })

    if (now - lastDumpAt < 5_000) return
    lastDumpAt = now
    void writeDiagnosticDump('event_loop_lag', { lagMs }).catch(() => {
      // Diagnostics must never make extension failures worse.
    })
  }, SAMPLE_INTERVAL_MS).unref()
}

export function diagnosticSummary(): Record<string, unknown> {
  const now = Date.now()
  return {
    activeTurns: Array.from(activeTurns.values()).map((turn) => ({
      cwd: turn.cwd,
      activeMs: now - turn.startedAt
    })),
    recentEvents: events.slice(-50)
  }
}

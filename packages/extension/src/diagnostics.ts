import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
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
const DEBUG_ENV = process.env.PI_ELIXIR_DEBUG?.toLowerCase()
const DEBUG_ENABLED =
  DEBUG_ENV === '1' || DEBUG_ENV === 'true' || DEBUG_ENV === 'debug' || DEBUG_ENV === 'verbose'
const DEBUG_VERBOSE = DEBUG_ENV === 'verbose'
const DEBUG_LOG_PATH =
  process.env.PI_ELIXIR_DEBUG_LOG ?? path.join(homedir(), '.pi', 'agent', 'pi-elixir-debug.log')

const events: DiagnosticEvent[] = []
const activeTurns = new Map<string, { cwd: string; startedAt: number }>()
const activeSpans = new Map<
  number,
  { kind: string; cwd?: string; startedAt: number; data?: Record<string, unknown> }
>()
let nextSpanId = 0
let monitorStarted = false
let lastTick = Date.now()
let lastDumpAt = 0

function sessionKey(cwd: string, sessionFile?: string): string {
  return `${cwd}:${sessionFile ?? 'ephemeral'}`
}

function push(event: DiagnosticEvent): void {
  events.push(event)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

function compactData(
  data: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!data || DEBUG_VERBOSE) return data
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (typeof value === 'string' && value.length > 200) return [key, `${value.slice(0, 200)}…`]
      return [key, value]
    })
  )
}

export function recordDiagnostic(kind: string, cwd?: string, data?: Record<string, unknown>): void {
  push({ timestamp: new Date().toISOString(), kind, cwd, data })
}

export async function withDiagnosticSpan<T>(
  kind: string,
  cwd: string | undefined,
  data: Record<string, unknown> | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const id = ++nextSpanId
  const startedAt = Date.now()
  activeSpans.set(id, { kind, cwd, startedAt, data })
  recordDiagnostic(`${kind}_start`, cwd, data)

  try {
    const result = await fn()
    recordDiagnostic(`${kind}_done`, cwd, { ...data, durationMs: Date.now() - startedAt })
    return result
  } catch (error) {
    recordDiagnostic(`${kind}_error`, cwd, {
      ...data,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  } finally {
    activeSpans.delete(id)
  }
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

function activeDiagnosticState(now: number): Record<string, unknown> {
  return {
    activeTurns: Array.from(activeTurns.values()).map((turn) => ({
      cwd: turn.cwd,
      activeMs: now - turn.startedAt
    })),
    activeSpans: Array.from(activeSpans.values()).map((span) => ({
      kind: span.kind,
      cwd: span.cwd,
      activeMs: now - span.startedAt,
      data: compactData(span.data)
    }))
  }
}

export async function writeDiagnosticDump(
  reason: string,
  data?: Record<string, unknown>
): Promise<string> {
  const file = DEBUG_LOG_PATH
  const payload = {
    reason,
    createdAt: new Date().toISOString(),
    pid: process.pid,
    ...activeDiagnosticState(Date.now()),
    events: DEBUG_VERBOSE
      ? events
      : events.map((event) => ({ ...event, data: compactData(event.data) })),
    data: compactData(data)
  }
  await mkdir(path.dirname(file), { recursive: true })
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

    if (!DEBUG_ENABLED || now - lastDumpAt < 5_000) return
    lastDumpAt = now
    void writeDiagnosticDump('event_loop_lag', { lagMs }).catch(() => {
      // Diagnostics must never make extension failures worse.
    })
  }, SAMPLE_INTERVAL_MS).unref()
}

export function diagnosticSummary(): Record<string, unknown> {
  return {
    ...activeDiagnosticState(Date.now()),
    recentEvents: events.slice(-50)
  }
}

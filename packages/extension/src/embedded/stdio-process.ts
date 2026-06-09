import * as childProcess from 'node:child_process'

import { connectionCache, emitStatusChange, invalidateCache } from '../connection/status.ts'
import type {
  BridgeBusEvent,
  BridgeEvent,
  BridgeInfo,
  BridgeUIEvent,
  PendingToolCall,
  StdioMessage,
  ToolArgs,
  ToolResult
} from '../protocol/types.ts'

const START_STDIO_EXPR = 'Pi.Transport.Stdio.start()'

interface EmbeddedProcess {
  proc: childProcess.ChildProcess
  ready: boolean
  url: string
  buffer: string
  nextId: number
  pending: Map<number, PendingToolCall>
}

export type { BridgeInfo, BridgeUIEvent }

type UIEventListener = (cwd: string, event: BridgeUIEvent) => void
type BusEventListener = (cwd: string, event: BridgeBusEvent) => void
type BridgeRequestHandler = (
  cwd: string,
  message: StdioMessage
) => Promise<Record<string, unknown> | undefined>

const bridgeInfo = new Map<string, BridgeInfo>()
const uiEventListeners = new Set<UIEventListener>()
const busEventListeners = new Set<BusEventListener>()
const requestHandlers = new Set<BridgeRequestHandler>()

export function getBridgeInfo(cwd: string): BridgeInfo | undefined {
  return bridgeInfo.get(cwd)
}

export function onBridgeUIEvent(listener: UIEventListener): () => void {
  uiEventListeners.add(listener)
  return () => {
    uiEventListeners.delete(listener)
  }
}

export function onBridgeBusEvent(listener: BusEventListener): () => void {
  busEventListeners.add(listener)
  return () => {
    busEventListeners.delete(listener)
  }
}

export function onBridgeRequest(handler: BridgeRequestHandler): () => void {
  requestHandlers.add(handler)
  return () => {
    requestHandlers.delete(handler)
  }
}

function emitUIEvent(cwd: string, event: BridgeUIEvent): void {
  for (const listener of uiEventListeners) {
    try {
      listener(cwd, event)
    } catch {
      // UI event listeners are best-effort.
    }
  }
}

function emitBusEvent(cwd: string, event: BridgeBusEvent): void {
  for (const listener of busEventListeners) {
    try {
      listener(cwd, event)
    } catch {
      // Bus event listeners are best-effort.
    }
  }
}

const embeddedProcesses = new Map<string, EmbeddedProcess>()
const embeddedFailed = new Set<string>()

export function hasEmbeddedFailed(cwd: string): boolean {
  return embeddedFailed.has(cwd)
}

export function clearEmbeddedFailed(cwd: string): void {
  embeddedFailed.delete(cwd)
}

export function embeddedUrl(cwd: string): string {
  return `stdio:${encodeURIComponent(cwd)}`
}

export function cwdFromEmbeddedUrl(url: string): string {
  return decodeURIComponent(url.slice('stdio:'.length))
}

function failPending(entry: EmbeddedProcess, error: Error): void {
  for (const pending of entry.pending.values()) {
    pending.reject(error)
  }
  entry.pending.clear()
}

function parseMessage(line: string): StdioMessage | null {
  try {
    const message: unknown = JSON.parse(line)
    return typeof message === 'object' && message !== null ? (message as StdioMessage) : null
  } catch {
    return null
  }
}

function markReady(cwd: string, entry: EmbeddedProcess, url?: string): void {
  if (url) entry.url = url
  entry.ready = true
  invalidateCache(cwd)
  emitStatusChange(cwd, 'embedded')
}

function writeToBeam(entry: EmbeddedProcess, message: ToolArgs): void {
  entry.proc.stdin?.write(JSON.stringify(message) + '\n')
}

function sendResponse(entry: EmbeddedProcess, id: string, response: ToolArgs): void {
  writeToBeam(entry, { type: 'response', id, ...response })
}

async function handleBridgeRequest(
  cwd: string,
  entry: EmbeddedProcess,
  message: StdioMessage
): Promise<void> {
  if (typeof message.id !== 'string') return

  const responses = await Promise.all(
    Array.from(requestHandlers, (handler) => handler(cwd, message))
  )
  const response = responses.find((candidate) => candidate !== undefined)
  if (response) {
    sendResponse(entry, message.id, response)
    return
  }

  if (message.op === 'llm_complete') {
    const fakeResponse = process.env.PI_TEST_LLM_COMPLETE_RESPONSE
    if (fakeResponse) {
      sendResponse(entry, message.id, { ok: true, result: fakeResponse })
      return
    }

    sendResponse(entry, message.id, {
      ok: false,
      error: 'Pi LLM completion is not available from this extension runtime yet.',
      cwd
    })
    return
  }

  if (message.op === 'llm_stream') {
    const fakeStream = process.env.PI_TEST_LLM_STREAM_RESPONSE
    if (fakeStream) {
      for (const delta of fakeStream.split('|')) {
        writeToBeam(entry, { type: 'llm_chunk', id: message.id, delta })
      }
      writeToBeam(entry, { type: 'llm_done', id: message.id, result: '' })
      return
    }

    writeToBeam(entry, {
      type: 'llm_error',
      id: message.id,
      error: 'Pi LLM streaming is not available from this extension runtime yet.'
    })
    return
  }

  sendResponse(entry, message.id, {
    ok: false,
    error: `Unknown bridge request: ${message.op ?? 'unknown'}`
  })
}

function handleMessage(cwd: string, entry: EmbeddedProcess, message: StdioMessage): void {
  if (message.type === 'ready') {
    if (message.info) bridgeInfo.set(cwd, message.info)
    markReady(cwd, entry)
    return
  }

  if (message.type === 'ui') {
    emitUIEvent(cwd, message as BridgeUIEvent)
    return
  }

  if (message.type === 'event') {
    emitBusEvent(cwd, message as BridgeBusEvent)
    return
  }

  if (message.type === 'request') {
    void handleBridgeRequest(cwd, entry, message)
    return
  }

  if (message.type !== 'result' || typeof message.id !== 'number') return

  const pending = entry.pending.get(message.id)
  if (!pending) return

  entry.pending.delete(message.id)
  pending.resolve({ text: message.text ?? '', isError: message.isError ?? false })
}

function handleStdout(cwd: string, entry: EmbeddedProcess, chunk: Buffer): void {
  entry.buffer += chunk.toString()

  if (entry.buffer.includes('PI_MCP_READY')) {
    const port = entry.buffer.match(/port=(\d+)/)?.[1]
    markReady(cwd, entry, port ? `http://127.0.0.1:${port}/mcp` : undefined)
    entry.buffer = ''
    return
  }

  while (true) {
    const newline = entry.buffer.indexOf('\n')
    if (newline === -1) return

    const line = entry.buffer.slice(0, newline).trim()
    entry.buffer = entry.buffer.slice(newline + 1)
    if (!line) continue

    if (line.includes('PI_MCP_READY')) {
      const port = line.match(/port=(\d+)/)?.[1]
      markReady(cwd, entry, port ? `http://127.0.0.1:${port}/mcp` : undefined)
      continue
    }

    const message = parseMessage(line)
    if (message) handleMessage(cwd, entry, message)
  }
}

export function startEmbeddedInBackground(cwd: string): void {
  if (embeddedProcesses.has(cwd)) return

  const proc = childProcess.spawn('mix', ['run', '--no-halt', '-e', START_STDIO_EXPR], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MIX_ENV: 'dev' }
  })

  const entry: EmbeddedProcess = {
    proc,
    ready: false,
    url: embeddedUrl(cwd),
    buffer: '',
    nextId: 0,
    pending: new Map()
  }
  embeddedProcesses.set(cwd, entry)

  proc.stdout?.on('data', (chunk: Buffer) => {
    if (embeddedProcesses.get(cwd) === entry) handleStdout(cwd, entry, chunk)
  })

  proc.stderr?.on('data', () => {
    // Drain stderr so verbose Mix/BEAM output cannot block the child process.
  })

  proc.on('error', (error) => {
    if (embeddedProcesses.get(cwd) !== entry) return
    embeddedProcesses.delete(cwd)
    embeddedFailed.add(cwd)
    failPending(entry, error)
    emitStatusChange(cwd, null)
  })

  proc.on('exit', () => {
    if (embeddedProcesses.get(cwd) !== entry) return
    embeddedProcesses.delete(cwd)
    connectionCache.delete(cwd)
    failPending(entry, new Error('Embedded BEAM process exited'))
    if (!entry.ready) embeddedFailed.add(cwd)
    emitStatusChange(cwd, null)
  })
}

export function stopEmbedded(cwd: string): void {
  const entry = embeddedProcesses.get(cwd)
  if (!entry) return
  entry.proc.kill()
  embeddedProcesses.delete(cwd)
  connectionCache.delete(cwd)
  failPending(entry, new Error('Embedded BEAM process stopped'))
}

export function stopAllEmbedded(): void {
  for (const [cwd] of embeddedProcesses) stopEmbedded(cwd)
}

export function getEmbeddedKind(cwd: string) {
  const embedded = embeddedProcesses.get(cwd)
  if (embedded?.ready) return 'embedded'
  if (embedded) return 'starting'
  return null
}

export function isEmbeddedReady(cwd: string): boolean {
  return embeddedProcesses.get(cwd)?.ready ?? false
}

export function getEmbeddedUrl(cwd: string): string {
  return embeddedProcesses.get(cwd)?.url ?? embeddedUrl(cwd)
}

export function sendEmbeddedEvent(cwd: string, event: BridgeEvent): Promise<void> {
  if (!isEmbeddedReady(cwd)) return Promise.resolve()

  void callEmbeddedTool(cwd, 'pi_event', event).catch(() => {
    // Bridge events are notifications. They must never block agent tool completion.
  })
  return Promise.resolve()
}

export function callEmbeddedTool(
  cwd: string,
  name: string,
  args: ToolArgs,
  signal?: AbortSignal
): Promise<ToolResult> {
  const entry = embeddedProcesses.get(cwd)
  if (!entry?.ready || !entry.proc.stdin) {
    return Promise.resolve({ text: 'Embedded BEAM is not ready.', isError: true })
  }

  const id = ++entry.nextId
  const payload = JSON.stringify({ type: 'call', id, name, arguments: args }) + '\n'

  return new Promise((resolve, reject) => {
    const abort = () => {
      entry.pending.delete(id)
      resolve({ text: 'Tool call aborted.', isError: true })
    }

    if (signal?.aborted) return abort()

    entry.pending.set(id, { resolve, reject })
    signal?.addEventListener('abort', abort, { once: true })
    entry.proc.stdin!.write(payload, (error) => {
      if (!error) return
      entry.pending.delete(id)
      reject(error)
    })
  })
}

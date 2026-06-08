import { spawn, execSync, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PROJECT_DIR =
  process.env.PI_ELIXIR_INTEGRATION_PROJECT ??
  path.resolve(__dirname, '../../../fixtures/demo_project')
const START_STDIO_EXPR = 'Pi.Transport.Stdio.start()'
const STARTUP_TIMEOUT = 120_000

type StdioMessage = {
  type?: string
  id?: number | string
  name?: string
  text?: string
  isError?: boolean
  op?: string
  payload?: {
    messages?: Array<{ content?: string }>
  }
}

function ensureDeps(): void {
  execSync('mix deps.get', { cwd: PROJECT_DIR, stdio: 'pipe' })
}

function hasElixir(): boolean {
  try {
    execSync('elixir --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

class JsonLineQueue {
  private buffer = ''
  private messages: StdioMessage[] = []
  private waiters: Array<(message: StdioMessage) => boolean> = []

  push(chunk: Buffer): void {
    this.buffer += chunk.toString()

    while (true) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) return

      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue

      try {
        this.enqueue(JSON.parse(line) as StdioMessage)
      } catch {
        continue
      }
    }
  }

  next(
    match: (message: StdioMessage) => boolean,
    timeout = STARTUP_TIMEOUT
  ): Promise<StdioMessage> {
    const existingIndex = this.messages.findIndex(match)
    if (existingIndex !== -1) {
      const [message] = this.messages.splice(existingIndex, 1)
      return Promise.resolve(message)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== waiterFn)
        reject(new Error('Timed out waiting for stdio message'))
      }, timeout)

      const waiterFn = (message: StdioMessage) => {
        if (!match(message)) return false
        clearTimeout(timer)
        resolve(message)
        return true
      }

      this.waiters.push(waiterFn)
    })
  }

  private enqueue(message: StdioMessage): void {
    const waiter = this.waiters.find((candidate) => candidate(message))
    if (waiter) {
      this.waiters = this.waiters.filter((candidate) => candidate !== waiter)
      return
    }

    this.messages.push(message)
  }
}

const elixirAvailable = hasElixir()
const projectAvailable = fs.existsSync(PROJECT_DIR)

describe.skipIf(!elixirAvailable || !projectAvailable)('embedded stdio transport', () => {
  let proc: ChildProcess
  let queue: JsonLineQueue
  let nextCallId = 0

  beforeAll(async () => {
    ensureDeps()
    queue = new JsonLineQueue()
    proc = spawn('mix', ['run', '--no-halt', '-e', START_STDIO_EXPR], {
      cwd: PROJECT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MIX_ENV: 'test' }
    })

    proc.stdout?.on('data', (chunk: Buffer) => queue.push(chunk))

    await queue.next((message) => message.type === 'ready')
  }, STARTUP_TIMEOUT)

  afterAll(() => {
    if (proc && !proc.killed) proc.kill()
  })

  function call(name: string, args: Record<string, unknown>): Promise<StdioMessage> {
    const id = ++nextCallId
    proc.stdin?.write(JSON.stringify({ type: 'call', id, name, arguments: args }) + '\n')
    return queue.next((message) => message.type === 'result' && message.id === id)
  }

  function respond(id: string, result: string): void {
    proc.stdin?.write(JSON.stringify({ type: 'response', id, ok: true, result }) + '\n')
  }

  it('routes a BEAM-initiated LLM request back to the waiting eval call', async () => {
    const resultPromise = call('project_eval', { code: 'Pi.LLM.complete("hello")' })
    const request = await queue.next((message) => message.type === 'request')

    expect(request.op).toBe('llm_complete')
    expect(request.payload?.messages?.[0]?.content).toBe('hello')

    respond(String(request.id), 'fake completion')

    const result = await resultPromise
    expect(result.isError).toBe(false)
    expect(result.text).toContain('fake completion')
  })

  it('routes BEAM-initiated LLM stream chunks and done events', async () => {
    const resultPromise = call('project_eval', {
      code: 'Pi.LLM.stream("stream").stream |> Enum.join()',
      timeout: 5_000
    })
    const request = await queue.next((message) => message.type === 'request')

    expect(request.op).toBe('llm_stream')

    proc.stdin?.write(JSON.stringify({ type: 'llm_chunk', id: request.id, delta: 'hello ' }) + '\n')
    proc.stdin?.write(JSON.stringify({ type: 'llm_chunk', id: request.id, delta: 'stream' }) + '\n')
    proc.stdin?.write(JSON.stringify({ type: 'llm_done', id: request.id, result: '' }) + '\n')

    const result = await resultPromise
    expect(result.isError).toBe(false)
    expect(result.text).toContain('hello stream')
  })

  it('multiplexes concurrent BEAM-initiated LLM requests out of order', async () => {
    const code = `
first = Task.async(fn -> Pi.LLM.complete("first") end)
second = Task.async(fn -> Pi.LLM.complete("second") end)
[Task.await(first), Task.await(second)]
`
    const resultPromise = call('project_eval', { code })
    const requests = [
      await queue.next((message) => message.type === 'request'),
      await queue.next((message) => message.type === 'request')
    ]

    const first = requests.find((request) => request.payload?.messages?.[0]?.content === 'first')
    const second = requests.find((request) => request.payload?.messages?.[0]?.content === 'second')

    expect(first).toBeDefined()
    expect(second).toBeDefined()

    respond(String(second?.id), 'second result')
    respond(String(first?.id), 'first result')

    const result = await resultPromise
    expect(result.isError).toBe(false)
    expect(result.text).toContain('first result')
    expect(result.text).toContain('second result')
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { actualReadFileSync } = vi.hoisted(() => ({
  actualReadFileSync: require('node:fs').readFileSync as typeof fs.readFileSync
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs')
  return {
    ...actual,
    readFileSync: vi.fn((path: Parameters<typeof actual.readFileSync>[0], ...args) => {
      if (String(path).endsWith('package.json')) return actualReadFileSync(path, ...args)
      return undefined
    })
  }
})
vi.mock('node:child_process')

import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'

import {
  callTool,
  resolveUrl,
  getConnectionKind,
  onStatusChange,
  stopAllEmbedded
} from '#src/beam-client.js'
import {
  BRIDGE_PROTOCOL_VERSION,
  EXPECTED_BRIDGE_BUILD,
  REQUIRED_BRIDGE_CAPABILITIES
} from '#src/version.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function invalidResponse(text: string, status = 200): Response {
  return new Response(text, { status })
}

function emitStdout(proc: childProcess.ChildProcess, text: string): void {
  const stdout = proc.stdout as EventEmitter
  stdout.emit('data', Buffer.from(text))
}

function emitReady(proc: childProcess.ChildProcess, info: Record<string, unknown> = {}): void {
  emitStdout(
    proc,
    JSON.stringify({
      type: 'ready',
      info: {
        project: 'test_app',
        version: 'test',
        build: EXPECTED_BRIDGE_BUILD,
        protocol: BRIDGE_PROTOCOL_VERSION,
        transport: 'stdio',
        capabilities: [...REQUIRED_BRIDGE_CAPABILITIES],
        ...info
      }
    }) + '\n'
  )
}

// Reset module-level state between tests by clearing internal Maps/Sets.
// We access them indirectly through the public API.
function resetModuleState() {
  stopAllEmbedded()
  vi.mocked(childProcess.spawnSync).mockReturnValue({
    status: 0
  } as childProcess.SpawnSyncReturns<Buffer>)
  // Clear env overrides
  delete process.env.PI_MCP_URL
  delete process.env.PI_DISABLE_EMBEDDED
}

describe('callTool', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns text content on successful response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' }
          ],
          isError: false
        }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 'some_tool', { key: 'val' })
    expect(result).toEqual({ text: 'hello\nworld', isError: false })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('http://localhost:4000/mcp')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body.method).toBe('tools/call')
    expect(body.params).toEqual({ name: 'some_tool', arguments: { key: 'val' } })
  })

  it('returns isError from the result payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: 'boom' }],
          isError: true
        }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 'fail_tool', {})
    expect(result).toEqual({ text: 'boom', isError: true })
  })

  it('defaults isError to false when omitted', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'ok' }] }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.isError).toBe(false)
  })

  it('filters out non-text content types', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            { type: 'image', text: 'should be ignored' },
            { type: 'text', text: 'kept' }
          ]
        }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.text).toBe('kept')
  })

  it('returns empty string when result has no content', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }))

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.text).toBe('')
  })

  it('returns friendly error on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Could not reach BEAM')
    expect(result.text).toContain('ECONNREFUSED')
    expect(result.text).toContain('http://localhost:4000/mcp')
  })

  it('handles non-Error thrown from fetch', async () => {
    vi.mocked(fetch).mockRejectedValueOnce('string error')

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('string error')
  })

  it('returns error on invalid JSON response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(invalidResponse('not json', 200))

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('invalid response')
    expect(result.text).toContain('HTTP 200')
  })

  it('returns error on JSON-RPC error response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' }
      })
    )

    const result = await callTool('http://localhost:4000/mcp', 't', {})
    expect(result).toEqual({ text: 'MCP error -32600: Invalid Request', isError: true })
  })

  it('passes AbortSignal to fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [] } })
    )

    const controller = new AbortController()
    await callTool('http://localhost:4000/mcp', 't', {}, controller.signal)

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.signal).toBe(controller.signal)
  })
})

describe('resolveUrl', () => {
  beforeEach(() => {
    resetModuleState()
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetModuleState()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns PI_MCP_URL env var when set', async () => {
    process.env.PI_MCP_URL = 'http://custom:9999/mcp'

    const result = await resolveUrl('/some/project')
    expect(result).toEqual({ url: 'http://custom:9999/mcp', kind: 'external' })

    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns cached connection within TTL', async () => {
    // First call: discovery finds a external MCP server on port 4000
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4000/config') {
        return jsonResponse({ project_name: 'my_app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })

    vi.mocked(fs.readFileSync).mockReturnValue('app: :my_app')

    const first = await resolveUrl('/project')
    expect(first).toEqual({ url: 'http://localhost:4000/mcp', kind: 'external' })

    // Second call within TTL should use cache — reset fetch to reject everything
    vi.mocked(fetch).mockRejectedValue(new Error('should not be called'))

    const second = await resolveUrl('/project')
    expect(second).toEqual({ url: 'http://localhost:4000/mcp', kind: 'external' })
  })

  it('re-discovers after cache TTL expires', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4000/config') {
        return jsonResponse({ project_name: 'my_app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })

    vi.mocked(fs.readFileSync).mockReturnValue('app: :my_app')

    await resolveUrl('/project2')

    // Advance past TTL (30s)
    vi.advanceTimersByTime(31_000)

    // fetch is called again for re-discovery
    vi.mocked(fetch).mockClear()
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4001/config') {
        return jsonResponse({ project_name: 'my_app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })

    const result = await resolveUrl('/project2')
    expect(result).toEqual({ url: 'http://localhost:4001/mcp', kind: 'external' })
    expect(fetch).toHaveBeenCalled()
  })

  it('preserves caller Mix paths when starting embedded', async () => {
    const mixHome = '/mise/elixir/1.20.1-otp-28/.mix'
    const mixArchives = `${mixHome}/archives`
    vi.stubEnv('MIX_HOME', mixHome)
    vi.stubEnv('MIX_ARCHIVES', mixArchives)
    vi.stubEnv('PI_ELIXIR_BRIDGE_MIX_ENV', 'test')
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    const result = await resolveUrl('/embedded-project')
    const expectedMixEnv = {
      MIX_ARCHIVES: mixArchives,
      MIX_ENV: 'test',
      MIX_HOME: mixHome,
      PI_ELIXIR_PROJECT_CWD: '/embedded-project'
    }

    expect(result).toBeNull()
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'mix',
      ['deps.get'],
      expect.objectContaining({ env: expect.objectContaining(expectedMixEnv) })
    )
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'mix',
      ['run', '-e', 'Pi.Transport.Stdio.start()'],
      expect.objectContaining({
        cwd: expect.stringContaining('packages/bridge'),
        env: expect.objectContaining(expectedMixEnv)
      })
    )
  })

  it('uses bundled bridge by default for Mix projects without pi_bridge', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockReturnValue(`defmodule Demo.MixProject do
  use Mix.Project
  def project, do: [app: :demo]
  defp deps do
    []
  end
end`)
    vi.mocked(childProcess.spawn).mockClear()

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    const result = await resolveUrl('/missing-dep-project')

    expect(result).toBeNull()
    expect(getConnectionKind('/missing-dep-project')).toBe('starting')
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'mix',
      ['run', '-e', 'Pi.Transport.Stdio.start()'],
      expect.objectContaining({
        env: expect.objectContaining({ PI_ELIXIR_PROJECT_CWD: '/missing-dep-project' })
      })
    )
  })

  it('returns null immediately for failed cwds', async () => {
    // First: trigger embedded failure
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/failed-project')

    // Simulate exit without becoming ready → marks as failed
    fakeProc.emit('exit')

    vi.mocked(childProcess.spawn).mockClear()

    const result = await resolveUrl('/failed-project')
    expect(result).toBeNull()
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  it('returns null when PI_DISABLE_EMBEDDED is set', async () => {
    process.env.PI_DISABLE_EMBEDDED = '1'
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = await resolveUrl('/disabled-project')
    expect(result).toBeNull()
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  it('returns embedded URL when process is ready', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    // First call starts embedded
    const first = await resolveUrl('/ready-project')
    expect(first).toBeNull()

    // Simulate the strict startup handshake.
    emitReady(fakeProc)

    // Second call should find the ready embedded process
    const second = await resolveUrl('/ready-project')
    expect(second).not.toBeNull()
    expect(second!.kind).toBe('embedded')
    expect(second!.url).toBe('stdio:%2Fready-project')
  })

  it('matches external MCP server by structured project root', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4002/config') {
        return jsonResponse({
          project_name: 'wrong_app',
          project_root: '/another-project',
          framework_type: 'phoenix'
        })
      }
      if (url === 'http://localhost:4005/config') {
        return jsonResponse({
          project_name: 'specific_app',
          project_root: '/matched-project',
          framework_type: 'phoenix'
        })
      }
      return new Response(null, { status: 404 })
    })

    const result = await resolveUrl('/matched-project')
    expect(result).toEqual({ url: 'http://localhost:4005/mcp', kind: 'external' })
  })

  it('returns null when external MCP servers report a different project root', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4000/config') {
        return jsonResponse({
          project_name: 'other_app',
          project_root: '/another-project',
          framework_type: 'phoenix'
        })
      }
      return new Response(null, { status: 404 })
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 99
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    const result = await resolveUrl('/mismatched-project')
    expect(result).toBeNull()
  })
})

describe('getConnectionKind', () => {
  beforeEach(() => {
    resetModuleState()
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetModuleState()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns null when no connection exists', () => {
    expect(getConnectionKind('/unknown')).toBeNull()
  })

  it("returns 'starting' when embedded process is running but not ready", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/starting-project')
    expect(getConnectionKind('/starting-project')).toBe('starting')
  })

  it("returns 'embedded' when process becomes ready", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/embedded-kind-project')
    emitReady(fakeProc)

    expect(getConnectionKind('/embedded-kind-project')).toBe('embedded')
  })

  it("returns 'external' when cached from discovery", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4000/config') {
        return jsonResponse({ project_name: 'app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })
    vi.mocked(fs.readFileSync).mockReturnValue('app: :app')

    await resolveUrl('/external-kind-project')
    expect(getConnectionKind('/external-kind-project')).toBe('external')
  })

  it('returns unavailable after embedded process exits without readiness', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/exit-project')
    expect(getConnectionKind('/exit-project')).toBe('starting')

    fakeProc.emit('exit')
    expect(getConnectionKind('/exit-project')).toBe('unavailable')
  })
})

describe('onStatusChange', () => {
  beforeEach(() => {
    resetModuleState()
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetModuleState()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('fires callback when embedded process becomes ready', async () => {
    const cb = vi.fn()
    const unsubscribe = onStatusChange(cb)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/cb-project')
    emitReady(fakeProc)

    expect(cb).toHaveBeenCalledWith('/cb-project', 'embedded')
    unsubscribe()
  })

  it('fires callback with null when embedded process exits', async () => {
    const cb = vi.fn()
    const unsubscribe = onStatusChange(cb)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/cb-exit-project')
    fakeProc.emit('exit')

    expect(cb).toHaveBeenCalledWith('/cb-exit-project', null)
    unsubscribe()
  })

  it('fires callback with null on process error', async () => {
    const cb = vi.fn()
    const unsubscribe = onStatusChange(cb)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/cb-error-project')
    fakeProc.emit('error', new Error('spawn failed'))

    expect(cb).toHaveBeenCalledWith('/cb-error-project', null)
    unsubscribe()
  })

  it('isolates listener errors from other subscribers', async () => {
    const throwing = vi.fn(() => {
      throw new Error('stale context')
    })
    const healthy = vi.fn()
    const unsubscribeThrowing = onStatusChange(throwing)
    const unsubscribeHealthy = onStatusChange(healthy)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/isolated-cb-project')

    expect(() => {
      emitReady(fakeProc)
    }).not.toThrow()

    expect(throwing).toHaveBeenCalledWith('/isolated-cb-project', 'embedded')
    expect(healthy).toHaveBeenCalledWith('/isolated-cb-project', 'embedded')
    unsubscribeThrowing()
    unsubscribeHealthy()
  })

  it('clears cached embedded URLs when stopping an embedded process', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const firstProc = new EventEmitter() as childProcess.ChildProcess
    firstProc.stdout = new EventEmitter() as any
    firstProc.stderr = new EventEmitter() as any
    firstProc.kill = vi.fn()
    firstProc.pid = 12345

    const secondProc = new EventEmitter() as childProcess.ChildProcess
    secondProc.stdout = new EventEmitter() as any
    secondProc.stderr = new EventEmitter() as any
    secondProc.kill = vi.fn()
    secondProc.pid = 67890

    vi.mocked(childProcess.spawn).mockReturnValueOnce(firstProc).mockReturnValueOnce(secondProc)

    await resolveUrl('/cached-stop-project')
    emitReady(firstProc)

    const cached = await resolveUrl('/cached-stop-project')
    expect(cached).toEqual({ url: 'stdio:%2Fcached-stop-project', kind: 'embedded' })

    stopAllEmbedded()
    vi.mocked(childProcess.spawn).mockClear()

    const afterStop = await resolveUrl('/cached-stop-project')
    expect(afterStop).toBeNull()
    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
  })

  it('ignores stale process exits after a newer embedded process starts for the same cwd', async () => {
    const cb = vi.fn()
    const unsubscribe = onStatusChange(cb)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const firstProc = new EventEmitter() as childProcess.ChildProcess
    firstProc.stdout = new EventEmitter() as any
    firstProc.stderr = new EventEmitter() as any
    firstProc.kill = vi.fn()
    firstProc.pid = 12345

    const secondProc = new EventEmitter() as childProcess.ChildProcess
    secondProc.stdout = new EventEmitter() as any
    secondProc.stderr = new EventEmitter() as any
    secondProc.kill = vi.fn()
    secondProc.pid = 67890

    vi.mocked(childProcess.spawn).mockReturnValueOnce(firstProc).mockReturnValueOnce(secondProc)

    await resolveUrl('/restart-project')
    stopAllEmbedded()
    await resolveUrl('/restart-project')
    emitReady(firstProc)
    firstProc.emit('exit')

    expect(getConnectionKind('/restart-project')).toBe('starting')
    expect(cb).not.toHaveBeenCalled()

    emitReady(secondProc)

    expect(getConnectionKind('/restart-project')).toBe('embedded')
    expect(await resolveUrl('/restart-project')).toEqual({
      url: 'stdio:%2Frestart-project',
      kind: 'embedded'
    })

    vi.mocked(fetch).mockClear()
    vi.mocked(childProcess.spawn).mockClear()
    emitReady(firstProc)

    expect(await resolveUrl('/restart-project')).toEqual({
      url: 'stdio:%2Frestart-project',
      kind: 'embedded'
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(childProcess.spawn).not.toHaveBeenCalled()
    expect(cb).not.toHaveBeenCalledWith('/restart-project', null)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith('/restart-project', 'embedded')
    unsubscribe()
  })

  it('ignores stale process errors after a newer embedded process starts for the same cwd', async () => {
    const cb = vi.fn()
    const unsubscribe = onStatusChange(cb)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const firstProc = new EventEmitter() as childProcess.ChildProcess
    firstProc.stdout = new EventEmitter() as any
    firstProc.stderr = new EventEmitter() as any
    firstProc.kill = vi.fn()
    firstProc.pid = 12345

    const secondProc = new EventEmitter() as childProcess.ChildProcess
    secondProc.stdout = new EventEmitter() as any
    secondProc.stderr = new EventEmitter() as any
    secondProc.kill = vi.fn()
    secondProc.pid = 67890

    vi.mocked(childProcess.spawn).mockReturnValueOnce(firstProc).mockReturnValueOnce(secondProc)

    await resolveUrl('/stale-error-project')
    stopAllEmbedded()
    await resolveUrl('/stale-error-project')
    firstProc.emit('error', new Error('stale process error'))
    emitReady(secondProc)

    expect(getConnectionKind('/stale-error-project')).toBe('embedded')
    expect(cb).not.toHaveBeenCalledWith('/stale-error-project', null)
    expect(cb).toHaveBeenCalledWith('/stale-error-project', 'embedded')

    stopAllEmbedded()
    vi.mocked(childProcess.spawn).mockClear()
    expect(await resolveUrl('/stale-error-project')).toBeNull()
    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('atomically restarts a stale bridge once before reporting incompatibility', async () => {
    const cb = vi.fn()
    const unsubscribe = onStatusChange(cb)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const firstProc = new EventEmitter() as childProcess.ChildProcess
    firstProc.stdout = new EventEmitter() as any
    firstProc.stderr = new EventEmitter() as any
    firstProc.kill = vi.fn()
    firstProc.pid = 24680

    const secondProc = new EventEmitter() as childProcess.ChildProcess
    secondProc.stdout = new EventEmitter() as any
    secondProc.stderr = new EventEmitter() as any
    secondProc.kill = vi.fn()
    secondProc.pid = 24681

    vi.mocked(childProcess.spawn).mockClear()
    vi.mocked(childProcess.spawn).mockReturnValueOnce(firstProc).mockReturnValueOnce(secondProc)

    await resolveUrl('/old-bridge-project')
    emitReady(firstProc, { build: 'pi_bridge@stale/protocol-1', protocol: 1 })

    expect(firstProc.kill).toHaveBeenCalled()
    expect(childProcess.spawn).toHaveBeenCalledTimes(2)
    expect(getConnectionKind('/old-bridge-project')).toBe('starting')
    expect(cb).not.toHaveBeenCalledWith('/old-bridge-project', 'incompatible')

    emitReady(secondProc, { build: 'pi_bridge@stale/protocol-1', protocol: 1 })

    expect(secondProc.kill).toHaveBeenCalled()
    expect(getConnectionKind('/old-bridge-project')).toBe('incompatible')
    expect(cb).toHaveBeenCalledWith('/old-bridge-project', 'incompatible')
    unsubscribe()
  })

  it('notifies multiple subscribers and supports unsubscribe', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = onStatusChange(first)
    const unsubscribeSecond = onStatusChange(second)

    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const fakeProc = new EventEmitter() as childProcess.ChildProcess
    fakeProc.stdout = new EventEmitter() as any
    fakeProc.stderr = new EventEmitter() as any
    fakeProc.kill = vi.fn()
    fakeProc.pid = 12345
    vi.mocked(childProcess.spawn).mockReturnValue(fakeProc)

    await resolveUrl('/multi-cb-project')
    unsubscribeFirst()
    emitReady(fakeProc)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('/multi-cb-project', 'embedded')
    unsubscribeSecond()
  })
})

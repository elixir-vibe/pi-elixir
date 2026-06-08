import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:fs')
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
} from '../src/beam-client.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function invalidResponse(text: string, status = 200): Response {
  return new Response(text, { status })
}

// Reset module-level state between tests by clearing internal Maps/Sets.
// We access them indirectly through the public API.
function resetModuleState() {
  stopAllEmbedded()
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

  it('returns null and starts embedded when no external MCP server found', async () => {
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
    expect(result).toBeNull()
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'mix',
      expect.arrayContaining(['run', '--no-halt']),
      expect.objectContaining({ cwd: '/embedded-project' })
    )
  })

  it('marks Mix projects without pi_bridge as missing instead of starting a doomed BEAM', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
    vi.mocked(fs.readFileSync).mockReturnValue(`defmodule Demo.MixProject do
  use Mix.Project
  def project, do: [app: :demo]
  defp deps do
    []
  end
end`)
    vi.mocked(childProcess.spawn).mockClear()

    const result = await resolveUrl('/missing-dep-project')

    expect(result).toBeNull()
    expect(getConnectionKind('/missing-dep-project')).toBe('missing')
    expect(childProcess.spawn).not.toHaveBeenCalled()
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

    // Simulate readiness
    ;(fakeProc.stdout as EventEmitter).emit(
      'data',
      Buffer.from('PI_MCP_READY port=4041 server=bandit')
    )

    // Second call should find the ready embedded process
    const second = await resolveUrl('/ready-project')
    expect(second).not.toBeNull()
    expect(second!.kind).toBe('embedded')
    expect(second!.url).toContain('/mcp')
  })

  it('matches external MCP server by app name from mix.exs', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('  app: :specific_app,')

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4002/config') {
        return jsonResponse({ project_name: 'wrong_app', framework_type: 'phoenix' })
      }
      if (url === 'http://localhost:4005/config') {
        return jsonResponse({ project_name: 'specific_app', framework_type: 'phoenix' })
      }
      return new Response(null, { status: 404 })
    })

    const result = await resolveUrl('/matched-project')
    expect(result).toEqual({ url: 'http://localhost:4005/mcp', kind: 'external' })
  })

  it('returns null when external MCP servers exist but none match the app name', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('  app: :my_app,')

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4000/config') {
        return jsonResponse({ project_name: 'other_app', framework_type: 'phoenix' })
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
    ;(fakeProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY'))

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

  it('returns null after embedded process exits without readiness', async () => {
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
    expect(getConnectionKind('/exit-project')).toBeNull()
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
    ;(fakeProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY'))

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
      ;(fakeProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY'))
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
    ;(firstProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY port=3333'))

    const cached = await resolveUrl('/cached-stop-project')
    expect(cached).toEqual({ url: 'http://127.0.0.1:3333/mcp', kind: 'embedded' })

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
    ;(firstProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY port=3333'))
    firstProc.emit('exit')

    expect(getConnectionKind('/restart-project')).toBe('starting')
    expect(cb).not.toHaveBeenCalled()

    ;(secondProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY port=4444'))

    expect(getConnectionKind('/restart-project')).toBe('embedded')
    expect(await resolveUrl('/restart-project')).toEqual({
      url: 'http://127.0.0.1:4444/mcp',
      kind: 'embedded'
    })

    vi.mocked(fetch).mockClear()
    vi.mocked(childProcess.spawn).mockClear()
    ;(firstProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY port=3333'))

    expect(await resolveUrl('/restart-project')).toEqual({
      url: 'http://127.0.0.1:4444/mcp',
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
    ;(secondProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY port=5555'))

    expect(getConnectionKind('/stale-error-project')).toBe('embedded')
    expect(cb).not.toHaveBeenCalledWith('/stale-error-project', null)
    expect(cb).toHaveBeenCalledWith('/stale-error-project', 'embedded')

    stopAllEmbedded()
    vi.mocked(childProcess.spawn).mockClear()
    expect(await resolveUrl('/stale-error-project')).toBeNull()
    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
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
    ;(fakeProc.stdout as EventEmitter).emit('data', Buffer.from('PI_MCP_READY'))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('/multi-cb-project', 'embedded')
    unsubscribeSecond()
  })
})

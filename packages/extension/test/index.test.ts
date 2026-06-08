import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/connection/resolver.ts', () => ({
  callTool: vi.fn(),
  resolveUrl: vi.fn(),
  getConnectionKind: vi.fn(),
  sendBridgeEvent: vi.fn()
}))

vi.mock('../src/connection/status.ts', () => ({
  onStatusChange: vi.fn()
}))

vi.mock('../src/embedded/stdio-process.ts', () => ({
  stopEmbedded: vi.fn(),
  onBridgeBusEvent: vi.fn((_listener) => vi.fn()),
  onBridgeRequest: vi.fn((_listener) => vi.fn()),
  onBridgeUIEvent: vi.fn((_listener) => vi.fn()),
  getBridgeInfo: vi.fn()
}))

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { resolveUrl, getConnectionKind } from '../src/connection/resolver.ts'
import { onStatusChange } from '../src/connection/status.ts'
import { onBridgeRequest, stopEmbedded } from '../src/embedded/stdio-process.ts'
import extension from '../src/index.js'

let tempRoot: string

function makeProject(name: string, elixir = true): string {
  const cwd = path.join(tempRoot, name)
  fs.mkdirSync(cwd, { recursive: true })
  if (elixir) fs.writeFileSync(path.join(cwd, 'mix.exs'), 'defmodule MixProject do\nend\n')
  return cwd
}

function fakePi() {
  const handlers = new Map<string, Function>()
  return {
    pi: {
      on: vi.fn((event: string, handler: Function) => {
        handlers.set(event, handler)
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      events: { emit: vi.fn() },
      getSessionName: vi.fn(() => undefined),
      getActiveTools: vi.fn(() => []),
      appendEntry: vi.fn()
    },
    handlers
  }
}

function fakeCtx(cwd: string, sessionFile = `${cwd}/session.jsonl`) {
  return {
    cwd,
    mode: 'tui',
    hasUI: true,
    isIdle: () => true,
    sessionManager: {
      getSessionFile: () => sessionFile,
      getLeafId: () => 'leaf-1'
    },
    ui: {
      theme: {
        fg: (_name: string, text: string) => text
      },
      setStatus: vi.fn(),
      notify: vi.fn(),
      setWidget: vi.fn()
    }
  }
}

describe('extension registration', () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-elixir-index-'))
    vi.clearAllMocks()
    vi.mocked(resolveUrl).mockResolvedValue(null)
    vi.mocked(getConnectionKind).mockReturnValue('starting')
    vi.mocked(onStatusChange).mockImplementation((_listener) => vi.fn())
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('keeps the model-facing Elixir tool surface minimal', () => {
    const { pi } = fakePi()
    extension(pi as any)

    expect(pi.registerTool).toHaveBeenCalledTimes(4)
    expect(pi.registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      'elixir_eval',
      'elixir_sandbox_eval',
      'elixir_ast_search',
      'elixir_ast_replace'
    ])
  })
})

describe('extension status lifecycle', () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-elixir-index-'))
    vi.clearAllMocks()
    vi.mocked(resolveUrl).mockResolvedValue(null)
    vi.mocked(getConnectionKind).mockReturnValue('starting')
    vi.mocked(onStatusChange).mockImplementation((_listener) => vi.fn())
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('subscribes per cwd without replacing other active cwd subscriptions', async () => {
    const projectA = makeProject('project-a')
    const projectB = makeProject('project-b')
    const { pi, handlers } = fakePi()
    extension(pi as any)

    await handlers.get('session_start')!({}, fakeCtx(projectA))
    await handlers.get('session_start')!({}, fakeCtx(projectB))

    expect(onStatusChange).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes only the shutting-down cwd and stops that embedded process', async () => {
    const projectA = makeProject('project-a')
    const projectB = makeProject('project-b')
    const unsubscribeA = vi.fn()
    const unsubscribeB = vi.fn()
    vi.mocked(onStatusChange).mockReturnValueOnce(unsubscribeA).mockReturnValueOnce(unsubscribeB)

    const { pi, handlers } = fakePi()
    extension(pi as any)

    await handlers.get('session_start')!({}, fakeCtx(projectA))
    await handlers.get('session_start')!({}, fakeCtx(projectB))
    await handlers.get('session_shutdown')!({}, fakeCtx(projectA))

    expect(unsubscribeA).toHaveBeenCalledTimes(1)
    expect(unsubscribeB).not.toHaveBeenCalled()
    expect(stopEmbedded).toHaveBeenCalledWith(projectA)
  })

  it('keeps the embedded process running while another session uses the same cwd', async () => {
    const projectA = makeProject('project-a')
    const unsubscribeFirst = vi.fn()
    const unsubscribeSecond = vi.fn()
    vi.mocked(onStatusChange)
      .mockReturnValueOnce(unsubscribeFirst)
      .mockReturnValueOnce(unsubscribeSecond)

    const { pi, handlers } = fakePi()
    extension(pi as any)

    await handlers.get('session_start')!({}, fakeCtx(projectA, 'session-a.jsonl'))
    await handlers.get('session_start')!({}, fakeCtx(projectA, 'session-b.jsonl'))
    await handlers.get('session_shutdown')!({}, fakeCtx(projectA, 'session-a.jsonl'))

    expect(unsubscribeFirst).toHaveBeenCalledTimes(1)
    expect(unsubscribeSecond).not.toHaveBeenCalled()
    expect(stopEmbedded).not.toHaveBeenCalled()
  })

  it('does not subscribe for non-Elixir projects and clears any old subscription for that session', async () => {
    const projectA = makeProject('project-a')
    const unsubscribe = vi.fn()
    vi.mocked(onStatusChange).mockReturnValueOnce(unsubscribe)

    const { pi, handlers } = fakePi()
    extension(pi as any)

    await handlers.get('session_start')!({}, fakeCtx(projectA, 'session-a.jsonl'))
    fs.unlinkSync(path.join(projectA, 'mix.exs'))
    await handlers.get('session_start')!({}, fakeCtx(projectA, 'session-a.jsonl'))

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(onStatusChange).toHaveBeenCalledTimes(1)
  })

  it('handles BEAM session request APIs', async () => {
    const projectA = makeProject('project-a')
    let handler:
      | ((cwd: string, message: any) => Promise<Record<string, unknown> | undefined>)
      | undefined
    vi.mocked(onBridgeRequest).mockImplementation((cb) => {
      handler = cb as typeof handler
      return vi.fn()
    })

    const { pi, handlers } = fakePi()
    extension(pi as any)
    await handlers.get('session_start')!({}, fakeCtx(projectA))

    const info = await handler?.(projectA, { op: 'session_info' })
    expect(info?.result).toMatchObject({ cwd: projectA, leafId: 'leaf-1', isIdle: true })

    vi.mocked(pi.getActiveTools).mockReturnValueOnce(['read', 'bash'])
    const activeTools = await handler?.(projectA, { op: 'active_tools' })
    expect(activeTools?.result).toEqual({ tools: ['read', 'bash'] })

    const appended = await handler?.(projectA, {
      op: 'append_entry',
      payload: { customType: 'demo', data: { ok: true } }
    })
    expect(appended).toEqual({ ok: true, result: 'ok' })
    expect(pi.appendEntry).toHaveBeenCalledWith('demo', { ok: true })
  })

  it('treats status UI updates as best-effort when a context is stale', async () => {
    const projectA = makeProject('project-a')
    let listener: ((cwd: string, kind: any) => void) | undefined
    vi.mocked(onStatusChange).mockImplementation((cb) => {
      listener = cb
      return vi.fn()
    })

    const ctx = fakeCtx(projectA)
    ctx.ui.setStatus.mockImplementation(() => {
      throw new Error('stale context')
    })

    const { pi, handlers } = fakePi()
    extension(pi as any)

    await handlers.get('session_start')!({}, ctx)

    expect(() => listener?.(projectA, 'embedded')).not.toThrow()
  })
})

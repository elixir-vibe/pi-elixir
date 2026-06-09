import type * as PiAI from '@earendil-works/pi-ai'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@earendil-works/pi-ai', async () => {
  const actual = await vi.importActual<typeof PiAI>('@earendil-works/pi-ai')
  return {
    ...actual,
    complete: vi.fn(),
    stream: vi.fn()
  }
})

import { handleBridgeRequest } from '#src/bridge/requests.ts'
import { complete, stream } from '@earendil-works/pi-ai'

const model = {
  provider: 'test-provider',
  id: 'test-model',
  api: 'openai-responses',
  name: 'Test Model',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4_096
}

function fakeCtx(overrides: Record<string, unknown> = {}) {
  return {
    cwd: '/tmp/project',
    model,
    signal: undefined,
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn(async () => ({
        ok: true,
        apiKey: 'key',
        headers: { 'x-test': '1' }
      }))
    },
    ...overrides
  }
}

async function* streamEvents() {
  yield {
    type: 'text_delta' as const,
    contentIndex: 0,
    delta: 'hello ',
    partial: assistant('hello ')
  }
  yield {
    type: 'text_delta' as const,
    contentIndex: 0,
    delta: 'stream',
    partial: assistant('hello stream')
  }
  yield { type: 'done' as const, reason: 'stop' as const, message: assistant('hello stream') }
}

function assistant(text: string) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'openai-responses' as const,
    provider: 'test-provider' as const,
    model: 'test-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop' as const,
    timestamp: Date.now()
  }
}

describe('handleBridgeRequest llm_complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes BEAM llm_complete requests to the active pi model', async () => {
    vi.mocked(complete).mockResolvedValueOnce(assistant('subagent done'))

    const result = await handleBridgeRequest(
      {
        type: 'request',
        id: 'llm_1',
        op: 'llm_complete',
        payload: {
          messages: [
            { role: 'system', content: 'be concise' },
            { role: 'user', content: 'run child task' }
          ],
          opts: {}
        }
      },
      fakeCtx() as any,
      {} as any
    )

    expect(result).toEqual({ ok: true, result: 'subagent done' })
    expect(complete).toHaveBeenCalledWith(
      model,
      {
        systemPrompt: 'be concise',
        messages: [{ role: 'user', content: 'run child task', timestamp: expect.any(Number) }]
      },
      { apiKey: 'key', headers: { 'x-test': '1' }, signal: undefined, timeoutMs: 60_000 }
    )
  })

  it('returns a bridge error when no active model is available', async () => {
    const result = await handleBridgeRequest(
      { type: 'request', id: 'llm_1', op: 'llm_complete', payload: { messages: [] } },
      fakeCtx({ model: undefined }) as any,
      {} as any
    )

    expect(result).toEqual({ ok: false, error: 'No active pi model is selected.' })
    expect(complete).not.toHaveBeenCalled()
  })

  it('routes BEAM llm_stream requests to active pi model chunks', async () => {
    vi.mocked(stream).mockReturnValueOnce(streamEvents() as any)
    const responder = { llmChunk: vi.fn(), llmDone: vi.fn(), llmError: vi.fn() }

    const result = await handleBridgeRequest(
      {
        type: 'request',
        id: 'llm_stream_1',
        op: 'llm_stream',
        payload: { messages: [{ role: 'user', content: 'stream child task' }] }
      },
      fakeCtx() as any,
      {} as any,
      responder
    )

    expect(result).toBeNull()
    expect(responder.llmChunk).toHaveBeenCalledWith('llm_stream_1', 'hello ')
    expect(responder.llmChunk).toHaveBeenCalledWith('llm_stream_1', 'stream')
    expect(responder.llmDone).toHaveBeenCalledWith('llm_stream_1', 'hello stream')
    expect(responder.llmError).not.toHaveBeenCalled()
  })
})

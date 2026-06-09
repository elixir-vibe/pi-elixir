import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@earendil-works/pi-ai', async () => {
  const actual =
    await vi.importActual<typeof import('@earendil-works/pi-ai')>('@earendil-works/pi-ai')
  return {
    ...actual,
    complete: vi.fn()
  }
})

import { complete } from '@earendil-works/pi-ai'

import { handleBridgeRequest } from '../src/bridge/requests.ts'

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

describe('handleBridgeRequest llm_complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes BEAM llm_complete requests to the active pi model', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'subagent done' }],
      api: 'openai-responses',
      provider: 'test-provider',
      model: 'test-model',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: Date.now()
    })

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
})

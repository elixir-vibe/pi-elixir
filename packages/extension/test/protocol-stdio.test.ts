import { decodeStdioMessage } from '#src/protocol/stdio.ts'
import { describe, expect, it } from 'vitest'

describe('decodeStdioMessage', () => {
  it('decodes valid discriminated bridge messages', () => {
    expect(
      decodeStdioMessage({
        type: 'ready',
        info: {
          build: 'pi_bridge@0.8.1/protocol-2',
          protocol: 2,
          capabilities: ['stdio_jsonl']
        }
      })
    ).toMatchObject({ type: 'ready', info: { protocol: 2 } })

    expect(decodeStdioMessage({ type: 'result', id: 1, text: '42', isError: false })).toEqual({
      type: 'result',
      id: 1,
      text: '42',
      isError: false
    })
  })

  it('accepts a ready message without an umbrella application name', () => {
    const message = { type: 'ready', info: { project: null } }

    expect(decodeStdioMessage(message)).toEqual(message)
  })

  it('rejects malformed known messages instead of casting them', () => {
    expect(decodeStdioMessage({ type: 'ready', info: { project: 42 } })).toBeNull()
    expect(decodeStdioMessage({ type: 'result', id: '1', text: '42', isError: false })).toBeNull()
    expect(
      decodeStdioMessage({
        type: 'ready',
        info: { protocol: '2', capabilities: ['stdio_jsonl'] }
      })
    ).toBeNull()
  })

  it('rejects unknown message variants', () => {
    expect(decodeStdioMessage({ type: 'surprise', payload: {} })).toBeNull()
    expect(decodeStdioMessage(null)).toBeNull()
  })
})

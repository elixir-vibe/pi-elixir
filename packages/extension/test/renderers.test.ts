import type * as PiCodingAgent from '@earendil-works/pi-coding-agent'
import type { AgentToolResult, Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const original = await importOriginal<typeof PiCodingAgent>()
  return { ...original, keyHint: (_id: string, label: string) => `ctrl+o ${label}` }
})

const { renderElixirResult } = await import('#src/renderers.ts')

const theme = {
  fg: (_name: string, text: string) => text
} as Theme

function textOf(component: Component, width = 120) {
  return component.render(width).join('\n')
}

function evalResult(evalPayload: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: '' }],
    details: { eval: evalPayload }
  } as AgentToolResult<unknown>
}

describe('elixir result rendering', () => {
  it('uses structured compact inspect previews instead of the first pretty line', () => {
    const result = evalResult({
      result: '%{\n  bridge: "0.6.0",\n  app: :pi_bridge\n}',
      parts: [
        {
          format: 'inspect',
          output: '%{\n  bridge: "0.6.0",\n  app: :pi_bridge\n}',
          preview: '%{bridge: "0.6.0", app: :pi_bridge}',
          language: 'elixir'
        }
      ]
    })

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))

    expect(compact).toContain('✓ %{bridge: "0.6.0", app: :pi_bridge}')
    expect(compact).toContain('to expand')
    expect(compact).not.toBe('✓ %{')
  })

  it('keeps the expand hint inline while truncating to terminal width', () => {
    const result = evalResult({
      result:
        '%{\n  bridge: "0.6.0",\n  cwd: "/Users/dannote/Development/pi-elixir/packages/bridge",\n  app: :pi_bridge,\n  transport: :stdio\n}',
      parts: [
        {
          format: 'inspect',
          output:
            '%{\n  bridge: "0.6.0",\n  cwd: "/Users/dannote/Development/pi-elixir/packages/bridge",\n  app: :pi_bridge,\n  transport: :stdio\n}',
          preview:
            '%{bridge: "0.6.0", cwd: "/Users/dannote/Development/pi-elixir/packages/bridge", app: :pi_bridge, transport: :stdio}',
          language: 'elixir'
        }
      ]
    })

    const compact = textOf(
      renderElixirResult(result, { expanded: false, isPartial: false }, theme),
      88
    )

    expect(compact.split('\n')).toHaveLength(1)
    expect(compact).toContain('✓ %{bridge: "0.6.0"')
    expect(compact).toContain('to expand')
  })
})

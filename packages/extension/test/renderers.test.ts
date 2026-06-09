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

function linesOf(component: Component, width = 120) {
  return component.render(width)
}

function textOf(component: Component, width = 120) {
  return linesOf(component, width).join('\n')
}

function evalResult(evalPayload: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: '' }],
    details: { eval: evalPayload }
  } as AgentToolResult<unknown>
}

describe('elixir result rendering', () => {
  it('uses structured compact inspect previews without expansion noise when they fit', () => {
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

    expect(compact).toBe('\n%{bridge: "0.6.0", app: :pi_bridge}')
    expect(compact).not.toContain('to expand')
    expect(compact).not.toContain('✓')
  })

  it('recomputes compact hints when the terminal width changes', () => {
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
    const component = renderElixirResult(result, { expanded: false, isPartial: false }, theme)

    const wide = textOf(component, 160)
    const narrow = textOf(component, 88)

    expect(wide).toContain('transport: :stdio}')
    expect(wide).not.toContain('to expand')
    expect(narrow.split('\n')).toHaveLength(2)
    expect(linesOf(component, 88)[0]).toBe('')
    expect(narrow).toContain('%{bridge: "0.6.0"')
    expect(narrow).toContain('to expand')
    expect(narrow).not.toContain('✓')
  })

  it('appends eval duration when timing context is available', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-10T00:00:01.200Z'))
      const result = evalResult({
        result: '42',
        parts: [{ format: 'inspect', output: '42', preview: '42', language: 'elixir' }]
      })

      const compact = textOf(
        renderElixirResult(result, { expanded: false, isPartial: false }, theme, {
          state: { startedAt: Date.parse('2026-06-10T00:00:00.000Z') },
          isPartial: false
        })
      )

      expect(compact).toBe('\n42\nTook 1.2s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a couple of stack frames for compact errors', () => {
    const result = {
      content: [
        {
          type: 'text' as const,
          text: '** (RuntimeError) render smoke boom\n    (elixir 1.20.0) src/elixir.erl:382: :elixir.eval_external_handler/3\n    (stdlib 8.0) erl_eval.erl:1048: :erl_eval.do_apply/7\n    (pi_bridge 0.6.0) lib/pi/eval/evaluator.ex:142: anonymous fn/2 in Pi.Eval.Evaluator.eval_code/2'
        }
      ],
      isError: true
    } as AgentToolResult<unknown>

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))

    expect(compact).toContain('RuntimeError: render smoke boom')
    expect(compact).not.toContain('✗')
    expect(compact).toContain('(elixir 1.20.0) src/elixir.erl:382')
    expect(compact).toContain('(stdlib 8.0) erl_eval.erl:1048')
    expect(compact).toContain('to expand')
    expect(compact).not.toContain('pi_bridge 0.6.0')
  })

  it('shows the expand hint when the compact preview is semantically lossy', () => {
    const result = evalResult({
      result: '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]',
      parts: [
        {
          format: 'inspect',
          output: '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]',
          preview: '[1, 2, 3, 4, 5, ...]',
          language: 'elixir'
        }
      ]
    })

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))

    expect(compact).toContain('[1, 2, 3, 4, 5, ...]')
    expect(compact).toContain('to expand')
  })
})

import type * as PiCodingAgent from '@earendil-works/pi-coding-agent'
import type { AgentToolResult, Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

const { identity } = vi.hoisted(() => ({ identity: (text: string) => text }))

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const original = await importOriginal<typeof PiCodingAgent>()
  return {
    ...original,
    keyHint: (_id: string, label: string) => `ctrl+o ${label}`,
    getMarkdownTheme: () => ({
      heading: identity,
      link: identity,
      linkUrl: identity,
      code: identity,
      codeBlock: identity,
      codeBlockBorder: identity,
      quote: identity,
      quoteBorder: identity,
      hr: identity,
      listBullet: identity,
      bold: identity,
      italic: identity,
      strikethrough: identity,
      underline: identity
    })
  }
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

      expect(compact).toBe('\n42\n\nTook 1.2s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows compact inline exception headline with expansion hint', () => {
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

    expect(compact).toBe('\nRuntimeError: render smoke boom (ctrl+o to expand)')
    expect(compact).not.toContain('✗')
    expect(compact).not.toContain('(elixir 1.20.0) src/elixir.erl:382')
    expect(compact).toContain('to expand')
  })

  it('uses structured exception origin when available', () => {
    const result = evalResult({
      error:
        '** (RuntimeError) showcase boom\n    nofile:1: (file)\n    (elixir 1.20.0) src/elixir.erl:382: :elixir.eval_external_handler/3',
      exception: {
        type: 'Elixir.RuntimeError',
        message: 'showcase boom',
        stacktrace: [
          { text: 'nofile:1: (file)', file: 'nofile', line: 1, origin: 'nofile:1' },
          {
            text: '(elixir 1.20.0) src/elixir.erl:382: :elixir.eval_external_handler/3',
            file: 'src/elixir.erl',
            line: 382,
            origin: 'src/elixir.erl:382'
          }
        ]
      }
    })

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))
    const expanded = textOf(renderElixirResult(result, { expanded: true, isPartial: false }, theme))

    expect(compact).toBe('\nRuntimeError: showcase boom · nofile:1 (ctrl+o to expand)')
    expect(expanded).toContain('RuntimeError: showcase boom · nofile:1')
    expect(expanded).not.toContain('nofile:1: (file)')
    expect(expanded).toContain('(elixir 1.20.0) src/elixir.erl:382')
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

  it('renders structured table parts when expanded', () => {
    const result = evalResult({
      parts: [
        {
          format: 'table',
          output: JSON.stringify({
            columns: ['bytes', 'path'],
            rows: [
              ['123', 'lib/pi.ex'],
              ['456', 'lib/pi/eval.ex']
            ],
            total_rows: 2,
            column_types: ['integer', 'string'],
            alignments: ['right', 'left']
          }),
          preview: '2 rows × 2 columns'
        }
      ]
    })

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))
    const expanded = textOf(renderElixirResult(result, { expanded: true, isPartial: false }, theme))

    expect(compact).toContain('┌───────┬───────────────┐')
    expect(compact).toContain('│ bytes │ path          │')
    expect(compact).toContain('│ 123   │ lib/pi.ex     │')
    expect(compact).toContain('│       │ … 1 more rows │')
    expect(compact).toContain('1/2 rows · 2 columns · integer, string · (ctrl+o to expand)')
    expect(expanded).toContain('┌───────┬────────────────┐')
    expect(expanded).toContain('│ bytes │ path           │')
    expect(expanded).toContain('│ 123   │ lib/pi.ex      │')
    expect(expanded).toContain('2/2 rows · 2 columns · integer, string')
  })

  it('truncates compact table cells based on render width', () => {
    const result = evalResult({
      parts: [
        {
          format: 'table',
          output: JSON.stringify({
            columns: ['name', 'description'],
            rows: [
              [
                'Pi.Agent',
                'async/1, async/2, await/1, await/2, await_many/1, await_many/2, chain/1'
              ],
              ['Pi.Dev', 'compile/0, reload/0']
            ],
            total_rows: 2,
            column_types: ['string', 'string']
          })
        }
      ]
    })

    const compact = textOf(
      renderElixirResult(result, { expanded: false, isPartial: false }, theme),
      55
    )

    expect(compact).toContain('async/1, async/2, await…')
    expect(compact).not.toContain('await_many/2')
    expect(compact).toContain('1/2 rows · 2 columns · string, string · (ctrl+o to expand)')
  })

  it('renders compact source parts with code preview', () => {
    const result = evalResult({
      parts: [
        {
          format: 'source',
          output: [
            'def table(rows, opts \\ []) when is_list(rows) do',
            '  %{columns: columns, rows: row_values} = table_data(rows, opts)',
            '',
            '  preview = Keyword.get(opts, :preview)',
            '  %Pi.Output{}',
            'end',
            '',
            'def tree(value, opts \\ []), do: value'
          ].join('\n'),
          language: 'elixir',
          preview: 'Pi.Output.table/2 lines 6-16',
          metadata: {
            source: '/Users/dannote/Development/pi-elixir/packages/bridge/lib/pi/output.ex',
            start_line: 6,
            end_line: 13,
            subject: 'Pi.Output.table/2 lines 6-13'
          }
        }
      ]
    })

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))
    const expanded = textOf(renderElixirResult(result, { expanded: true, isPartial: false }, theme))

    expect(compact).toContain(
      'Pi.Output.table/2 lines 6-13 · lib/pi/output.ex:6-13 (ctrl+o to expand)'
    )
    expect(compact).toContain(' 6  def table(rows, opts')
    expect(compact).toContain('%Pi.Output{}')
    expect(compact).toContain('… 2 more')
    expect(compact).not.toContain('def tree')
    expect(expanded).toContain('13  def tree')
  })

  it('renders compact tree parts with real data preview', () => {
    const result = evalResult({
      parts: [
        {
          format: 'tree',
          output: JSON.stringify([
            { key: ':status', value: '200' },
            { key: ':title', value: 'Example Domain' },
            { key: ':format', value: ':text' },
            { key: ':truncated?', value: 'false' }
          ]),
          preview: 'map with 4 keys',
          metadata: {
            inspect_preview:
              '%{\n  status: 200,\n  title: "Example Domain",\n  format: :text,\n  truncated?: false\n}'
          }
        }
      ]
    })

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))

    expect(compact).toContain('map with 4 keys (ctrl+o to expand)')
    expect(compact).toContain('status: 200')
    expect(compact).toContain('title: "Example Domain"')
    expect(compact).toContain('truncated?: false')
  })

  it('renders structured tree parts when expanded', () => {
    const result = evalResult({
      parts: [
        {
          format: 'tree',
          output: JSON.stringify([
            { key: ':app', value: ':pi_bridge' },
            { key: ':versions', value: [{ key: ':bridge', value: '0.6.3' }] }
          ]),
          preview: 'map with 2 keys'
        }
      ]
    })

    const expanded = textOf(renderElixirResult(result, { expanded: true, isPartial: false }, theme))

    expect(expanded).toContain(':app: :pi_bridge')
    expect(expanded).toContain('  :bridge: 0.6.3')
  })
})

import type * as PiCodingAgent from '@earendil-works/pi-coding-agent'
import type { AgentToolResult, Theme } from '@earendil-works/pi-coding-agent'
import { visibleWidth, type Component } from '@earendil-works/pi-tui'
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

const { renderAstReplaceResult, renderElixirResult } = await import('#src/renderers.ts')

const theme = {
  fg: (_name: string, text: string) => text
} as Theme

const markerTheme = {
  fg: (name: string, text: string) => `<${name}>${text}</${name}>`,
  bold: (text: string) => `<bold>${text}</bold>`
} as Theme

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: {} }
}

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

describe('AST result rendering', () => {
  it('shows semantic edits before textual dry-run diffs', () => {
    const result = {
      content: [{ type: 'text' as const, text: 'ok' }],
      details: {
        astReplace: {
          dry_run: true,
          total: 1,
          replacements: [{ file: 'lib/demo.ex', count: 1 }],
          diffs: [
            {
              file: 'lib/demo.ex',
              diff: '--- lib/demo.ex\n+++ lib/demo.ex\n-def run, do: :ok\n+def run, do: :error',
              semantic_edits: [
                {
                  op: 'update',
                  kind: 'function',
                  line: 2,
                  summary: 'updated function def run/0'
                }
              ]
            }
          ]
        }
      }
    } as AgentToolResult<unknown>

    const compact = textOf(
      renderAstReplaceResult(result, { expanded: false, isPartial: false }, theme)
    )
    const expanded = textOf(
      renderAstReplaceResult(result, { expanded: true, isPartial: false }, theme)
    )

    expect(compact).toContain('UPDATE function L2 updated function def run/0')
    expect(compact).not.toContain('--- lib/demo.ex')
    expect(expanded).toContain('Semantic diff')
    expect(expanded).toContain('--- lib/demo.ex')
  })
})

describe('elixir result rendering', () => {
  it('renders install transcripts like streaming command output', () => {
    const transcript = [
      '[pi-elixir] Added {:pi_bridge, "== 0.6.15", only: :dev} to mix.exs',
      '$ mix deps.get',
      '',
      'Resolving Hex dependencies...',
      'Resolution completed in 0.1s',
      'New:',
      '  pi_bridge 0.6.15',
      '* Getting pi_bridge (Hex package)'
    ].join('\n')

    const compact = textOf(
      renderElixirResult(textResult(transcript), { expanded: false, isPartial: true }, theme)
    )
    const expanded = textOf(
      renderElixirResult(textResult(transcript), { expanded: true, isPartial: true }, theme)
    )

    expect(compact).toContain('earlier lines')
    expect(compact).toContain('Resolution completed in 0.1s')
    expect(compact).toContain('* Getting pi_bridge (Hex package)')
    expect(expanded).toContain('[pi-elixir] Added')
    expect(expanded).toContain('$ mix deps.get')
  })

  it('uses structured compact inspect previews without expansion noise when they fit', () => {
    const result = evalResult({
      result: '%{\n  bridge: "0.6.0",\n  app: :pi_bridge\n}',
      parts: [
        {
          kind: 'inspect',
          body: '%{\n  bridge: "0.6.0",\n  app: :pi_bridge\n}',
          title: '%{bridge: "0.6.0", app: :pi_bridge}',
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
          kind: 'inspect',
          body: '%{\n  bridge: "0.6.0",\n  cwd: "/Users/dannote/Development/pi-elixir/packages/bridge",\n  app: :pi_bridge,\n  transport: :stdio\n}',
          title:
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
        parts: [{ kind: 'inspect', body: '42', title: '42', language: 'elixir' }]
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
          kind: 'inspect',
          body: '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]',
          title: '[1, 2, 3, 4, 5, ...]',
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
          kind: 'table',
          body: JSON.stringify({
            columns: ['bytes', 'path'],
            rows: [
              ['123', 'lib/pi.ex'],
              ['456', 'lib/pi/eval.ex']
            ],
            total_rows: 2,
            column_types: ['integer', 'string'],
            alignments: ['right', 'left']
          }),
          title: '2 rows × 2 columns'
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
          kind: 'table',
          body: JSON.stringify({
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
    expect(compact).toContain('1/2 rows · 2 columns · string, string · (ctrl+o to exp…')
  })

  it('clamps expanded structured output lines to render width', () => {
    const longLine = 'x'.repeat(800)
    const result = evalResult({
      parts: [
        {
          kind: 'text',
          body: longLine
        }
      ]
    })

    const width = 55
    const lines = linesOf(
      renderElixirResult(result, { expanded: true, isPartial: false }, theme),
      width
    )

    expect(lines.some((line) => line.includes('…'))).toBe(true)
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true)
  })

  it('renders compact source parts with code preview', () => {
    const result = evalResult({
      parts: [
        {
          kind: 'code',
          body: [
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
          title: 'Pi.Output.table/2 lines 6-16',
          data: {
            source_path: '/Users/dannote/Development/pi-elixir/packages/bridge/lib/pi/output.ex',
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

  it('summarizes multi-part reflection output before expandable details', () => {
    const result = evalResult({
      parts: [
        {
          kind: 'text',
          body: 'No follow-up refactor suggested: 2 changed funcs, no hotspots/boundaries/smells.'
        },
        {
          kind: 'tree',
          body: JSON.stringify([
            { key: ':changed_functions', value: '[]' },
            { key: ':recommendation', value: 'Prefer stopping.' }
          ]),
          title: 'map with 2 keys'
        }
      ]
    })

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))
    const expanded = textOf(renderElixirResult(result, { expanded: true, isPartial: false }, theme))

    expect(compact).toBe(
      '\nNo follow-up refactor suggested: 2 changed funcs, no hotspots/boundaries/smells. (ctrl+o to expand)'
    )
    expect(compact).not.toContain('map with 2 keys')
    expect(compact).not.toContain('changed_functions')
    expect(expanded).toContain('No follow-up refactor suggested')
    expect(expanded).toContain('├─ changed_functions: []')
  })

  it('renders compact tree parts with real data preview', () => {
    const result = evalResult({
      parts: [
        {
          kind: 'tree',
          body: JSON.stringify([
            { key: ':status', value: '200' },
            { key: ':title', value: 'Example Domain' },
            { key: ':format', value: ':text' },
            { key: ':truncated?', value: 'false' }
          ]),
          title: 'map with 4 keys',
          data: {
            inspect_preview:
              '%{\n  status: 200,\n  title: "Example Domain",\n  format: :text,\n  truncated?: false\n}'
          }
        }
      ]
    })

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))

    expect(compact).not.toContain('map with 4 keys')
    expect(compact).toContain('├─ status: 200')
    expect(compact).toContain('├─ title: Example Domain')
    expect(compact).toContain('└─ truncated?: false')
    expect(compact).not.toContain('(ctrl+o to expand)')
  })

  it('renders web fetch document parts as a compact card', () => {
    const result = evalResult({
      parts: [
        {
          kind: 'document',
          body: [
            'Example Domain Example Domain',
            'This domain is for use in documentation examples without needing permission.',
            'Avoid use in operations.',
            'Learn more'
          ].join('\n'),
          language: 'text',
          title: 'Web fetch · 200 · Example Domain',
          data: {
            document_kind: 'web_fetch',
            url: 'https://example.com',
            final_url: 'https://example.com',
            status: 200,
            content_type: 'text/html',
            format: 'text',
            title: 'Example Domain',
            size_bytes: 559,
            total_chars: 142,
            truncated: false,
            redirected: false
          }
        }
      ]
    })

    const compact = textOf(renderElixirResult(result, { expanded: false, isPartial: false }, theme))

    expect(compact).toContain('Web fetch · 200 OK · text/html · 559 B')
    expect(compact).toContain('https://example.com')
    const compactLines = linesOf(
      renderElixirResult(result, { expanded: false, isPartial: false }, theme)
    )
    expect(compactLines).toHaveLength(6)
    expect(compact).toContain('→ Example Domain')
    expect(compact).not.toContain('Example Domain Example Domain')
    expect(compact).toContain(
      'This domain is for use in documentation examples without needing permission.'
    )
    expect(compact).toContain('142 chars · not truncated · (ctrl+o to expand)')
    expect(compact).not.toContain('%Pi.Web.Result')
  })

  it('renders web fetch document parts without overusing accent color', () => {
    const result = evalResult({
      parts: [
        {
          kind: 'document',
          body: 'Example Domain\nBody',
          language: 'text',
          data: {
            document_kind: 'web_fetch',
            url: 'https://example.com',
            final_url: 'https://example.com',
            status: 200,
            content_type: 'text/html',
            format: 'text',
            title: 'Example Domain',
            size_bytes: 559,
            total_chars: 19,
            truncated: false,
            redirected: false
          }
        }
      ]
    })

    const compact = textOf(
      renderElixirResult(result, { expanded: false, isPartial: false }, markerTheme)
    )
    const expanded = textOf(
      renderElixirResult(result, { expanded: true, isPartial: false }, markerTheme)
    )

    expect(compact).not.toContain('<accent>')
    expect(compact).toContain('<muted>https://example.com</muted>')
    expect(compact).toContain('<toolOutput>Example Domain</toolOutput>')
    expect(expanded).not.toContain('<accent>')
    expect(expanded).toContain('<bold><muted>Web fetch</muted></bold>')
    expect(expanded).toContain(
      '<muted>URL:         </muted> <toolOutput>https://example.com</toolOutput>'
    )
  })

  it('renders web fetch document parts as expanded metadata plus body', () => {
    const result = evalResult({
      parts: [
        {
          kind: 'document',
          body: 'Example Domain\n\nThis domain is for use in documentation examples.',
          language: 'text',
          data: {
            document_kind: 'web_fetch',
            url: 'https://example.com',
            final_url: 'https://example.com',
            status: 200,
            content_type: 'text/html',
            format: 'text',
            title: 'Example Domain',
            size_bytes: 559,
            total_chars: 65,
            truncated: false,
            redirected: false
          }
        }
      ]
    })

    const expanded = textOf(renderElixirResult(result, { expanded: true, isPartial: false }, theme))

    expect(expanded).toContain('Web fetch')
    expect(expanded).toContain('Status:       200 OK')
    expect(expanded).toContain('URL:          https://example.com')
    expect(expanded).toContain('Content-Type: text/html')
    expect(expanded).toContain('Title\nExample Domain')
    expect(expanded).toContain('Body\nExample Domain')
  })

  it('renders structured tree parts when expanded', () => {
    const result = evalResult({
      parts: [
        {
          kind: 'tree',
          body: JSON.stringify([
            { key: ':app', value: ':pi_bridge' },
            { key: ':versions', value: [{ key: ':bridge', value: '0.6.3' }] }
          ]),
          title: 'map with 2 keys'
        }
      ]
    })

    const expanded = textOf(renderElixirResult(result, { expanded: true, isPartial: false }, theme))

    expect(expanded).toContain('├─ app: :pi_bridge')
    expect(expanded).toContain('   └─ bridge: 0.6.3')
  })
})

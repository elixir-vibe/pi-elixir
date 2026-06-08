import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

import { bridgeTool, displayString } from '../helpers.ts'
import { renderAstSearchResult } from '../renderers.ts'

interface AstSearchPayload {
  kind?: string
  matches?: Array<{ file?: string; line?: number; source?: string }>
  total?: number
}

function parseAstSearchPayload(text: string): AstSearchPayload | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as AstSearchPayload) : null
  } catch {
    return null
  }
}

function astSearchDetails(text: string) {
  const payload = parseAstSearchPayload(text)
  return payload?.kind === 'ast_search' ? { astSearch: payload } : {}
}

function astSearchText(text: string) {
  const payload = parseAstSearchPayload(text)
  if (payload?.kind !== 'ast_search') return text

  const matches = payload.matches ?? []
  if (matches.length === 0) return 'No matches found.'

  const lines = matches.map(({ file, line, source }) => {
    const body = (source ?? '')
      .split('\n')
      .map((sourceLine) => `  ${sourceLine}`)
      .join('\n')
    return `${file ?? '(unknown)'}:${line ?? 0}\n${body}`
  })

  return `${lines.join('\n\n')}\n\n${payload.total ?? matches.length} match(es)`
}

export function register(pi: ExtensionAPI) {
  bridgeTool(
    pi,
    'elixir_ast_search',
    'ex_ast_search',
    'AST Search',
    `Search Elixir code by AST pattern using ExAST. Patterns are valid Elixir syntax.
Variables capture matched nodes, _ is a wildcard, structs/maps match partially.
Requires ex_ast as a project dependency.

Examples:
- 'IO.inspect(_)' — find all IO.inspect calls
- '%Step{id: "subject"}' — find structs with specific field value
- 'def handle_call(_, _, _) do _ end' — find GenServer callbacks
- '{:error, reason}' — find error tuples and capture the reason`,
    Type.Object({
      pattern: Type.String({ description: 'Elixir AST pattern to match' }),
      path: Type.Optional(Type.String({ description: 'Path to search (default: lib/)' }))
    }),
    (args, theme) => {
      let text = theme.fg('toolTitle', theme.bold('elixir_ast_search '))
      text += theme.fg('accent', displayString(args.pattern))
      const path = displayString(args.path)
      if (path) text += theme.fg('muted', ` ${path}`)
      return new Text(text, 0, 0)
    },
    {
      transformResult: astSearchText,
      resultDetails: astSearchDetails,
      renderResult: renderAstSearchResult
    }
  )
}

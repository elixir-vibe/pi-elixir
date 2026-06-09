import type { ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

import { bridgeTool, displayString } from '../helpers.ts'
import { renderAstSearchResult } from '../renderers.ts'

interface AstSearchPayload {
  kind?: string
  matches?: Array<{ file?: string; line?: number; source?: string }>
  total?: number
}

const astSearchOptions = {
  path: Type.Optional(Type.String({ description: 'Path to search (default: lib/)' })),
  inside: Type.Optional(Type.String({ description: 'Only match inside this AST pattern' })),
  notInside: Type.Optional(Type.String({ description: 'Skip matches inside this AST pattern' })),
  allowBroad: Type.Optional(Type.Boolean({ description: 'Allow broad patterns such as _' })),
  limit: Type.Optional(Type.Integer({ description: 'Maximum number of matches' }))
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

function appendPath(text: string, path: unknown, theme: Theme) {
  const pathText = displayString(path)
  return pathText ? text + theme.fg('muted', ` ${pathText}`) : text
}

function patternSummary(args: Record<string, unknown>) {
  const pattern = displayString(args.pattern)
  if (pattern) return pattern

  if (typeof args.patterns === 'object' && args.patterns !== null) {
    return `${Object.keys(args.patterns).length} patterns`
  }

  return '(missing pattern)'
}

export function register(pi: ExtensionAPI) {
  bridgeTool(
    pi,
    'elixir_ast_search',
    'ex_ast_search',
    'AST Search',
    `Search Elixir code by AST pattern using ExAST. Patterns are valid Elixir syntax.
Variables capture matched nodes, _ is a wildcard, structs/maps match partially.
Use either pattern for one search or patterns for multiple named searches in one traversal.
Requires ex_ast as a project dependency.

Examples:
- 'IO.inspect(_)' — find all IO.inspect calls
- '%Step{id: "subject"}' — find structs with specific field value
- 'def handle_call(_, _, _) do _ end' — find GenServer callbacks
- '{:error, reason}' — find error tuples and capture the reason`,
    Type.Object({
      pattern: Type.Optional(Type.String({ description: 'Elixir AST pattern to match' })),
      patterns: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: 'Named Elixir AST patterns to match in one traversal'
        })
      ),
      ...astSearchOptions
    }),
    (args, theme) => {
      let text = theme.fg('toolTitle', theme.bold('elixir_ast_search '))
      text += theme.fg('accent', patternSummary(args))
      return new Text(appendPath(text, args.path, theme), 0, 0)
    },
    {
      transformResult: astSearchText,
      resultDetails: astSearchDetails,
      renderResult: renderAstSearchResult
    }
  )
}

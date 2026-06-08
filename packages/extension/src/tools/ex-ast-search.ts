import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

import { displayString, evalTool, loadScript, wrapWithBindings } from '../helpers.ts'
import { renderAstSearchResult } from '../renderers.ts'

export function register(pi: ExtensionAPI) {
  evalTool(
    pi,
    'elixir_ast_search',
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
    (params) =>
      wrapWithBindings(loadScript('ex_ast_search'), {
        pattern: displayString(params.pattern),
        path: params.path ?? null
      }),
    (args, theme) => {
      let text = theme.fg('toolTitle', theme.bold('elixir_ast_search '))
      text += theme.fg('accent', displayString(args.pattern))
      const path = displayString(args.path)
      if (path) text += theme.fg('muted', ` ${path}`)
      return new Text(text, 0, 0)
    },
    { renderResult: renderAstSearchResult }
  )
}

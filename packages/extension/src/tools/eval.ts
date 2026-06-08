import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

import {
  bridgeTool,
  DEFAULT_MAX_LINES,
  formatSize,
  DEFAULT_MAX_BYTES,
  displayString
} from '../helpers.ts'
import { renderElixirResult } from '../renderers.ts'

export function register(pi: ExtensionAPI) {
  bridgeTool(
    pi,
    'elixir_eval',
    'project_eval',
    'Elixir Eval',
    `Evaluate Elixir code in the running application.

Runs inside the BEAM with full access to project modules, deps, Ecto repos, and IEx helpers.
Use this instead of bash for anything Elixir — test functions, introspect modules, manipulate ASTs,
query process state, read docs with h(), list exports with exports(), inspect values with i().

Output truncated to ${DEFAULT_MAX_LINES} lines / ${formatSize(DEFAULT_MAX_BYTES)}.`,
    Type.Object({
      code: Type.String({ description: 'Elixir code to evaluate' }),
      timeout: Type.Optional(Type.Integer({ description: 'Timeout in ms (default: 30000)' }))
    }),
    (args, theme) => {
      const code = displayString(args.code)
      const preview = code.length > 120 ? code.slice(0, 117) + '…' : code
      return new Text(
        theme.fg('toolTitle', theme.bold('elixir_eval ')) + theme.fg('accent', preview),
        0,
        0
      )
    },
    { renderResult: renderElixirResult }
  )
}

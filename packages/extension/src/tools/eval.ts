import {
  bridgeTool,
  DEFAULT_MAX_LINES,
  formatSize,
  DEFAULT_MAX_BYTES,
  displayString,
  renderSingleLine,
  pendingArgsSuffix,
  type ToolCallRenderContext
} from '#src/helpers.ts'
import type { ToolArgs } from '#src/protocol/types.ts'
import { renderElixirResult } from '#src/renderers.ts'
import type { ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

interface EvalPayload {
  kind?: string
  io?: string
  result?: string | null
  error?: string
  text?: string
}

function parseEvalPayload(text: string): EvalPayload | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as EvalPayload) : null
  } catch {
    return null
  }
}

function evalDetails(text: string) {
  const payload = parseEvalPayload(text)
  return payload?.kind === 'eval' ? { eval: payload } : {}
}

function evalText(text: string) {
  const payload = parseEvalPayload(text)
  return payload?.kind === 'eval' && typeof payload.text === 'string' ? payload.text : text
}

function optionSuffix(args: ToolArgs, theme: Theme) {
  const parts: string[] = []
  if (args.mode === 'sandbox') parts.push(theme.fg('warning', 'sandbox'))
  if (typeof args.timeout === 'number') parts.push(theme.fg('muted', `${args.timeout}ms`))
  return parts.length > 0
    ? theme.fg('muted', ' (') + parts.join(theme.fg('muted', ', ')) + theme.fg('muted', ')')
    : ''
}

function renderEvalCall(toolName: string) {
  return (args: ToolArgs, theme: Theme, context: ToolCallRenderContext) => {
    const code = displayString(args.code)
    return renderSingleLine(
      theme.fg('toolTitle', theme.bold(`${toolName} `)) +
        theme.fg('accent', code) +
        optionSuffix(args, theme) +
        pendingArgsSuffix(context, theme)
    )
  }
}

export function register(pi: ExtensionAPI) {
  bridgeTool(
    pi,
    'elixir_eval',
    'project_eval_structured',
    'iex',
    `Evaluate Elixir code in the running application.

Runs inside the BEAM with full access to project modules, deps, Ecto repos, and IEx helpers.
Use mode: "sandbox" for untrusted snippets through Dune.
Use this instead of bash for anything Elixir — test functions, introspect modules, manipulate ASTs,
query process state, read docs with h(), list exports with exports(), inspect values with i().

Output truncated to ${DEFAULT_MAX_LINES} lines / ${formatSize(DEFAULT_MAX_BYTES)}.`,
    Type.Object({
      code: Type.String({ description: 'Elixir code to evaluate' }),
      mode: Type.Optional(
        Type.Union([Type.Literal('trusted'), Type.Literal('sandbox')], {
          description:
            'Eval mode: trusted project introspection (default) or sandbox for untrusted code'
        })
      ),
      timeout: Type.Optional(
        Type.Integer({ description: 'Timeout in ms (default: 30000 trusted, 5000 sandbox)' })
      )
    }),
    renderEvalCall('iex'),
    { transformResult: evalText, resultDetails: evalDetails, renderResult: renderElixirResult }
  )
}

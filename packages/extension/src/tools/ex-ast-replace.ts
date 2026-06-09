import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { astOptionSuffix, bridgeTool, displayString, renderSingleLine } from '../helpers.ts'
import { renderAstReplaceResult } from '../renderers.ts'

interface AstReplacePayload {
  kind?: string
  dry_run?: boolean
  replacements?: Array<{ file?: string; count?: number }>
  diffs?: Array<{ file?: string; diff?: string }>
  total?: number
}

function parseAstReplacePayload(text: string): AstReplacePayload | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as AstReplacePayload) : null
  } catch {
    return null
  }
}

function astReplaceDetails(text: string) {
  const payload = parseAstReplacePayload(text)
  return payload?.kind === 'ast_replace' ? { astReplace: payload } : {}
}

function astReplaceText(text: string) {
  const payload = parseAstReplacePayload(text)
  if (payload?.kind !== 'ast_replace') return text

  const replacements = payload.replacements ?? []
  if (replacements.length === 0) return 'No matches found.'

  const verb = payload.dry_run ? 'Would update' : 'Updated'
  const lines = replacements.map(
    ({ file, count }) => `${verb} ${file ?? '(unknown)'} (${count ?? 0} replacement(s))`
  )
  return `${lines.join('\n')}\n\n${payload.total ?? 0} replacement(s) in ${replacements.length} file(s)`
}

export function register(pi: ExtensionAPI) {
  bridgeTool(
    pi,
    'elixir_ast_replace',
    'ex_ast_replace',
    'ast edit',
    `Replace Elixir code by AST pattern using ExAST. Patterns are valid Elixir syntax.
Captures from the pattern are substituted into the replacement by name.
Requires ex_ast as a project dependency.

Examples:
- pattern: 'IO.inspect(expr, _)' replacement: 'Logger.debug(inspect(expr))'
- pattern: 'dbg(expr)' replacement: 'expr'
- pattern: '%Step{id: "subject"}' replacement: 'SharedSteps.subject_step(@opts)'`,
    Type.Object({
      pattern: Type.String({ description: 'Elixir AST pattern to match' }),
      replacement: Type.String({
        description: 'Replacement template (use capture names from pattern)'
      }),
      path: Type.Optional(Type.String({ description: 'Path to replace in (default: lib/)' })),
      inside: Type.Optional(Type.String({ description: 'Only replace inside this AST pattern' })),
      notInside: Type.Optional(
        Type.String({ description: 'Skip replacements inside this AST pattern' })
      ),
      allowBroad: Type.Optional(Type.Boolean({ description: 'Allow broad patterns such as _' })),
      limit: Type.Optional(Type.Integer({ description: 'Maximum number of matches to replace' })),
      dryRun: Type.Optional(
        Type.Boolean({
          description: 'Preview changes without writing files (default: false)'
        })
      )
    }),
    (args, theme) => {
      let text = theme.fg('toolTitle', theme.bold('ast edit '))
      text += theme.fg('accent', displayString(args.pattern))
      text += theme.fg('muted', ' → ')
      text += theme.fg('accent', displayString(args.replacement))
      return renderSingleLine(text + astOptionSuffix(args, theme))
    },
    {
      transformResult: astReplaceText,
      resultDetails: astReplaceDetails,
      renderResult: renderAstReplaceResult
    }
  )
}

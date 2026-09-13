import {
  astOptionSuffix,
  bridgeTool,
  displaySingleLine,
  normalizePathForBeam
} from '#src/helpers.ts'
import { renderAstReplaceResult } from '#src/renderers.ts'
import { renderWrappedText } from '#src/shared/render.ts'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

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
    `Rewrite Elixir source with ExAST patterns—not ast-grep patterns.

CRITICAL SYNTAX: patterns and replacements must be valid Elixir. Never use ast-grep metavariables such as $NAME or $$$ARGS. Lowercase Elixir variables capture nodes, _ is a non-capturing wildcard, and the literal Elixir form ... matches zero or more nodes. Captures are substituted into the replacement by their lowercase variable names. ExAST runs in pi-elixir's isolated bridge; the target project needs no dependency.

Conversion: ast-grep foo($FIRST, $$$REST) → ExAST foo(first, ...).

Examples:
- pattern: 'IO.inspect(expr, _)' replacement: 'Logger.debug(inspect(expr))'
- pattern: 'dbg(expr)' replacement: 'expr'
- pattern: '%Step{id: "subject"}' replacement: 'SharedSteps.subject_step(@opts)'`,
    Type.Object({
      pattern: Type.String({
        description:
          'Valid Elixir ExAST pattern. Use lowercase variables and ...; never use $NAME or $$$ARGS.'
      }),
      replacement: Type.String({
        description:
          'Valid Elixir replacement using lowercase capture names from the pattern; never $ metavariables.'
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
      text += theme.fg('accent', displaySingleLine(args.pattern))
      text += theme.fg('muted', ' → ')
      text += theme.fg('accent', displaySingleLine(args.replacement))
      return renderWrappedText(text + astOptionSuffix(args, theme))
    },
    {
      transformResult: astReplaceText,
      prepareParams: normalizePathForBeam,
      resultDetails: astReplaceDetails,
      renderResult: renderAstReplaceResult
    }
  )
}

import {
  getLanguageFromPath,
  type AgentToolResult,
  type ToolRenderResultOptions,
  type Theme
} from '@earendil-works/pi-coding-agent'

import {
  codeFrameLines,
  decodeInspectedString,
  expandHint,
  hiddenLine,
  oneLine,
  renderLines,
  resultIsError,
  resultText
} from './shared.ts'

interface AstMatch {
  path: string
  line: string
  snippet?: string
}

interface AstSearchPayload {
  matches?: Array<{ file?: string; line?: number; source?: string }>
  total?: number
}

function astSearchPayload(result: AgentToolResult<unknown>): AstSearchPayload | null {
  const details = (result as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return null
  const payload = (details as { astSearch?: unknown }).astSearch
  return typeof payload === 'object' && payload !== null ? (payload as AstSearchPayload) : null
}

function structuredAstMatches(payload: AstSearchPayload): AstMatch[] {
  return (payload.matches ?? []).map(({ file, line, source }) => ({
    path: file ?? '(unknown)',
    line: String(line ?? 0),
    snippet: source
  }))
}

function parseAstMatches(text: string): AstMatch[] {
  const lines = text.split('\n')
  const matches: AstMatch[] = []

  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].match(/^(.+?):(\d+)$/)
    if (!header) continue

    const [, path, line] = header
    let snippet: string | undefined
    for (let next = index + 1; next < lines.length; next++) {
      const candidate = lines[next]
      if (/^(.+?):(\d+)$/.test(candidate)) break
      if (candidate.trim()) {
        snippet = candidate.trim()
        break
      }
    }

    matches.push({ path, line, snippet })
  }

  return matches
}

function codeLanguage(path: string) {
  return getLanguageFromPath(path) ?? 'text'
}

function matchLine(match: AstMatch, theme: Theme) {
  const location = `${match.path}:${match.line}:`
  const snippet = match.snippet ? ` ${theme.fg('toolOutput', oneLine(match.snippet, 80))}` : ''
  return `${theme.fg('muted', location)}${snippet}`
}

function renderToolUnavailableOrError(
  result: AgentToolResult<unknown>,
  text: string,
  theme: Theme,
  emptyMessage: string
) {
  if (!text) return renderLines([theme.fg('muted', emptyMessage)])
  if (resultIsError(result) || text.startsWith('ex_ast is not installed')) {
    return renderLines([theme.fg('error', oneLine(text))])
  }
  return null
}

function renderFallback(text: string, theme: Theme) {
  return renderLines([theme.fg('muted', oneLine(text))])
}

export function renderAstSearchResult(
  result: AgentToolResult<unknown>,
  { expanded }: ToolRenderResultOptions,
  theme: Theme
) {
  const text = decodeInspectedString(resultText(result)).trim()
  const unavailableOrError = renderToolUnavailableOrError(result, text, theme, '(no matches)')
  if (unavailableOrError) return unavailableOrError

  const payload = astSearchPayload(result)
  const matches = payload ? structuredAstMatches(payload) : parseAstMatches(text)
  if (matches.length === 0) return renderFallback(text, theme)

  if (!expanded) {
    const shown = matches.slice(0, 8).map((match) => matchLine(match, theme))
    const more = hiddenLine(matches.length - shown.length, theme)
    return renderLines([...shown, ...(more ? ['', more, expandHint(theme)] : [])])
  }

  const lines: string[] = []
  const shownMatches = matches.slice(0, 24)
  for (const match of shownMatches) {
    if (lines.length > 0) lines.push('')
    lines.push(matchLine(match, theme))
    if (match.snippet?.includes('\n')) {
      lines.push(
        ...codeFrameLines(match.snippet, codeLanguage(match.path), theme, {
          startLine: Number.parseInt(match.line, 10) || 1,
          maxLines: 3
        })
      )
    }
  }

  const more = hiddenLine(matches.length - shownMatches.length, theme)
  if (more) lines.push('', more)
  return renderLines(lines)
}

interface ReplacementLine {
  path: string
  count: number
}

interface SemanticEdit {
  op?: string
  kind?: string
  summary?: string
  line?: number | null
}

interface AstReplacePayload {
  dry_run?: boolean
  replacements?: Array<{ file?: string; count?: number }>
  diffs?: Array<{
    file?: string
    diff?: string
    language?: string
    semantic_edits?: SemanticEdit[]
    semanticEdits?: SemanticEdit[]
  }>
  total?: number
}

function astReplacePayload(result: AgentToolResult<unknown>): AstReplacePayload | null {
  const details = (result as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return null
  const payload = (details as { astReplace?: unknown }).astReplace
  return typeof payload === 'object' && payload !== null ? (payload as AstReplacePayload) : null
}

function replacementLines(payload: AstReplacePayload): ReplacementLine[] {
  return (payload.replacements ?? []).map(({ file, count }) => ({
    path: file ?? '(unknown)',
    count: count ?? 0
  }))
}

function renderDiffLine(line: string, theme: Theme): string {
  if (line.startsWith('+')) return theme.fg('success', line)
  if (line.startsWith('-')) return theme.fg('error', line)
  return theme.fg('toolOutput', line)
}

function semanticEdits(payload: AstReplacePayload): SemanticEdit[] {
  return (payload.diffs ?? []).flatMap((diff) => diff.semantic_edits ?? diff.semanticEdits ?? [])
}

function semanticEditLine(edit: SemanticEdit, theme: Theme): string {
  const line = edit.line ? theme.fg('muted', `L${edit.line} `) : ''
  return `${line}${theme.fg('toolOutput', edit.summary ?? 'syntax-aware edit')}`
}

function semanticPreviewLines(
  payload: AstReplacePayload,
  theme: Theme,
  maxLines: number
): string[] {
  return semanticEdits(payload)
    .slice(0, maxLines)
    .map((edit) => semanticEditLine(edit, theme))
}

export function renderAstReplaceResult(
  result: AgentToolResult<unknown>,
  { expanded }: ToolRenderResultOptions,
  theme: Theme
) {
  const text = decodeInspectedString(resultText(result)).trim()
  const unavailableOrError = renderToolUnavailableOrError(result, text, theme, '(no replacements)')
  if (unavailableOrError) return unavailableOrError

  const payload = astReplacePayload(result)
  if (!payload) return renderFallback(text, theme)

  const replacements = replacementLines(payload)
  if (replacements.length === 0) return renderFallback(text, theme)

  const total =
    payload.total ?? replacements.reduce((sum, replacement) => sum + replacement.count, 0)
  const action = payload.dry_run ? 'dry-run' : 'updated'

  if (!expanded) {
    const semanticLines = semanticPreviewLines(payload, theme, 8)
    if (semanticLines.length > 0) {
      const hidden = semanticEdits(payload).length - semanticLines.length
      return renderLines([
        ...semanticLines,
        ...(hidden > 0
          ? ['', theme.fg('muted', `… ${hidden} more AST edits`), expandHint(theme)]
          : [])
      ])
    }

    return renderLines([
      `${theme.fg('accent', action)}  ${theme.fg('toolOutput', `${total} replacements in ${replacements.length} files`)}`
    ])
  }

  const lines = [
    `${theme.fg('accent', action)}  ${theme.fg('toolOutput', `${total} replacements`)}`
  ]
  for (const replacement of replacements.slice(0, 20)) {
    lines.push(
      `  ${theme.fg('muted', replacement.path)} ${theme.fg('accent', String(replacement.count))}`
    )
  }
  const more = hiddenLine(replacements.length - 20, theme)
  if (more) lines.push(more)

  const semanticLines = semanticPreviewLines(payload, theme, 40)
  if (semanticLines.length > 0) {
    lines.push('', theme.fg('muted', 'Semantic diff'))
    lines.push(...semanticLines)
  }

  const diffs = payload.diffs ?? []
  for (const diff of diffs.slice(0, 3)) {
    if (!diff.diff) continue
    lines.push('', theme.fg('muted', diff.file ?? '(diff)'))
    lines.push(...diff.diff.split('\n').map((line) => renderDiffLine(line, theme)))
  }

  return renderLines(lines)
}

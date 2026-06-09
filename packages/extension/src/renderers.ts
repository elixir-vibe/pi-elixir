import {
  getLanguageFromPath,
  highlightCode,
  keyHint,
  type AgentToolResult,
  type ToolRenderResultOptions,
  type Theme
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

function resultText(result: AgentToolResult<unknown>) {
  return result.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n')
}

function decodeInspectedString(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return text

  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === 'string' ? parsed : text
  } catch {
    return text
  }
}

function oneLine(text: string, limit = 120): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > limit ? compact.slice(0, limit - 1) + '…' : compact
}

function firstContentLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  )
}

function renderLines(lines: string[]) {
  return new Text(lines.join('\n'), 0, 0)
}

function resultIsError(result: AgentToolResult<unknown>): boolean {
  return (result as { isError?: unknown }).isError === true
}

function resultArg(result: AgentToolResult<unknown>, key: string): string | undefined {
  const details = (result as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return undefined
  const args = (details as { args?: unknown }).args
  if (typeof args !== 'object' || args === null) return undefined
  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' && value ? value : undefined
}

function icon(ok: boolean, theme: Theme) {
  return theme.fg(ok ? 'success' : 'error', ok ? '✓' : '✗')
}

function hiddenLine(count: number, theme: Theme) {
  return count > 0 ? theme.fg('muted', `  … ${count} more`) : undefined
}

function expandHint(theme: Theme) {
  return (
    theme.fg('muted', '  (') + keyHint('app.tools.expand', 'to expand') + theme.fg('muted', ')')
  )
}

function codeLines(text: string, language: string, theme: Theme, maxLines?: number): string[] {
  const highlighted = highlightCode(text, language)
  const shown = typeof maxLines === 'number' ? highlighted.slice(0, maxLines) : highlighted
  const hidden = typeof maxLines === 'number' ? highlighted.length - shown.length : 0
  const lines = shown.map((line) => `  ${line}`)
  const more = hiddenLine(hidden, theme)
  if (more) lines.push(more)
  return lines
}

function stripFinalNewline(text: string) {
  return text.replace(/\r?\n$/, '')
}

function errorTitle(text: string) {
  const first = firstContentLine(text)
  const match = first.match(/^\*\* \(([^)]+)\)\s*(.*)$/)
  if (!match) return first || 'Error'
  const [, kind, message] = match
  return message ? `${kind}: ${message}` : kind
}

function stackFrames(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('('))
    .slice(0, 6)
}

interface OutputPart {
  format?: string
  output?: string
  language?: string | null
}

interface EvalPayload {
  io?: string
  result?: string | null
  error?: string
  parts?: OutputPart[]
}

function evalPayload(result: AgentToolResult<unknown>): EvalPayload | null {
  const details = (result as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return null
  const payload = (details as { eval?: unknown }).eval
  return typeof payload === 'object' && payload !== null ? (payload as EvalPayload) : null
}

function renderErrorBlock(message: string, expanded: boolean, theme: Theme) {
  const title = errorTitle(message)
  if (!expanded)
    return renderLines([
      `${icon(false, theme)} ${theme.fg('error', oneLine(title))}`,
      expandHint(theme)
    ])

  const frames = stackFrames(message)
  return renderLines([
    `${icon(false, theme)} ${theme.fg('error', title)}`,
    ...frames.map((frame) => `  ${theme.fg('muted', frame)}`)
  ])
}

function renderEvalValue(value: string, expanded: boolean, theme: Theme) {
  if (!value) return renderLines([theme.fg('muted', '(no output)')])
  if (!expanded)
    return renderLines([`${icon(true, theme)} ${theme.fg('toolOutput', oneLine(value))}`])

  const lines = codeLines(value, 'elixir', theme)
  const [firstLine, ...rest] = lines
  return renderLines([`${icon(true, theme)} ${firstLine?.trimStart() ?? ''}`, ...rest])
}

function renderIoAndValue(io: string, value: string, expanded: boolean, theme: Theme) {
  const cleanIo = stripFinalNewline(io)
  const ioPreview = firstContentLine(cleanIo)
  if (!expanded) {
    const suffix = value ? theme.fg('muted', `  ↳ ${oneLine(value, 60)}`) : ''
    return renderLines([
      `${icon(true, theme)} ${theme.fg('toolOutput', oneLine(ioPreview))}${suffix}`,
      expandHint(theme)
    ])
  }

  return renderLines([
    `${icon(true, theme)} ${theme.fg('toolOutput', firstContentLine(cleanIo))}`,
    ...cleanIo
      .split('\n')
      .slice(1)
      .map((line) => `  ${theme.fg('toolOutput', line)}`),
    ...(value ? ['', ...codeLines(value, 'elixir', theme)] : [])
  ])
}

function renderStructuredEval(payload: EvalPayload, expanded: boolean, theme: Theme) {
  if (payload.parts && payload.parts.length > 0)
    return renderOutputParts(payload.parts, expanded, theme)

  const io = payload.io ?? ''
  const value = payload.result ?? ''
  return io ? renderIoAndValue(io, value, expanded, theme) : renderEvalValue(value, expanded, theme)
}

function partPreview(part: OutputPart) {
  return firstContentLine(part.output ?? '')
}

function renderOutputParts(parts: OutputPart[], expanded: boolean, theme: Theme) {
  const visibleParts = parts.filter((part) => part.output)
  if (visibleParts.length === 0) return renderLines([theme.fg('muted', '(no output)')])

  if (!expanded) {
    const [first, second] = visibleParts
    const suffix = second ? theme.fg('muted', `  ↳ ${oneLine(second.output ?? '', 60)}`) : ''
    return renderLines([
      `${icon(true, theme)} ${theme.fg('toolOutput', oneLine(partPreview(first)))}${suffix}`,
      ...(visibleParts.length > 1 ? [expandHint(theme)] : [])
    ])
  }

  const lines: string[] = []
  for (const [index, part] of visibleParts.entries()) {
    if (index > 0) lines.push('')
    const output = stripFinalNewline(part.output ?? '')
    const format = part.format ?? 'text'
    if (format === 'inspect' || format === 'source') {
      const code = codeLines(output, part.language ?? 'elixir', theme)
      if (index === 0) {
        const [first, ...rest] = code
        lines.push(`${icon(true, theme)} ${first?.trimStart() ?? ''}`, ...rest)
      } else {
        lines.push(...code)
      }
    } else if (format === 'error') {
      lines.push(`${index === 0 ? icon(false, theme) + ' ' : ''}${theme.fg('error', output)}`)
    } else {
      const rendered = output.split('\n').map((line) => `  ${theme.fg('toolOutput', line)}`)
      if (index === 0) {
        const [first, ...rest] = rendered
        lines.push(`${icon(true, theme)} ${first?.trimStart() ?? ''}`, ...rest)
      } else {
        lines.push(...rendered)
      }
    }
  }
  return renderLines(lines)
}

function parseIoResult(text: string): { io: string; result: string } | null {
  const marker = '\n\nResult:\n\n'
  if (!text.startsWith('IO:\n\n') || !text.includes(marker)) return null
  const body = text.slice('IO:\n\n'.length)
  const index = body.indexOf(marker)
  return {
    io: stripFinalNewline(body.slice(0, index)),
    result: stripFinalNewline(body.slice(index + marker.length))
  }
}

export function renderEvalResult(
  result: AgentToolResult<unknown>,
  { expanded }: ToolRenderResultOptions,
  theme: Theme
) {
  const payload = evalPayload(result)
  const text = decodeInspectedString(resultText(result)).trim()
  if (!text && !payload) return renderLines([theme.fg('muted', '(no output)')])

  if (payload?.error) return renderErrorBlock(payload.error, expanded, theme)

  if (payload) {
    return renderStructuredEval(payload, expanded, theme)
  }

  if (resultIsError(result)) return renderErrorBlock(text, expanded, theme)

  const ioResult = parseIoResult(text)
  if (ioResult) return renderIoAndValue(ioResult.io, ioResult.result, expanded, theme)

  return renderEvalValue(text, expanded, theme)
}

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

function searchHeader(count: number, pattern: string | undefined, theme: Theme) {
  const noun = count === 1 ? 'match' : 'matches'
  const patternText = pattern ? `  ${theme.fg('muted', oneLine(pattern, 60))}` : ''
  return `${icon(true, theme)} ${theme.fg('accent', `${count} ${noun}`)}${patternText}`
}

function matchLine(match: AstMatch, theme: Theme) {
  const location = `${match.path}:${match.line}`
  const snippet = match.snippet ? `  ${theme.fg('toolOutput', oneLine(match.snippet, 80))}` : ''
  return `  ${theme.fg('muted', location)}${snippet}`
}

function renderToolUnavailableOrError(
  result: AgentToolResult<unknown>,
  text: string,
  theme: Theme,
  emptyMessage: string
) {
  if (!text) return renderLines([theme.fg('muted', emptyMessage)])
  if (resultIsError(result) || text.startsWith('ex_ast is not installed')) {
    return renderLines([`${icon(false, theme)} ${theme.fg('error', oneLine(text))}`])
  }
  return null
}

function renderFallback(text: string, theme: Theme) {
  return renderLines([`${icon(true, theme)} ${theme.fg('muted', oneLine(text))}`])
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

  const pattern = resultArg(result, 'pattern')
  if (!expanded) {
    const shown = matches.slice(0, 4).map((match) => matchLine(match, theme))
    const more = hiddenLine(matches.length - shown.length, theme)
    return renderLines([
      searchHeader(matches.length, pattern, theme),
      ...shown,
      ...(more ? [more] : []),
      expandHint(theme)
    ])
  }

  const lines = [searchHeader(matches.length, pattern, theme)]
  const shownMatches = matches.slice(0, 12)
  for (const match of shownMatches) {
    lines.push('')
    lines.push(`  ${theme.fg('muted', `${match.path}:`)}${theme.fg('accent', match.line)}`)
    if (match.snippet) lines.push(...codeLines(match.snippet, codeLanguage(match.path), theme, 3))
  }

  const more = hiddenLine(matches.length - shownMatches.length, theme)
  if (more) lines.push('', more)
  return renderLines(lines)
}

interface ReplacementLine {
  path: string
  count: number
}

interface AstReplacePayload {
  dry_run?: boolean
  replacements?: Array<{ file?: string; count?: number }>
  diffs?: Array<{ file?: string; diff?: string; language?: string }>
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
    return renderLines([
      `${icon(true, theme)} ${theme.fg('accent', action)}  ${theme.fg('toolOutput', `${total} replacements in ${replacements.length} files`)}`,
      expandHint(theme)
    ])
  }

  const lines = [
    `${icon(true, theme)} ${theme.fg('accent', action)}  ${theme.fg('toolOutput', `${total} replacements`)}`
  ]
  for (const replacement of replacements.slice(0, 20)) {
    lines.push(
      `  ${theme.fg('muted', replacement.path)} ${theme.fg('accent', String(replacement.count))}`
    )
  }
  const more = hiddenLine(replacements.length - 20, theme)
  if (more) lines.push(more)

  const diffs = payload.diffs ?? []
  for (const diff of diffs.slice(0, 3)) {
    if (!diff.diff) continue
    lines.push('', `  ${theme.fg('muted', diff.file ?? '(diff)')}`)
    lines.push(...codeLines(diff.diff, diff.language ?? 'diff', theme, 40))
  }

  return renderLines(lines)
}

export function renderElixirResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme
) {
  return renderEvalResult(result, options, theme)
}

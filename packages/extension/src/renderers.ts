import {
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
  const text = decodeInspectedString(resultText(result)).trim()
  if (!text) return renderLines([theme.fg('muted', '(no output)')])

  if (resultIsError(result)) {
    const title = errorTitle(text)
    if (!expanded)
      return renderLines([
        `${icon(false, theme)} ${theme.fg('error', oneLine(title))}`,
        expandHint(theme)
      ])

    const frames = stackFrames(text)
    return renderLines([
      `${icon(false, theme)} ${theme.fg('error', title)}`,
      ...frames.map((frame) => `  ${theme.fg('muted', frame)}`)
    ])
  }

  const ioResult = parseIoResult(text)
  if (ioResult) {
    const ioPreview = firstContentLine(ioResult.io)
    if (!expanded) {
      const suffix = ioResult.result ? theme.fg('muted', `  ↳ ${oneLine(ioResult.result, 60)}`) : ''
      return renderLines([
        `${icon(true, theme)} ${theme.fg('toolOutput', oneLine(ioPreview))}${suffix}`,
        expandHint(theme)
      ])
    }

    return renderLines([
      `${icon(true, theme)} ${theme.fg('toolTitle', theme.bold('IO'))}`,
      ...ioResult.io.split('\n').map((line) => `  ${theme.fg('toolOutput', line)}`),
      '',
      theme.fg('muted', '↳ result'),
      ...codeLines(ioResult.result, 'elixir', theme)
    ])
  }

  if (!expanded)
    return renderLines([`${icon(true, theme)} ${theme.fg('toolOutput', oneLine(text))}`])
  return renderLines([
    `${icon(true, theme)} ${theme.fg('toolTitle', theme.bold('Result'))}`,
    ...codeLines(text, 'elixir', theme)
  ])
}

interface AstMatch {
  path: string
  line: string
  snippet?: string
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

function languageFromPath(path: string) {
  if (path.endsWith('.heex')) return 'heex'
  if (path.endsWith('.eex') || path.endsWith('.leex')) return 'html'
  if (path.endsWith('.ex') || path.endsWith('.exs')) return 'elixir'
  return 'text'
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

function groupedMatches(matches: AstMatch[]) {
  const groups = new Map<string, AstMatch[]>()
  for (const match of matches) {
    const group = groups.get(match.path) ?? []
    group.push(match)
    groups.set(match.path, group)
  }
  return groups
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

  const matches = parseAstMatches(text)
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
  let shown = 0
  for (const [path, group] of groupedMatches(matches)) {
    if (shown >= 12) break
    lines.push('')
    lines.push(theme.fg('muted', path))

    for (const match of group) {
      if (shown >= 12) break
      lines.push(`  ${theme.fg('accent', match.line)}`)
      if (match.snippet) lines.push(...codeLines(match.snippet, languageFromPath(path), theme, 3))
      shown += 1
    }
  }

  const more = hiddenLine(matches.length - shown, theme)
  if (more) lines.push('', more)
  return renderLines(lines)
}

interface ReplacementLine {
  verb: string
  path: string
  count: number
}

function parseReplacementLines(text: string): ReplacementLine[] {
  return text
    .split('\n')
    .map((line) => line.match(/^(Would update|Updated) (.+) \((\d+) replacement\(s\)\)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ verb: match[1], path: match[2], count: Number(match[3]) }))
}

export function renderAstReplaceResult(
  result: AgentToolResult<unknown>,
  { expanded }: ToolRenderResultOptions,
  theme: Theme
) {
  const text = decodeInspectedString(resultText(result)).trim()
  const unavailableOrError = renderToolUnavailableOrError(result, text, theme, '(no replacements)')
  if (unavailableOrError) return unavailableOrError

  const replacements = parseReplacementLines(text)
  if (replacements.length === 0) return renderFallback(text, theme)

  const total = replacements.reduce((sum, replacement) => sum + replacement.count, 0)
  const dryRun = replacements.some((replacement) => replacement.verb === 'Would update')
  const action = dryRun ? 'dry-run' : 'updated'

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
  return renderLines(lines)
}

export function renderElixirResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme
) {
  return renderEvalResult(result, options, theme)
}

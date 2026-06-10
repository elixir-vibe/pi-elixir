import {
  getLanguageFromPath,
  getMarkdownTheme,
  highlightCode,
  keyHint,
  type AgentToolResult,
  type ToolRenderResultOptions,
  type Theme
} from '@earendil-works/pi-coding-agent'
import { Markdown, Text, visibleWidth, type Component } from '@earendil-works/pi-tui'

import { truncateLine } from './helpers.ts'

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

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function comparableInspectText(text: string): string {
  return compactText(text)
    .replace(/%\{\s+/g, '%{')
    .replace(/\[\s+/g, '[')
    .replace(/\{\s+/g, '{')
    .replace(/\s+([}\]])/g, '$1')
}

function oneLine(text: string, limit = 120): string {
  const compact = compactText(text)
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
  return new Text(['', ...lines].join('\n'), 0, 0)
}

interface TimedToolRenderContext {
  state?: { startedAt?: number; endedAt?: number }
  isPartial?: boolean
  isError?: boolean
}

function timedContext(context: unknown): TimedToolRenderContext | undefined {
  return typeof context === 'object' && context !== null
    ? (context as TimedToolRenderContext)
    : undefined
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function withTiming(component: Component, theme: Theme, context: unknown): Component {
  const ctx = timedContext(context)
  if (!ctx?.state || ctx.state.startedAt === undefined) return component

  const state = ctx.state
  const startedAt = state.startedAt as number
  if (!ctx.isPartial || ctx.isError) state.endedAt ??= Date.now()
  const endTime = state.endedAt ?? Date.now()
  const label = ctx.isPartial ? 'Elapsed' : 'Took'
  const timing = theme.fg('muted', `${label} ${formatDuration(endTime - startedAt)}`)

  return {
    render: (width) => [...component.render(width), '', timing],
    invalidate: () => component.invalidate?.()
  }
}

function resultIsError(result: AgentToolResult<unknown>): boolean {
  return (result as { isError?: unknown }).isError === true
}

function hiddenLine(count: number, theme: Theme) {
  return count > 0 ? theme.fg('muted', `… ${count} more`) : undefined
}

function expandHint(theme: Theme) {
  return theme.fg('muted', '(') + keyHint('app.tools.expand', 'to expand') + theme.fg('muted', ')')
}

function inlineExpandHint(theme: Theme) {
  return theme.fg('muted', ' (') + keyHint('app.tools.expand', 'to expand') + theme.fg('muted', ')')
}

function renderCompactLine(
  prefix: string,
  preview: string,
  semanticHidden: boolean,
  theme: Theme
): Component {
  return {
    render: (width) => {
      const line = prefix + preview
      if (!semanticHidden && visibleWidth(line) <= width) return ['', line]

      const hint = inlineExpandHint(theme)
      const lineWithHint = line + hint
      if (semanticHidden && visibleWidth(lineWithHint) <= width) return ['', lineWithHint]

      const reserve = visibleWidth(prefix) + visibleWidth(hint)
      if (width > reserve + 4) return ['', prefix + truncateLine(preview, width - reserve) + hint]

      return ['', truncateLine(line, width)]
    },
    invalidate: () => undefined
  }
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

interface CodeFrameOptions {
  startLine?: number
  maxLines?: number
  highlightLine?: number
}

function codeFrameLines(
  text: string,
  language: string,
  theme: Theme,
  options: CodeFrameOptions = {}
): string[] {
  const highlighted = highlightCode(text, language)
  const startLine = options.startLine ?? 1
  const shown =
    typeof options.maxLines === 'number' ? highlighted.slice(0, options.maxLines) : highlighted
  const hidden = typeof options.maxLines === 'number' ? highlighted.length - shown.length : 0
  const endLine = startLine + Math.max(shown.length - 1, 0)
  const gutterWidth = String(endLine).length
  const lines = shown.map((line, index) => {
    const number = startLine + index
    const gutter = String(number).padStart(gutterWidth, ' ')
    const marker = options.highlightLine === number ? '›' : ' '
    return `${theme.fg('muted', `${marker}${gutter}  `)}${line}`
  })
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
    .filter((line) => line && !line.startsWith('** '))
    .slice(0, 8)
}

function compactExceptionType(type: string | undefined): string | undefined {
  return type?.startsWith('Elixir.') ? type.slice('Elixir.'.length) : type
}

function exceptionTitle(exception: ExceptionPayload | null | undefined, fallback: string) {
  const type = compactExceptionType(exception?.type)
  const message = exception?.message
  if (type && message) return `${type}: ${message}`
  if (type) return type
  return fallback
}

function exceptionFrames(exception: ExceptionPayload | null | undefined, fallbackText: string) {
  const structured = exception?.stacktrace
    ?.map((frame) => frame.text?.trim())
    .filter((line): line is string => Boolean(line))
  return structured?.length ? structured.slice(0, 8) : stackFrames(fallbackText)
}

function exceptionOrigin(exception: ExceptionPayload | null | undefined): string | undefined {
  const origin = exception?.stacktrace?.find((frame) => frame.origin)?.origin
  return origin ?? undefined
}

function errorHeadline(title: string, origin: string | undefined) {
  return origin ? `${title} · ${origin}` : title
}

interface OutputPart {
  format?: string
  output?: string
  language?: string | null
  preview?: string | null
  metadata?: Record<string, unknown> | null
}

interface ExceptionFrame {
  text?: string
  file?: string
  line?: number | null
  origin?: string | null
}

interface ExceptionPayload {
  kind?: string
  type?: string
  message?: string
  stacktrace?: ExceptionFrame[]
}

interface EvalPayload {
  io?: string
  result?: string | null
  error?: string
  exception?: ExceptionPayload | null
  parts?: OutputPart[]
}

function evalPayload(result: AgentToolResult<unknown>): EvalPayload | null {
  const details = (result as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return null
  const payload = (details as { eval?: unknown }).eval
  return typeof payload === 'object' && payload !== null ? (payload as EvalPayload) : null
}

function frameOriginForText(frame: string): string | undefined {
  const nofile = frame.match(/^nofile:(\d+)/)
  if (nofile) return `nofile:${nofile[1]}`

  const source = frame.match(/(?:^|\))\s*([^\s()]+\.(?:ex|exs|erl)):(\d+)/)
  if (source) return `${source[1]}:${source[2]}`

  return undefined
}

function renderErrorBlock(
  message: string,
  expanded: boolean,
  theme: Theme,
  exception?: ExceptionPayload | null
) {
  const title = exceptionTitle(exception, errorTitle(message))
  const origin = exceptionOrigin(exception)
  const headline = errorHeadline(title, origin)
  const frames = exceptionFrames(exception, message).filter(
    (frame) => frameOriginForText(frame) !== origin
  )

  if (!expanded) {
    const hidden = frames.length > 0 || compactText(message) !== compactText(title)
    return renderCompactLine('', theme.fg('error', headline), hidden, theme)
  }

  return renderLines([
    theme.fg('error', headline),
    ...(frames.length > 0 ? ['', ...frames.map((frame) => theme.fg('muted', frame))] : [])
  ])
}

function renderEvalValue(value: string, expanded: boolean, theme: Theme) {
  if (!value) return renderLines([theme.fg('muted', '(no output)')])
  if (!expanded) {
    const hidden = value.includes('\n')
    return renderCompactLine('', theme.fg('toolOutput', compactText(value)), hidden, theme)
  }

  const lines = codeLines(value, 'elixir', theme)
  const [firstLine, ...rest] = lines
  return renderLines([firstLine?.trimStart() ?? '', ...rest])
}

function renderIoAndValue(io: string, value: string, expanded: boolean, theme: Theme) {
  const cleanIo = stripFinalNewline(io)
  const ioPreview = firstContentLine(cleanIo)
  if (!expanded) {
    const suffix = value ? theme.fg('muted', ` ↳ ${compactText(value)}`) : ''
    return renderCompactLine(
      '',
      theme.fg('toolOutput', compactText(ioPreview)) + suffix,
      true,
      theme
    )
  }

  return renderLines([
    theme.fg('toolOutput', firstContentLine(cleanIo)),
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
  return part.preview ?? compactText(part.output ?? '')
}

function partHasSemanticHiddenOutput(part: OutputPart) {
  const output = part.output ?? ''
  const preview = partPreview(part)
  return comparableInspectText(output) !== comparableInspectText(preview)
}

interface TablePayload {
  columns?: unknown[]
  rows?: unknown[][]
  total_rows?: unknown
  totalRows?: unknown
  column_types?: unknown[]
  columnTypes?: unknown[]
  alignments?: unknown[]
}

interface TreeNode {
  key?: unknown
  value?: unknown
}

function parseJsonPart(part: OutputPart): unknown {
  try {
    return JSON.parse(part.output ?? '')
  } catch {
    return null
  }
}

function tableCell(value: unknown) {
  return typeof value === 'string' ? value : String(value ?? '')
}

interface RenderTableData {
  columns: string[]
  rows: string[][]
  totalRows: number
  columnTypes: string[]
  alignments: string[]
}

function tableStringList(values: unknown[] | undefined) {
  return values?.map(tableCell) ?? []
}

function tableNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function tableData(part: OutputPart): RenderTableData | null {
  const table = parseJsonPart(part) as TablePayload | null
  const columns = table?.columns?.map(tableCell) ?? []
  const rows = table?.rows?.map((row) => row.map(tableCell)) ?? []
  const totalRows = tableNumber(table?.total_rows ?? table?.totalRows, rows.length)
  const columnTypes = tableStringList(table?.column_types ?? table?.columnTypes)
  const alignments = tableStringList(table?.alignments)
  return columns.length > 0 ? { columns, rows, totalRows, columnTypes, alignments } : null
}

function markdownTableCell(value: string) {
  return value.replace(/\r?\n/gu, ' ').replace(/\|/gu, '\\|')
}

function markdownAlignmentMarker(alignment: string | undefined) {
  return alignment === 'right' ? '---:' : '---'
}

function markdownTable(columns: string[], rows: string[][], alignments: string[]) {
  const header = `| ${columns.map(markdownTableCell).join(' | ')} |`
  const separator = `| ${columns.map((_, index) => markdownAlignmentMarker(alignments[index])).join(' | ')} |`
  const body = rows.map(
    (row) => `| ${columns.map((_, index) => markdownTableCell(row[index] ?? '')).join(' | ')} |`
  )
  return [header, separator, ...body].join('\n')
}

function tableFooter(data: RenderTableData, visibleRows: number, hidden: number, theme: Theme) {
  const shape = `${visibleRows}/${data.totalRows} rows · ${data.columns.length} columns`
  const types = data.columnTypes.length > 0 ? ` · ${data.columnTypes.join(', ')}` : ''
  const more = hidden > 0 ? ` · ${hidden} more` : ''
  return theme.fg('muted', shape + more + types)
}

function compactTableFooter(data: RenderTableData, visibleRows: number, theme: Theme) {
  const shape = `${visibleRows}/${data.totalRows} rows · ${data.columns.length} columns`
  const types = data.columnTypes.length > 0 ? ` · ${data.columnTypes.join(', ')}` : ''
  return theme.fg('muted', shape + types) + theme.fg('muted', ' · ') + expandHint(theme)
}

function compactTableCellWidth(columnCount: number, width: number) {
  const borderOverhead = 3 * columnCount + 1
  const availableForCells = Math.max(columnCount * 8, width - borderOverhead)
  return Math.max(8, Math.min(60, Math.floor(availableForCells / columnCount)))
}

function compactTableRows(rows: string[][], columnCount: number, width: number) {
  const cellWidth = compactTableCellWidth(columnCount, width)
  return rows.map((row) => row.map((cell) => truncateLine(cell, cellWidth)))
}

function compactContinuationRow(columnCount: number, hidden: number) {
  if (hidden <= 0) return []
  return Array.from({ length: columnCount }, (_, index) =>
    index === columnCount - 1 ? `… ${hidden} more rows` : ''
  )
}

function renderMarkdownTable(
  part: OutputPart,
  theme: Theme,
  options: { maxRows: number; expanded: boolean }
): Component | null {
  const data = tableData(part)
  if (!data) return null

  const visibleRows = data.rows.slice(0, options.maxRows)
  const hidden = Math.max(0, data.totalRows - visibleRows.length)
  return {
    render: (width) => {
      const rows = options.expanded
        ? visibleRows
        : [
            ...compactTableRows(visibleRows, data.columns.length, width),
            compactContinuationRow(data.columns.length, hidden)
          ].filter((row) => row.length > 0)
      const markdown = markdownTable(data.columns, rows, data.alignments)
      const lines = new Markdown(markdown, 0, 0, getMarkdownTheme()).render(width)
      const footer = options.expanded
        ? tableFooter(data, visibleRows.length, hidden, theme)
        : compactTableFooter(data, visibleRows.length, theme)
      if (footer) lines.push('', footer)
      return ['', ...lines]
    },
    invalidate: () => undefined
  }
}

function renderTreeValue(value: unknown, theme: Theme, indent = 0): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const node = entry as TreeNode
      const key = tableCell(node.key)
      const child = node.value
      const prefix = `${'  '.repeat(indent)}${theme.fg('muted', key + ':')}`
      if (Array.isArray(child)) return [prefix, ...renderTreeValue(child, theme, indent + 1)]
      return [`${prefix} ${theme.fg('toolOutput', tableCell(child))}`]
    })
  }

  return [`${'  '.repeat(indent)}${theme.fg('toolOutput', tableCell(value))}`]
}

function renderTreePart(part: OutputPart, theme: Theme): string[] | null {
  const tree = parseJsonPart(part)
  if (tree === null) return null
  return renderTreeValue(tree, theme).slice(0, 40)
}

function renderOnlyTablePart(
  visibleParts: OutputPart[],
  expanded: boolean,
  theme: Theme
): Component | null {
  const onlyPart = visibleParts.length === 1 ? visibleParts[0] : undefined
  if (onlyPart?.format !== 'table') return null
  return renderMarkdownTable(onlyPart, theme, { maxRows: expanded ? 20 : 1, expanded })
}

function numberMetadata(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function relativeSourcePath(path: string | undefined) {
  if (!path) return undefined
  const marker = '/packages/bridge/'
  const markerIndex = path.indexOf(marker)
  if (markerIndex >= 0) return path.slice(markerIndex + marker.length)
  return path
}

function sourceStartLine(part: OutputPart) {
  return numberMetadata(part.metadata?.start_line ?? part.metadata?.startLine) ?? 1
}

function sourceLocation(part: OutputPart) {
  const path = relativeSourcePath(stringMetadata(part.metadata?.source ?? part.metadata?.path))
  const startLine = numberMetadata(part.metadata?.start_line ?? part.metadata?.startLine)
  const endLine = numberMetadata(part.metadata?.end_line ?? part.metadata?.endLine)
  if (!path || !startLine) return undefined
  return endLine && endLine !== startLine
    ? `${path}:${startLine}-${endLine}`
    : `${path}:${startLine}`
}

function sourceTitleText(part: OutputPart) {
  const subject = stringMetadata(part.metadata?.subject) ?? partPreview(part)
  const location = sourceLocation(part)
  return location ? `${subject} · ${location}` : subject
}

function sourceTitle(part: OutputPart, hidden: boolean, theme: Theme, width: number) {
  const title = sourceTitleText(part)
  if (!hidden) return truncateLine(title, width)

  const hint = inlineExpandHint(theme)
  if (visibleWidth(title + hint) <= width) return title + hint

  const reserve = visibleWidth(hint)
  return width > reserve + 4
    ? truncateLine(title, width - reserve) + hint
    : truncateLine(title, width)
}

function renderCompactSourcePart(part: OutputPart, theme: Theme): Component {
  return {
    render: (width) => {
      const output = stripFinalNewline(part.output ?? '')
      const maxLines = 6
      const totalLines = output ? output.split('\n').length : 0
      const hidden = totalLines > maxLines
      const lines = codeFrameLines(output, part.language ?? 'elixir', theme, {
        startLine: sourceStartLine(part),
        maxLines
      })
      return ['', theme.fg('muted', sourceTitle(part, hidden, theme, width)), ...lines]
    },
    invalidate: () => undefined
  }
}

function renderOnlySourcePart(visibleParts: OutputPart[], expanded: boolean, theme: Theme) {
  const onlyPart = visibleParts.length === 1 ? visibleParts[0] : undefined
  if (expanded || onlyPart?.format !== 'source') return null
  return renderCompactSourcePart(onlyPart, theme)
}

function renderOutputParts(parts: OutputPart[], expanded: boolean, theme: Theme) {
  const visibleParts = parts.filter((part) => part.output)
  if (visibleParts.length === 0) return renderLines([theme.fg('muted', '(no output)')])

  const table = renderOnlyTablePart(visibleParts, expanded, theme)
  if (table) return table

  const source = renderOnlySourcePart(visibleParts, expanded, theme)
  if (source) return source

  if (!expanded) {
    const preview = visibleParts
      .map((part, index) => {
        const text = partPreview(part)
        const styled = part.format === 'text' && index === 0 ? theme.fg('toolOutput', text) : text
        return index === 0 ? styled : theme.fg('muted', ` ↳ ${text}`)
      })
      .join('')
    const semanticHidden = visibleParts.some(partHasSemanticHiddenOutput)
    return renderCompactLine('', preview, semanticHidden, theme)
  }

  const lines: string[] = []
  for (const [index, part] of visibleParts.entries()) {
    if (index > 0) lines.push('')
    const output = stripFinalNewline(part.output ?? '')
    const format = part.format ?? 'text'
    if (format === 'table') {
      lines.push(theme.fg('toolOutput', output))
    } else if (format === 'tree') {
      lines.push(...(renderTreePart(part, theme) ?? [theme.fg('toolOutput', output)]))
    } else if (format === 'inspect') {
      const code = codeLines(output, part.language ?? 'elixir', theme)
      if (index === 0) {
        const [first, ...rest] = code
        lines.push(first?.trimStart() ?? '', ...rest)
      } else {
        lines.push(...code)
      }
    } else if (format === 'source') {
      lines.push(
        ...codeFrameLines(output, part.language ?? 'elixir', theme, {
          startLine: sourceStartLine(part)
        })
      )
    } else if (format === 'error') {
      lines.push(theme.fg('error', output))
    } else {
      const rendered = output.split('\n').map((line) => `  ${theme.fg('toolOutput', line)}`)
      if (index === 0) {
        const [first, ...rest] = rendered
        lines.push(first?.trimStart() ?? '', ...rest)
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
  theme: Theme,
  context?: unknown
) {
  const payload = evalPayload(result)
  const text = decodeInspectedString(resultText(result)).trim()
  let component: Component
  if (!text && !payload) component = renderLines([theme.fg('muted', '(no output)')])
  else if (payload?.error)
    component = renderErrorBlock(payload.error, expanded, theme, payload.exception)
  else if (payload) component = renderStructuredEval(payload, expanded, theme)
  else if (resultIsError(result)) component = renderErrorBlock(text, expanded, theme)
  else {
    const ioResult = parseIoResult(text)
    component = ioResult
      ? renderIoAndValue(ioResult.io, ioResult.result, expanded, theme)
      : renderEvalValue(text, expanded, theme)
  }

  return withTiming(component, theme, context)
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

function renderDiffLine(line: string, theme: Theme): string {
  if (line.startsWith('+')) return theme.fg('success', line)
  if (line.startsWith('-')) return theme.fg('error', line)
  return theme.fg('toolOutput', line)
}

function diffPreviewLines(payload: AstReplacePayload, theme: Theme, maxLines: number): string[] {
  const lines: string[] = []
  for (const diff of payload.diffs ?? []) {
    const diffText = diff.diff?.trimEnd()
    if (!diffText) continue
    if (lines.length > 0) lines.push('')
    lines.push(...diffText.split('\n').map((line) => renderDiffLine(line, theme)))
    if (lines.length >= maxLines) break
  }
  return lines.slice(0, maxLines)
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
    const diffLines = diffPreviewLines(payload, theme, 8)
    if (diffLines.length > 0) {
      const totalDiffLines = (payload.diffs ?? []).reduce(
        (sum, diff) => sum + (diff.diff ? diff.diff.trimEnd().split('\n').length : 0),
        0
      )
      const hidden = totalDiffLines - diffLines.length
      return renderLines([
        ...diffLines,
        ...(hidden > 0 ? ['', theme.fg('muted', `… ${hidden} more lines`), expandHint(theme)] : [])
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

  const diffs = payload.diffs ?? []
  for (const diff of diffs.slice(0, 3)) {
    if (!diff.diff) continue
    lines.push('', theme.fg('muted', diff.file ?? '(diff)'))
    lines.push(...diff.diff.split('\n').map((line) => renderDiffLine(line, theme)))
  }

  return renderLines(lines)
}

export function renderElixirResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context?: unknown
) {
  return renderEvalResult(result, options, theme, context)
}

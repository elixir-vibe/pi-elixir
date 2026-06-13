import { getMarkdownTheme, highlightCode, type Theme } from '@earendil-works/pi-coding-agent'
import { Markdown, visibleWidth, type Component } from '@earendil-works/pi-tui'

import { truncateLine } from '../helpers.ts'
import {
  codeFrameLines,
  codeLines,
  comparableInspectText,
  compactText,
  decodeInspectedString,
  expandHint,
  inlineExpandHint,
  renderCompactLine,
  renderLines,
  stripFinalNewline
} from './shared.ts'

export interface OutputPart {
  kind?: string
  body?: string
  language?: string | null
  title?: string | null
  data?: Record<string, unknown> | null
}

function partPreview(part: OutputPart) {
  return part.title ?? compactText(part.body ?? '')
}

function partHasSemanticHiddenOutput(part: OutputPart) {
  const output = part.body ?? ''
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
    return JSON.parse(part.body ?? '')
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

function treeKeyLabel(key: unknown) {
  const label = tableCell(key)
  const atom = label.match(/^:([A-Za-z_][\w?!@]*)$/u)
  if (atom) return atom[1]
  if (label.startsWith('"') && label.endsWith('"')) return decodeInspectedString(label)
  return label
}

function renderTreeValue(value: unknown, theme: Theme, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const node = entry as TreeNode
      const key = treeKeyLabel(node.key)
      const child = node.value
      const last = index === value.length - 1
      const branch = last ? '└─ ' : '├─ '
      const childPrefix = prefix + (last ? '   ' : '│  ')
      const linePrefix = theme.fg('muted', prefix + branch)
      const label = theme.fg('muted', key + ':')
      if (Array.isArray(child))
        return [`${linePrefix}${label}`, ...renderTreeValue(child, theme, childPrefix)]
      return [`${linePrefix}${label} ${theme.fg('toolOutput', tableCell(child))}`]
    })
  }

  return [theme.fg('toolOutput', tableCell(value))]
}

function renderTreePart(part: OutputPart, theme: Theme): string[] | null {
  const tree = parseJsonPart(part)
  if (tree === null) return null
  return renderTreeValue(tree, theme).slice(0, 40)
}

function treeInspectPreview(part: OutputPart): string | undefined {
  return stringMetadata(part.data?.inspect_preview ?? part.data?.inspectPreview)
}

function genericTreeTitle(title: string) {
  return (
    title === 'tree' || /^map with \d+ keys$/u.test(title) || /^list with \d+ items$/u.test(title)
  )
}

function treeExpandLine(hidden: number, theme: Theme) {
  return hidden > 0 ? theme.fg('muted', `… ${hidden} more · `) + expandHint(theme) : undefined
}

function renderCompactTreePart(part: OutputPart, theme: Theme): Component | null {
  const tree = renderTreePart(part, theme)
  const inspectPreview = tree ? undefined : treeInspectPreview(part)
  if (!tree && !inspectPreview) return null

  return {
    render: (width) => {
      const maxLines = 6
      const rawLines = tree ?? highlightCode(stripFinalNewline(inspectPreview ?? ''), 'elixir')
      const shown = rawLines.slice(0, maxLines).map((line) => truncateLine(line, width))
      const hidden = rawLines.length - shown.length
      const title = partPreview(part)
      const titleLines = genericTreeTitle(title) ? [] : [truncateLine(title, width)]
      const expand = treeExpandLine(hidden, theme)
      return ['', ...titleLines, ...shown, ...(expand ? [expand] : [])]
    },
    invalidate: () => undefined
  }
}

function renderOnlyTablePart(
  visibleParts: OutputPart[],
  expanded: boolean,
  theme: Theme
): Component | null {
  const onlyPart = visibleParts.length === 1 ? visibleParts[0] : undefined
  if (onlyPart?.kind !== 'table') return null
  return renderMarkdownTable(onlyPart, theme, { maxRows: expanded ? 20 : 1, expanded })
}

function numberMetadata(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function booleanMetadata(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function formatBytes(value: number | undefined) {
  if (value === undefined) return undefined
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  for (const unit of units) {
    if (size < 1024 || unit === units[units.length - 1]) return `${size.toFixed(1)} ${unit}`
    size /= 1024
  }
  return `${value} B`
}

function statusLabel(status: number | undefined) {
  if (status === undefined) return '?'
  if (status >= 200 && status < 300) return `${status} OK`
  if (status >= 300 && status < 400) return `${status} redirect`
  if (status >= 400 && status < 500) return `${status} client error`
  if (status >= 500) return `${status} server error`
  return String(status)
}

function relativeSourcePath(path: string | undefined) {
  if (!path) return undefined
  const marker = '/packages/bridge/'
  const markerIndex = path.indexOf(marker)
  if (markerIndex >= 0) return path.slice(markerIndex + marker.length)
  return path
}

function sourceStartLine(part: OutputPart) {
  return numberMetadata(part.data?.start_line ?? part.data?.startLine) ?? 1
}

function sourceLocation(part: OutputPart) {
  const path = relativeSourcePath(
    stringMetadata(
      part.data?.source_path ?? part.data?.sourcePath ?? part.data?.source ?? part.data?.path
    )
  )
  const startLine = numberMetadata(part.data?.start_line ?? part.data?.startLine)
  const endLine = numberMetadata(part.data?.end_line ?? part.data?.endLine)
  if (!path || !startLine) return undefined
  return endLine && endLine !== startLine
    ? `${path}:${startLine}-${endLine}`
    : `${path}:${startLine}`
}

function sourceTitleText(part: OutputPart) {
  const subject = stringMetadata(part.data?.subject) ?? partPreview(part)
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
      const output = stripFinalNewline(part.body ?? '')
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
  if (expanded || onlyPart?.kind !== 'code') return null
  return renderCompactSourcePart(onlyPart, theme)
}

function renderOnlyTreePart(visibleParts: OutputPart[], expanded: boolean, theme: Theme) {
  const onlyPart = visibleParts.length === 1 ? visibleParts[0] : undefined
  if (expanded || onlyPart?.kind !== 'tree') return null
  return renderCompactTreePart(onlyPart, theme)
}

function documentKind(part: OutputPart) {
  return stringMetadata(part.data?.document_kind ?? part.data?.documentKind)
}

function renderOnlyDocumentPart(
  visibleParts: OutputPart[],
  expanded: boolean,
  theme: Theme
): Component | null {
  const onlyPart = visibleParts.length === 1 ? visibleParts[0] : undefined
  if (onlyPart?.kind !== 'document') return null
  if (documentKind(onlyPart) !== 'web_fetch') return null
  return renderWebFetchPart(onlyPart, expanded, theme)
}

function webFetchMetaLine(part: OutputPart) {
  const status = statusLabel(numberMetadata(part.data?.status))
  const contentType = stringMetadata(part.data?.content_type ?? part.data?.contentType)
  const bytes = formatBytes(numberMetadata(part.data?.size_bytes ?? part.data?.sizeBytes))
  return ['Web fetch', status, contentType, bytes].filter(Boolean).join(' · ')
}

function webFetchUrlLines(part: OutputPart) {
  const url = stringMetadata(part.data?.url)
  const finalUrl = stringMetadata(part.data?.final_url ?? part.data?.finalUrl)
  const redirected = booleanMetadata(part.data?.redirected) || (url && finalUrl && url !== finalUrl)
  if (!url) return []
  if (redirected && finalUrl) return [url, `→ ${finalUrl}`]
  return [url]
}

function webFetchFooterText(part: OutputPart) {
  const chars = numberMetadata(part.data?.total_chars ?? part.data?.totalChars)
  const truncated = booleanMetadata(part.data?.truncated) === true
  return `${chars ?? visibleWidth(part.body ?? '')} chars · ${truncated ? 'truncated' : 'not truncated'}`
}

function compactWebBodyLines(part: OutputPart, title: string | undefined) {
  const lines = stripFinalNewline(part.body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const bodyLines = title
    ? lines.filter((line) => line !== title && line !== `${title} ${title}`)
    : lines

  return bodyLines.slice(0, 1)
}

function renderCompactWebFetchPart(part: OutputPart, theme: Theme): Component {
  return {
    render: (width) => {
      const title = stringMetadata(part.data?.title)
      const shownBody = compactWebBodyLines(part, title)
      return [
        '',
        theme.fg('muted', truncateLine(webFetchMetaLine(part), width)),
        ...webFetchUrlLines(part).map((line) => theme.fg('muted', truncateLine(line, width))),
        ...(title
          ? [theme.fg('muted', '→ ') + theme.fg('toolOutput', truncateLine(title, width - 2))]
          : []),
        ...shownBody.map((line) => theme.fg('toolOutput', truncateLine(line, width))),
        theme.fg('muted', webFetchFooterText(part)) + theme.fg('muted', ' · ') + expandHint(theme)
      ]
    },
    invalidate: () => undefined
  }
}

function metadataRow(
  label: string,
  value: string | number | boolean | undefined | null,
  theme: Theme
) {
  if (value === undefined || value === null || value === '') return undefined
  return `${theme.fg('muted', label.padEnd(13))} ${theme.fg('toolOutput', String(value))}`
}

function sectionHeader(label: string, theme: Theme) {
  const muted = theme.fg('muted', label)
  const bold = (theme as Theme & { bold?: (text: string) => string }).bold
  return bold ? bold(muted) : muted
}

function yesNo(value: boolean | undefined) {
  return value ? 'yes' : 'no'
}

function webFetchExpandedHeader(part: OutputPart, format: string, theme: Theme) {
  return [
    '',
    sectionHeader('Web fetch', theme),
    metadataRow('Status:', statusLabel(numberMetadata(part.data?.status)), theme),
    metadataRow('URL:', stringMetadata(part.data?.url), theme),
    metadataRow('Final URL:', stringMetadata(part.data?.final_url ?? part.data?.finalUrl), theme),
    metadataRow(
      'Content-Type:',
      stringMetadata(part.data?.content_type ?? part.data?.contentType),
      theme
    ),
    metadataRow('Format:', format, theme),
    metadataRow(
      'Size:',
      formatBytes(numberMetadata(part.data?.size_bytes ?? part.data?.sizeBytes)),
      theme
    ),
    metadataRow('Chars:', numberMetadata(part.data?.total_chars ?? part.data?.totalChars), theme),
    metadataRow('Redirected:', yesNo(booleanMetadata(part.data?.redirected)), theme),
    metadataRow('Truncated:', yesNo(booleanMetadata(part.data?.truncated)), theme)
  ].filter((line): line is string => line !== undefined)
}

function webFetchExpandedBodyLines(output: string, format: string, width: number, theme: Theme) {
  if (format === 'markdown') return new Markdown(output, 0, 0, getMarkdownTheme()).render(width)
  if (format === 'json' || format === 'html') return codeLines(output, format, theme)
  return output.split('\n').map((line) => theme.fg('toolOutput', line))
}

function webFetchExpandedBodyHeader(part: OutputPart, theme: Theme) {
  const title = stringMetadata(part.data?.title)
  return title
    ? [
        '',
        sectionHeader('Title', theme),
        theme.fg('toolOutput', title),
        '',
        sectionHeader('Body', theme)
      ]
    : ['', sectionHeader('Body', theme)]
}

function renderExpandedWebFetchPart(part: OutputPart, theme: Theme): Component {
  return {
    render: (width) => {
      const output = stripFinalNewline(part.body ?? '')
      const format = stringMetadata(part.data?.format) ?? part.language ?? 'text'
      return [
        ...webFetchExpandedHeader(part, format, theme),
        ...webFetchExpandedBodyHeader(part, theme),
        ...webFetchExpandedBodyLines(output, format, width, theme)
      ]
    },
    invalidate: () => undefined
  }
}

function renderWebFetchPart(part: OutputPart, expanded: boolean, theme: Theme): Component {
  return expanded ? renderExpandedWebFetchPart(part, theme) : renderCompactWebFetchPart(part, theme)
}

function renderCompactOutputParts(visibleParts: OutputPart[], theme: Theme): Component {
  if (visibleParts.length > 1 && visibleParts[0]?.kind === 'text') {
    return renderCompactLine('', theme.fg('toolOutput', partPreview(visibleParts[0])), true, theme)
  }

  const preview = visibleParts
    .map((part, index) => {
      const text = partPreview(part)
      const styled = part.kind === 'text' && index === 0 ? theme.fg('toolOutput', text) : text
      return index === 0 ? styled : theme.fg('muted', ` ↳ ${text}`)
    })
    .join('')
  const semanticHidden = visibleParts.some(partHasSemanticHiddenOutput)
  return renderCompactLine('', preview, semanticHidden, theme)
}

export function renderOutputParts(parts: OutputPart[], expanded: boolean, theme: Theme) {
  const visibleParts = parts.filter((part) => part.body)
  if (visibleParts.length === 0) return renderLines([theme.fg('muted', '(no output)')])

  const table = renderOnlyTablePart(visibleParts, expanded, theme)
  if (table) return table

  const document = renderOnlyDocumentPart(visibleParts, expanded, theme)
  if (document) return document

  const source = renderOnlySourcePart(visibleParts, expanded, theme)
  if (source) return source

  const tree = renderOnlyTreePart(visibleParts, expanded, theme)
  if (tree) return tree

  if (!expanded) return renderCompactOutputParts(visibleParts, theme)

  const lines: string[] = []
  for (const [index, part] of visibleParts.entries()) {
    if (index > 0) lines.push('')
    const output = stripFinalNewline(part.body ?? '')
    const kind = part.kind ?? 'text'
    if (kind === 'table') {
      lines.push(theme.fg('toolOutput', output))
    } else if (kind === 'tree') {
      lines.push(...(renderTreePart(part, theme) ?? [theme.fg('toolOutput', output)]))
    } else if (kind === 'inspect') {
      const code = codeLines(output, part.language ?? 'elixir', theme)
      if (index === 0) {
        const [first, ...rest] = code
        lines.push(first?.trimStart() ?? '', ...rest)
      } else {
        lines.push(...code)
      }
    } else if (kind === 'code') {
      lines.push(
        ...codeFrameLines(output, part.language ?? 'elixir', theme, {
          startLine: sourceStartLine(part)
        })
      )
    } else if (kind === 'error') {
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

import { highlightCode, type AgentToolResult, type Theme } from '@earendil-works/pi-coding-agent'
import { visibleWidth, type Component } from '@earendil-works/pi-tui'

import { truncateLine } from '../helpers.ts'
import {
  expandHint as sharedExpandHint,
  hiddenLine as sharedHiddenLine,
  renderLines as sharedRenderLines,
  resultText as sharedResultText
} from '../shared/render.ts'

export function resultText(result: AgentToolResult<unknown>) {
  return sharedResultText(result)
}

export function decodeInspectedString(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return text

  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === 'string' ? parsed : text
  } catch {
    return text
  }
}

export function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function comparableInspectText(text: string): string {
  return compactText(text)
    .replace(/%\{\s+/g, '%{')
    .replace(/\[\s+/g, '[')
    .replace(/\{\s+/g, '{')
    .replace(/\s+([}\]])/g, '$1')
}

export function oneLine(text: string, limit = 120): string {
  const compact = compactText(text)
  return compact.length > limit ? compact.slice(0, limit - 1) + '…' : compact
}

export function firstContentLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  )
}

export function renderLines(lines: string[]) {
  return sharedRenderLines(lines)
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

export function withTiming(component: Component, theme: Theme, context: unknown): Component {
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

export function resultIsError(result: AgentToolResult<unknown>): boolean {
  return (result as { isError?: unknown }).isError === true
}

export function hiddenLine(count: number, theme: Theme) {
  return sharedHiddenLine(count, theme)
}

export function expandHint(theme: Theme) {
  return sharedExpandHint(theme)
}

export function inlineExpandHint(theme: Theme) {
  return theme.fg('muted', ' ') + sharedExpandHint(theme)
}

export function renderCompactLine(
  prefix: string,
  title: string,
  semanticHidden: boolean,
  theme: Theme
): Component {
  return {
    render: (width) => {
      const line = prefix + title
      if (!semanticHidden && visibleWidth(line) <= width) return ['', line]

      const hint = inlineExpandHint(theme)
      const lineWithHint = line + hint
      if (semanticHidden && visibleWidth(lineWithHint) <= width) return ['', lineWithHint]

      const reserve = visibleWidth(prefix) + visibleWidth(hint)
      if (width > reserve + 4) return ['', prefix + truncateLine(title, width - reserve) + hint]

      return ['', truncateLine(line, width)]
    },
    invalidate: () => undefined
  }
}

export function codeLines(
  text: string,
  language: string,
  theme: Theme,
  maxLines?: number
): string[] {
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

export function codeFrameLines(
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

export function stripFinalNewline(text: string) {
  return text.replace(/\r?\n$/, '')
}

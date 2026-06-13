import type {
  AgentToolResult,
  ToolRenderResultOptions,
  Theme
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

import { renderCommandOutput } from '../shared/command-output.ts'
import { renderOutputParts, type OutputPart } from './output.ts'
import {
  codeLines,
  compactText,
  decodeInspectedString,
  firstContentLine,
  renderCompactLine,
  renderLines,
  resultIsError,
  resultText,
  stripFinalNewline,
  withTiming
} from './shared.ts'

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

interface BridgeDetails {
  cwd?: string
  source?: string
  phase?: string
  connection?: string
}

function resultDetails(result: AgentToolResult<unknown>): Record<string, unknown> | null {
  const details = (result as { details?: unknown }).details
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : null
}

function evalPayload(result: AgentToolResult<unknown>): EvalPayload | null {
  const payload = resultDetails(result)?.eval
  return typeof payload === 'object' && payload !== null ? (payload as EvalPayload) : null
}

function bridgeDetails(result: AgentToolResult<unknown>): BridgeDetails | null {
  const bridge = resultDetails(result)?.bridge
  return typeof bridge === 'object' && bridge !== null ? (bridge as BridgeDetails) : null
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

function displayPathForUser(value: string | undefined): string | undefined {
  if (!value) return undefined
  const home = process.env.HOME
  if (home && value === home) return '~'
  if (home && value.startsWith(`${home}/`)) return `~${value.slice(home.length)}`
  return value
}

function bridgeSourceLabel(source: string | undefined): string {
  switch (source) {
    case 'external-env':
      return 'external bridge'
    case 'workspace':
      return 'current Mix project'
    case 'path-argument':
      return 'path Mix project'
    case 'bundled-bridge':
      return 'bundled pi_bridge'
    default:
      return 'pi_bridge'
  }
}

function renderBridgeStatus(bridge: BridgeDetails, text: string, expanded: boolean, theme: Theme) {
  const phase = bridge.phase === 'starting' ? 'starting' : 'preparing'
  const cwd = displayPathForUser(bridge.cwd)
  const summary = ['Elixir BEAM', phase, bridgeSourceLabel(bridge.source), cwd]
    .filter(Boolean)
    .join(' · ')

  if (!expanded) return renderCompactLine('', theme.fg('muted', summary), true, theme)

  const lines = stripFinalNewline(text)
    .split('\n')
    .map((line, index) => theme.fg(index === 0 ? 'toolOutput' : 'muted', line))
  return renderLines(lines)
}

function isInstallTranscript(text: string) {
  return (
    text.includes('$ mix deps.get') ||
    text.includes('$ mix run --no-halt') ||
    text.startsWith('[pi-elixir] Added ')
  )
}

function renderInstallTranscript(text: string, expanded: boolean, theme: Theme) {
  return renderCommandOutput(stripFinalNewline(text), expanded, theme)
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
  const bridge = bridgeDetails(result)
  const text = decodeInspectedString(resultText(result)).trim()
  let component: Component
  if (!text && !payload) component = renderLines([theme.fg('muted', '(no output)')])
  else if (payload?.error)
    component = renderErrorBlock(payload.error, expanded, theme, payload.exception)
  else if (payload) component = renderStructuredEval(payload, expanded, theme)
  else if (bridge?.phase === 'preparing')
    component = renderBridgeStatus(bridge, text, expanded, theme)
  else if (isInstallTranscript(text)) component = renderInstallTranscript(text, expanded, theme)
  else if (resultIsError(result)) component = renderErrorBlock(text, expanded, theme)
  else {
    const ioResult = parseIoResult(text)
    component = ioResult
      ? renderIoAndValue(ioResult.io, ioResult.result, expanded, theme)
      : renderEvalValue(text, expanded, theme)
  }

  return withTiming(component, theme, context)
}

export function renderElixirResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context?: unknown
) {
  return renderEvalResult(result, options, theme, context)
}

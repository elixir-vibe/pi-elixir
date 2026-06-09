import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolRenderResultOptions,
  type Theme
} from '@earendil-works/pi-coding-agent'
import { visibleWidth, type Component } from '@earendil-works/pi-tui'
import type { TObject } from 'typebox'

import {
  callTool,
  resolveUrl,
  getConnectionKind,
  type InstallPrompt
} from './connection/resolver.ts'
import { getIncompatibleDependency } from './connection/status.ts'
import { resolveMixProjectCwd } from './mix/project.ts'
import type { ToolArgs, ToolResult } from './protocol/types.ts'

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize }

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const ansiStylePrefix = new RegExp(`^${String.fromCharCode(27)}\\[[0-9;]*m`, 'u')

export function displayString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function displaySingleLine(value: unknown) {
  return displayString(value).replace(/\s+/gu, ' ').trim()
}

export function truncateLine(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (visibleWidth(text) <= maxWidth) return text

  const targetWidth = Math.max(0, maxWidth - 1)
  let result = ''
  let currentWidth = 0
  let activeStyles: string[] = []
  let index = 0

  while (index < text.length) {
    const ansi = ansiStylePrefix.exec(text.slice(index))
    if (ansi) {
      const code = ansi[0]
      result += code
      activeStyles = code === '\x1b[0m' || code === '\x1b[m' ? [] : [...activeStyles, code]
      index += code.length
      continue
    }

    let end = index
    while (end < text.length && !ansiStylePrefix.test(text.slice(end))) end++

    for (const segment of segmenter.segment(text.slice(index, end))) {
      const grapheme = segment.segment
      const graphemeWidth = visibleWidth(grapheme)
      if (currentWidth + graphemeWidth > targetWidth) return result + activeStyles.join('') + '…'
      result += grapheme
      currentWidth += graphemeWidth
    }
    index = end
  }

  return result + activeStyles.join('') + '…'
}

export function renderSingleLine(text: string): Component {
  return {
    render: (width) => [truncateLine(text, width)],
    invalidate: () => undefined
  }
}

export function normalizePathForBeam(
  params: ToolArgs,
  ctx: ExtensionContext,
  beamCwd: string
): ToolArgs {
  const rawPath = params.path
  if (typeof rawPath !== 'string' || rawPath.length === 0) return params

  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.cwd, rawPath)
  if (!fs.existsSync(absolutePath)) return params

  const relativeToBeam = path.relative(beamCwd, absolutePath)
  if (relativeToBeam === '') return { ...params, path: '.' }
  if (relativeToBeam.startsWith('..') || path.isAbsolute(relativeToBeam)) return params
  return { ...params, path: relativeToBeam }
}

export function astOptionSuffix(args: Record<string, unknown>, theme: Theme) {
  const parts: string[] = []
  const pathText = displayString(args.path)
  if (pathText) parts.push(pathText)
  const inside = displayString(args.inside)
  if (inside) parts.push(`inside ${inside}`)
  const notInside = displayString(args.notInside)
  if (notInside) parts.push(`not inside ${notInside}`)
  if (typeof args.limit === 'number') parts.push(`limit ${args.limit}`)
  if (args.allowBroad === true) parts.push('allow broad')
  if (args.dryRun === true) parts.push('dry-run')
  return parts.length > 0 ? theme.fg('muted', ` ${parts.join(' · ')}`) : ''
}

export function truncated(text: string) {
  const t = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES })
  if (!t.truncated) return t.content
  return (
    t.content +
    `\n\n[Truncated: ${t.outputLines}/${t.totalLines} lines, ${formatSize(t.outputBytes)}/${formatSize(t.totalBytes)}]`
  )
}

type ToolParameters = TObject
type RenderCall = (args: ToolArgs, theme: Theme, context?: unknown) => Component

export interface BridgeToolOpts {
  transformResult?: (text: string) => string
  prepareParams?: (
    params: ToolArgs,
    ctx: ExtensionContext,
    beamCwd: string,
    toolCallId: string
  ) => ToolArgs
  resultDetails?: (text: string, params: ToolArgs) => Record<string, unknown>
  renderResult?: (
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context?: unknown
  ) => Component
}

function missingDependencyError() {
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Pi BEAM tools are not installed in this Mix project. I can add the dev-only dependency to mix.exs and run `mix deps.get`, but I need explicit confirmation before editing the project.'
      }
    ],
    isError: true,
    details: {}
  }
}

function incompatibleDependencyError(cwd: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text:
          getIncompatibleDependency(cwd) ??
          'Installed pi_bridge version is incompatible with this pi-elixir extension.'
      }
    ],
    isError: true,
    details: {}
  }
}

function noConnectionError() {
  return {
    content: [
      {
        type: 'text' as const,
        text: 'No BEAM connection for this project. Start the Phoenix server with `mix phx.server` or ensure mix.exs exists and the project compiles.'
      }
    ],
    isError: true,
    details: {}
  }
}

function stillCompilingError() {
  return {
    content: [
      { type: 'text' as const, text: 'The BEAM is still compiling. Wait a moment and try again.' }
    ],
    isError: true,
    details: {}
  }
}

function connectionError(cwd: string) {
  const kind = getConnectionKind(cwd)
  if (kind === 'starting') return stillCompilingError()
  if (kind === 'missing') return missingDependencyError()
  if (kind === 'incompatible') return incompatibleDependencyError(cwd)
  return noConnectionError()
}

function installPromptMessage(prompt: InstallPrompt) {
  return `Pi BEAM tools are not installed in this Mix project.\n\nI can add the dev-only Pi BEAM dependency to ${prompt.mixExsPath} and run mix deps.get.\n\nProposed dependency:\n  ${prompt.dependency}\n\nProceed?`
}

type ExecuteToolCall = (
  params: ToolArgs,
  url: string,
  signal: AbortSignal | undefined
) => Promise<ToolResult>

interface BeamToolRegistration {
  name: string
  label: string
  description: string
  parameters: ToolParameters
  renderCall: RenderCall
  executeToolCall: ExecuteToolCall
  opts?: BridgeToolOpts
}

function registerBeamTool(pi: ExtensionAPI, tool: BeamToolRegistration) {
  pi.registerTool({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const beamCwd = resolveMixProjectCwd(ctx.cwd)
      if (!beamCwd) return connectionError(ctx.cwd)

      const conn = await resolveUrl(beamCwd, {
        confirmInstall: (prompt) =>
          ctx.hasUI
            ? ctx.ui.confirm('Install Pi BEAM tools?', installPromptMessage(prompt))
            : Promise.resolve(false)
      })
      if (!conn) return connectionError(beamCwd)

      const bridgeParams = tool.opts?.prepareParams?.(params, ctx, beamCwd, _id) ?? params
      const { text: rawText, isError } = await tool.executeToolCall(bridgeParams, conn.url, signal)
      const extraDetails = tool.opts?.resultDetails?.(rawText, params) ?? {}
      const text = tool.opts?.transformResult ? tool.opts.transformResult(rawText) : rawText
      return {
        content: [{ type: 'text' as const, text: truncated(text) }],
        isError,
        details: { args: params, mcpName: tool.name, ...extraDetails }
      }
    },
    renderCall: (args, theme, context) => tool.renderCall(args as ToolArgs, theme, context),
    renderResult: tool.opts?.renderResult
  })
}

export function bridgeTool(
  pi: ExtensionAPI,
  name: string,
  mcpName: string,
  label: string,
  description: string,
  parameters: ToolParameters,
  renderCall: RenderCall,
  opts?: BridgeToolOpts
) {
  registerBeamTool(pi, {
    name,
    label,
    description,
    parameters,
    renderCall,
    executeToolCall: (params, url, signal) => callTool(url, mcpName, params, signal),
    opts
  })
}

const scriptCache = new Map<string, string>()

export function loadScript(name: string): string {
  const cached = scriptCache.get(name)
  if (cached) return cached
  const filePath = fileURLToPath(new URL(`../scripts/tools/${name}.exs`, import.meta.url))
  const content = fs.readFileSync(filePath, 'utf-8')
  scriptCache.set(name, content)
  return content
}

export function wrapWithBindings(script: string, bindings: ToolArgs): string {
  const assigns = Object.entries(bindings)
    .map(([key, value]) => `${key} = ${elixirLiteral(value)}`)
    .join('\n')
  return `${assigns}\n\n${script}`
}

function elixirLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'nil'
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return 'nil'
}

export function evalTool(
  pi: ExtensionAPI,
  name: string,
  label: string,
  description: string,
  parameters: ToolParameters,
  buildCode: (params: ToolArgs) => string,
  renderCall: RenderCall,
  opts?: BridgeToolOpts
) {
  registerBeamTool(pi, {
    name,
    label,
    description,
    parameters,
    renderCall,
    executeToolCall: (params, url, signal) =>
      callTool(url, 'project_eval', { code: buildCode(params) }, signal),
    opts
  })
}

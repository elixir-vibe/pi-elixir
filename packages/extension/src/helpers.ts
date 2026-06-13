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
import dedent from 'dedent'
import type { TObject } from 'typebox'

import {
  callTool,
  resolveUrl,
  getConnectionKind,
  getStartupTranscript,
  type InstallPrompt
} from './connection/resolver.ts'
import { getIncompatibleDependency, getUnavailableReason } from './connection/status.ts'
import { resolveMixProjectCwd } from './mix/project.ts'
import type { ToolArgs, ToolResult } from './protocol/types.ts'
import { sleep } from './shared/async.ts'
import { parseIntegerEnv } from './shared/env.ts'

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize }

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const ansiStylePrefix = new RegExp(`^${String.fromCharCode(27)}\\[[0-9;]*m`, 'u')
const DEFAULT_STARTUP_RETRY_DELAY_MS = 750
const DEFAULT_STARTUP_WAIT_BUDGET_MS = 120_000
const PREPARATION_NOTICE_DELAY_MS = 500
const TEST_STARTUP_RETRY_DELAY_MS = 0
const TEST_STARTUP_WAIT_BUDGET_MS = 50

export function sessionContext(pi: ExtensionAPI, ctx: ExtensionContext) {
  return {
    cwd: ctx.cwd,
    sessionFile: ctx.sessionManager?.getSessionFile?.(),
    sessionName: pi.getSessionName(),
    leafId: ctx.sessionManager?.getLeafId?.(),
    mode: ctx.mode
  }
}

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
  isErrorResult?: (text: string, params: ToolArgs) => boolean
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
        text: 'Pi BEAM tools are not installed in this Mix project. Run `/elixir:install` to add the dev-only dependency, or retry from a non-interactive session where pi-elixir can install it automatically.'
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

function noMixProjectError() {
  return {
    content: [
      {
        type: 'text' as const,
        text: dedent`
          pi-elixir could not find a Mix project or bundled bridge.

          How pi-elixir chooses where to run:
          1. current directory if it has mix.exs
          2. a Mix project containing the tool path argument
          3. the bundled pi_bridge fallback from the installed extension

          Try running from a Mix project root, pass a path inside a Mix project, or run /elixir:doctor for environment details.
        `
      }
    ],
    isError: true,
    details: {}
  }
}

function runtimeUnavailableError(cwd: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text:
          getUnavailableReason(cwd) ??
          'Elixir/Mix is not available on PATH. Install Elixir/OTP before using pi-elixir BEAM tools.'
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
        text: dedent`
          pi-elixir could not connect to pi_bridge for this project.

          Normally pi-elixir starts an embedded BEAM automatically. If this is a cold project, it may still be compiling dependencies.

          Next steps:
          - wait a moment and retry the tool call
          - run /elixir:doctor to see bridge/runtime diagnostics
          - if dependencies were just changed, run mix deps.get && mix compile
          - use mix phx.server only when intentionally exposing an external Phoenix/MCP bridge
        `
      }
    ],
    isError: true,
    details: {}
  }
}

function envIntegerOrDefault(name: string, fallback: number): number {
  const parsed = parseIntegerEnv(name)
  return parsed.ok && parsed.value !== undefined && parsed.value >= 0 ? parsed.value : fallback
}

function startupRetryDelayMs(): number {
  const fallback =
    process.env.NODE_ENV === 'test' ? TEST_STARTUP_RETRY_DELAY_MS : DEFAULT_STARTUP_RETRY_DELAY_MS
  return envIntegerOrDefault('PI_ELIXIR_STARTUP_RETRY_MS', fallback)
}

function startupWaitBudgetMs(): number {
  const fallback =
    process.env.NODE_ENV === 'test' ? TEST_STARTUP_WAIT_BUDGET_MS : DEFAULT_STARTUP_WAIT_BUDGET_MS
  return envIntegerOrDefault('PI_ELIXIR_STARTUP_WAIT_MS', fallback)
}

function stillCompilingError() {
  return {
    content: [
      {
        type: 'text' as const,
        text: dedent`
          The embedded BEAM bridge is still starting.

          Cold starts can compile Elixir dependencies. pi-elixir waits and streams Mix output when available; retry in a moment if the startup budget was exceeded.

          Run /elixir:doctor if this keeps happening.
        `
      }
    ],
    isError: true,
    details: {}
  }
}

function connectionError(cwd: string) {
  const kind = getConnectionKind(cwd)
  if (kind === 'starting') return stillCompilingError()
  if (kind === 'missing') return missingDependencyError()
  if (kind === 'unavailable') return runtimeUnavailableError(cwd)
  if (kind === 'incompatible') return incompatibleDependencyError(cwd)
  return noConnectionError()
}

function installPromptMessage(prompt: InstallPrompt) {
  return dedent`
    Pi BEAM tools are not installed in this Mix project.

    I can add the dev-only Pi BEAM dependency to ${prompt.mixExsPath} and run mix deps.get.

    Proposed dependency:
      ${prompt.dependency}

    Proceed?
  `
}

function allowNonInteractiveInstall(): boolean {
  return process.env.PI_ELIXIR_AUTO_INSTALL !== '0'
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

type BeamToolCwdSource = 'external-env' | 'workspace' | 'path-argument' | 'bundled-bridge'

interface BeamToolTarget {
  cwd: string
  source: BeamToolCwdSource
}

function resolveBeamToolTarget(
  pi: ExtensionAPI,
  toolName: string,
  params: ToolArgs,
  ctx: ExtensionContext
): BeamToolTarget | null {
  if (process.env.PI_MCP_URL) return { cwd: ctx.cwd, source: 'external-env' }

  const workspace = resolveMixProjectCwd(ctx.cwd)
  if (workspace) return { cwd: workspace, source: 'workspace' }

  const pathArgument = resolveMixProjectCwdFromToolPath(params, ctx.cwd)
  if (pathArgument) return { cwd: pathArgument, source: 'path-argument' }

  const bundled = resolveBundledBridgeCwd(pi, toolName)
  if (bundled) return { cwd: bundled, source: 'bundled-bridge' }

  return null
}

export function resolveBeamToolCwd(
  pi: ExtensionAPI,
  toolName: string,
  params: ToolArgs,
  ctx: ExtensionContext
): string | null {
  return resolveBeamToolTarget(pi, toolName, params, ctx)?.cwd ?? null
}

function resolveMixProjectCwdFromToolPath(params: ToolArgs, cwd: string): string | null {
  const rawPath = params.path
  if (typeof rawPath !== 'string' || rawPath.length === 0) return null

  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath)
  if (!fs.existsSync(absolutePath)) return null

  let candidate = fs.statSync(absolutePath).isDirectory()
    ? absolutePath
    : path.dirname(absolutePath)
  while (true) {
    if (fs.existsSync(path.join(candidate, 'mix.exs'))) return candidate
    const parent = path.dirname(candidate)
    if (parent === candidate) return null
    candidate = parent
  }
}

function resolveBundledBridgeCwd(pi: ExtensionAPI, toolName: string): string | null {
  const sourceInfo = pi.getAllTools().find((tool) => tool.name === toolName)?.sourceInfo
  const candidates = bundledBridgeCandidates(sourceInfo?.baseDir, sourceInfo?.path)

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'mix.exs'))) return candidate
  }
  return null
}

function bundledBridgeCandidates(...sources: Array<string | undefined>): string[] {
  const candidates = new Set<string>()

  for (const source of sources) {
    if (!source || source.startsWith('<')) continue
    const start =
      fs.existsSync(source) && fs.statSync(source).isDirectory() ? source : path.dirname(source)
    let dir = start
    while (true) {
      candidates.add(path.join(dir, 'packages', 'bridge'))
      candidates.add(path.join(dir, '..', 'bridge'))

      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  return [...candidates]
}

function displayPathForUser(value: string): string {
  const home = process.env.HOME
  if (home && value === home) return '~'
  if (home && value.startsWith(`${home}${path.sep}`)) return `~${value.slice(home.length)}`
  return value
}

function beamSourceLabel(source: BeamToolCwdSource): string {
  switch (source) {
    case 'external-env':
      return 'external PI_MCP_URL bridge'
    case 'workspace':
      return 'current Mix project'
    case 'path-argument':
      return 'Mix project from tool path'
    case 'bundled-bridge':
      return 'bundled pi_bridge fallback'
  }

  source satisfies never
  throw new Error(`Unknown BEAM source: ${String(source)}`)
}

function bridgePreparationMessage(target: BeamToolTarget): string {
  return dedent`
    Preparing Elixir BEAM bridge…
    Project: ${displayPathForUser(target.cwd)}
    Source: ${beamSourceLabel(target.source)}
    First run may compile dependencies; Mix output will stream below when available.
  `
}

async function resolveUrlWithStartupGrace(
  beamCwd: string,
  confirmInstall: (prompt: InstallPrompt) => Promise<boolean>,
  onProgress?: (message: string) => void,
  signal?: AbortSignal
) {
  const options = { confirmInstall, onProgress, signal }
  const startedAt = Date.now()
  const waitBudget = startupWaitBudgetMs()
  const retryDelay = startupRetryDelayMs()

  while (true) {
    const conn = await resolveUrl(beamCwd, options)
    if (conn || getConnectionKind(beamCwd) !== 'starting') return conn

    const transcript = getStartupTranscript(beamCwd)
    if (transcript) onProgress?.(transcript)

    if (Date.now() - startedAt >= waitBudget || signal?.aborted) return null
    await sleep(retryDelay)
  }
}

function registerBeamTool(pi: ExtensionAPI, tool: BeamToolRegistration) {
  pi.registerTool({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute(_id, params, signal, onUpdate, ctx) {
      const target = resolveBeamToolTarget(pi, tool.name, params, ctx)
      if (!target) return noMixProjectError()

      const beamCwd = target.cwd
      let installTranscript = ''
      let preparationNoticeShown = false
      const preparationTimer = onUpdate
        ? setTimeout(() => {
            preparationNoticeShown = true
            onUpdate({
              content: [{ type: 'text' as const, text: bridgePreparationMessage(target) }],
              details: { bridge: { cwd: beamCwd, source: target.source, phase: 'preparing' } }
            })
          }, PREPARATION_NOTICE_DELAY_MS)
        : undefined
      preparationTimer?.unref?.()

      try {
        const conn = await resolveUrlWithStartupGrace(
          beamCwd,
          (prompt) =>
            ctx.hasUI
              ? ctx.ui.confirm('Install Pi BEAM tools?', installPromptMessage(prompt))
              : Promise.resolve(allowNonInteractiveInstall()),
          (message) => {
            if (message) {
              installTranscript = message
              if (preparationTimer && !preparationNoticeShown) clearTimeout(preparationTimer)
              onUpdate?.({
                content: [{ type: 'text' as const, text: message }],
                details: { bridge: { cwd: beamCwd, source: target.source, phase: 'starting' } }
              })
            }
          },
          signal
        )
        if (!conn) {
          const error = connectionError(beamCwd)
          if (!installTranscript) return error

          return {
            ...error,
            content: [
              {
                type: 'text' as const,
                text: `${installTranscript}\n\n${error.content.map((part) => part.text).join('\n')}`
              }
            ]
          }
        }

        const bridgeParams = tool.opts?.prepareParams?.(params, ctx, beamCwd, _id) ?? params
        const { text: rawText, isError } = await tool.executeToolCall(
          bridgeParams,
          conn.url,
          signal
        )
        const extraDetails = tool.opts?.resultDetails?.(rawText, params) ?? {}
        const text = tool.opts?.transformResult ? tool.opts.transformResult(rawText) : rawText
        const forcedError = tool.opts?.isErrorResult?.(rawText, params) ?? false
        return {
          content: [{ type: 'text' as const, text: truncated(text) }],
          isError: isError || forcedError,
          details: {
            args: params,
            mcpName: tool.name,
            bridge: { cwd: beamCwd, source: target.source, connection: conn.kind },
            ...extraDetails
          }
        }
      } finally {
        if (preparationTimer) clearTimeout(preparationTimer)
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

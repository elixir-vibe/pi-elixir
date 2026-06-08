import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type AgentToolResult,
  type ExtensionAPI,
  type ToolRenderResultOptions,
  type Theme
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

import {
  callTool,
  resolveUrl,
  getConnectionKind,
  type InstallPrompt
} from './connection/resolver.ts'
import type { ToolArgs, ToolResult } from './protocol/types.ts'

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize }

export function displayString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function truncated(text: string) {
  const t = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES })
  if (!t.truncated) return t.content
  return (
    t.content +
    `\n\n[Truncated: ${t.outputLines}/${t.totalLines} lines, ${formatSize(t.outputBytes)}/${formatSize(t.totalBytes)}]`
  )
}

type ToolParameters = ReturnType<typeof Type.Object>
type RenderCall = (args: ToolArgs, theme: Theme) => Component

export interface BridgeToolOpts {
  transformResult?: (text: string) => string
  renderResult?: (
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme
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
      const conn = await resolveUrl(ctx.cwd, {
        confirmInstall: (prompt) =>
          ctx.hasUI
            ? ctx.ui.confirm('Install Pi BEAM tools?', installPromptMessage(prompt))
            : Promise.resolve(false)
      })
      if (!conn) return connectionError(ctx.cwd)

      let { text, isError } = await tool.executeToolCall(params, conn.url, signal)
      if (tool.opts?.transformResult) text = tool.opts.transformResult(text)
      return {
        content: [{ type: 'text' as const, text: truncated(text) }],
        isError,
        details: {}
      }
    },
    renderCall: tool.renderCall,
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
  const filePath = path.resolve(__dirname, `../scripts/tools/${name}.exs`)
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

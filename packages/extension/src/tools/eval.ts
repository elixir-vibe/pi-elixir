import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  bridgeTool,
  DEFAULT_MAX_LINES,
  formatSize,
  DEFAULT_MAX_BYTES,
  displaySingleLine,
  renderSingleLine
} from '#src/helpers.ts'
import type { ToolArgs } from '#src/protocol/types.ts'
import { renderElixirResult } from '#src/renderers.ts'
import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

interface EvalPayload {
  kind?: string
  io?: string
  result?: string | null
  error?: string
  text?: string
}

interface SessionEntryLike {
  id?: string
  parentId?: string | null
  message?: { toolCallId?: string }
}

interface SessionManagerLike {
  getSessionFile?: () => string | undefined
  getLeafId?: () => string | null
  getEntry?: (id: string) => SessionEntryLike | undefined
  getBranch?: (fromId?: string) => SessionEntryLike[]
}

function parseEvalPayload(text: string): EvalPayload | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as EvalPayload) : null
  } catch {
    return null
  }
}

function evalDetails(text: string) {
  const payload = parseEvalPayload(text)
  return payload?.kind === 'eval' ? { eval: payload } : {}
}

function evalText(text: string) {
  const payload = parseEvalPayload(text)
  return payload?.kind === 'eval' && typeof payload.text === 'string' ? payload.text : text
}

function optionSuffix(args: ToolArgs, theme: Theme) {
  const parts: string[] = []
  if (args.mode === 'sandbox') parts.push(theme.fg('warning', 'sandbox'))
  if (typeof args.timeout === 'number') parts.push(theme.fg('muted', `${args.timeout}ms`))
  return parts.length > 0
    ? theme.fg('muted', ' (') + parts.join(theme.fg('muted', ', ')) + theme.fg('muted', ')')
    : ''
}

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]/gu, '_')
}

function stateRoot(sessionFile: string) {
  return path.join(`${sessionFile}.pi-elixir`, 'eval-state')
}

function statePathFor(root: string, nodeId: string) {
  return path.join(root, `${safeFileName(nodeId)}.term`)
}

function candidateStateIds(entry: SessionEntryLike) {
  return [entry.message?.toolCallId, entry.id].filter((id): id is string => typeof id === 'string')
}

function nearestRestorePath(manager: SessionManagerLike, root: string, leafId: string) {
  const branch = manager.getBranch?.(leafId)
  if (branch && branch.length > 0) {
    for (const entry of branch.toReversed()) {
      for (const stateId of candidateStateIds(entry)) {
        const candidate = statePathFor(root, stateId)
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }

  let current: string | null | undefined = leafId
  const seen = new Set<string>()

  while (current && !seen.has(current)) {
    seen.add(current)
    const entry: SessionEntryLike | undefined = manager.getEntry?.(current)
    if (entry) {
      for (const stateId of candidateStateIds(entry)) {
        const candidate = statePathFor(root, stateId)
        if (fs.existsSync(candidate)) return candidate
      }
    }
    current = entry?.parentId
  }

  return undefined
}

function prepareEvalParams(
  params: ToolArgs,
  ctx: ExtensionContext,
  beamCwd: string,
  toolCallId: string
): ToolArgs {
  if (params.mode === 'sandbox') return params

  const manager = ctx.sessionManager as SessionManagerLike | undefined
  if (!manager) return { ...params, sessionId: `ephemeral:${beamCwd}` }

  const sessionFile = manager.getSessionFile?.()
  const leafId = manager.getLeafId?.()
  if (!sessionFile || !leafId) return { ...params, sessionId: `ephemeral:${beamCwd}` }

  const root = stateRoot(sessionFile)
  const statePath = statePathFor(root, toolCallId)
  const restorePath = nearestRestorePath(manager, root, leafId)

  return {
    ...params,
    sessionId: toolCallId,
    statePath,
    ...(restorePath ? { restorePath } : {})
  }
}

function renderEvalCall(toolName: string) {
  return (args: ToolArgs, theme: Theme) => {
    const code = displaySingleLine(args.code)
    return renderSingleLine(
      theme.fg('toolTitle', theme.bold(`${toolName} `)) +
        theme.fg('accent', code) +
        optionSuffix(args, theme)
    )
  }
}

export function register(pi: ExtensionAPI) {
  bridgeTool(
    pi,
    'elixir_eval',
    'project_eval_structured',
    'iex',
    `Evaluate Elixir code in the running application.

Runs inside the BEAM with full access to project modules, deps, Ecto repos, and IEx helpers.
Use mode: "sandbox" for untrusted snippets through Dune.
Use this instead of bash for anything Elixir — test functions, introspect modules, manipulate ASTs,
query process state, read docs with h(), list exports with exports(), inspect values with i().

Output truncated to ${DEFAULT_MAX_LINES} lines / ${formatSize(DEFAULT_MAX_BYTES)}.`,
    Type.Object({
      code: Type.String({ description: 'Elixir code to evaluate' }),
      mode: Type.Optional(
        Type.Union([Type.Literal('trusted'), Type.Literal('sandbox')], {
          description:
            'Eval mode: trusted project introspection (default) or sandbox for untrusted code'
        })
      ),
      timeout: Type.Optional(
        Type.Integer({ description: 'Timeout in ms (default: 30000 trusted, 5000 sandbox)' })
      )
    }),
    renderEvalCall('iex'),
    {
      transformResult: evalText,
      prepareParams: prepareEvalParams,
      resultDetails: evalDetails,
      renderResult: renderElixirResult
    }
  )
}

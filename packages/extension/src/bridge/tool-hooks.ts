import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { callTool, resolveUrl, sendBridgeEvent } from '../connection/resolver.ts'
import type { ToolArgs } from '../protocol/types.ts'
import { refreshSessionSnapshots } from '../sessions/state.ts'

interface PluginHookResponse {
  0?: string
  1?: string | ToolArgs
  block?: string
  ok?: ToolArgs
  error?: string
}

function parsePluginHookResponse(text: string): PluginHookResponse {
  try {
    return JSON.parse(text) as PluginHookResponse
  } catch {
    return {}
  }
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part !== 'object' || part === null) return ''
      const maybeText = (part as { text?: unknown }).text
      return typeof maybeText === 'string' ? maybeText : ''
    })
    .join('\n')
}

export function registerBridgeToolHooks(
  pi: ExtensionAPI,
  resolveElixirCwd: (cwd: string) => string | null,
  hasBridgePlugins: (cwd: string) => boolean
) {
  pi.on('tool_call', async (event, ctx: ExtensionContext) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return undefined

    await sendBridgeEvent(beamCwd, {
      type: 'tool_call',
      cwd: ctx.cwd,
      name: event.toolName
    })

    if (!hasBridgePlugins(beamCwd)) return undefined

    const conn = await resolveUrl(beamCwd)
    if (!conn) return undefined

    const result = await callTool(conn.url, 'pi_plugin_tool_call', {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input
    })
    const payload = parsePluginHookResponse(result.text)

    if (payload.block) return { block: true, reason: payload.block }
    if (payload.ok && typeof payload.ok === 'object') Object.assign(event.input, payload.ok)
    return undefined
  })

  pi.on('tool_result', async (event, ctx: ExtensionContext) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return undefined

    if (event.toolName?.startsWith('elixir_'))
      await refreshSessionSnapshots(pi, ctx, resolveElixirCwd)

    await sendBridgeEvent(beamCwd, {
      type: 'tool_result',
      cwd: ctx.cwd,
      name: event.toolName,
      isError: event.isError
    })

    if (!hasBridgePlugins(beamCwd)) return undefined

    const conn = await resolveUrl(beamCwd)
    if (!conn) return undefined

    const result = await callTool(conn.url, 'pi_plugin_tool_result', {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input,
      content: textFromContent(event.content),
      isError: event.isError
    })
    const payload = parsePluginHookResponse(result.text)

    if (payload.ok && typeof payload.ok === 'object') {
      const patch = payload.ok
      return {
        content:
          typeof patch.content === 'string'
            ? [{ type: 'text' as const, text: patch.content }]
            : undefined,
        isError: typeof patch.isError === 'boolean' ? patch.isError : undefined
      }
    }

    return undefined
  })
}

import { callTool, resolveUrl, sendBridgeEvent } from '#src/connection/resolver.ts'
import { recordDiagnostic, withDiagnosticSpan } from '#src/diagnostics.ts'
import type { ToolArgs } from '#src/protocol/types.ts'
import { refreshSessionSnapshots } from '#src/sessions/state.ts'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

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

    recordDiagnostic('tool_call', beamCwd, { toolName: event.toolName })
    await sendBridgeEvent(beamCwd, {
      type: 'tool_call',
      cwd: ctx.cwd,
      name: event.toolName
    })

    if (!hasBridgePlugins(beamCwd)) return undefined

    const payload = await withDiagnosticSpan(
      'plugin_tool_call',
      beamCwd,
      { toolName: event.toolName },
      async () => {
        const conn = await resolveUrl(beamCwd)
        if (!conn) return {}

        const result = await callTool(conn.url, 'pi_plugin_tool_call', {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          input: event.input
        })
        return parsePluginHookResponse(result.text)
      }
    )

    if (payload.block) return { block: true, reason: payload.block }
    if (payload.ok && typeof payload.ok === 'object') Object.assign(event.input, payload.ok)
    return undefined
  })

  pi.on('tool_result', async (event, ctx: ExtensionContext) => {
    const beamCwd = resolveElixirCwd(ctx.cwd)
    if (!beamCwd) return undefined

    recordDiagnostic('tool_result', beamCwd, { toolName: event.toolName, isError: event.isError })
    if (event.toolName?.startsWith('elixir_'))
      await refreshSessionSnapshots(pi, ctx, resolveElixirCwd)

    await sendBridgeEvent(beamCwd, {
      type: 'tool_result',
      cwd: ctx.cwd,
      name: event.toolName,
      isError: event.isError
    })

    if (!hasBridgePlugins(beamCwd)) return undefined

    const payload = await withDiagnosticSpan(
      'plugin_tool_result',
      beamCwd,
      { toolName: event.toolName },
      async () => {
        const conn = await resolveUrl(beamCwd)
        if (!conn) return {}

        const result = await callTool(conn.url, 'pi_plugin_tool_result', {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          input: event.input,
          content: textFromContent(event.content),
          isError: event.isError
        })
        return parsePluginHookResponse(result.text)
      }
    )

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

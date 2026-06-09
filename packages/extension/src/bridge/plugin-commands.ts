import { callTool, resolveUrl } from '#src/connection/resolver.ts'
import type { BridgeInfo, BridgePluginCommand } from '#src/protocol/types.ts'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

interface PluginCommandResult {
  0?: string
  1?: string
  ok?: string
  error?: string
}

function pluginCommandName(command: BridgePluginCommand): string | null {
  if (!command.name) return null
  return `elixir:${command.name}`
}

function parsePluginCommandResult(text: string): PluginCommandResult {
  try {
    return JSON.parse(text) as PluginCommandResult
  } catch {
    return { ok: text }
  }
}

export function registerBridgeCommands(
  pi: ExtensionAPI,
  info: BridgeInfo | undefined,
  registered: Set<string>,
  resolveElixirCwd: (cwd: string) => string | null
) {
  for (const command of info?.commands ?? []) {
    const name = pluginCommandName(command)
    if (!name || registered.has(name)) continue

    registered.add(name)
    pi.registerCommand(name, {
      description: command.description ?? `Run BEAM plugin command ${command.name}`,
      handler: async (args, ctx) => {
        const beamCwd = resolveElixirCwd(ctx.cwd)
        const conn = beamCwd ? await resolveUrl(beamCwd) : null
        if (!conn) {
          ctx.ui.notify('No BEAM connection for this project.', 'error')
          return
        }

        const result = await callTool(conn.url, 'pi_plugin_command', { name: command.name, args })
        const payload = parsePluginCommandResult(result.text)
        if (result.isError || payload.error) {
          ctx.ui.notify(payload.error ?? result.text, 'error')
          return
        }

        if (payload.ok) ctx.ui.notify(payload.ok, 'info')
      }
    })
  }
}

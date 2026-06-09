import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { callTool, resolveUrl } from '../connection/resolver.ts'

export function registerSessionCommands(
  pi: ExtensionAPI,
  registered: Set<string>,
  resolveElixirCwd: (cwd: string) => string | null
) {
  const commands = [
    {
      name: 'elixir:sessions.cancel',
      description: 'Cancel an OTP-backed BEAM session',
      tool: 'pi_session_cancel'
    },
    {
      name: 'elixir:sessions.rerun',
      description: 'Rerun an OTP-backed BEAM session',
      tool: 'pi_session_rerun'
    }
  ]

  for (const command of commands) {
    if (registered.has(command.name)) continue
    registered.add(command.name)
    pi.registerCommand(command.name, {
      description: command.description,
      handler: async (args, ctx) => {
        const rawArgs = args as unknown
        const id =
          typeof rawArgs === 'string'
            ? rawArgs
            : typeof rawArgs === 'object' &&
                rawArgs !== null &&
                typeof (rawArgs as { id?: unknown }).id === 'string'
              ? (rawArgs as { id: string }).id
              : undefined
        if (!id) {
          ctx.ui.notify('Session id is required.', 'error')
          return
        }

        const beamCwd = resolveElixirCwd(ctx.cwd)
        const conn = beamCwd ? await resolveUrl(beamCwd) : null
        if (!conn) {
          ctx.ui.notify('No BEAM connection for this project.', 'error')
          return
        }

        const result = await callTool(conn.url, command.tool, { id })
        ctx.ui.notify(result.isError ? result.text : 'ok', result.isError ? 'error' : 'info')
      }
    })
  }
}

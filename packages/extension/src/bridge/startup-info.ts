import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

import type { BridgeInfo } from '../embedded/stdio-process.ts'

function list<T>(value: T[] | undefined, render: (value: T) => string | undefined) {
  if (!value || value.length === 0) return 'none'
  return value.map(render).filter(Boolean).join(', ') || 'none'
}

export function renderStartupInfo(info: BridgeInfo) {
  const lines = [
    'pi_bridge',
    `  project: ${info.project ?? 'unknown'}`,
    `  transport: ${info.transport ?? 'unknown'}`,
    `  integrations: ${list(info.integrations, (name) => name)}`,
    `  executable skills: ${info.skills?.length ?? 0}`,
    `  plugins: ${info.plugins?.length ?? 0}`,
    `  endpoints: ${list(info.endpoints, (endpoint) => endpoint.url ?? (endpoint.port ? `:${endpoint.port}` : endpoint.module))}`
  ]

  return lines.join('\n')
}

export function showStartupInfo(ctx: ExtensionContext, info: BridgeInfo | undefined) {
  if (!info) return
  ctx.ui.notify(renderStartupInfo(info), 'info')
}

import type { BridgeInfo } from '#src/embedded/stdio-process.ts'
import { EXTENSION_VERSION } from '#src/version.ts'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

export function renderStartupInfo(info: BridgeInfo) {
  const lines = [
    'pi_bridge',
    `  project: ${info.project ?? 'unknown'}`,
    `  pi_bridge: ${info.version ?? 'unknown'} (extension ${EXTENSION_VERSION})`,
    `  transport: ${info.transport ?? 'unknown'}`,
    `  executable skills: ${info.skills?.length ?? 0}`,
    `  plugins: ${info.plugins?.length ?? 0}`
  ]

  return lines.join('\n')
}

export function showStartupInfo(ctx: ExtensionContext, info: BridgeInfo | undefined) {
  if (!info) return
  ctx.ui.notify(renderStartupInfo(info), 'info')
}

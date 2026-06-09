import packageJson from '../../../package.json' with { type: 'json' }

export const EXTENSION_VERSION = packageJson.version

export function expectedPiBridgeDependency(): string {
  return `{:pi_bridge, "== ${EXTENSION_VERSION}", only: :dev}`
}

export function piBridgeVersionMismatchMessage(actual: string | undefined): string {
  const installed = actual || 'unknown'
  return `pi_bridge version mismatch: installed ${installed}, but pi-elixir extension expects ${EXTENSION_VERSION}. Update the Mix dependency to {:pi_bridge, "== ${EXTENSION_VERSION}", only: :dev} and run mix deps.get.`
}

export function isPiBridgeVersionCompatible(actual: string | undefined): boolean {
  return actual === EXTENSION_VERSION
}

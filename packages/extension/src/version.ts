import { readFileSync } from 'node:fs'

function readExtensionVersion(): string {
  const packageJsonUrl = new URL('../../../package.json', import.meta.url)
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as { version?: string }
  return packageJson.version ?? '0.0.0'
}

export const EXTENSION_VERSION = readExtensionVersion()

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

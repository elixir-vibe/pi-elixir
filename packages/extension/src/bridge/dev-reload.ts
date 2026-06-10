import {
  clearEmbeddedFailed,
  startEmbeddedInBackground,
  stopEmbedded
} from '#src/embedded/stdio-process.ts'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

type ReloadableContext = ExtensionContext & { reload: () => Promise<void> }

function reloadContext(ctx: ExtensionContext): ReloadableContext {
  return ctx as ReloadableContext
}

export async function compileBeam(pi: ExtensionAPI, beamCwd: string): Promise<void> {
  const result = await pi.exec('mix', ['compile', '--force'], { cwd: beamCwd, timeout: 120_000 })
  if (result.code !== 0) {
    const output = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')
    throw new Error(output || `mix compile exited ${result.code}`)
  }
}

export async function restartBeam(pi: ExtensionAPI, beamCwd: string): Promise<void> {
  stopEmbedded(beamCwd)
  clearEmbeddedFailed(beamCwd)
  await compileBeam(pi, beamCwd)
  startEmbeddedInBackground(beamCwd)
}

export async function refreshDev(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  beamCwd: string
): Promise<void> {
  stopEmbedded(beamCwd)
  clearEmbeddedFailed(beamCwd)
  await compileBeam(pi, beamCwd)
  await reloadContext(ctx).reload()
}

export function scheduleDevRequest(
  action: 'restart' | 'refresh' | 'pi',
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  beamCwd: string
): void {
  setTimeout(() => {
    void (async () => {
      try {
        if (action === 'restart') {
          await restartBeam(pi, beamCwd)
          ctx.ui.notify('Elixir restarted', 'info')
        } else if (action === 'pi') {
          await reloadContext(ctx).reload()
        } else {
          await refreshDev(pi, ctx, beamCwd)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Elixir ${action} failed:\n${message}`, 'error')
      }
    })()
  }, 0)
}

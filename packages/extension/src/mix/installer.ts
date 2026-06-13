import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  clearIncompatibleDependency,
  clearMissingDependency,
  markMissingDependency
} from '#src/connection/status.ts'
import { expectedPiBridgeDependency } from '#src/version.ts'

import { addPiDependency, hasPiDependency, readAppName, readMixExs } from './project.ts'

const PI_BEAM_PATH = fileURLToPath(new URL('../../../bridge', import.meta.url))

export interface InstallPrompt {
  dependency: string
  mixExsPath: string
}

export interface InstallOptions {
  confirmInstall?: (prompt: InstallPrompt) => Promise<boolean>
  onProgress?: (message: string) => void
  signal?: AbortSignal
}

function localPiBeamPath(): string | null {
  const override = process.env.PI_BEAM_PACKAGE_PATH
  const candidate = override ? path.resolve(override) : PI_BEAM_PATH
  return fs.existsSync(path.join(candidate, 'mix.exs')) ? candidate : null
}

function relativePiBeamPath(cwd: string, beamPath: string): string {
  const relative = path.relative(cwd, beamPath).replaceAll(path.sep, '/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

function dependencyLine(cwd: string): string {
  if (process.env.PI_BEAM_DEPENDENCY !== 'path') return expectedPiBridgeDependency()

  const beamPath = localPiBeamPath()
  if (!beamPath) return expectedPiBridgeDependency()
  return `{:pi_bridge, path: "${relativePiBeamPath(cwd, beamPath)}", only: :dev}`
}

function mixDepsGetEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HEX_HTTP_CONCURRENCY: process.env.HEX_HTTP_CONCURRENCY ?? '1'
  }
}

function isHexNetworkFailure(output: string): boolean {
  return (
    output.includes('Failed to exchange API key for OAuth token') ||
    output.includes(':failed_connect') ||
    output.includes('{:failed_connect,')
  )
}

function installFailureMessage(code: number | null, output: string): string {
  const base = `mix deps.get exited with code ${code}`
  const suffix = output ? `\n\n${output}` : ''

  if (!isHexNetworkFailure(output)) return `${base}${suffix}`

  return `${base}\n\nHex could not reach hex.pm while fetching pi_bridge. Check network/VPN/proxy access and retry the install. The mix.exs edit was rolled back so the next Elixir tool call can prompt again.${suffix}`
}

function runMixDepsGet(
  cwd: string,
  onProgress?: (message: string) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn('mix', ['deps.get'], {
      cwd,
      env: mixDepsGetEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let transcript = '$ mix deps.get\n\n'
    let aborted = false

    const emit = () => onProgress?.(transcript.trimEnd())
    const append = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      const text = chunk.toString('utf8')
      if (target === 'stdout') stdout += text
      else stderr += text
      transcript += text
      emit()
    }
    const abort = () => {
      aborted = true
      proc.kill('SIGTERM')
    }

    emit()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })

    proc.stdout?.on('data', (chunk: Buffer) => append(chunk, 'stdout'))
    proc.stderr?.on('data', (chunk: Buffer) => append(chunk, 'stderr'))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      signal?.removeEventListener('abort', abort)
      if (aborted) {
        reject(new Error(`${transcript.trimEnd()}\n\nCommand aborted`))
        return
      }
      if (code === 0) {
        resolve()
        return
      }

      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      reject(new Error(installFailureMessage(code, output)))
    })
  })
}

export async function ensurePiBeamDependency(cwd: string, options?: InstallOptions) {
  const mixExsPath = path.join(cwd, 'mix.exs')
  const mixExs = readMixExs(cwd)
  if (!mixExs) return true

  if (readAppName(cwd) === 'pi_bridge' || hasPiDependency(mixExs)) {
    clearMissingDependency(cwd)
    return true
  }

  const dependency = dependencyLine(cwd)
  markMissingDependency(cwd)

  if (!options?.confirmInstall) return false
  if (!(await options.confirmInstall({ dependency, mixExsPath }))) return false

  const updated = addPiDependency(mixExs, dependency)
  if (!updated) return false

  options.onProgress?.(`[pi-elixir] Added ${dependency} to mix.exs`)
  fs.writeFileSync(mixExsPath, updated)

  try {
    await runMixDepsGet(cwd, options.onProgress, options.signal)
  } catch (error) {
    fs.writeFileSync(mixExsPath, mixExs)
    options.onProgress?.('[pi-elixir] Rolled back mix.exs')
    markMissingDependency(cwd)
    throw error
  }
  clearMissingDependency(cwd)
  clearIncompatibleDependency(cwd)
  return true
}

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

function runMixDepsGet(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn('mix', ['deps.get'], {
      cwd,
      env: mixDepsGetEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      const suffix = output ? `\n\n${output}` : ''
      reject(new Error(`mix deps.get exited with code ${code}${suffix}`))
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

  fs.writeFileSync(mixExsPath, updated)
  await runMixDepsGet(cwd)
  clearMissingDependency(cwd)
  clearIncompatibleDependency(cwd)
  return true
}

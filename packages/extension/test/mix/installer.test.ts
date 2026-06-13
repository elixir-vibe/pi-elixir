import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ensurePiBeamDependency } from '#src/mix/installer.ts'
import { expectedPiBridgeDependency } from '#src/version.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempRoot: string
const oldEnv = { ...process.env }

function writeFakeMix(binDir: string, body: string) {
  fs.mkdirSync(binDir, { recursive: true })
  const mixPath = path.join(binDir, 'mix')
  fs.writeFileSync(mixPath, `#!/usr/bin/env bash\n${body}\n`)
  fs.chmodSync(mixPath, 0o755)
}

function writeMixExs(dir: string) {
  fs.writeFileSync(
    path.join(dir, 'mix.exs'),
    `defmodule Demo.MixProject do
  use Mix.Project

  def project do
    [app: :demo, version: "0.1.0", deps: deps()]
  end

  defp deps do
    [
      {:jason, "~> 1.4"}
    ]
  end
end
`
  )
}

describe('ensurePiBeamDependency', () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-elixir-installer-'))
    writeMixExs(tempRoot)
    process.env = { ...oldEnv }
    delete process.env.PI_BEAM_PACKAGE_PATH
    delete process.env.PI_BEAM_DEPENDENCY
  })

  afterEach(() => {
    process.env = { ...oldEnv }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('suggests the published Hex dependency by default', async () => {
    let dependency = ''
    const ok = await ensurePiBeamDependency(tempRoot, {
      confirmInstall: async (prompt) => {
        dependency = prompt.dependency
        return false
      }
    })

    expect(ok).toBe(false)
    expect(dependency).toBe(expectedPiBridgeDependency())
  })

  it('allows an explicit local path dependency for development', async () => {
    const bridge = path.join(tempRoot, 'bridge')
    fs.mkdirSync(bridge)
    fs.writeFileSync(path.join(bridge, 'mix.exs'), 'defmodule PiBridge.MixProject do end\n')
    process.env.PI_BEAM_PACKAGE_PATH = bridge
    process.env.PI_BEAM_DEPENDENCY = 'path'

    let dependency = ''
    await ensurePiBeamDependency(tempRoot, {
      confirmInstall: async (prompt) => {
        dependency = prompt.dependency
        return false
      }
    })

    expect(dependency).toBe('{:pi_bridge, path: "./bridge", only: :dev}')
  })

  it('runs mix deps.get without inheriting terminal output', async () => {
    const binDir = path.join(tempRoot, 'bin')
    writeFakeMix(binDir, 'echo noisy stdout; echo noisy stderr >&2; exit 0')
    process.env.PATH = `${binDir}${path.delimiter}${oldEnv.PATH ?? ''}`

    const stdoutSpy = vi.spyOn(process.stdout, 'write')
    const stderrSpy = vi.spyOn(process.stderr, 'write')

    const ok = await ensurePiBeamDependency(tempRoot, {
      confirmInstall: async () => true
    })

    expect(ok).toBe(true)
    expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining('noisy stdout'))
    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('noisy stderr'))
  })

  it('uses a conservative Hex fetch concurrency for automatic dependency install', async () => {
    const binDir = path.join(tempRoot, 'bin')
    const envFile = path.join(tempRoot, 'hex-env')
    writeFakeMix(binDir, `printf '%s' "$HEX_HTTP_CONCURRENCY" > ${envFile}; exit 0`)
    process.env.PATH = `${binDir}${path.delimiter}${oldEnv.PATH ?? ''}`

    const ok = await ensurePiBeamDependency(tempRoot, {
      confirmInstall: async () => true
    })

    expect(ok).toBe(true)
    expect(fs.readFileSync(envFile, 'utf8')).toBe('1')
  })

  it('preserves explicit Hex fetch concurrency', async () => {
    const binDir = path.join(tempRoot, 'bin')
    const envFile = path.join(tempRoot, 'hex-env')
    writeFakeMix(binDir, `printf '%s' "$HEX_HTTP_CONCURRENCY" > ${envFile}; exit 0`)
    process.env.PATH = `${binDir}${path.delimiter}${oldEnv.PATH ?? ''}`
    process.env.HEX_HTTP_CONCURRENCY = '4'

    const ok = await ensurePiBeamDependency(tempRoot, {
      confirmInstall: async () => true
    })

    expect(ok).toBe(true)
    expect(fs.readFileSync(envFile, 'utf8')).toBe('4')
  })

  it('includes captured mix deps.get output when installation fails and rolls back mix.exs', async () => {
    const binDir = path.join(tempRoot, 'bin')
    const originalMixExs = fs.readFileSync(path.join(tempRoot, 'mix.exs'), 'utf8')
    writeFakeMix(binDir, 'echo deps stdout; echo deps stderr >&2; exit 42')
    process.env.PATH = `${binDir}${path.delimiter}${oldEnv.PATH ?? ''}`

    await expect(
      ensurePiBeamDependency(tempRoot, {
        confirmInstall: async () => true
      })
    ).rejects.toThrow('deps stdout\ndeps stderr')
    expect(fs.readFileSync(path.join(tempRoot, 'mix.exs'), 'utf8')).toBe(originalMixExs)
  })

  it('reports Hex network failures with retry guidance', async () => {
    const binDir = path.join(tempRoot, 'bin')
    writeFakeMix(
      binDir,
      `echo '** (RuntimeError) Failed to exchange API key for OAuth token: {:failed_connect, [{:to_address, {~c"hex.pm", 443}}, {:inet, [:inet], :closed}]}' >&2; exit 1`
    )
    process.env.PATH = `${binDir}${path.delimiter}${oldEnv.PATH ?? ''}`

    await expect(
      ensurePiBeamDependency(tempRoot, {
        confirmInstall: async () => true
      })
    ).rejects.toThrow('Check network/VPN/proxy access and retry the install')
  })

  it('emits progress while installing', async () => {
    const binDir = path.join(tempRoot, 'bin')
    const progress: string[] = []
    writeFakeMix(binDir, 'echo fetching deps; exit 0')
    process.env.PATH = `${binDir}${path.delimiter}${oldEnv.PATH ?? ''}`

    const ok = await ensurePiBeamDependency(tempRoot, {
      confirmInstall: async () => true,
      onProgress: (message) => progress.push(message)
    })

    expect(ok).toBe(true)
    expect(progress).toContain(`[pi-elixir] Added ${expectedPiBridgeDependency()} to mix.exs`)
    expect(progress).toContain('$ mix deps.get')
    expect(progress.at(-1)).toContain('fetching deps')
  })
})

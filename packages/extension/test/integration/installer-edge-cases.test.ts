import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ensurePiBeamDependency } from '#src/mix/installer.ts'
import { expectedPiBridgeDependency } from '#src/version.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let tempRoot: string
const oldEnv = { ...process.env }

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

function writeFakeMix(body: string) {
  const binDir = path.join(tempRoot, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  const mixPath = path.join(binDir, 'mix')
  fs.writeFileSync(
    mixPath,
    `#!/usr/bin/env bash
${body}
`
  )
  fs.chmodSync(mixPath, 0o755)
  process.env.PATH = `${binDir}${path.delimiter}${oldEnv.PATH ?? ''}`
}

function mixExs() {
  return fs.readFileSync(path.join(tempRoot, 'mix.exs'), 'utf8')
}

describe('installer edge cases', () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-elixir-installer-integration-'))
    writeMixExs(tempRoot)
    process.env = { ...oldEnv }
    delete process.env.PI_BEAM_PACKAGE_PATH
    delete process.env.PI_BEAM_DEPENDENCY
  })

  afterEach(() => {
    process.env = { ...oldEnv }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('rolls back mix.exs and keeps the Hex failure visible when dependency fetch fails', async () => {
    const original = mixExs()
    writeFakeMix(
      `echo 'Resolving Hex dependencies...' >&2
       echo '** (RuntimeError) Failed to exchange API key for OAuth token: {:failed_connect, [{:to_address, {~c"hex.pm", 443}}, {:inet, [:inet], :closed}]}' >&2
       exit 1`
    )

    await expect(
      ensurePiBeamDependency(tempRoot, {
        confirmInstall: async () => true
      })
    ).rejects.toThrow('Check network/VPN/proxy access and retry the install')

    expect(mixExs()).toBe(original)
    expect(mixExs()).not.toContain(':pi_bridge')
  })

  it('streams progress for successful installs and preserves the dependency edit', async () => {
    const progress: string[] = []
    writeFakeMix(`echo 'Resolving Hex dependencies...'
                  echo '* Getting pi_bridge (Hex package)'
                  exit 0`)

    const installed = await ensurePiBeamDependency(tempRoot, {
      confirmInstall: async () => true,
      onProgress: (message) => progress.push(message)
    })

    expect(installed).toBe(true)
    expect(mixExs()).toContain(expectedPiBridgeDependency())
    expect(progress).toContain(`Adding ${expectedPiBridgeDependency()} to mix.exs...`)
    expect(progress).toContain('Running mix deps.get for pi_bridge...')
    expect(progress.some((message) => message.includes('Resolving Hex dependencies...'))).toBe(true)
    expect(progress.some((message) => message.includes('* Getting pi_bridge (Hex package)'))).toBe(
      true
    )
  })
})

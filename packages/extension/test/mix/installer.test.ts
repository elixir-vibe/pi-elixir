import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ensurePiBeamDependency } from '#src/mix/installer.ts'
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
    expect(dependency).toBe('{:pi_bridge, "== 0.6.3", only: :dev}')
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
})

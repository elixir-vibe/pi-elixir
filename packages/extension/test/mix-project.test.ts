import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { resolveMixProjectCwd } from '../src/mix/project.ts'

let tempRoot: string

function writeMix(relativeDir: string): string {
  const dir = path.join(tempRoot, relativeDir)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'mix.exs'), 'defmodule Demo.MixProject do\nend\n')
  return dir
}

describe('resolveMixProjectCwd', () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-elixir-mix-project-'))
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('uses cwd when it is a Mix project', () => {
    writeMix('.')

    expect(resolveMixProjectCwd(tempRoot)).toBe(tempRoot)
  })

  it('uses packages/bridge for pi-elixir monorepo roots', () => {
    const bridge = writeMix('packages/bridge')
    writeMix('packages/fixtures/demo_project')

    expect(resolveMixProjectCwd(tempRoot)).toBe(bridge)
  })

  it('uses the only nested Mix project when unambiguous', () => {
    const app = writeMix('examples/app')

    expect(resolveMixProjectCwd(tempRoot)).toBe(app)
  })

  it('returns null for ambiguous nested Mix projects', () => {
    writeMix('apps/a')
    writeMix('apps/b')

    expect(resolveMixProjectCwd(tempRoot)).toBeNull()
  })
})

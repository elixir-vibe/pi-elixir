import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}))

import * as childProcess from 'node:child_process'

import { elixirRuntimeProblem } from '#src/mix/runtime.ts'

describe('elixirRuntimeProblem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when elixir and mix are available', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0
    } as childProcess.SpawnSyncReturns<Buffer>)

    expect(elixirRuntimeProblem()).toBeNull()
  })

  it('explains when elixir is missing', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 127
    } as childProcess.SpawnSyncReturns<Buffer>)

    expect(elixirRuntimeProblem()).toContain('Elixir is not installed')
  })

  it('explains when mix is missing from an incomplete Elixir install', () => {
    const spawn = vi.mocked(childProcess.spawnSync)
    spawn.mockReturnValueOnce({ status: 0 } as childProcess.SpawnSyncReturns<Buffer>)
    spawn.mockReturnValueOnce({ status: 127 } as childProcess.SpawnSyncReturns<Buffer>)

    expect(elixirRuntimeProblem()).toContain('Mix is not available')
  })
})

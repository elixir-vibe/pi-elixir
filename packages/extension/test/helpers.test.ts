import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@earendil-works/pi-coding-agent', () => ({
  DEFAULT_MAX_LINES: 2000,
  DEFAULT_MAX_BYTES: 50 * 1024,
  formatSize: (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    return `${(bytes / 1024).toFixed(1)}KB`
  },
  truncateHead: vi.fn()
}))

vi.mock('../src/beam-client.ts', () => ({}))

import { displaySingleLine, normalizePathForBeam, truncated } from '#src/helpers.ts'
import { truncateHead } from '@earendil-works/pi-coding-agent'

const mockTruncateHead = vi.mocked(truncateHead)

describe('displaySingleLine', () => {
  it('normalizes multiline tool arguments for one-line call previews', () => {
    expect(displaySingleLine('foo\n  bar\t baz')).toBe('foo bar baz')
  })
})

describe('normalizePathForBeam', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('rewrites repo-root relative paths under the BEAM cwd to BEAM-relative paths', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-elixir-path-'))
    const beamCwd = path.join(dir, 'packages/bridge')
    const file = path.join(beamCwd, 'lib/pi/eval.ex')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'defmodule Demo do end')

    const result = normalizePathForBeam(
      { path: 'packages/bridge/lib/pi/eval.ex' },
      { cwd: dir } as never,
      beamCwd
    )

    expect(result.path).toBe('lib/pi/eval.ex')
  })

  it('leaves missing paths untouched so BEAM can report the original path', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-elixir-path-'))
    const result = normalizePathForBeam(
      { path: 'packages/bridge/lib/pi/missing.ex' },
      { cwd: dir } as never,
      path.join(dir, 'packages/bridge')
    )

    expect(result.path).toBe('packages/bridge/lib/pi/missing.ex')
  })
})

describe('truncated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns text unchanged when not truncated', () => {
    mockTruncateHead.mockReturnValue({
      content: 'hello world',
      truncated: false,
      truncatedBy: null,
      totalLines: 1,
      totalBytes: 11,
      outputLines: 1,
      outputBytes: 11,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines: 2000,
      maxBytes: 50 * 1024
    })

    expect(truncated('hello world')).toBe('hello world')
  })

  it('appends truncation notice when truncated', () => {
    mockTruncateHead.mockReturnValue({
      content: 'first line',
      truncated: true,
      truncatedBy: 'lines',
      totalLines: 5000,
      totalBytes: 100_000,
      outputLines: 2000,
      outputBytes: 40_000,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines: 2000,
      maxBytes: 50 * 1024
    })

    const result = truncated('some very long text')
    expect(result).toBe('first line\n\n[Truncated: 2000/5000 lines, 39.1KB/97.7KB]')
  })
})

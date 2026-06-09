import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { truncated } from '#src/helpers.ts'
import { truncateHead } from '@earendil-works/pi-coding-agent'

const mockTruncateHead = vi.mocked(truncateHead)

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

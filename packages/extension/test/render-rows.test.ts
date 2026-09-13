import {
  clampRenderedLines,
  renderError,
  renderLines,
  renderSingleLine,
  renderToolCall
} from '#src/shared/render.ts'
import type { Theme } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text
} as Theme

describe('physical tool result rows', () => {
  it('clamps each physical component row and forwards invalidation', () => {
    const invalidate = vi.fn()
    const component = clampRenderedLines({ render: () => ['abc\r\ndef\rghi\njkl'], invalidate })
    expect(component.render(3)).toEqual(['abc', 'def', 'ghi', 'jkl'])
    component.invalidate()
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('normalizes embedded newlines in single-line summaries', () => {
    expect(renderSingleLine('one\r\ntwo\rthree\nfour').render(80)).toEqual(['one two three four'])
  })

  it('wraps call arguments without ellipses or lost content', () => {
    const component = renderToolCall(theme, 'ast', {
      segments: [{ text: 'abcdefghijklmnopqrstuvwxyz' }]
    })
    for (const width of [1, 8, 40]) {
      const rows = component.render(width)
      expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true)
      expect(rows.join('').replaceAll(' ', '')).toBe('astabcdefghijklmnopqrstuvwxyz')
      expect(rows.join('')).not.toContain('…')
    }
  })

  it('wraps complete errors and preserves their leading blank row', () => {
    const rows = renderError('Something failed\r\nTry again', theme).render(8)
    expect(rows[0]).toBe('')
    expect(rows.every((row) => visibleWidth(row) <= 8 && !/[\r\n]/u.test(row))).toBe(true)
    expect(rows.join('').replaceAll(' ', '')).toBe('SomethingfailedTryagain')
  })

  it('splits multiline exception text before measuring or truncating rows', () => {
    const component = renderLines(['BadMapError: expected a map\n  nil\r\nstack\rframe'])
    for (const width of [1, 8, 40, 120]) {
      const rows = component.render(width)
      expect(rows).toHaveLength(5)
      for (const row of rows) {
        expect(row).not.toMatch(/[\r\n]/u)
        expect(visibleWidth(row)).toBeLessThanOrEqual(width)
      }
    }
  })
})

import { renderLines } from '#src/shared/render.ts'
import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'

describe('physical tool result rows', () => {
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

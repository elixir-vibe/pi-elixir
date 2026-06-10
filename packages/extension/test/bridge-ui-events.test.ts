import { updateStatus } from '#src/bridge/ui-events.ts'
import type { ConnectionKind } from '#src/connection/status.ts'
import { describe, expect, it, vi } from 'vitest'

function fakeCtx() {
  return {
    ui: {
      theme: {
        fg: (_name: string, text: string) => text
      },
      setStatus: vi.fn()
    }
  } as any
}

describe('Elixir connection status UI', () => {
  it.each<ConnectionKind>([
    'external',
    'embedded',
    'starting',
    'missing',
    'incompatible',
    'unavailable',
    null
  ])('keeps footer status quiet for %s state', (kind) => {
    const ctx = fakeCtx()

    updateStatus(ctx, kind)

    expect(ctx.ui.setStatus).toHaveBeenCalledWith('elixir', undefined)
  })
})

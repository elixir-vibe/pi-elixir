import type { ConnectionKind } from '#src/connection/resolver.ts'
import type { BridgeUIEvent } from '#src/embedded/stdio-process.ts'
import type { StatusContext } from '#src/sessions/types.ts'

export function updateStatus(ctx: StatusContext, _kind: ConnectionKind) {
  try {
    ctx.ui.setStatus('elixir', undefined)
  } catch {
    // Status updates are best-effort. Session replacement can stale old UI contexts while embedded process callbacks are still finishing.
  }
}

export function applyBridgeUIEvent(ctx: StatusContext, event: BridgeUIEvent) {
  try {
    const key = event.key ?? 'pi-bridge'

    switch (event.op) {
      case 'status':
        ctx.ui.setStatus(key, event.text ?? undefined)
        break
      case 'progress': {
        const title = event.title ?? key
        const value =
          typeof event.current === 'number' && typeof event.total === 'number'
            ? `${title} ${event.current}/${event.total}`
            : title
        ctx.ui.setStatus(key, value)
        break
      }
      case 'widget':
        ctx.ui.setWidget(key, event.lines, { placement: event.placement ?? 'belowEditor' })
        break
      case 'notify':
        ctx.ui.notify(event.message ?? '', event.level)
        break
    }
  } catch {
    // UI bridge events are best-effort; stale contexts can disappear during session replacement.
  }
}

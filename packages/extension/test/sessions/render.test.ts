import { renderSessionWidget } from '#src/sessions/render.ts'
import type { SessionSnapshot } from '#src/sessions/types.ts'
import type { Theme } from '@earendil-works/pi-coding-agent'
import { visibleWidth, type Component } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

const theme = {
  fg: (_name: string, text: string) => text
} as Theme

function textOf(component: Component, width = 120) {
  return component.render(width).join('\n')
}

const sessions: SessionSnapshot[] = [
  { id: 'root', name: 'tree_qa', status: 'idle' },
  {
    id: 'ok',
    parentId: 'root',
    name: 'ok',
    status: 'done',
    prompt: 'happy path',
    response: 'passed',
    latest: 'passed',
    durationMs: 0,
    events: [{ type: 'started' }, { type: 'llm' }, { type: 'done' }]
  },
  {
    id: 'fail',
    parentId: 'root',
    name: 'fail',
    status: 'failed',
    prompt: 'explode',
    error: 'boom',
    latest: 'explode',
    durationMs: 0,
    events: [{ type: 'started' }, { type: 'llm' }, { type: 'failed' }]
  },
  {
    id: 'slow',
    parentId: 'root',
    name: 'slow',
    status: 'cancelled',
    prompt: 'wait forever',
    latest: 'wait forever',
    durationMs: 21,
    events: [{ type: 'started' }, { type: 'llm' }, { type: 'cancelled' }]
  }
]

describe('BEAM session renderer', () => {
  it('renders compact mixed edge-state trees with branch guides', () => {
    expect(textOf(renderSessionWidget(sessions, theme, false))).toBe(`✗ tree_qa
  1 done · 1 failed · 1 cancelled
  ├─ ✓ ok  passed
  ├─ ✗ fail failed  boom
  └─ ○ slow cancelled  wait forever
  (expand for details)`)
  })

  it('renders expanded details without redundant labels', () => {
    expect(textOf(renderSessionWidget(sessions, theme, true))).toBe(`✗ tree_qa
  1 done · 1 failed · 1 cancelled
  ├─ ✓ ok  passed
  │  “happy path”
  │  started → llm → done · 0ms
  ├─ ✗ fail failed  boom
  │  “explode”
  │  started → llm → failed · 0ms
  └─ ○ slow cancelled  wait forever
     “wait forever”
     started → llm → cancelled · 21ms`)
  })

  it('renders parent-visible agent job lifecycle events', () => {
    const eventSessions: SessionSnapshot[] = [
      {
        id: 'parent',
        name: 'parent',
        status: 'idle',
        events: [
          {
            type: 'agent_job_started',
            data: {
              role: 'reviewer',
              task: 'Review child module',
              status: 'running',
              child_session_id: 'child'
            }
          },
          {
            type: 'agent_job_finished',
            data: {
              role: 'reviewer',
              task: 'Review child module',
              status: 'done',
              result: 'looks good',
              child_session_id: 'child'
            }
          }
        ]
      },
      {
        id: 'child',
        parentId: 'parent',
        name: 'reviewer',
        status: 'done',
        response: 'looks good'
      }
    ]

    expect(textOf(renderSessionWidget(eventSessions, theme, false))).toContain(
      '✓ parent  reviewer done: looks good'
    )

    expect(textOf(renderSessionWidget(eventSessions, theme, true))).toContain(
      '    ↳ reviewer started: Review child module\n    ↳ reviewer done: looks good'
    )
  })

  it('renders running live previews from current activity and recent output', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'))
    expect(
      textOf(
        renderSessionWidget(
          [
            { id: 'root', name: 'live', status: 'idle' },
            {
              id: 'child',
              parentId: 'root',
              name: 'research',
              status: 'running',
              prompt: 'scan docs',
              latest: 'scan docs',
              current: 'llm',
              currentStartedAt: '2026-01-01T00:00:03.000Z',
              lastActivityAt: '2026-01-01T00:00:09.000Z',
              recentOutput: ['reading docs'],
              events: [{ type: 'started' }, { type: 'llm' }],
              durationMs: 1200
            }
          ],
          theme,
          true
        )
      )
    ).toBe(`● live
  1 running
  └─ ● research  reading docs  llm 7.0s
     “scan docs”
     … llm 7.0s
     started → llm · 1.2s`)
    vi.useRealTimers()
  })

  it('renders recursive status and token usage on child rows and aggregated root summaries', () => {
    expect(
      textOf(
        renderSessionWidget(
          [
            { id: 'root', name: 'usage', status: 'idle' },
            { id: 'group', parentId: 'root', name: 'group', status: 'idle' },
            {
              id: 'a',
              parentId: 'group',
              name: 'a',
              status: 'done',
              response: 'ok',
              usage: {
                input: 1200,
                output: 340,
                totalTokens: 1540,
                cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 }
              }
            },
            {
              id: 'b',
              parentId: 'group',
              name: 'b',
              status: 'done',
              response: 'ok',
              usage: {
                input: 800,
                output: 60,
                totalTokens: 860,
                cost: { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 }
              }
            }
          ],
          theme,
          false
        )
      )
    ).toBe(`✓ usage
  2 done · ↑2.0k ↓400 $0.005
  └─ ✓ group
     2 done · ↑2.0k ↓400 $0.005
     ├─ ✓ a  ok  ↑1.2k ↓340 $0.003
     └─ ✓ b  ok  ↑800 ↓60 $0.002
  (expand for details)`)
  })

  it('limits compact session trees and reports hidden lines', () => {
    const many: SessionSnapshot[] = [
      { id: 'root', name: 'many', status: 'idle' },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `child-${index}`,
        parentId: 'root',
        name: `child-${index}`,
        status: 'done' as const,
        response: `done ${index}`
      }))
    ]

    const lines = textOf(renderSessionWidget(many, theme, false)).split('\n')

    expect(lines).toHaveLength(12)
    expect(lines.at(-2)).toMatch(/^… \d+ hidden$/)
    expect(lines.at(-1)).toBe('  (expand for details)')
  })

  it('limits expanded session trees and reports hidden lines', () => {
    const many: SessionSnapshot[] = [
      { id: 'root', name: 'many expanded', status: 'idle' },
      ...Array.from({ length: 40 }, (_, index) => ({
        id: `child-${index}`,
        parentId: 'root',
        name: `child-${index}`,
        status: 'done' as const,
        response: `done ${index}`
      }))
    ]

    const lines = textOf(renderSessionWidget(many, theme, true)).split('\n')

    expect(lines).toHaveLength(28)
    expect(lines.at(-1)).toMatch(/^… \d+ hidden$/)
  })

  it('truncates to render width', () => {
    const text = textOf(
      renderSessionWidget(
        [
          { id: 'root', name: 'wide', status: 'idle' },
          {
            id: 'child',
            parentId: 'root',
            name: 'child',
            status: 'done',
            response: 'this response is intentionally too long for the available width'
          }
        ],
        theme,
        false
      ),
      32
    )

    const childLine = text.split('\n').find((line) => line.includes('child'))
    expect(childLine).toContain('…')
    expect(visibleWidth(childLine ?? '')).toBeLessThanOrEqual(32)
  })
})

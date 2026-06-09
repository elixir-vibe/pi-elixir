import type { Theme } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'

import { renderSessionWidget } from '../../src/sessions/render.ts'
import type { SessionSnapshot } from '../../src/sessions/types.ts'

const theme = {
  fg: (_name: string, text: string) => text
} as Theme

function textOf(component: unknown) {
  expect(component).toBeInstanceOf(Text)
  return (component as Text).text
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

  it('renders running live previews from current activity and recent output', () => {
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
  └─ ● research  reading docs
     “scan docs”
     … llm
     started → llm · 1.2s`)
  })
})

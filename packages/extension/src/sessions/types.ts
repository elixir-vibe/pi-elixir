import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'

export interface StatusContext extends ExtensionContext {
  ui: ExtensionContext['ui'] & {
    theme: Theme
    setStatus: (id: string, text: string | undefined) => void
  }
}

export interface SessionEventSnapshot {
  type?: string
  at?: string | null
  data?: unknown
}

export interface SessionUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
}

export interface SessionSnapshot {
  id?: string
  parentId?: string | null
  name?: string | null
  status?: string
  latest?: string | null
  prompt?: string | null
  response?: string | null
  result?: unknown
  error?: string | null
  startedAt?: string | null
  updatedAt?: string | null
  lastActivityAt?: string | null
  completedAt?: string | null
  currentStartedAt?: string | null
  durationMs?: number | null
  current?: string | null
  usage?: SessionUsage | null
  runCount?: number
  turnCount?: number
  messageCount?: number
  recentOutput?: string[]
  events?: SessionEventSnapshot[]
}

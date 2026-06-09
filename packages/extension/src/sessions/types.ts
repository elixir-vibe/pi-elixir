import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'

export interface StatusContext extends ExtensionContext {
  ui: ExtensionContext['ui'] & {
    theme: Theme
    setStatus: (id: string, text: string | undefined) => void
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
  durationMs?: number | null
  messageCount?: number
  events?: Array<{ type?: string; at?: string | null }>
}

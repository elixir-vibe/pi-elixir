import type { TruncationResult } from './truncate'

export interface ToolStatusDetails {
  error?: boolean
  loading?: boolean
}

export interface TruncatedOutputDetails {
  truncated?: boolean
  truncation?: TruncationResult
}

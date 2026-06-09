export type ConnectionKind =
  | 'external'
  | 'embedded'
  | 'starting'
  | 'missing'
  | 'incompatible'
  | null

export interface CachedConnection {
  url: string
  kind: ConnectionKind
  timestamp: number
}

type StatusListener = (cwd: string, kind: ConnectionKind) => void

const statusListeners = new Set<StatusListener>()
const missingDependency = new Set<string>()
const incompatibleDependency = new Map<string, string>()
export const connectionCache = new Map<string, CachedConnection>()

export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

export function emitStatusChange(cwd: string, kind: ConnectionKind): void {
  for (const listener of statusListeners) {
    try {
      listener(cwd, kind)
    } catch {
      // Status updates are best-effort; stale UI subscribers should not break process events.
    }
  }
}

export function markMissingDependency(cwd: string): void {
  missingDependency.add(cwd)
}

export function clearMissingDependency(cwd: string): void {
  missingDependency.delete(cwd)
}

export function hasMissingDependency(cwd: string): boolean {
  return missingDependency.has(cwd)
}

export function markIncompatibleDependency(cwd: string, message: string): void {
  incompatibleDependency.set(cwd, message)
}

export function clearIncompatibleDependency(cwd: string): void {
  incompatibleDependency.delete(cwd)
}

export function getIncompatibleDependency(cwd: string): string | undefined {
  return incompatibleDependency.get(cwd)
}

export function invalidateCache(cwd: string): void {
  connectionCache.delete(cwd)
}

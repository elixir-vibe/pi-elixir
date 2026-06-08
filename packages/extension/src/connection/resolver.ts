import {
  callEmbeddedTool,
  clearEmbeddedFailed,
  cwdFromEmbeddedUrl,
  getEmbeddedKind,
  getEmbeddedUrl,
  hasEmbeddedFailed,
  isEmbeddedReady,
  sendEmbeddedEvent,
  startEmbeddedInBackground
} from '../embedded/stdio-process.ts'
import {
  ensurePiBeamDependency,
  type InstallOptions,
  type InstallPrompt
} from '../mix/installer.ts'
import type { BridgeEvent, ToolArgs, ToolResult } from '../protocol/types.ts'
import { callHttpTool, discoverExternalMCP } from '../transport/http-json-rpc.ts'
import { connectionCache, hasMissingDependency, type ConnectionKind } from './status.ts'

export type { ConnectionKind, InstallPrompt }

export interface ResolveUrlOptions extends InstallOptions {}

export interface ConnectionResolution {
  url: string
  kind: ConnectionKind
}

const CACHE_TTL = 30_000

export async function callTool(
  url: string,
  name: string,
  args: ToolArgs,
  signal?: AbortSignal
): Promise<ToolResult> {
  if (url.startsWith('stdio:')) {
    return callEmbeddedTool(cwdFromEmbeddedUrl(url), name, args, signal)
  }

  return callHttpTool(url, name, args, signal)
}

export function sendBridgeEvent(cwd: string, event: BridgeEvent): Promise<void> {
  return sendEmbeddedEvent(cwd, event)
}

export async function resolveUrl(
  cwd: string,
  options?: ResolveUrlOptions
): Promise<ConnectionResolution | null> {
  if (process.env.PI_MCP_URL) {
    return { url: process.env.PI_MCP_URL, kind: 'external' }
  }

  const cached = connectionCache.get(cwd)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { url: cached.url, kind: cached.kind }
  }

  const externalUrl = await discoverExternalMCP(cwd)
  if (externalUrl) {
    connectionCache.set(cwd, { url: externalUrl, kind: 'external', timestamp: Date.now() })
    return { url: externalUrl, kind: 'external' }
  }

  if (process.env.PI_DISABLE_EMBEDDED === '1') return null
  if (hasEmbeddedFailed(cwd)) return null

  if (!(await ensurePiBeamDependency(cwd, options))) return null
  clearEmbeddedFailed(cwd)

  if (isEmbeddedReady(cwd)) {
    const url = getEmbeddedUrl(cwd)
    connectionCache.set(cwd, { url, kind: 'embedded', timestamp: Date.now() })
    return { url, kind: 'embedded' }
  }

  startEmbeddedInBackground(cwd)
  return null
}

export function getConnectionKind(cwd: string): ConnectionKind {
  const cached = connectionCache.get(cwd)
  if (cached) return cached.kind
  if (hasMissingDependency(cwd)) return 'missing'
  return getEmbeddedKind(cwd)
}

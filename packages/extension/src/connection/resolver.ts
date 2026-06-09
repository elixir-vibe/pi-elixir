import { recordDiagnostic, withDiagnosticSpan } from '#src/diagnostics.ts'
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
} from '#src/embedded/stdio-process.ts'
import {
  ensurePiBeamDependency,
  type InstallOptions,
  type InstallPrompt
} from '#src/mix/installer.ts'
import type { BridgeEvent, ToolArgs, ToolResult } from '#src/protocol/types.ts'
import { callHttpTool, discoverExternalMCP } from '#src/transport/http-json-rpc.ts'

import {
  connectionCache,
  getIncompatibleDependency,
  hasMissingDependency,
  type ConnectionKind
} from './status.ts'

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
  const kind = url.startsWith('stdio:') ? 'embedded' : 'http'
  return withDiagnosticSpan(
    'bridge_tool_call',
    kind === 'embedded' ? cwdFromEmbeddedUrl(url) : undefined,
    { name, kind },
    async () => {
      if (url.startsWith('stdio:')) {
        return callEmbeddedTool(cwdFromEmbeddedUrl(url), name, args, signal)
      }

      return callHttpTool(url, name, args, signal)
    }
  )
}

export function sendBridgeEvent(cwd: string, event: BridgeEvent): Promise<void> {
  return sendEmbeddedEvent(cwd, event)
}

export async function resolveUrl(
  cwd: string,
  options?: ResolveUrlOptions
): Promise<ConnectionResolution | null> {
  return withDiagnosticSpan('resolve_url', cwd, undefined, async () => {
    if (process.env.PI_MCP_URL) {
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'env_url' })
      return { url: process.env.PI_MCP_URL, kind: 'external' }
    }

    const cached = connectionCache.get(cwd)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'cache_hit', kind: cached.kind })
      return { url: cached.url, kind: cached.kind }
    }

    const externalUrl = await withDiagnosticSpan(
      'discover_external_mcp',
      cwd,
      undefined,
      async () => discoverExternalMCP(cwd)
    )
    if (externalUrl) {
      connectionCache.set(cwd, { url: externalUrl, kind: 'external', timestamp: Date.now() })
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'external_found' })
      return { url: externalUrl, kind: 'external' }
    }

    if (process.env.PI_DISABLE_EMBEDDED === '1') {
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'embedded_disabled' })
      return null
    }

    const incompatible = getIncompatibleDependency(cwd)
    if (incompatible) {
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'incompatible_dependency' })
      return null
    }

    const failedBeforeInstall = hasEmbeddedFailed(cwd)
    const missingBeforeInstall = hasMissingDependency(cwd)
    const dependencyReady = await withDiagnosticSpan(
      'ensure_pi_beam_dependency',
      cwd,
      undefined,
      async () => ensurePiBeamDependency(cwd, options)
    )
    if (!dependencyReady) {
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'dependency_unavailable' })
      return null
    }
    if (failedBeforeInstall && !missingBeforeInstall) {
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'embedded_failed_before_install' })
      return null
    }
    clearEmbeddedFailed(cwd)

    if (isEmbeddedReady(cwd)) {
      const url = getEmbeddedUrl(cwd)
      connectionCache.set(cwd, { url, kind: 'embedded', timestamp: Date.now() })
      recordDiagnostic('resolve_url_phase', cwd, { phase: 'embedded_ready' })
      return { url, kind: 'embedded' }
    }

    startEmbeddedInBackground(cwd)
    recordDiagnostic('resolve_url_phase', cwd, { phase: 'embedded_starting' })
    return null
  })
}

export function getConnectionKind(cwd: string): ConnectionKind {
  const cached = connectionCache.get(cwd)
  if (cached) return cached.kind
  if (getIncompatibleDependency(cwd)) return 'incompatible'
  if (hasMissingDependency(cwd)) return 'missing'
  return getEmbeddedKind(cwd)
}

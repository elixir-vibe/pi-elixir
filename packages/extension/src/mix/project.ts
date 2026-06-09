import * as fs from 'node:fs'
import * as path from 'node:path'

import { recordDiagnostic } from '../diagnostics.ts'

const PREFERRED_NESTED_MIX_PATHS = ['packages/bridge/mix.exs']
const RESOLVE_CACHE_TTL_MS = 2_000
const resolvedMixProjectCache = new Map<string, { value: string | null; timestamp: number }>()

export function readMixExs(cwd: string): string | null {
  try {
    return fs.readFileSync(path.join(cwd, 'mix.exs'), 'utf-8')
  } catch {
    return null
  }
}

export function readAppName(cwd: string): string | null {
  const mixExs = readMixExs(cwd)
  if (!mixExs) return null
  const match = mixExs.match(/app:\s*:(\w+)/)
  return match ? match[1] : null
}

export function resolveMixProjectCwd(cwd: string): string | null {
  const cached = resolvedMixProjectCache.get(cwd)
  if (cached && Date.now() - cached.timestamp < RESOLVE_CACHE_TTL_MS) {
    if (!cached.value || fs.existsSync(path.join(cached.value, 'mix.exs'))) return cached.value
  }

  const resolved = resolveMixProjectCwdUncached(cwd)
  resolvedMixProjectCache.set(cwd, { value: resolved, timestamp: Date.now() })
  return resolved
}

function resolveMixProjectCwdUncached(cwd: string): string | null {
  const startedAt = Date.now()
  if (fs.existsSync(path.join(cwd, 'mix.exs'))) {
    recordDiagnostic('mix_project_resolve', cwd, {
      result: cwd,
      reason: 'cwd_mix_exs',
      durationMs: Date.now() - startedAt
    })
    return cwd
  }

  for (const relative of PREFERRED_NESTED_MIX_PATHS) {
    const candidate = path.join(cwd, relative)
    if (fs.existsSync(candidate)) {
      const result = path.dirname(candidate)
      recordDiagnostic('mix_project_resolve', cwd, {
        result,
        reason: relative,
        durationMs: Date.now() - startedAt
      })
      return result
    }
  }

  recordDiagnostic('mix_project_resolve', cwd, {
    result: null,
    reason: 'no_direct_mix_project_recursive_scan_disabled',
    durationMs: Date.now() - startedAt
  })
  return null
}

export function hasPiDependency(mixExs: string): boolean {
  return /\{\s*:pi(_bridge)?\s*,/.test(mixExs)
}

export function addPiDependency(mixExs: string, dependency: string): string | null {
  const match = mixExs.match(/defp deps do\s*\n(?<indent>\s*)\[/)
  if (!match?.groups) return null
  const indent = `${match.groups.indent}  `
  const insertAt = match.index! + match[0].length
  return `${mixExs.slice(0, insertAt)}\n${indent}${dependency},${mixExs.slice(insertAt)}`
}

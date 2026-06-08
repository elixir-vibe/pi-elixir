import * as fs from 'node:fs'
import * as path from 'node:path'

const IGNORED_MIX_DIRS = new Set(['.git', '_build', 'deps', 'node_modules'])
const PREFERRED_NESTED_MIX_PATHS = ['packages/bridge/mix.exs']

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
  if (fs.existsSync(path.join(cwd, 'mix.exs'))) return cwd

  for (const relative of PREFERRED_NESTED_MIX_PATHS) {
    const candidate = path.join(cwd, relative)
    if (fs.existsSync(candidate)) return path.dirname(candidate)
  }

  const candidates = findNestedMixProjects(cwd, 3)
  return candidates.length === 1 ? candidates[0] : null
}

function findNestedMixProjects(cwd: string, maxDepth: number): string[] {
  const found: string[] = []

  function visit(dir: string, depth: number): void {
    if (depth > maxDepth) return

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'mix.exs')) {
      found.push(dir)
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_MIX_DIRS.has(entry.name)) continue
      visit(path.join(dir, entry.name), depth + 1)
    }
  }

  visit(cwd, 1)
  return found
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

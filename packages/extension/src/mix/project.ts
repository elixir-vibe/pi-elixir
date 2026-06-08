import * as fs from 'node:fs'
import * as path from 'node:path'

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

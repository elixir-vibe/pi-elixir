import { basename } from 'node:path'

export function formatProjectName(cwd: string, maxLength = 32): string {
  const name = basename(cwd) || cwd
  if (name.length <= maxLength) return name
  return `${name.slice(0, Math.max(0, maxLength - 1))}…`
}

export function formatPiNotificationTitle(cwd: string): string {
  return `π · ${formatProjectName(cwd)}`
}

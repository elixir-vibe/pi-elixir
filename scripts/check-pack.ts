#!/usr/bin/env node
import { packlist } from '@pnpm/fs.packlist'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>

const files = new Set(await packlist(root, { manifest: packageJson }))

const requiredFiles = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'packages/extension/src/index.ts',
  'packages/extension/scripts/embedded_server.exs',
  'packages/extension/skills/elixir/dev/SKILL.md',
  'packages/extension/skills/elixir/new-project/SKILL.md',
  'packages/bridge/mix.exs',
  'packages/bridge/README.md',
  'packages/bridge/docs/protocol.md',
  'packages/bridge/lib/pi/session.ex',
  'packages/bridge/lib/pi/session/worker.ex',
  'packages/bridge/lib/pi/transport/stdio.ex'
] as const

const forbiddenPatterns = [
  /^packages\/extension\/test\//,
  /^packages\/bridge\/test\//,
  /^packages\/bridge\/deps\//,
  /^packages\/bridge\/_build\//,
  /^node_modules\//,
  /^\.git\//,
  /^\.worktrees\//,
  /^pnpm-lock\.yaml$/,
  /^bun\.lock$/
] as const

const requiredMetadata = [
  ['name', 'pi-elixir'],
  ['version', '0.4.0'],
  ['pi.extensions.0', './packages/extension/src/index.ts'],
  ['pi.skills.0', './packages/extension/skills']
] as const

function getPath(object: unknown, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((value, key) => {
    if (typeof value !== 'object' || value === null) return undefined
    return (value as Record<string, unknown>)[key]
  }, object)
}

const missing = requiredFiles.filter((file) => !files.has(file))
const forbidden = [...files].filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)))
const metadataErrors = requiredMetadata.flatMap(([keyPath, expected]) => {
  const actual = getPath(packageJson, keyPath)
  return actual === expected ? [] : [`${keyPath}: expected ${expected}, got ${String(actual)}`]
})

const bridgeCount = [...files].filter((file) => file.startsWith('packages/bridge/lib/')).length
const extensionCount = [...files].filter((file) => file.startsWith('packages/extension/src/')).length

if (missing.length || forbidden.length || metadataErrors.length) {
  if (missing.length) console.error('Missing required pack files:\n' + missing.join('\n'))
  if (forbidden.length) console.error('Forbidden files in pack:\n' + forbidden.join('\n'))
  if (metadataErrors.length) console.error('Invalid package metadata:\n' + metadataErrors.join('\n'))
  process.exit(1)
}

console.log(
  `Packlist ok: ${files.size} files, ${bridgeCount} bridge lib files, ${extensionCount} extension src files`
)

#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const roots = ['src', 'test']
const errors = []

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (/\.(?:mjs|ts)$/.test(entry.name)) yield path
  }
}

for (const root of roots) {
  for await (const file of walk(root)) {
    const text = await readFile(file, 'utf8')
    const lines = text.split('\n')

    lines.forEach((line, index) => {
      if (/^\s*;\s*\(/.test(line)) {
        errors.push(`${file}:${index + 1}: avoid leading semicolon call guards; extract a variable/helper instead`)
      }
    })

    if (file.startsWith('src/') && file !== 'src/version.ts') {
      const deepRelativeImports = text.matchAll(/from ['"](?:\.\.\/){2,}/g)
      for (const match of deepRelativeImports) {
        errors.push(`${file}: avoid deep parent-relative imports; use #src/* package imports`)
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('TS hygiene guard ok')

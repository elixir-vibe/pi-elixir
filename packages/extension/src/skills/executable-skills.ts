import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { callTool, resolveUrl } from '../connection/resolver.ts'
import type { BridgeSkillInfo } from '../protocol/types.ts'

function isBeamSkill(value: unknown): value is Required<BridgeSkillInfo> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'path' in value &&
    typeof value.path === 'string' &&
    'module' in value &&
    typeof value.module === 'string' &&
    'metadata' in value &&
    typeof value.metadata === 'object' &&
    value.metadata !== null &&
    'markdown' in value &&
    typeof value.markdown === 'string' &&
    'apis' in value &&
    Array.isArray(value.apis)
  )
}

function parseSkills(text: string): Required<BridgeSkillInfo>[] {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter(isBeamSkill) : []
  } catch {
    return []
  }
}

function cacheDir(cwd: string): string {
  const hash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16)
  return path.join(os.tmpdir(), 'pi-elixir-executable-skills', hash)
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+/, '') || 'skill'
}

function yamlString(value: unknown): string {
  return JSON.stringify(typeof value === 'string' ? value : '')
}

function skillMarkdown(skill: Required<BridgeSkillInfo>): string {
  const description = skill.metadata.description ?? ''
  const apiBlock =
    skill.apis.length === 0
      ? ''
      : `\n\n## Executable APIs\n\n${skill.apis
          .map((api) => `- \`${api.name ?? ''}\` via \`${api.module ?? skill.module}\``)
          .join('\n')}\n`

  return `---\nname: ${yamlString(skill.name)}\ndescription: ${yamlString(description)}\n---\n\nExecutable Elixir skill loaded from \`${skill.path}\`.\n\n${skill.markdown}${apiBlock}\n`
}

function materialize(cwd: string, skills: Required<BridgeSkillInfo>[]): string | null {
  if (skills.length === 0) return null

  const root = cacheDir(cwd)
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })

  for (const skill of skills) {
    const dir = path.join(root, safeName(skill.name))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMarkdown(skill))
  }

  return root
}

export async function discoverExecutableSkillPath(cwd: string): Promise<string | null> {
  const conn = await resolveUrl(cwd)
  if (!conn) return null

  const result = await callTool(conn.url, 'pi_skills_list', {}, undefined)
  if (result.isError) return null

  return materialize(cwd, parseSkills(result.text))
}

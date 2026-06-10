import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import path from 'node:path'

import {
  callEmbeddedTool,
  getBridgeInfo,
  isEmbeddedReady,
  startEmbeddedInBackground,
  stopEmbedded
} from '#src/embedded/stdio-process.ts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PROJECT_DIR =
  process.env.PI_ELIXIR_INTEGRATION_PROJECT ??
  path.resolve(__dirname, '../../../fixtures/demo_project')
const STARTUP_TIMEOUT = 20_000

function ensureDeps(): void {
  execSync('mix deps.get', { cwd: PROJECT_DIR, stdio: 'pipe' })
}

function hasElixir(): boolean {
  try {
    execSync('elixir --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function structuredPayload(result: { text: string }) {
  return JSON.parse(result.text) as {
    kind?: string
    text?: string
    parts?: Array<{ kind?: string; body?: string; title?: string }>
  }
}

function waitForReady(cwd: string, timeout = STARTUP_TIMEOUT): Promise<void> {
  const deadline = Date.now() + timeout

  return new Promise((resolve, reject) => {
    const poll = () => {
      if (isEmbeddedReady(cwd)) {
        resolve()
        return
      }

      if (Date.now() >= deadline) {
        const info = getBridgeInfo(cwd)
        reject(
          new Error(
            `Timed out waiting for embedded stdio process; bridge info: ${JSON.stringify(info ?? null)}`
          )
        )
        return
      }

      setTimeout(poll, 100)
    }

    poll()
  })
}

const elixirAvailable = hasElixir()
const projectAvailable = fs.existsSync(PROJECT_DIR)

describe.skipIf(!elixirAvailable || !projectAvailable)(
  'extension-owned embedded stdio smoke',
  () => {
    const originalComplete = process.env.PI_TEST_LLM_COMPLETE_RESPONSE
    const originalStream = process.env.PI_TEST_LLM_STREAM_RESPONSE

    beforeAll(async () => {
      ensureDeps()
      process.env.PI_TEST_LLM_COMPLETE_RESPONSE = 'extension fake completion'
      process.env.PI_TEST_LLM_STREAM_RESPONSE = 'stream |from |extension'
      startEmbeddedInBackground(PROJECT_DIR)
      await waitForReady(PROJECT_DIR)
    }, STARTUP_TIMEOUT)

    afterAll(() => {
      if (originalComplete === undefined) delete process.env.PI_TEST_LLM_COMPLETE_RESPONSE
      else process.env.PI_TEST_LLM_COMPLETE_RESPONSE = originalComplete

      if (originalStream === undefined) delete process.env.PI_TEST_LLM_STREAM_RESPONSE
      else process.env.PI_TEST_LLM_STREAM_RESPONSE = originalStream

      stopEmbedded(PROJECT_DIR)
    })

    it('captures structured bridge info from ready event', () => {
      const info = getBridgeInfo(PROJECT_DIR)

      expect(info?.project).toBe('pi_demo_project')
      expect(info?.transport).toBe('stdio')
      expect(info?.apis?.runtime?.some((api) => api.name === 'llm')).toBe(true)
      expect(info?.skills?.some((skill) => skill.name === 'demo-skill')).toBe(true)
      expect(info?.plugins?.some((plugin) => plugin.name === 'DemoPlugin')).toBe(true)
    })

    it('routes Pi.LLM.complete through the extension request handler', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval', {
        code: 'Pi.LLM.complete("hello from extension smoke")'
      })

      expect(result.isError).toBe(false)
      expect(result.text).toContain('extension fake completion')
    })

    it('exposes humane Dev helpers through eval aliases', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval_structured', {
        code: 'Dev.status()'
      })

      expect(result.isError).toBe(false)
      const payload = structuredPayload(result)
      expect(payload.text).toContain('app: :pi_demo_project')
      expect(payload.text).toContain('restart_hint')
      expect(payload.parts?.[0]?.kind).toBe('tree')
      expect(payload.parts?.[0]?.title).toContain('map with')
    })

    it('compiles the fixture project through Dev.compile', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval_structured', {
        code: 'Dev.compile()'
      })

      expect(result.isError).toBe(false)
      const payload = structuredPayload(result)
      expect(payload.text).toContain('{:ok,')
      expect(payload.text).toContain('count:')
    })

    it('renders typed file pipelines as structured table output', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval_structured', {
        code: 'Path.wildcard("lib/**/*.ex") |> Enum.map(&%{path: &1, bytes: File.stat!(&1).size})'
      })

      expect(result.isError).toBe(false)
      const payload = structuredPayload(result)
      const table = payload.parts?.find((part) => part.kind === 'table')
      expect(table?.title).toMatch(/\d+ rows × 2 columns/u)
      expect(table?.body).toContain('path')
      expect(table?.body).toContain('bytes')
    })

    it('routes Pi.LLM.stream through extension chunk/done messages', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval', {
        code: 'Pi.LLM.stream("stream").stream |> Enum.join()'
      })

      expect(result.isError).toBe(false)
      expect(result.text).toContain('stream from extension')
    })
  }
)

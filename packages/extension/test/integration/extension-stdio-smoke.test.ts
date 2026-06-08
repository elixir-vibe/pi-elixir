import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  callEmbeddedTool,
  getBridgeInfo,
  isEmbeddedReady,
  startEmbeddedInBackground,
  stopEmbedded
} from '../../src/embedded/stdio-process.ts'

const PROJECT_DIR =
  process.env.PI_ELIXIR_INTEGRATION_PROJECT ??
  path.resolve(__dirname, '../../../fixtures/demo_project')
const STARTUP_TIMEOUT = 120_000

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

function waitForReady(cwd: string, timeout = STARTUP_TIMEOUT): Promise<void> {
  const deadline = Date.now() + timeout

  return new Promise((resolve, reject) => {
    const poll = () => {
      if (isEmbeddedReady(cwd)) {
        resolve()
        return
      }

      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for embedded stdio process'))
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

    it('routes Pi.LLM.stream through extension chunk/done messages', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval', {
        code: 'Pi.LLM.stream("stream").stream |> Enum.join()'
      })

      expect(result.isError).toBe(false)
      expect(result.text).toContain('stream from extension')
    })
  }
)

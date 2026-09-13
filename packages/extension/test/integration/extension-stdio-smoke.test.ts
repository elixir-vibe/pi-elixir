import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { getUnavailableReason } from '#src/connection/status.ts'
import {
  callEmbeddedTool,
  embeddedStartupTranscript,
  getBridgeInfo,
  hasEmbeddedFailed,
  isEmbeddedReady,
  startEmbeddedInBackground,
  stopEmbedded
} from '#src/embedded/stdio-process.ts'
import {
  BRIDGE_PROTOCOL_VERSION,
  EXPECTED_BRIDGE_BUILD,
  REQUIRED_BRIDGE_CAPABILITIES
} from '#src/version.ts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PROJECT_DIR =
  process.env.PI_ELIXIR_INTEGRATION_PROJECT ??
  path.resolve(__dirname, '../../../fixtures/demo_project')
const STARTUP_TIMEOUT = 20_000
const DEPS_TIMEOUT = 10_000
const COMPILE_TIMEOUT = 60_000
const HOOK_TIMEOUT = DEPS_TIMEOUT + COMPILE_TIMEOUT + STARTUP_TIMEOUT + 5_000

function ensureCompiledProject(): void {
  execSync('mix deps.get', {
    cwd: PROJECT_DIR,
    stdio: 'pipe',
    timeout: DEPS_TIMEOUT
  })
  execSync('mix compile', {
    cwd: PROJECT_DIR,
    stdio: 'pipe',
    timeout: COMPILE_TIMEOUT
  })
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
    parts?: Array<{ kind?: string; body?: string; title?: string; data?: Record<string, unknown> }>
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
            `Timed out waiting for embedded stdio process; bridge info: ${JSON.stringify(info ?? null)}; failed: ${hasEmbeddedFailed(cwd)}; unavailable: ${getUnavailableReason(cwd) ?? 'none'}; startup: ${embeddedStartupTranscript(cwd) ?? 'none'}`
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
    const originalBridgeMixEnv = process.env.PI_ELIXIR_BRIDGE_MIX_ENV
    const originalMirror = process.env.PI_ELIXIR_MIRROR

    beforeAll(async () => {
      ensureCompiledProject()
      process.env.PI_TEST_LLM_COMPLETE_RESPONSE = 'extension fake completion'
      process.env.PI_TEST_LLM_STREAM_RESPONSE = 'stream |from |extension'
      process.env.PI_ELIXIR_BRIDGE_MIX_ENV = 'test'
      process.env.PI_ELIXIR_MIRROR = '0'
      startEmbeddedInBackground(PROJECT_DIR)
      await waitForReady(PROJECT_DIR, STARTUP_TIMEOUT)
    }, HOOK_TIMEOUT)

    afterAll(() => {
      if (originalComplete === undefined) delete process.env.PI_TEST_LLM_COMPLETE_RESPONSE
      else process.env.PI_TEST_LLM_COMPLETE_RESPONSE = originalComplete

      if (originalStream === undefined) delete process.env.PI_TEST_LLM_STREAM_RESPONSE
      else process.env.PI_TEST_LLM_STREAM_RESPONSE = originalStream

      if (originalBridgeMixEnv === undefined) delete process.env.PI_ELIXIR_BRIDGE_MIX_ENV
      else process.env.PI_ELIXIR_BRIDGE_MIX_ENV = originalBridgeMixEnv

      if (originalMirror === undefined) delete process.env.PI_ELIXIR_MIRROR
      else process.env.PI_ELIXIR_MIRROR = originalMirror

      stopEmbedded(PROJECT_DIR)
    })

    it('captures structured bridge info from ready event', () => {
      const info = getBridgeInfo(PROJECT_DIR)

      expect(info?.project).toBe('pi_demo_project')
      expect(info?.transport).toBe('stdio')
      expect(info?.protocol).toBe(BRIDGE_PROTOCOL_VERSION)
      expect(info?.build).toBe(EXPECTED_BRIDGE_BUILD)
      expect(info?.capabilities).toEqual(expect.arrayContaining([...REQUIRED_BRIDGE_CAPABILITIES]))
      expect(info?.apis?.runtime?.some((api) => api.name === 'llm')).toBe(true)
      expect(info?.skills?.map((skill) => skill.name)).toContain('demo-skill')
      expect(info?.plugins?.map((plugin) => plugin.name)).toContain('DemoPlugin')
    })

    it('starts an umbrella bridge and serves AST requests without an application name', async () => {
      const cwd = fs.mkdtempSync(path.join(tmpdir(), 'pi-elixir-umbrella-'))

      try {
        fs.mkdirSync(path.join(cwd, 'apps'))
        fs.writeFileSync(
          path.join(cwd, 'mix.exs'),
          'defmodule Umbrella.MixProject do\n  use Mix.Project\n  def project, do: [apps_path: "apps"]\nend\n'
        )
        fs.copyFileSync(path.join(cwd, 'mix.exs'), path.join(cwd, 'fixture.ex'))
        startEmbeddedInBackground(cwd)
        await waitForReady(cwd)

        expect(getBridgeInfo(cwd)?.project).toBeNull()
        const result = await callEmbeddedTool(cwd, 'ex_ast_search', {
          pattern: 'defmodule _ do _ end',
          path: 'fixture.ex'
        })

        expect(result.isError).toBe(false)
        expect(structuredPayload(result).kind).toBe('ast_search')
        expect(result.text).toContain('Umbrella.MixProject')
      } finally {
        stopEmbedded(cwd)
        fs.rmSync(cwd, { recursive: true, force: true })
      }
    })

    it('routes Pi.LLM.complete through the extension request handler', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval', {
        target: 'bridge',
        code: 'Pi.LLM.complete("hello from extension smoke")'
      })

      expect(result.isError).toBe(false)
      expect(result.text).toContain('extension fake completion')
    })

    it('evaluates ordinary code in the isolated project VM', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval_structured', {
        code: '{Mix.Project.config()[:app], Code.ensure_loaded?(Pi)}'
      })

      expect(result.isError).toBe(false)
      const payload = structuredPayload(result)
      expect(payload.text).toContain(':pi_demo_project')
    })

    it('keeps pi-elixir helpers available through explicit bridge target', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval_structured', {
        target: 'bridge',
        code: 'Code.ensure_loaded?(Pi.CodeMap)'
      })

      expect(result.isError).toBe(false)
      const payload = structuredPayload(result)
      expect(payload.text).toContain('true')
    })

    it('renders bridge typed file pipelines as structured table output', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval_structured', {
        target: 'bridge',
        code: 'Path.wildcard("lib/**/*.ex") |> Enum.map(&%{path: &1, bytes: File.stat!(&1).size})'
      })

      expect(result.isError).toBe(false)
      const payload = structuredPayload(result)
      const table = payload.parts?.find((part) => part.kind === 'table')
      expect(table?.title).toMatch(/\d+ rows × 2 columns/u)
      expect(table?.body).toContain('path')
      expect(table?.body).toContain('bytes')
    })

    it('renders web results as structured document output', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval_structured', {
        target: 'bridge',
        code: `%Pi.Web.Result{
          url: "https://example.test",
          final_url: "https://example.test/final",
          status: 200,
          content_type: "text/markdown",
          format: :markdown,
          title: "Example",
          text: "# Example\\n\\nBody",
          size_bytes: 16,
          total_chars: 16,
          redirected?: true
        }`
      })

      expect(result.isError).toBe(false)
      const payload = structuredPayload(result)
      const document = payload.parts?.find((part) => part.kind === 'document')
      expect(document?.title).toBe('Web fetch · 200 · Example')
      expect(document?.body).toContain('# Example')
      expect(document?.data?.document_kind).toBe('web_fetch')
      expect(document?.data?.format).toBe('markdown')
      expect(document?.data?.redirected).toBe(true)
    })

    it('routes Pi.LLM.stream through extension chunk/done messages', async () => {
      const result = await callEmbeddedTool(PROJECT_DIR, 'project_eval', {
        target: 'bridge',
        code: 'Pi.LLM.stream("stream").stream |> Enum.join()'
      })

      expect(result.isError).toBe(false)
      expect(result.text).toContain('stream from extension')
    })
  }
)

import type { BridgeRequestResponder } from '#src/embedded/stdio-process.ts'
import { flags } from '#src/flags.ts'
import type { StdioMessage } from '#src/protocol/types.ts'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { scheduleDevRequest } from './dev-reload.ts'
import { handleLLMComplete, handleLLMStream } from './llm.ts'

function handleDevReloadRequest(
  message: StdioMessage,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  beamCwd: string
): Record<string, unknown> | undefined {
  const action = message.payload?.action
  if (action === 'beam_restart') {
    scheduleDevRequest('restart', pi, ctx, beamCwd)
    return { ok: true, result: { scheduled: true, action } }
  }
  if (action === 'pi_reload') {
    scheduleDevRequest('pi', pi, ctx, beamCwd)
    return { ok: true, result: { scheduled: true, action } }
  }
  if (action === 'dev_reload') {
    scheduleDevRequest('refresh', pi, ctx, beamCwd)
    return { ok: true, result: { scheduled: true, action } }
  }
  return { ok: false, error: 'dev_reload requires action beam_restart, pi_reload, or dev_reload' }
}

export async function handleBridgeRequest(
  message: StdioMessage,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  beamCwd: string,
  responder?: BridgeRequestResponder
): Promise<Record<string, unknown> | null | undefined> {
  if (message.op === 'llm_complete') {
    if (!flags.llm()) return { ok: false, error: 'BEAM-initiated LLM is disabled.' }
    return await handleLLMComplete(message, ctx, pi)
  }
  if (message.op === 'llm_stream') {
    if (!flags.llm()) return { ok: false, error: 'BEAM-initiated LLM is disabled.' }
    return await handleLLMStream(message, ctx, pi, responder)
  }

  if (message.op === 'session_info') {
    return {
      ok: true,
      result: {
        cwd: ctx.cwd,
        mode: ctx.mode,
        hasUI: ctx.hasUI,
        sessionFile: ctx.sessionManager?.getSessionFile?.(),
        sessionName: pi.getSessionName(),
        leafId: ctx.sessionManager?.getLeafId?.(),
        isIdle: ctx.isIdle()
      }
    }
  }

  if (message.op === 'active_tools') {
    return { ok: true, result: { tools: pi.getActiveTools() } }
  }

  if (message.op === 'dev_reload') return handleDevReloadRequest(message, ctx, pi, beamCwd)

  if (message.op === 'append_entry') {
    const customType = message.payload?.customType
    const data = message.payload?.data
    if (typeof customType !== 'string' || typeof data !== 'object' || data === null) {
      return { ok: false, error: 'append_entry requires customType and data' }
    }

    pi.appendEntry(customType, data as Record<string, unknown>)
    return { ok: true, result: 'ok' }
  }

  if (message.op === 'send_message') {
    const customType = message.payload?.customType
    const data = message.payload?.data
    if (typeof customType !== 'string' || typeof data !== 'object' || data === null) {
      return { ok: false, error: 'send_message requires customType and data' }
    }

    pi.sendMessage({
      customType,
      content: '',
      display: true,
      details: data as Record<string, unknown>
    })
    return { ok: true, result: 'ok' }
  }

  return undefined
}

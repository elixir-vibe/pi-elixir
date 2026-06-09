import {
  complete,
  type Api as API,
  type AssistantMessage,
  type Context,
  type Message,
  type Model
} from '@earendil-works/pi-ai'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { recordDiagnostic, withDiagnosticSpan } from '../diagnostics.ts'
import type { StdioMessage } from '../protocol/types.ts'

interface BridgeLLMMessage {
  role?: unknown
  content?: unknown
}

function bridgeMessages(message: StdioMessage): BridgeLLMMessage[] {
  const messages = message.payload?.messages
  return Array.isArray(messages) ? (messages as BridgeLLMMessage[]) : []
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part !== 'object' || part === null) return ''
      const maybeText = (part as { text?: unknown }).text
      return typeof maybeText === 'string' ? maybeText : ''
    })
    .filter(Boolean)
    .join('\n')
}

function assistantMessage(text: string, model: Model<API>): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop',
    timestamp: Date.now()
  }
}

function toContext(messages: BridgeLLMMessage[], model: Model<API>): Context {
  let systemPrompt: string | undefined
  const converted: Message[] = []

  for (const message of messages) {
    const role = typeof message.role === 'string' ? message.role : String(message.role ?? '')
    const text = contentText(message.content)
    if (!text) continue

    if (role === 'system') {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${text}` : text
      continue
    }

    if (role === 'assistant') {
      converted.push(assistantMessage(text, model))
      continue
    }

    converted.push({ role: 'user', content: text, timestamp: Date.now() })
  }

  return { systemPrompt, messages: converted }
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

export async function handleLLMComplete(
  message: StdioMessage,
  ctx: ExtensionContext,
  _pi: ExtensionAPI
): Promise<Record<string, unknown>> {
  return await withDiagnosticSpan('llm_complete_request', ctx.cwd, undefined, async () => {
    const model = ctx.model
    if (!model) return { ok: false, error: 'No active pi model is selected.' }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
    if (!auth.ok) return { ok: false, error: auth.error }

    const context = toContext(bridgeMessages(message), model)
    recordDiagnostic('llm_complete_context', ctx.cwd, {
      messageCount: context.messages.length,
      hasSystemPrompt: Boolean(context.systemPrompt),
      model: `${model.provider}/${model.id}`
    })

    const result = await complete(model, context, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal: ctx.signal,
      timeoutMs: 60_000
    })

    if (result.stopReason === 'error' || result.stopReason === 'aborted') {
      return { ok: false, error: result.errorMessage ?? result.stopReason }
    }

    return { ok: true, result: assistantText(result) }
  })
}

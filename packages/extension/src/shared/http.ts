import { withTimeoutSignal } from './abort'

interface HttpOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface HttpTextResult {
  ok: boolean
  status: number
  text: string
  response: Response
}

export function env(name: string): string | undefined {
  return process.env[name] || undefined
}

export function requireEnv(
  name: string
): { ok: true; value: string } | { ok: false; message: string } {
  const value = env(name)
  return value ? { ok: true, value } : { ok: false, message: `${name} not set` }
}

export function apiErrorMessage(status: number, body?: string): string {
  if (!body?.trim()) return `API returned ${status}`

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const message = [parsed.error, parsed.message]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(': ')
    if (message) return `API returned ${status}: ${message}`
  } catch {
    const singleLine = body.replace(/\s+/gu, ' ').trim()
    if (singleLine) return `API returned ${status}: ${singleLine.slice(0, 240)}`
  }

  return `API returned ${status}`
}

export async function fetchText(
  url: string,
  init: RequestInit = {},
  options: HttpOptions = {}
): Promise<HttpTextResult> {
  const request = async (signal?: AbortSignal) => {
    const response = await fetch(url, { ...init, signal })
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
      response
    }
  }

  if (options.timeoutMs !== undefined) {
    return withTimeoutSignal(options.signal, options.timeoutMs, request)
  }

  return request(options.signal)
}

export async function fetchJson(
  url: string,
  init: RequestInit = {},
  options: HttpOptions = {}
): Promise<Omit<HttpTextResult, 'text'> & { data?: unknown }> {
  const result = await fetchText(url, init, options)
  return {
    ok: result.ok,
    status: result.status,
    response: result.response,
    data: result.ok ? (JSON.parse(result.text) as unknown) : undefined
  }
}

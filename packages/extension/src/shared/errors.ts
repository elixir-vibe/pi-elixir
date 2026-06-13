import { isRecord } from './json'

export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const cause = errorCauseMessage(error.cause)
  if (!cause || cause === error.message) return error.message
  return `${error.message}: ${cause}`
}

function errorCauseMessage(cause: unknown): string | undefined {
  if (!cause) return undefined
  if (cause instanceof Error) return cause.message
  if (isRecord(cause)) {
    const message = typeof cause.message === 'string' ? cause.message : undefined
    const code = typeof cause.code === 'string' ? cause.code : undefined
    if (message && code) return `${message} (${code})`
    return message ?? code
  }
  return String(cause)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown
  } catch {
    return undefined
  }
}

export function parseJsonObject(content: string): Record<string, unknown> | undefined {
  const parsed = parseJson(content)
  return isRecord(parsed) ? parsed : undefined
}

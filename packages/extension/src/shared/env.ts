export type ParseEnvResult<T> = { ok: true; value?: T } | { ok: false; message: string }

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function parseNumberEnv(name: string): ParseEnvResult<number> {
  const raw = optionalEnv(name)
  if (!raw) return { ok: true }

  const value = Number(raw)
  return Number.isFinite(value)
    ? { ok: true, value }
    : { ok: false, message: `${name} must be a number` }
}

export function parseIntegerEnv(name: string): ParseEnvResult<number> {
  const parsed = parseNumberEnv(name)
  if (!parsed.ok || parsed.value === undefined) return parsed

  return Number.isInteger(parsed.value)
    ? parsed
    : { ok: false, message: `${name} must be an integer` }
}

export function parseDelimitedEnvList(name: string, delimiter: RegExp = /[\n,]/u): string[] {
  return (optionalEnv(name) ?? '')
    .split(delimiter)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export async function withTimeoutSignal<T>(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const signal = parentSignal
    ? AbortSignal.any([controller.signal, parentSignal])
    : controller.signal

  try {
    return await run(signal)
  } finally {
    clearTimeout(timeoutId)
  }
}

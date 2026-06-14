export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForValue<T>(
  read: () => T | undefined,
  options: { timeoutMs: number; intervalMs?: number }
): Promise<T | undefined> {
  const intervalMs = options.intervalMs ?? 100
  const start = Date.now()
  while (Date.now() - start < options.timeoutMs) {
    const value = read()
    if (value !== undefined) return value
    // eslint-disable-next-line no-await-in-loop -- polling must wait between sequential reads.
    await sleep(intervalMs)
  }
  return read()
}

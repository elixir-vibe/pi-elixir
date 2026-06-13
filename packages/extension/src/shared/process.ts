export interface CommandOutput {
  code?: number | null
  stdout?: string
  stderr?: string
}

export function commandOutput(result: CommandOutput, fallback = 'Unknown error'): string {
  return result.stderr?.trim() || result.stdout?.trim() || fallback
}

export function commandFailure(result: CommandOutput, action: string): string {
  const output = commandOutput(result)
  const code = result.code === undefined || result.code === null ? '' : ` (exit ${result.code})`
  return `${action}${code}: ${output}`
}

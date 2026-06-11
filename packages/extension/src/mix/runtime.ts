import * as childProcess from 'node:child_process'

function commandExists(command: string): boolean {
  const result = childProcess.spawnSync(command, ['--version'], {
    stdio: 'ignore',
    timeout: 3_000
  })

  return result?.status === 0
}

export function elixirRuntimeProblem(): string | null {
  if (!commandExists('elixir')) {
    return 'Elixir is not installed or not available on PATH. Install Elixir/OTP before using pi-elixir BEAM tools.'
  }

  if (!commandExists('mix')) {
    return 'Mix is not available on PATH. Install a complete Elixir distribution before using pi-elixir BEAM tools.'
  }

  return null
}

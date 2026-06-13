import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getConnectionKind } from '#src/connection/resolver.ts'
import { getIncompatibleDependency, getUnavailableReason } from '#src/connection/status.ts'
import { getBridgeInfo, getEmbeddedUrl } from '#src/embedded/stdio-process.ts'
import { hasPiDependency, readMixExs, resolveMixProjectCwd } from '#src/mix/project.ts'
import { elixirRuntimeProblem } from '#src/mix/runtime.ts'
import { EXTENSION_VERSION, expectedPiBridgeDependency } from '#src/version.ts'

interface CommandResult {
  ok: boolean
  output: string
}

function run(command: string, args: string[], cwd: string): CommandResult {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 5_000
  })

  const output = [result.stdout, result.stderr]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim()

  return { ok: result.status === 0, output: output || (result.error ? result.error.message : '') }
}

function firstLine(value: string): string {
  return (
    value
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? 'unavailable'
  )
}

function elixirVersion(cwd: string): string {
  const result = run('elixir', ['--version'], cwd)
  if (!result.ok) return 'unavailable'
  const lines = result.output.split('\n').map((line) => line.trim())
  const elixir = lines.find((line) => line.startsWith('Elixir ')) ?? 'Elixir unknown'
  const otp = lines.find((line) => line.startsWith('Erlang/OTP ')) ?? 'Erlang/OTP unknown'
  return `${elixir} · ${otp}`
}

function mixVersion(cwd: string): string {
  const result = run('mix', ['--version'], cwd)
  if (!result.ok) return 'unavailable'
  return (
    result.output
      .split('\n')
      .find((line) => line.trim().startsWith('Mix '))
      ?.trim() ?? firstLine(result.output)
  )
}

function miseHint(cwd: string): string | null {
  const result = run('mise', ['exec', '--', 'elixir', '--version'], cwd)
  if (!result.ok) return null
  return `mise exec elixir: ${firstLine(result.output)}`
}

function dependencyStatus(beamCwd: string | null): string[] {
  if (!beamCwd) return ['pi_bridge dependency: unknown (no Mix project resolved)']

  const mixExs = readMixExs(beamCwd)
  if (!mixExs) return ['pi_bridge dependency: unknown (mix.exs is not readable)']

  const present = hasPiDependency(mixExs)
  const lines = [`pi_bridge dependency: ${present ? 'present' : 'missing'}`]
  if (!present) lines.push(`expected dependency: ${expectedPiBridgeDependency()}`)
  return lines
}

function bundledBridgeStatus(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '..', '..', 'bridge'),
    path.resolve(here, '..', '..', '..', 'bridge')
  ]
  const bridge = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'mix.exs')))
  return bridge ? `available (${bridge})` : 'not found'
}

function pathWarnings(): string[] {
  const entries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const missingMiseEntries = entries.filter(
    (entry) => entry.includes('/.local/share/mise/installs/') && !fs.existsSync(entry)
  )

  if (missingMiseEntries.length === 0) return []
  return [
    `PATH warning: ${missingMiseEntries.length} stale mise install path(s) in current pi process`
  ]
}

export function buildElixirDoctorReport(cwd: string): string {
  const beamCwd = resolveMixProjectCwd(cwd)
  const runtimeProblem = elixirRuntimeProblem()
  const connectionKind = beamCwd ? getConnectionKind(beamCwd) : null
  const bridgeInfo = beamCwd ? getBridgeInfo(beamCwd) : undefined
  const unavailable = beamCwd ? getUnavailableReason(beamCwd) : undefined
  const incompatible = beamCwd ? getIncompatibleDependency(beamCwd) : undefined
  const mise = miseHint(beamCwd ?? cwd)
  const lines = [
    'pi-elixir doctor',
    '',
    `cwd: ${cwd}`,
    `Mix cwd: ${beamCwd ?? 'not found'}`,
    `bundled bridge fallback: ${bundledBridgeStatus()}`,
    `extension version: ${EXTENSION_VERSION}`,
    '',
    `Elixir: ${elixirVersion(beamCwd ?? cwd)}`,
    `Mix: ${mixVersion(beamCwd ?? cwd)}`,
    ...(runtimeProblem ? [`runtime problem: ${runtimeProblem}`] : []),
    ...(mise ? [mise] : []),
    ...pathWarnings(),
    '',
    ...dependencyStatus(beamCwd),
    '',
    `connection: ${connectionKind ?? 'none'}`,
    ...(beamCwd ? [`embedded url: ${getEmbeddedUrl(beamCwd)}`] : []),
    ...(bridgeInfo
      ? [
          `bridge: ${bridgeInfo.project ?? 'unknown'} ${bridgeInfo.version ?? 'unknown'} (${bridgeInfo.transport ?? 'unknown'})`
        ]
      : []),
    ...(unavailable ? [`unavailable reason: ${unavailable}`] : []),
    ...(incompatible ? [`incompatible dependency: ${incompatible}`] : []),
    '',
    `next step: ${nextStep({ beamCwd, runtimeProblem, unavailable, connectionKind, incompatible })}`
  ]

  return lines.join('\n')
}

function nextStep(input: {
  beamCwd: string | null
  runtimeProblem: string | null
  unavailable?: string
  connectionKind: ReturnType<typeof getConnectionKind>
  incompatible?: string
}): string {
  if (!input.beamCwd) return 'run pi from a Mix project directory, or from a supported repo root'
  if (input.runtimeProblem)
    return 'fix Elixir/Mix availability in the shell that starts pi, then restart pi'
  if (input.incompatible)
    return 'update the pi_bridge dependency to match this extension and run mix deps.get'
  if (input.unavailable?.startsWith('Embedded BEAM exited before ready'))
    return 'fix the embedded BEAM startup error shown above, then run /elixir:restart'
  if (input.connectionKind === 'missing')
    return 'run an Elixir tool and approve installing the dev-only pi_bridge dependency'
  if (input.connectionKind === 'starting')
    return 'wait for the embedded BEAM to finish starting, then retry the tool call'
  if (input.connectionKind === 'embedded' || input.connectionKind === 'external')
    return 'connection looks ready'
  return 'run an Elixir tool to start the embedded BEAM, or use /elixir:restart from a Mix project'
}

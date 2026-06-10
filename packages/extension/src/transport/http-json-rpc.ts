import { readAppName } from '#src/mix/project.ts'
import type { JsonRpcResponse, McpConfig, ToolArgs, ToolResult } from '#src/protocol/types.ts'

let requestId = 0

type ExternalMCPProbe = { url: string; config: McpConfig }

const PROBE_PORTS = [4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009]

function isMcpConfig(value: unknown): value is McpConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'project_name' in value &&
    typeof value.project_name === 'string' &&
    'framework_type' in value &&
    typeof value.framework_type === 'string'
  )
}

async function fetchConfig(baseUrl: string): Promise<McpConfig | null> {
  try {
    const resp = await fetch(baseUrl.replace(/\/mcp$/, '/config'), {
      signal: AbortSignal.timeout(1000)
    })
    if (!resp.ok) return null
    const json: unknown = await resp.json()
    return isMcpConfig(json) ? json : null
  } catch {
    return null
  }
}

export async function discoverExternalMCP(cwd: string): Promise<string | null> {
  const appName = readAppName(cwd)

  const probes = PROBE_PORTS.map(async (port) => {
    const url = `http://localhost:${port}/mcp`
    const config = await fetchConfig(url)
    return config ? { url, config } : null
  })

  const results = (await Promise.all(probes)).filter(
    (result): result is ExternalMCPProbe => result !== null
  )

  if (results.length === 0) return null
  if (!appName) return results[0].url

  return results.find((result) => result.config.project_name === appName)?.url ?? null
}

export async function callHttpTool(
  url: string,
  name: string,
  args: ToolArgs,
  signal?: AbortSignal
): Promise<ToolResult> {
  const id = ++requestId

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args }
      }),
      signal
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      text: `Could not reach BEAM MCP endpoint at ${url} (${msg}). Start the configured external MCP server, or unset PI_MCP_URL to let pi-elixir use its embedded bridge.`,
      isError: true
    }
  }

  let json: JsonRpcResponse
  try {
    json = await resp.json()
  } catch {
    return {
      text: `BEAM returned invalid response (HTTP ${resp.status}). The server may be starting up or misconfigured.`,
      isError: true
    }
  }

  if (json.error) {
    return { text: `MCP error ${json.error.code}: ${json.error.message}`, isError: true }
  }

  const text = (json.result?.content ?? [])
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n')

  return { text, isError: json.result?.isError ?? false }
}

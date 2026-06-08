import { highlightCode, type AgentToolResult } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

function resultText(result: AgentToolResult<unknown>) {
  return result.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n')
}

export function renderElixirResult(result: AgentToolResult<unknown>) {
  const text = resultText(result)
  if (!text) return new Text(text, 0, 0)
  return new Text(highlightCode(text, 'elixir').join('\n'), 0, 0)
}

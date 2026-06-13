import { keyHint, truncateToVisualLines, type Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, type Component } from '@earendil-works/pi-tui'

const COMMAND_PREVIEW_LINES = 5

function styleOutput(text: string, theme: Theme): string {
  return text
    .split('\n')
    .map((line) => theme.fg('toolOutput', line))
    .join('\n')
}

function expandFooter(skipped: number, theme: Theme, width: number): string {
  const hint =
    theme.fg('muted', `... (${skipped} earlier lines,`) +
    ` ${keyHint('app.tools.expand', 'to expand')}${theme.fg('muted', ')')}`
  return truncateToWidth(hint, width, '...')
}

export function renderCommandOutput(text: string, expanded: boolean, theme: Theme): Component {
  const output = styleOutput(text.trim(), theme)
  return {
    render(width) {
      if (!output) return []

      if (expanded) {
        return ['', ...output.split('\n').map((line) => truncateToWidth(line, width, '...'))]
      }

      const preview = truncateToVisualLines(output, COMMAND_PREVIEW_LINES, width)
      if (preview.skippedCount > 0) {
        return ['', expandFooter(preview.skippedCount, theme, width), ...preview.visualLines]
      }
      return ['', ...preview.visualLines]
    },
    invalidate: () => undefined
  }
}

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationOptions,
  type TruncationResult
} from '@earendil-works/pi-coding-agent'

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult }

interface TruncateTextOptions extends TruncationOptions {
  notice?: (truncation: TruncationResult) => string
}

export function truncateHeadText(
  content: string,
  options: TruncateTextOptions = {}
): { text: string; truncation?: TruncationResult; notice?: string } {
  const truncation = truncateHead(content, options)
  if (!truncation.truncated && !truncation.firstLineExceedsLimit) {
    return { text: truncation.content }
  }

  const notice = options.notice?.(truncation) ?? defaultTruncationNotice(truncation)
  return {
    text: notice ? `${truncation.content}\n\n${notice}` : truncation.content,
    truncation,
    notice
  }
}

function defaultTruncationNotice(truncation: TruncationResult): string {
  if (truncation.firstLineExceedsLimit) {
    return `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`
  }

  if (truncation.truncatedBy === 'lines') {
    return `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`
  }

  return `[Output truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`
}

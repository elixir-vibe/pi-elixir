# Tool Renderer Style Guide

Pi tool output should look like one family across built-in and extension tools.

## Structure

- Let `ToolExecutionComponent` provide the card background and spacing; result renderers should not add their own boxes.
- Start custom result bodies with a blank line so they sit below the call line like built-in tools.
- Compact views should show the most useful real data, not only counts or type names.
- Expanded views may show metadata, but metadata must not dominate the actual result.

## Color roles

Use core tool colors first:

- `toolTitle` + `bold` — call titles only (`bash`, `read`, `iex`, command prefix). Avoid inside result bodies.
- `toolOutput` — normal result/body text and ordinary scalar values.
- `muted` — metadata labels, secondary status text, dividers, hidden-count lines, durations, expansion hints.
- `dim` — very low-emphasis hints only.
- `accent` — clickable or identity-like references: paths, URLs, module names, final target names.
- `warning` — warnings, truncation notices, line ranges, unusual but non-failing status.
- `error` — failures only.
- `success` — success state only when it adds information; do not color every `200 OK` green.

Use Markdown colors only when rendering Markdown or Markdown-shaped syntax:

- `mdHeading` — Markdown headings, not generic tool section headings.
- `mdCodeBlock` / `mdCodeBlockBorder` — code blocks and Markdown-rendered tables/code fences, not metadata values.
- `mdLinkUrl` — URLs inside rendered Markdown. For tool metadata URLs, prefer `accent`.

## Typography

- Bold is for call titles and rare high-level headers only.
- Section labels inside results (`Title`, `Body`, `Status`) should be muted, not bold/white.
- Avoid all-white blocks: every line should communicate whether it is title, metadata, body, hint, warning, or error.
- Avoid rainbow metadata: grouped metadata should be mostly muted labels plus normal/accent values.

## Recommended patterns

Compact web/document-like output:

```text
Web fetch · 200 OK · text/html · 559 B   # muted
https://example.com                     # accent
→ Example Domain                        # muted arrow + accent title

Body preview text...                    # toolOutput

142 chars · not truncated · (ctrl+o to expand)  # muted
```

Expanded document-like output:

```text
Web fetch                               # muted or accent, not bold white
Status:       200 OK                    # muted label + toolOutput value
URL:          https://example.com        # muted label + accent value

Title                                  # muted section label
Example Domain                         # accent or toolOutput

Body                                   # muted section label
Body text...                           # toolOutput
```

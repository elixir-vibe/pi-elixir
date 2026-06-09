# Operating Style

- Read relevant source, docs, and tests before implementation. For installed Elixir modules, use BEAM docs APIs (`Code.fetch_docs/1`, `h/1`, `exports/1`) before guessing or web-searching.
- Avoid unrelated cleanup, broad rewrites, or repo reshaping unless explicitly requested.
- Prefer correct, complete, Elixir-idiomatic fixes over superficial simple fixes.
- For Elixir refactors and code-shape searches, prefer ExAST tools (`elixir_ast_search`, `elixir_ast_replace`) before grep/regex/text replacement.
- Track multi-step work in a small local checklist or note when context may be lost.
- Use subagents/parallel review only for independent deep investigations; synthesize findings concisely.
- Preserve commit/PR hygiene: inspect repo style, avoid private-project leaks, and preview PRs before submitting.

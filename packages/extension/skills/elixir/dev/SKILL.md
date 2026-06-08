---
name: elixir-dev
description: Develop existing Elixir/Phoenix applications through a minimal BEAM tool surface. Use eval for runtime introspection and helper APIs, AST tools for structural code work, LSP for editor semantics, and Mix only for build/test/format gates. For starting a new Elixir project/package with Igniter or VibeKit, use the elixir-new-project skill instead.
---

# Elixir Development with BEAM Runtime Access

Use the BEAM as the primary control plane. Keep the model-facing Elixir tool surface small:

- `elixir_eval` — runtime introspection, helper calls, docs, profiling, filesystem inspection through Elixir stdlib, OTP state, database checks, and small experiments inside the loaded app.
- `elixir_ast_search` — structural Elixir search. Use it instead of text search when matching code shape.
- `elixir_ast_replace` — structural Elixir rewrites. Use it instead of regex/text replacement for syntax-aware changes.
- LSP, when available — diagnostics, definitions, references, hover, symbols, and code actions.
- Host file/shell tools — file edits, `git`, and `mix` build/test/format commands.

Use Elixir/OTP stdlib directly from `elixir_eval` for ordinary runtime, file, and process work. Reach for `Pi.*` shortcuts only when they provide bounded summaries or remove repetitive boilerplate.

Read the focused guidance files as needed:

- `operating-style.md` — Elixir-specific source reading, scope, correctness, context tracking, and PR hygiene.
- `tool-discipline.md` — eval/AST/LSP/shell choice rules.
- `runtime-snippets.md` — useful runtime introspection snippets.
- `workflow-verification.md` — edit and verification loop.

For phrases like “start a new package”, “see my vibe_kit package”, “use igniter”, `mix igniter.new`, or `mix igniter.install`, load `elixir-new-project` instead of treating the task as ordinary existing-project development.

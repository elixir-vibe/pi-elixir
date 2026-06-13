---
name: elixir-dev
description: Develop existing Elixir/Phoenix applications through a minimal BEAM tool surface. Use eval for runtime introspection and helper APIs, AST tools for structural code work, LSP for editor semantics, and Mix only for build/test/format gates. For starting a new Elixir project/package with Igniter or VibeKit, use the elixir-new-project skill instead.
---

# Elixir Development with BEAM Runtime Access

Use the BEAM as the primary control plane. Keep the model-facing Elixir tool surface small, but use the available tools aggressively:

- `elixir_eval` — runtime introspection, helper calls, docs, profiling, filesystem inspection through Elixir stdlib, OTP state, database checks, and small experiments inside the loaded app.
- `elixir_ast_search` — default choice for Elixir code search when the target is syntax/code shape. Prefer this over `rg`/grep for functions, callbacks, pipelines, structs, maps, tuples, calls, macros, and refactor candidates.
- `elixir_ast_replace` — default choice for Elixir refactors and syntax-aware rewrites. Prefer this over regex/text replacement unless the change is purely textual.
- LSP, when available — diagnostics, definitions, references, hover/type info, workspace/file symbols, and code actions.
- Host file/shell tools — file edits, `git`, package managers, and `mix` build/test/format commands.

Use Elixir docs APIs from `elixir_eval` before guessing framework/library behavior. Use `h(Module.fun/arity)`, `exports(Module)`, and `i(term)` for quick direct inspection; use `Pi.Docs.entries/1` and `Pi.Docs.get/3` when you need structured docs that can be filtered with normal `Enum`. Web search is for missing or external docs, not the first step for code that is already loaded in the project.

Treat `elixir_eval` as a typed Elixir shell: prefer plain Elixir expressions and pipelines for BEAM/runtime inspection, installed docs, OTP state, app config, QuackDB/Ecto session analytics, and structured filesystem work where typed maps/lists help follow-up reasoning. Use `bash` for external CLIs and raw text tools; use eval when the result should remain typed and renderable.

Use Elixir/OTP stdlib directly from `elixir_eval` for ordinary runtime, file, and process work. Reach for `Pi.*` shortcuts only when they provide bounded summaries or remove repetitive boilerplate. For bridge self-introspection, prefer the preloaded `Self` alias (`Pi.Self`) for `Self.status()`, `Self.quack()`, `Self.bindings()`, `Self.sessions()`, and `Self.context(query)`. For semantic code diff/review, prefer the preloaded `AST` alias (`Pi.AST`) for `AST.diff(changed: true)` before reading large textual `git diff` output. For semantic code reflection, prefer the preloaded `CodeMap` alias (`Pi.CodeMap`) for `CodeMap.reflect(changed: true)`, `CodeMap.context(target)`, `CodeMap.hotspots(path: file)`, and `CodeMap.smells(path: file)`. For session history analytics, prefer the preloaded short aliases `Q` (`Pi.Quack`), `E` (`Pi.Quack.Event`), and `SF` (`Pi.Quack.SessionFile`) with normal `Ecto.Query`/`QuackDB.Ecto` DSL, then render via `Q.table()` or `Pi.table()`. For structured docs, prefer `Pi.Docs.entries(Mod) |> Enum.filter(...)` and `Pi.Docs.get(Mod, :name, arity)`; use raw `Code.fetch_docs/1` only when inspecting the low-level docs chunk itself. For simple web context, prefer bounded `Pi.Web.fetch!/2` over raw `Req`.

After non-trivial Elixir edits, do not stop at tests. Run `CodeMap.reflect(changed: true)` before the final answer when Reach is available. Apply one small behavior-preserving cleanup if the evidence supports it; otherwise explicitly state why no further refactor is warranted.

Read the focused guidance files as needed:

- `operating-style.md` — Elixir-specific source reading, scope, correctness, context tracking, and PR hygiene.
- `tool-discipline.md` — eval/AST/LSP/shell choice rules.
- `runtime-snippets.md` — useful runtime introspection snippets.
- `workflow-verification.md` — edit and verification loop.

For Phoenix/LiveView UI, frontend assets, styling, browser-console feedback, PhoenixReplay debugging, or render verification, load `elixir-webdev` in addition to this general Elixir skill.

For phrases like “start a new package”, “see my vibe_kit package”, “use igniter”, `mix igniter.new`, or `mix igniter.install`, load `elixir-new-project` instead of treating the task as ordinary existing-project development.

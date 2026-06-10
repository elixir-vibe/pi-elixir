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

Use Elixir docs APIs from `elixir_eval` before guessing framework/library behavior. Prefer pipeline-friendly `Pi.Docs` for structured docs/source workflows, and use `Code.fetch_docs/1`, `h(Module.fun/arity)`, `exports(Module)`, and `i(term)` for quick direct inspection. Web search is for missing or external docs, not the first step for code that is already loaded in the project.

Treat `elixir_eval` as a typed Elixir shell: prefer plain Elixir expressions and pipelines for BEAM/runtime inspection, installed docs, OTP state, app config, QuackDB/Ecto session analytics, and structured filesystem work where typed maps/lists help follow-up reasoning. Use `bash` for external CLIs and raw text tools; use eval when the result should remain typed and renderable.

Use Elixir/OTP stdlib directly from `elixir_eval` for ordinary runtime, file, and process work. Reach for `Pi.*` shortcuts only when they provide bounded summaries or remove repetitive boilerplate. For session history analytics, prefer the preloaded short aliases `Q` (`Pi.Quack`), `E` (`Pi.Quack.Event`), and `SF` (`Pi.Quack.SessionFile`) with normal `Ecto.Query`/`QuackDB.Ecto` DSL, then render via `Q.table()` or `Pi.table()`. For docs/source context, prefer pipelines such as `Pi.Docs.module(Mod) |> Pi.Docs.functions() |> Pi.Docs.search("query")` and `Pi.Docs.module(Mod) |> Pi.Docs.function(:name, arity) |> Pi.Docs.source(context: 25)`. For simple web context, prefer bounded `Pi.Web.fetch!/2` over raw `Req`.

Read the focused guidance files as needed:

- `operating-style.md` — Elixir-specific source reading, scope, correctness, context tracking, and PR hygiene.
- `tool-discipline.md` — eval/AST/LSP/shell choice rules.
- `runtime-snippets.md` — useful runtime introspection snippets.
- `workflow-verification.md` — edit and verification loop.

For phrases like “start a new package”, “see my vibe_kit package”, “use igniter”, `mix igniter.new`, or `mix igniter.install`, load `elixir-new-project` instead of treating the task as ordinary existing-project development.

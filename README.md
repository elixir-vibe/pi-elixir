# pi-elixir

`pi-elixir` is the pi extension for BEAM-native, verifiable Elixir development.

It connects pi to the running Elixir system so an agent can inspect runtime state, make syntax-aware Elixir edits, and verify changes with real project checks. The model-facing surface stays intentionally small: eval for runtime truth, ExAST tools for structural code work, and normal Mix/LSP/shell commands for everything else.

## What it gives pi

- **Live BEAM eval** — `elixir_eval` runs trusted Elixir inside the loaded app with project modules, deps, config, processes, ETS, logs, and IEx helpers available.
- **Stateful IEx-like cells** — bindings, aliases, imports, and requires persist across eval calls and resume/branch navigation via sidecar snapshots.
- **Structural Elixir tools** — `elixir_ast_search` and `elixir_ast_replace` use [ExAST](https://hex.pm/packages/ex_ast) patterns instead of text/regex matching.
- **Syntax-aware review orientation** — `AST.diff(changed: true)` / `CodeMap.reflect(changed: true)` summarize changed modules/functions before the agent reads a large `git diff`.
- **OTP-backed sessions and agents** — optional BEAM sessions/subagents render as compact pi session trees without spawning more pi processes.
- **Project-local skills/plugins** — trusted local Elixir can add project workflows, guardrails, slash commands, tool hooks, and UI widgets.
- **Strict verification** — this repo gates releases with JS lint/typecheck/tests, BEAM compile/test/Credo/Dialyzer, ExDNA clone detection, Reach architecture/smell checks, Hex build validation, and npm pack validation.

`pi-elixir` follows the broader [Elixir Vibe](https://github.com/elixir-vibe) direction: compact agent APIs outside, rich composable Elixir APIs inside, structured BEAM payloads rendered by pi, and verification through runtime state plus structural analysis.

## Install

```sh
pi install npm:pi-elixir
```

Check the bridge from inside pi:

```text
/elixir:status
```

Use full diagnostics when setup looks wrong:

```text
/elixir:doctor
```

In each Mix project that should use BEAM tools, install the dev-only bridge dependency:

```text
/elixir:install
```

That adds an exact-versioned dependency such as:

```elixir
{:pi_bridge, "== <pi-elixir-version>", only: :dev}
```

The exact version matters: npm `pi-elixir` and Hex `pi_bridge` are released together and must speak the same protocol. If you skip `/elixir:install`, the first Elixir tool call can still prompt to add the dependency.

## Daily workflow

### Inspect the running app

Use `iex` / `elixir_eval` when runtime truth matters:

```text
iex alias MyApp.Repo; alias MyApp.Billing.Invoice; stale = Repo.all(...); length(stale)

14

Took 0.1s
```

The next eval continues from the same IEx-like state:

```text
iex stale |> Enum.group_by(& &1.customer_id) |> Enum.map(fn {id, xs} -> {id, length(xs)} end)

[{"cust_123", 5}, {"cust_456", 9}]

Took 0.1s
```

For Phoenix/Ecto/OTP bugs, prefer asking the running system over guessing from files:

```elixir
Supervisor.which_children(MyApp.Supervisor)
Application.get_env(:my_app, MyApp.Repo)
Process.info(pid, [:status, :message_queue_len, :current_stacktrace])
Pi.logs(tail: 50)
```

### Search and edit by syntax

Use ExAST-backed tools for Elixir code shape:

```text
ast grep defmodule _ do _ end lib/my_app
ast edit Logger.debug(_) → Logger.info(_) lib/my_app --dry-run
```

These tools match Elixir AST, including captures and nested expressions. They are for structural Elixir search/refactors; use LSP for editor semantics and `mix format`/tests for verification.

### Review changed Elixir safely

Before reading a large or truncated textual diff, orient on changed modules/functions:

```elixir
AST.diff(changed: true)
CodeMap.reflect(changed: true)
```

Then inspect only the relevant source slices or `git diff` sections. This keeps review focused on semantic changes instead of raw patch volume.

## Model-facing tools

`pi-elixir` deliberately exposes only three model tools:

| Tool | Label | Purpose |
|---|---:|---|
| `elixir_eval` | `iex` | Trusted eval inside the running app. Stateful by default for pi session branches; sandbox mode is available for untrusted snippets. |
| `elixir_ast_search` | `ast grep` | ExAST structural search over Elixir code. |
| `elixir_ast_replace` | `ast edit` | ExAST structural rewrite with dry-run diffs. |

Everything else is ordinary Elixir API reachable through eval:

```elixir
Pi.project()
Pi.logs(tail: 50)
Pi.Bridge.Info.runtime_apis()

Pi.Eval.bindings()
Pi.Eval.forget(:huge_result)
Pi.Eval.reset()

Pi.Docs.entries(Pi.Output)
Pi.Docs.get(Pi.Output, :table, 2)
Pi.Web.fetch!("https://example.com", format: :text)

Pi.Session.start(name: :reviewer)
Pi.Agent.parallel(["Review API", "Review tests"], timeout: 60_000)
```

For model calls from the BEAM, pi still owns provider/model selection, credentials, streaming, cancellation, usage, and transcript UI:

```elixir
Pi.LLM.complete("Summarize this module")
Pi.LLM.stream("Draft a migration plan")

Pi.ReqLLM.install()
ReqLLM.generate_text(Pi.ReqLLM.current_model(), "Summarize this module")
```

## Stateful eval and sidecars

`elixir_eval` behaves like an IEx/Livebook cell runtime scoped to the current pi execution path:

- variables persist across calls;
- `alias`, `import`, and `require` persist through `Macro.Env`;
- errors do not replace the previous good state;
- `Pi.Eval.bindings/0`, `forget/1`, and `reset/0` manage state from inside eval;
- snapshots are stored as sidecar blobs, **not** in the JSONL transcript.

Physical storage:

```text
<session.jsonl>.pi-elixir/
  eval-state/
    <toolCallId>.term
    <toolCallId>.term.meta.json
```

Unsafe or oversized bindings are handled defensively: PIDs/ports/refs/functions are not persisted, containers containing them are skipped, and sidecar snapshots have a size budget.

## Connection model

The normal path is an embedded stdio bridge started inside the Mix project with `Pi.Transport.Stdio.start()`. HTTP MCP endpoints are advanced/debug escape hatches.

Resolution order:

1. `PI_MCP_URL`, only when explicitly configured for a manually exposed HTTP MCP endpoint.
2. Discovered local HTTP MCP endpoint matching the Mix app name.
3. Embedded stdio transport inside the project.

```sh
# Advanced/debug only: bypass embedded stdio and use your own HTTP MCP endpoint.
export PI_MCP_URL=http://localhost:4001/mcp
export PI_DISABLE_EMBEDDED=1
```

Status is transport-focused and actionable: external/embedded/starting/missing/incompatible/offline. It does **not** show project package versions or optional integration guesses; project-specific checks belong in explicit eval snippets, prompts, and skills.

Feature flags are escape hatches for noisy, sensitive, or experimental environments:

| Capability | Default | Escape hatch |
|---|---:|---|
| Stateful `elixir_eval` | on | `PI_ELIXIR_STATEFUL_EVAL=0` |
| Eval sidecar snapshots | on | `PI_ELIXIR_EVAL_SIDECAR=0` |
| BEAM LLM / ReqLLM | on | `PI_ELIXIR_LLM=0` |
| BEAM sessions/widgets/control | on | `PI_ELIXIR_SESSIONS=0` |
| Project plugins/hooks/UI/commands | on | `PI_ELIXIR_PLUGINS=0` |
| Executable Elixir skills | on | `PI_ELIXIR_SKILLS=0` |
| Extra-short eval previews | off | `PI_ELIXIR_COMPACT_EVAL_PREVIEW=1` |

## Recommended project stack

For new web applications, use Phoenix with Igniter and VibeKit, then add pi-elixir in the project:

```sh
mix archive.install hex phx_new
mix archive.install hex igniter_new
mix phx.new my_app
cd my_app
mix igniter.install vibe_kit --agents-md
pi install npm:pi-elixir
```

For non-web Elixir projects and packages:

```sh
mix archive.install hex igniter_new
mix igniter.new my_lib --install vibe_kit --agents-md
cd my_lib
pi install npm:pi-elixir
```

VibeKit provides the project quality baseline (`mix ci`, Credo strict with ExSlop, Dialyzer, ExDNA, and Reach). pi-elixir provides the live BEAM tools used by agents while they work inside that project. Run `/elixir:install` once per project to add the exact matching dev-only `:pi_bridge` dependency.

## Troubleshooting setup

| Symptom | What to do |
|---|---|
| `Mix cwd: not found` | Start pi from a Mix project directory, or from a supported repo root with a known nested Mix project. |
| `Elixir is not installed or not available on PATH` | Start pi from a shell where Elixir/Mix are available. If you just changed `mise`/`asdf` versions, restart pi. |
| Stale `mise` PATH warning | Restart the shell/pi process so removed tool install paths disappear from `PATH`. |
| `pi_bridge dependency: missing` | Run `/elixir:install` in the Mix project. |
| Embedded BEAM exited before ready | Fix the Mix/Elixir error shown in doctor, then run `/elixir:restart`. Wrong Elixir versions surface here as the real Mix error. |
| `pi_bridge version mismatch` | Update the Mix dependency to the exact version expected by installed `pi-elixir`, then run `mix deps.get`. |
| Tool registration conflicts with another `pi-elixir` path | Remove the duplicate install, usually `pi remove npm:pi-elixir`, then install only the checkout or only the npm package. |

## Local development

```sh
git clone https://github.com/elixir-vibe/pi-elixir
cd pi-elixir
pnpm install
cd packages/bridge && mix deps.get && cd ../..
pi install "$PWD"
```

If you also have `npm:pi-elixir` installed globally, remove it before dogfooding a checkout to avoid duplicate tool registration:

```sh
pi remove npm:pi-elixir
pi install "$PWD"
```

From an already-running local checkout, `/elixir:dogfood` performs that switch for you.

Common commands:

```sh
pnpm run fmt
pnpm run check
pnpm run check:js
pnpm run check:beam
pnpm run test:integration
pnpm run pack:check
```

`pnpm run check` is the release-readiness gate.

## More docs

- [`packages/extension/README.md`](packages/extension/README.md) — pi extension behavior, connection resolution, slash commands, debugging, rendering, and tool discipline.
- [`packages/bridge/README.md`](packages/bridge/README.md) — BEAM APIs for eval, docs, LLM, sessions/agents, plugins, host bridge calls, and protocol concepts.
- [`packages/bridge/docs/protocol.md`](packages/bridge/docs/protocol.md) — stdio/protocol payload examples.

## Part of Elixir Vibe

pi-elixir gives the pi coding agent a live door into the BEAM: stateful eval, AST tools, and composable runtime APIs.

It is one building block of a larger stack — tools that make AI-generated software checkable: structural search, dependency analysis, duplication/slop detection, session replay, and ecosystem-wide code search. See the [Elixir Vibe](https://github.com/elixir-vibe) organization and [Building Blocks for the Future Web](https://github.com/elixir-vibe/building-blocks) for the broader thesis and roadmap.

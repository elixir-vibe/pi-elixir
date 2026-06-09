# pi-elixir

`pi-elixir` is the pi bridge for BEAM-native, verifiable Elixir development.

It gives pi a live connection to the running Elixir system, structural Elixir AST tools, supervised BEAM sessions, and resumable eval state. The emphasis is on callable capabilities and verifiers, not only instructions: the agent can inspect runtime state, make syntax-aware changes, and validate them from formatter/compile/test checks up through duplication, static analysis, and architecture/smell checks.

This follows the broader [Vibe](https://github.com/elixir-vibe/vibe) direction: few model-facing tools outside, rich composable Elixir APIs inside, structured BEAM payloads rendered by pi, and verification through runtime state plus structural analysis.

Real pi TUI output looks like this — compact tool calls, real BEAM status, and session trees rendered in the transcript/widget:

```text
 iex case Pi.Agent.parallel(["Reply only: child A ok", "Reply only: child B ok"], name: :review_smoke, timeout: 60000) d…
 (70000ms)
 ✓ %{status: :ok, kind: :parallel, results: ["child A ok", "child B ok"]}


✓ review_smoke
  2 done
  ├─ ✓ review_smoke  child A ok
  └─ ✓ review_smoke  child B ok
  (ctrl+o to expand)

~/my_app
↑37k ↓156 $0.190 (sub) 6.9%/272k (auto)                                                                      (openai-codex) gpt-5.5 • medium
⬡ BEAM (embedded)
```

## Why this is different

Instructions are included, but they are not the foundation. The foundation is executable capability: `iex` into the live app, ExAST-backed structural tools, OTP sessions, project-local plugins/skills, and strict verification gates.

`pi-elixir` gives the agent concrete operations and checks:

- **Live runtime inspection** — evaluate trusted Elixir inside the loaded app with project modules, config, deps, application env, processes, ETS, logs, and IEx helpers available.
- **Stateful IEx-like eval** — bindings, aliases, imports, and requires persist across `elixir_eval` calls. The state is stored as sidecar snapshots next to the pi session, so resume and branch navigation keep the right context.
- **Structural code intelligence** — `elixir_ast_search` and `elixir_ast_replace` use [ExAST](https://hex.pm/packages/ex_ast) patterns, so the agent searches and edits Elixir syntax instead of playing regex roulette.
- **OTP-native subagents** — `Pi.Session` and `Pi.Agent` run logical child sessions inside the embedded BEAM. Active work renders as a pi widget; completed trees land in transcript once.
- **Active-model LLM from BEAM** — `Pi.LLM` and optional `Pi.ReqLLM` route BEAM calls through pi's current model. pi owns provider/model selection, credentials, streaming, cancellation, usage, and transcript UI; the BEAM side sends structured completion/stream requests over the active bridge.
- **Project-local skills and plugins** — trusted Elixir code can teach the agent your app's workflows, guardrails, slash commands, UI widgets, and tool hooks.
- **Hard quality gates** — the repo itself is checked with JS lint/typecheck/tests, BEAM compile/test/Credo/Dialyzer, [ExDNA](https://hex.pm/packages/ex_dna) clone detection, and [Reach](https://hex.pm/packages/reach) architecture/smell checks.

The philosophy is the same as Vibe: compact agent APIs, structured BEAM payloads, runtime state, and Elixir/OTP idioms first. The implementation is pi-native: TypeScript owns tool registration/TUI rendering, while BEAM owns Elixir semantics.

## What you can do every day

### Debug a Phoenix/Ecto issue in the running app

The agent uses `iex` (`elixir_eval`) to inspect the live BEAM. Calls render as compact pi tool rows, not giant JSON blobs:

```text
 iex alias MyApp.Repo; alias MyApp.Billing.Invoice; stale = Repo.all(...); length(stale)
 ✓ 14
```

The next eval continues from the same IEx-like state:

```text
 iex stale |> Enum.group_by(& &1.customer_id) |> Enum.map(fn {id, xs} -> {id, length(xs)} end)
 ✓ [{"cust_123", 5}, {"cust_456", 9}]
```

That continuity is real state, not prompt memory. On resume/branch navigation, `pi-elixir` restores the newest matching sidecar eval snapshot.

### Inspect OTP instead of guessing

The agent can ask the live system about supervisors, queues, process state, ETS, logs, and application config:

```text
 iex Supervisor.which_children(MyApp.Supervisor)
 ✓ [
   {MyApp.Repo, #PID<0.421.0>, :worker, [MyApp.Repo]},
   {MyAppWeb.Endpoint, #PID<0.422.0>, :supervisor, [MyAppWeb.Endpoint]}
 ]
```

For Elixir bugs, this is the daily win: pi does not have to infer runtime truth from files alone.

### Search and edit by Elixir syntax shape

ExAST-backed tools show pi-style compact calls and semantic results. The agent can search for code shape instead of text:

Real captured `ast grep` output:

```text
 ast grep defmodule _ do _ end lib/pi/ast.ex · limit 2 · allow broad
 ✓ 1 match  defmodule _ do _ end
   lib/pi/ast.ex:1  defmodule Pi.AST do @moduledoc "Structured ExAST helpers
 for bridge tools." ali…
   (ctrl+o to expand)
```

Real captured `ast edit` dry-run/no-match output:

```text
 ast edit Logger.debug(_) → Logger.info(_) lib/pi/eval/snapshot.ex · limit 2 ·…
 ✓ No matches found.
```

The structure is Elixir AST. Captures, partial structs/maps, nested expressions, and broad-pattern guards are handled by ExAST, not a regex pretending to know Elixir. When a replacement matches, the same tool row renders semantic replacement counts and diff blocks in the expandable details.

### Run OTP-backed child agents without spawning more pi processes

BEAM sessions render as real pi session trees. This is captured from tmux; names/strings are sanitized only:

```text
 iex {:ok, root} = Pi.Session.start(name: :showcase); ...; :ok
 ✓ :ok


○ showcase
  3 done
  └─ ✓ tests done · done  70 passed
  └─ ✓ review done · done  LGTM
  └─ ✓ research done · done  notes ready
  (ctrl+o to expand)

~/my_app
↑17k ↓223 R16k CH96.4% $0.102 (sub) 6.3%/272k (auto)                                                                   (openai-codex) gpt-5.5 • medium
⬡ BEAM (embedded)
```

For real model-backed BEAM agents, the transcript shape is the same:

```text
 iex case Pi.Agent.parallel(["Review API", "Review tests"], name: :review_smoke, timeout: 60000) d…
 (70000ms)
 ✓ %{status: :ok, kind: :parallel, results: ["API ok", "tests ok"]}


✓ review_smoke
  2 done
  ├─ ✓ review_smoke  API ok
  └─ ✓ review_smoke  tests ok
  (ctrl+o to expand)
```

Active/running BEAM snapshots are widget-only. Completed root trees are sent once as transcript messages, so you do not get repeated live snapshot artifacts.

### Add project-specific Elixir knowledge

The startup screen shows `elixir-dev` / `elixir-new-project` as normal pi skills:

```text
[Skills]
  ... context-management, elixir-dev, elixir-new-project, ...

[Extensions]
  ... src, webfetch, websearch, ...
```

Your project can add executable Elixir skills and plugins. The main UX effect is that pi gets your release checklist, Oban conventions, Ecto rules, UI widgets, and slash commands as local trusted project behavior — not as generic prompt text.

## The model-facing tool surface

`pi-elixir` deliberately exposes only three model tools:

| Tool | Label | Purpose |
|---|---:|---|
| `elixir_eval` | `iex` | Trusted eval inside the running app. Stateful by default for pi session branches; sandbox mode available for untrusted snippets. |
| `elixir_ast_search` | `ast grep` | ExAST structural search over Elixir code. |
| `elixir_ast_replace` | `ast edit` | ExAST structural rewrite with dry-run diffs. |

Everything else is regular Elixir API reachable through eval:

```elixir
Pi.project()
Pi.logs(tail: 50)
Pi.Bridge.Info.runtime_apis()

Pi.Eval.bindings()
Pi.Eval.forget(:huge_result)
Pi.Eval.reset()

Pi.LLM.complete("Summarize this module")
Pi.LLM.stream("Draft a migration plan")
Pi.ReqLLM.install()

Pi.Session.start(name: :reviewer)
Pi.Agent.parallel(["Review API", "Review tests", "Review OTP risks"])
```

This keeps the transcript understandable: the model writes Elixir to control Elixir.

## Stateful eval and session-tree resume

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

When you navigate or resume a pi branch, the extension walks the session branch, finds the newest ancestor eval snapshot, and starts the next eval from that state. New evals write a new immutable checkpoint keyed by the tool call id, so old branch state is not overwritten.

Large or unsafe bindings are handled defensively:

- PIDs, ports, refs, functions, and containers containing them are not persisted.
- Live evaluator memory can hold runtime values while the bridge is active.
- Sidecar snapshots have a size budget and drop largest serializable bindings first.
- Metadata JSON contains only names/types/bytes, never the full state.

## Architecture

```text
pi Node/TUI
  ├─ TypeScript extension
  │  ├─ registers tools and skills
  │  ├─ starts embedded stdio by default, with explicit/discovered HTTP MCP escape hatches
  │  ├─ owns TUI rendering and sidecar eval-state paths
  │  └─ forwards lifecycle/tool events
  │
  └─ embedded or external BEAM
     ├─ Pi.Transport.Stdio / MCP endpoint
     ├─ Pi.Eval.Supervisor
     ├─ Pi.LLM.Broker
     ├─ Pi.Session.Supervisor
     ├─ Pi.Plugin.Manager
     ├─ Pi.Skill.Loader
     └─ project modules, deps, processes, Repo, endpoints
```

The BEAM side emits structured protocol payloads. The TS side renders them in pi style.

## Install

```sh
pi install npm:pi-elixir
```

When a Mix project needs embedded runtime access, pi asks before adding the exact dev-only Hex dependency:

```elixir
{:pi_bridge, "== 0.5.4", only: :dev}
```

The exact version matters: npm `pi-elixir` and Hex `pi_bridge` are released together and must speak the same protocol.

For local development:

```sh
git clone https://github.com/dannote/pi-elixir
cd pi-elixir
pnpm install
cd packages/bridge && mix deps.get && cd ../..
pi install "$PWD"
```

## Connection model

The normal connection path is an embedded stdio bridge started inside the Mix project with `Pi.Transport.Stdio.start()`. HTTP MCP endpoints are escape hatches for advanced/debug setups.

Resolution order:

1. `PI_MCP_URL`, only when explicitly configured for a manually exposed HTTP MCP endpoint.
2. Discovered local HTTP MCP endpoint matching the Mix app name.
3. Embedded stdio transport inside the project.

```sh
# Advanced/debug only: bypass embedded stdio and use your own HTTP MCP endpoint.
export PI_MCP_URL=http://localhost:4001/mcp
export PI_DISABLE_EMBEDDED=1
```

Status is actionable: external/embedded/starting/missing/incompatible/offline plus integration-specific status such as Phoenix endpoints.

## Included Elixir development skill

The package ships pi skills for Elixir work:

- `elixir-dev` — use BEAM eval for runtime introspection, ExAST tools for structural search/edit, LSP for editor semantics, and Mix only for build/test/format gates.
- `elixir-new-project` — bootstrap new Elixir packages/projects with strict VibeKit/Igniter-style quality setup.

The skill tells the agent how to work idiomatically: prefer runtime truth, inspect installed docs with `Code.fetch_docs/1`/`h/1`, use ExAST patterns for Elixir search/refactors before grep/regex, keep changes verified, and avoid inventing framework behavior.

## Quality stack

The release gate is intentionally strict. `pnpm run check` runs:

- TypeScript lint/typecheck/format/tests/duplication checks.
- BEAM compile with warnings as errors.
- ExUnit.
- Credo strict.
- Dialyzer.
- ExDNA clone detection with zero clone budget.
- Reach architecture and smell checks in strict mode.
- Hex package build validation.
- npm pack validation.

Reach and ExAST are not decorative dependencies. They are the direction: agentic Elixir coding should be semantic, structural, and architecture-aware.

## Debugging

Hidden pi command:

```text
/elixir:debug
```

Writes extension diagnostics to `~/.pi/agent/pi-elixir-debug.log` by default.

For event-loop/embedded bridge investigations:

```sh
export PI_ELIXIR_DEBUG=1
export PI_ELIXIR_DEBUG_LOG=/tmp/pi-elixir-debug.json
```

## Repository shape

```text
packages/
  extension/   # npm/pi package: TS extension, tools, skills, embedded stdio launcher
  bridge/      # Hex/Mix package: Pi runtime facade, protocol, eval, plugins, sessions
```

The npm package is the user-facing pi package. The Hex package is installed into target Mix projects as a dev-only bridge.

## Relationship to Vibe

[Vibe](https://github.com/elixir-vibe/vibe) is a BEAM-native coding-agent runtime. `pi-elixir` ports the most useful ideas into pi:

- minimal model-facing Elixir tools;
- Livebook-style eval state;
- structured BEAM payloads rendered by pi;
- executable Elixir skills;
- project-local plugins;
- OTP-backed child sessions;
- BEAM-first runtime inspection.

`pi-elixir` keeps pi's UI and tool model, but moves Elixir-specific work into the running BEAM: eval state, AST operations, sessions, skills, plugins, and runtime checks.

## Development

Prerequisites:

- pnpm
- Elixir `~> 1.20` with OTP 28+
- pi installed globally

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

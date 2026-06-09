# pi-elixir

BEAM runtime bridge for [pi](https://github.com/badlogic/pi-mono). `pi-elixir` lets pi talk to a running Mix project through a small model-facing tool surface while the Elixir side owns runtime semantics, project integrations, executable skills, plugins, and agent primitives.

## Relation to Vibe

`pi-elixir` is a proto-Vibe layer for pi:

- Vibe-style trusted executable skills are loaded from the project and surfaced to pi as resources.
- Vibe-style plugins run inside the BEAM and receive pi lifecycle/tool events.
- Vibe-style UI hooks let BEAM code update pi status, widgets, progress, and notifications.
- Vibe-style agents are represented by one abstraction, `Pi.Agent`; child agents/subagents are just sessions with `parent_id`.
- ReqLLM/pi-adapter work can build on the multiplexed `Pi.LLM` broker so many logical LLM/agent sessions share one pi ⇄ BEAM transport.

The package intentionally uses `Pi.*` modules even though the Mix package is named `:pi_bridge`.

## Repository shape

```text
packages/
  extension/   # npm/pi package: TypeScript extension, tools, skill resources, embedded stdio launcher
  bridge/      # Mix package: Pi runtime facade, stdio protocol, plugins, integrations, agents
```

## Install

```sh
pi install npm:pi-elixir
```

For local development, install the repository root. The root package is the pi/npm package and includes both the TypeScript extension and bundled `packages/bridge` Mix sources via npm's normal packlist rules:

```sh
git clone https://github.com/dannote/pi-elixir
cd pi-elixir
pnpm install
cd packages/bridge && mix deps.get && cd ../..
pi install "$PWD"
```

`pi list` should then show a package path ending in `pi-elixir`.

When the embedded BEAM side is needed and the target project lacks `:pi_bridge`, pi asks before editing `mix.exs` or running `mix deps.get`. The dependency is intentionally exact-versioned so the npm extension and Hex bridge speak the same protocol:

```elixir
{:pi_bridge, "== 0.5.3", only: :dev}
```

If an existing project has an older `pi_bridge`, the extension refuses the embedded connection and tells you which exact version to install.

## Connection model

The extension resolves a BEAM connection per project:

1. `PI_MCP_URL` external MCP endpoint, when explicitly configured.
2. Discovered local MCP endpoint matching the Mix app name.
3. Embedded stdio transport running `Pi.Transport.Stdio.start()` inside the project.

Status is kept actionable: external/embedded/starting/tools-missing/offline plus integration-specific status such as Phoenix ports.

```sh
export PI_MCP_URL=http://localhost:4001/mcp
export PI_DISABLE_EMBEDDED=1
```

## Debugging

`pi-elixir` follows pi core's snapshot-first debugging style. Run this hidden slash command from pi to write the current in-memory extension diagnostics:

```text
/elixir:debug
```

The snapshot is written to `~/.pi/agent/pi-elixir-debug.log` by default. For responsiveness investigations, enable automatic snapshots when event-loop lag is detected during an active turn:

```sh
export PI_ELIXIR_DEBUG=1
# or: export PI_ELIXIR_DEBUG=debug
# or: export PI_ELIXIR_DEBUG=verbose
export PI_ELIXIR_DEBUG_LOG=/tmp/pi-elixir-debug.json
```

Snapshots include recent lifecycle events, active turns, active diagnostic spans, hook timings, connection resolution phases, embedded BEAM startup/ready/error/exit details, bridge request timings, tool/plugin hook timings, and executable skill discovery timings. Values are compacted unless `PI_ELIXIR_DEBUG=verbose` is set.

## What is exposed to the model

The model-facing surface stays intentionally small:

| Tool | What it does |
|---|---|
| `elixir_eval` | Evaluate code inside the running app with project modules, deps, config, processes, and runtime state |
| `elixir_ast_search` | Search Elixir code by AST pattern |
| `elixir_ast_replace` | Rewrite Elixir code by AST pattern |

Everything richer is exposed as BEAM APIs callable from eval, discoverable through `Pi.Bridge.Info.runtime_apis/0` and the stdio `pi_apis` command.

## BEAM APIs

Useful entry points:

```elixir
Pi.project()
Pi.logs(tail: 50)
Pi.clear_logs()

Pi.Bridge.Info.snapshot()
Pi.Bridge.Info.runtime_apis()

Pi.LLM.complete("Summarize this module")
Pi.LLM.stream("Stream this response")
Pi.ReqLLM.generate_text("Use the active pi model")

Pi.Session.start(name: :reviewer)
Pi.Session.send_message("demo-message", count: 1)

Pi.Agent.run("Review this change", name: :reviewer)
Pi.Agent.parallel(["Review correctness", "Find missing tests"], name: :review)
```

`Pi.LLM` uses multiplexed request ids, so out-of-order concurrent responses route to the right caller. `Pi.Session` owns OTP-backed BEAM sessions/subagents; active work renders in a live widget and completed root session trees are sent back to pi as inline transcript entries. `Pi.ReqLLM` is conditionally available when ReqLLM is loaded and provides the Pi-backed ReqLLM entry point inside `pi_bridge`.

## Executable Elixir skills

Projects can add trusted executable skills under `priv/skills`, `.pi/skills`, or `skills` using `*.skill.exs` or `skill.exs`.

```elixir
defmodule MyApp.Skill.ReleaseChecklist do
  use Pi.Skill.Script

  skill do
    name "release-checklist"
    description "Project-specific release checks"
    markdown "Run the release checklist with access to runtime state."
  end
end
```

The bridge compiles these files in the project runtime and the extension materializes them as pi skill resources.

## Plugins and lifecycle events

Project plugins implement `Pi.Plugin` and are discovered from `priv/pi_plugins`, `.pi/plugins`, and `pi_plugins`.

```elixir
defmodule MyApp.PiPlugin do
  use Pi.Plugin

  def handle_event(%{"type" => "tool_result", "isError" => true}, state) do
    Pi.Plugin.UI.set_status(:tools, "tool error")
    {:noreply, state}
  end
end
```

Pi sends lifecycle/tool events such as `session_start`, `before_agent_start`, `turn_start`, `turn_end`, `tool_call`, and `tool_result` to BEAM.

## UI bridge

BEAM code can update pi UI through renderer-neutral events:

```elixir
Pi.Plugin.UI.set_status(:indexer, "indexing")
Pi.Plugin.UI.clear_status(:indexer)
Pi.Plugin.UI.set_progress(:import, title: "Importing", current: 3, total: 20)
Pi.Plugin.UI.set_widget(:metrics, ["Users: 42"], placement: :belowEditor)
Pi.Plugin.UI.clear_widget(:metrics)
Pi.Plugin.UI.notify("Import finished", type: :info)
```

## Integrations

Optional integrations are behaviour-discovered through `Pi.Integration`, not hardcoded. Built-ins currently include Phoenix, Ecto, Oban, and ExUnit when those modules are available.

```elixir
defmodule MyApp.PiIntegration do
  @behaviour Pi.Integration

  def name, do: :my_app
  def statuses, do: [%{key: :my_app, text: "ready"}]
  def endpoints, do: []
end
```

## Development

Prerequisites:

- pnpm
- Elixir `~> 1.20` with OTP 28+; CI uses Elixir `1.20.0-otp-28` on Ubuntu 24.04 for setup-beam compatibility
- pi installed globally

Common commands from the repo root:

```sh
pnpm run fmt
pnpm run check
pnpm run check:js
pnpm run check:beam
pnpm run test:integration
pnpm run pack:check
```

`pnpm run check` is the strict release-readiness gate. It runs JS lint/typecheck/format/tests/duplication, BEAM compile/test/Credo/Dialyzer/ExDNA, Reach architecture + smell checks in strict mode, and package pack validation.

Package-specific checks:

```sh
cd packages/extension
pnpm run check

cd ../bridge
mix ci
```

Local pi setup for contributors:

```sh
pi remove /path/to/pi-elixir || true
pi install /path/to/pi-elixir
pi list
```

The root `package.json` is the pi manifest. `packages/extension` is an internal workspace package for TypeScript checks; `packages/bridge` is included in the root npm package so embedded installs can use a local path dependency without custom copy scripts. `pnpm run pack:check` validates the package with pnpm's packlist API and `pnpm pack --dry-run --json`. Publishing requires an explicit version bump before tagging.

## Protocol contracts

Internal stdio envelopes use `JSONCodec` structs for stricter contracts:

- `Pi.Protocol.Call`
- `Pi.Protocol.Result`
- `Pi.Protocol.Request`
- `Pi.Protocol.Response`
- `Pi.Protocol.UIEvent`
- `Pi.Protocol.LLMChunk`
- `Pi.Protocol.LLMDone`
- `Pi.Protocol.LLMError`
- `Pi.Protocol.LLMCancel`
- `Pi.Protocol.APIModule`
- `Pi.Protocol.APIFunction`

JSON-lines is still the debug-friendly framing. The protocol is now structured so ETF/BERT or another length-prefixed encoding can replace the wire format later without changing the BEAM APIs.

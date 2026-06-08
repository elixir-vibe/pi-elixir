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

When the embedded BEAM side is needed and the target project lacks `:pi_bridge`, pi asks before editing `mix.exs` or running `mix deps.get`.

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

## What is exposed to the model

The model-facing surface stays intentionally small:

| Tool | What it does |
|---|---|
| `elixir_eval` | Evaluate code inside the running app with project modules, deps, config, processes, and runtime state |
| `elixir_ast_search` | Search Elixir code by AST pattern |
| `elixir_ast_replace` | Rewrite Elixir code by AST pattern |

Everything richer is exposed as BEAM APIs callable from eval, discoverable through `Pi.API.all/0` and the stdio `pi_apis` command.

## BEAM APIs

Useful entry points:

```elixir
Pi.project()
Pi.logs(tail: 50)
Pi.clear_logs()

Pi.Bridge.Info.snapshot()
Pi.API.all()

Pi.LLM.complete("Summarize this module")
Pi.Agent.async("Review this change", name: :reviewer)
Pi.Agent.parallel([
  [name: :reviewer, messages: [%{role: :user, content: "Review correctness"}]],
  [name: :tester, messages: [%{role: :user, content: "Find missing tests"}]]
])
```

`Pi.LLM` already uses multiplexed request ids, so out-of-order concurrent responses route to the right caller. The current extension has a placeholder `llm_complete` handler until pi exposes a raw active-model completion hook or `pi_adapter` supplies it.

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

## Protocol contracts

Internal stdio envelopes use `JSONCodec` structs for stricter contracts:

- `Pi.Protocol.Call`
- `Pi.Protocol.Result`
- `Pi.Protocol.Request`
- `Pi.Protocol.Response`
- `Pi.Protocol.UIEvent`
- `Pi.Protocol.APIModule`
- `Pi.Protocol.APIFunction`

JSON-lines is still the debug-friendly framing. The protocol is now structured so ETF/BERT or another length-prefixed encoding can replace the wire format later without changing the BEAM APIs.

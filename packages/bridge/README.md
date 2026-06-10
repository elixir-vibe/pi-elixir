# pi_bridge

BEAM runtime bridge for [pi](https://github.com/earendil-works/pi-coding-agent) and the [`pi-elixir`](https://github.com/dannote/pi-elixir) package. It provides the Elixir-side `Pi.*` modules used for Livebook-style stateful eval, ExAST-backed structural tools, stdio transport, executable Elixir skills, LLM calls through pi's active model, OTP-backed logical agents, and bidirectional plugin UI events.

`pi_bridge` is inspired by [Vibe](https://github.com/elixir-vibe/vibe): keep the model-facing surface small, but let trusted Elixir code operate from inside the running BEAM.

## Installation

```elixir
def deps do
  [
    {:pi_bridge, "== 0.5.4", only: :dev}
  ]
end
```

`pi_bridge` is intended for development-time agent tooling. The dependency is exact-versioned because the npm extension and Hex bridge are released together and share a stdio protocol.

## Public API ergonomics

The public API intentionally separates single-call and orchestration shapes:

- `Pi.LLM.complete/2` and `Pi.LLM.stream/2` are low-level model calls over the active pi session.
- `Pi.Session.start/1` creates a server-owned BEAM session process for OTP-backed agent/subagent work.
- `Pi.Agent.run/2` returns a single `%Pi.Agent.Result{}` and is backed by `Pi.Session` workers.
- `Pi.Agent.chain/2`, `Pi.Agent.parallel/2`, and `Pi.Agent.fanout/2` return `%Pi.Agent.Run{}` so partial results, kind, status, and errors are explicit.
- `Pi.Plugin` modules expose optional `init/1`, `handle_event/2`, `commands/0`, `handle_command/3`, `tool_call/3`, `tool_result/3`, `apis/0`, and `shutdown/1`; plugin process lifecycle is handled by `Pi.Plugin.Manager` and `Pi.Plugin.Supervisor`.
- `Pi.Plugin.api/1` registers API metadata at compile time and fills a default alias from the module name.
- `Pi.Plugin.command/1` registers BEAM plugin commands that the pi extension exposes as `/elixir:<name>` slash commands.
- `Pi.Plugin.Manager.load/2` and `unload/1` support dynamic plugin lifecycle changes.
- `Pi.Plugin.Waiters` provides an ETS-backed waiter registry for interactive plugins.
- `Pi.Plugin.Event.emit/2` publishes BEAM events onto pi's TypeScript extension event bus.
- `Pi.Session.info/1`, `active_tools/1`, `append_entry/3`, and `send_message/3` expose small host-session APIs back to BEAM code.

Boundary JSON examples are documented in [`docs/protocol.md`](docs/protocol.md).

## Eval

`Pi.Eval.run/2` is the trusted project introspection path. It evaluates inside the project BEAM with project modules, aliases, application config, OTP processes, Repo modules, and IEx helpers available.

Structured eval from the pi tool is stateful: bindings and `Macro.Env` are kept in a supervised evaluator and persisted as sidecar snapshots next to the pi session. That gives IEx/Livebook-like continuity across eval calls and resume/branch navigation without inlining large state into JSONL transcripts.

Useful eval helpers:

```elixir
Pi.Eval.bindings()
Pi.Eval.forget(:large_result)
Pi.Eval.reset()
```

QuackDB mirror analytics are available through token-efficient aliases in eval:

```elixir
# preloaded: import Ecto.Query; use QuackDB.Ecto
# preloaded: alias Pi.Self, as: Self
# preloaded: alias Pi.CodeMap, as: CodeMap
# preloaded: alias Pi.Quack, as: Q; require Q
# preloaded: alias Pi.Quack.Event, as: E; alias Pi.Quack.SessionFile, as: SF

Self.status()
Self.context("why did sync crash?", limit: 5)

# Reach-backed semantic reflection after edits.
CodeMap.reflect(changed: true)
CodeMap.hotspots(path: "lib/my_app/module.ex")
CodeMap.context("MyApp.Module.fun/2")

from(e in E,
  group_by: e.tool_name,
  order_by: [desc: count(e.id)],
  select: %{tool: e.tool_name, n: count(e.id)}
)
|> Q.table()
```

Use `Q.score/2`, `Q.matches/2`, `Q.json/2`, and `Q.json_text/2` inside normal QuackDB/Ecto queries for FTS and payload analysis.

For untrusted snippets, use the Dune-backed sandbox:

```elixir
{:ok, %{inspected: "42"}} = Pi.Eval.sandbox("40 + 2")

# Negative example: restricted system access is blocked.
{:error, message} = Pi.Eval.sandbox(~s(System.cmd("ls", [])))
```

The sandbox applies timeout, reduction, heap, and allowlist limits. It returns `{:error, :unavailable}` if the optional `:dune` dependency is not present.

## LLM

pi owns provider/model selection, credentials, streaming, cancellation, usage, and transcript UI. The BEAM side sends structured completion/stream requests over the active bridge; it does not create a separate provider stack.

```elixir
{:ok, text} = Pi.LLM.complete("Explain this module")

stream = Pi.LLM.stream("Draft a migration plan")
Enum.each(stream.stream, &IO.write/1)
```

ReqLLM can route through the active pi session as an adapter on top of that pi-owned model path:

```elixir
Pi.ReqLLM.install()
ReqLLM.generate_text("pi:current", "Summarize the current project")
```

ReqLLM may warn that `pi:current` is not in its public model catalog. That is expected: `pi:current` is a local provider/model route into the active pi session, not a hosted catalog model.

> **Feature flag:** `PI_ELIXIR_LLM=0` disables BEAM-initiated LLM requests.

## Sessions and agents

The bridge keeps one pi Node.js/TUI process and one embedded BEAM process. Subagents are not extra pi processes; they are lightweight OTP session workers supervised inside BEAM:

```text
pi Node.js/TUI
  └─ embedded BEAM
       ├─ Pi.LLM.Broker
       └─ Pi.Session.Supervisor
            ├─ Pi.Session.Worker
            └─ Pi.Session.Worker
```

Use `Pi.Session` when you need attachable, subscribable session state:

```elixir
{:ok, root} = Pi.Session.start(name: :root)
{:ok, reviewer} = Pi.Session.child(root, name: :reviewer)
{:ok, "done"} = Pi.Session.run(reviewer, "Review this change")

{:ok, state} = Pi.Session.subscribe(reviewer)
```

Session snapshots are emitted as `pi_session` events. The extension renders active/running work as a compact live widget, then emits completed root session trees once as inline transcript entries (`elixir-sessions`). Active BEAM snapshots are reloaded directly from the bridge on session start. Private slash commands control active sessions without adding model-facing tools. The TUI accepts either `id=session_123` or the raw `session_123` as the command argument:

```text
/elixir:sessions.cancel id=session_123
/elixir:sessions.rerun id=session_123
```

Snapshots carry structured fields such as prompt/response previews, current activity, recent streaming output, `run_count`, `completed_at`, and timing. Streaming session runs can emit `:delta` events before the final assistant message:

```elixir
{:ok, text} = Pi.Session.run(session, "Draft notes", stream: true)
```

> **Feature flag:** `PI_ELIXIR_SESSIONS=0` disables session snapshot/control affordances.

Use `Pi.Agent` for convenience orchestration over those sessions:

```elixir
{:ok, result} = Pi.Agent.run("Review this change", name: :reviewer)

{:ok, run} =
  Pi.Agent.chain([
    "Draft an implementation plan",
    "Review the plan for risks"
  ])

{:ok, fanout} = Pi.Agent.fanout(["Review tests", "Review API", "Review docs"])
```

`Pi.Agent.run/2` keeps the single-run shape `{:ok, %Pi.Agent.Result{}} | {:error, %Pi.Agent.Result{}}`. `chain/2`, `parallel/2`, and `fanout/2` return `{:ok, %Pi.Agent.Run{}} | {:error, %Pi.Agent.Run{}}` so orchestration metadata and partial results are explicit.

## Plugin command/event/hook lifecycle

1. On stdio startup, BEAM sends `ready` with plugin command inventory.
2. The TypeScript extension registers each plugin command as `/elixir:<name>`.
3. Running the slash command sends `pi_plugin_command` to BEAM and dispatches `handle_command/3`.
4. `Pi.Plugin.Event.emit/2` sends `{type: "event"}` back to pi and is published on `pi.events`.
5. Before a pi tool executes, the extension calls `pi_plugin_tool_call`; plugin `tool_call/3` may block or return an input-only patch.
6. After a pi tool result, the extension calls `pi_plugin_tool_result`; plugin `tool_result/3` may patch result `content` or `isError`.
7. Malformed hook payloads are rejected before plugin callbacks run.

## Session bridge APIs

BEAM code can ask the pi extension for small session-state snapshots, persist branch-aware custom entries, or emit a visible custom transcript message:

```elixir
{:ok, info} = Pi.Session.info()
{:ok, %{tools: tools}} = Pi.Session.active_tools()
{:ok, "ok"} = Pi.Session.append_entry("demo-state", count: 1)
{:ok, "ok"} = Pi.Session.send_message("demo-message", count: 1)
```

## Plugins

> **Feature flags:** `PI_ELIXIR_PLUGINS=0` disables built-in/project-local plugins, hooks, UI events, and plugin commands. `PI_ELIXIR_SKILLS=0` disables executable skill discovery.

Built-in optional plugins are loaded before project-local plugins. The built-in DuckDB event mirror (`Pi.Mirror.QuackDB`) is enabled by default; set `PI_ELIXIR_MIRROR=0` to disable it. By default it writes `~/.pi/elixir/session-mirror.duckdb`; override with `PI_ELIXIR_MIRROR_DB`, or point at an existing Quack server with `PI_ELIXIR_MIRROR_QUACKDB_URI` and `PI_ELIXIR_MIRROR_QUACKDB_TOKEN`.

Project-local plugins live in `priv/pi_plugins`, `.pi/plugins`, or `pi_plugins`. Each plugin is isolated behind a `Pi.Plugin.Worker` process.

```elixir
defmodule DemoPiPlugin do
  use Pi.Plugin

  def init(_opts), do: {:ok, %{events: 0}}

  def handle_event(_event, state), do: {:noreply, Map.update(state, :events, 1, &(&1 + 1))}

  command name: :demo, description: "Run the demo plugin command"

  def handle_command(:demo, args, state), do: {{:ok, "demo #{args}"}, state}

  # Negative example: block a tool call.
  # Return {:block, reason} to prevent a tool call, or {:ok, patch} to merge into the tool input only.
  def tool_call(%{"toolName" => "bash"}, _context, state), do: {{:block, "bash blocked"}, state}
  def tool_call(_call, _context, state), do: {:ok, state}

  # Return {:ok, patch} to patch a tool result. Supported TypeScript-side patches include
  # string `content` and boolean `isError`.
  def tool_result(%{"toolName" => "demo"}, _context, state) do
    {{:ok, %{"content" => "patched by plugin"}}, state}
  end

  def tool_result(_result, _context, state), do: {:ok, state}

  def apis do
    [name: :demo_plugin, module: __MODULE__, alias: :DemoPlugin]
  end
end
```

## Examples

See `examples/vibe_workflow.exs` and `examples/demo_plugin.exs`.

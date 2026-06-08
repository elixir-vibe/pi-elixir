# pi_bridge

BEAM runtime bridge for [pi](https://github.com/earendil-works/pi-coding-agent). It provides the Elixir-side `Pi.*` modules used by the pi-elixir extension for runtime eval, stdio transport, executable Elixir skills, LLM calls, logical agents, and bidirectional plugin UI events.

## Installation

```elixir
def deps do
  [
    {:pi_bridge, "~> 0.1", only: :dev}
  ]
end
```

`pi_bridge` is intended for development-time agent tooling.

## Public API ergonomics

The public API intentionally separates single-call and orchestration shapes:

- `Pi.LLM.complete/2` and `Pi.LLM.stream/2` are low-level model calls over the active pi session.
- `Pi.Agent.run/2` returns a single `%Pi.Agent.Result{}`.
- `Pi.Agent.chain/2`, `Pi.Agent.parallel/2`, and `Pi.Agent.fanout/2` return `%Pi.Agent.Run{}` so partial results, kind, status, and errors are explicit.
- `Pi.Plugin` modules expose optional `init/1`, `handle_event/2`, `commands/0`, `handle_command/3`, `tool_call/3`, `tool_result/3`, `apis/0`, and `shutdown/1`; plugin process lifecycle is handled by `Pi.Plugin.Manager` and `Pi.Plugin.Supervisor`.
- `Pi.Plugin.api/1` registers API metadata at compile time and fills a default alias from the module name.
- `Pi.Plugin.command/1` registers BEAM plugin commands that the pi extension exposes as `/elixir:<name>` slash commands.
- `Pi.Plugin.Manager.load/2` and `unload/1` support dynamic plugin lifecycle changes.
- `Pi.Plugin.Waiters` provides an ETS-backed waiter registry for interactive plugins.
- `Pi.Plugin.Event.emit/2` publishes BEAM events onto pi's TypeScript extension event bus.
- `Pi.Session.info/1`, `active_tools/1`, and `append_entry/3` expose small session-state APIs back to BEAM code.

Boundary JSON examples are documented in [`docs/protocol.md`](docs/protocol.md).

## Eval

`Pi.Eval.run/2` is the trusted project introspection path. It evaluates inside the project BEAM with project modules and aliases available.

For untrusted snippets, use the Dune-backed sandbox:

```elixir
{:ok, %{inspected: "42"}} = Pi.Eval.sandbox("40 + 2")
{:error, message} = Pi.Eval.sandbox(~s(System.cmd("ls", [])))
```

The sandbox applies timeout, reduction, heap, and allowlist limits. It returns `{:error, :unavailable}` if the optional `:dune` dependency is not present.

## LLM

```elixir
{:ok, text} = Pi.LLM.complete("Explain this module")

stream = Pi.LLM.stream("Draft a migration plan")
Enum.each(stream.stream, &IO.write/1)
```

ReqLLM can route through the active pi session:

```elixir
Pi.ReqLLM.install()
ReqLLM.generate_text("pi:current", "Summarize the current project")
```

ReqLLM may warn that `pi:current` is not in its public model catalog. That is expected: `pi:current` is a local provider/model route into the active pi session, not a hosted catalog model.

## Agents

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

## Plugins

Project-local plugins live in `priv/pi_plugins`, `.pi/plugins`, or `pi_plugins`. Each plugin is isolated behind a `Pi.Plugin.Worker` process.

```elixir
defmodule DemoPiPlugin do
  use Pi.Plugin

  def init(_opts), do: {:ok, %{events: 0}}

  def handle_event(_event, state), do: {:noreply, Map.update(state, :events, 1, &(&1 + 1))}

  command name: :demo, description: "Run the demo plugin command"

  def handle_command(:demo, args, state), do: {{:ok, "demo #{args}"}, state}

  def tool_call(%{"toolName" => "bash"}, _context, state), do: {{:block, "bash blocked"}, state}
  def tool_call(_call, _context, state), do: {:ok, state}

  def apis do
    [name: :demo_plugin, module: __MODULE__, alias: :DemoPlugin]
  end
end
```

## Examples

See `examples/vibe_workflow.exs` and `examples/demo_plugin.exs`.

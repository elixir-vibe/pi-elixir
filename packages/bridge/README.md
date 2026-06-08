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
- `Pi.Plugin` modules expose optional `init/1`, `handle_event/2`, and `apis/0`; plugin process lifecycle is handled by `Pi.Plugin.Manager` and `Pi.Plugin.Supervisor`.

Boundary JSON examples are documented in [`docs/protocol.md`](docs/protocol.md).

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

  def apis do
    [name: :demo_plugin, module: __MODULE__, alias: :DemoPlugin]
  end
end
```

## Examples

See `examples/vibe_workflow.exs` and `examples/demo_plugin.exs`.

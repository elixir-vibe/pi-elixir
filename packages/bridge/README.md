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

`Pi.Agent.Run` is the structured orchestration result for `chain/2`, `parallel/2`, and `fanout/2`.

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

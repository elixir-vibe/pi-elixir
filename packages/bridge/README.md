# pi_bridge

BEAM runtime bridge for [pi](https://github.com/earendil-works/pi-coding-agent). It provides the Elixir-side `Pi.*` modules used by the [pi-elixir extension](https://github.com/dannote/pi-elixir) for runtime eval, stdio transport, executable Elixir skills, and bidirectional plugin UI events.

## Installation

```elixir
def deps do
  [
    {:pi_bridge, "~> 0.1", only: :dev}
  ]
end
```

`pi_bridge` is intended for development-time agent tooling.

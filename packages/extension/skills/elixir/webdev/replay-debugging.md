# PhoenixReplay Debugging

Use PhoenixReplay only when it is installed. Check from eval:

```elixir
Code.ensure_loaded?(PhoenixReplay.Recordings)
```

## List recordings

```elixir
if Code.ensure_loaded?(PhoenixReplay.Recordings) do
  PhoenixReplay.Recordings.list_summaries()
else
  {:error, :phoenix_replay_not_loaded}
end
```

## Fetch a recording

```elixir
if Code.ensure_loaded?(PhoenixReplay.Recordings) do
  recording_id = PhoenixReplay.Recordings.list_summaries() |> List.first() |> Map.fetch!(:id)
  PhoenixReplay.Recordings.fetch!(recording_id)
else
  {:error, :phoenix_replay_not_loaded}
end
```

`%PhoenixReplay.Recording{}` includes:

```elixir
%PhoenixReplay.Recording{
  id: id,
  view: view,
  url: url,
  params: params,
  session: session,
  connected_at: connected_at,
  events: events
}
```

`events` entries are:

```elixir
{offset_ms, event_type, payload}
```

where `event_type` is `:mount`, `:event`, `:handle_params`, `:info`, or `:assigns`.

## Find where an assign changed

```elixir
assign_name = :count
recording_id = PhoenixReplay.Recordings.list_summaries() |> List.first() |> Map.fetch!(:id)
recording = PhoenixReplay.Recordings.fetch!(recording_id)

recording.events
|> Enum.with_index()
|> Enum.flat_map(fn {{offset_ms, type, payload}, index} ->
  assigns = Map.get(payload, :assigns) || Map.get(payload, "assigns") || %{}

  if type == :assigns and Map.has_key?(assigns, assign_name) do
    [%{index: index, offset_ms: offset_ms, assign: assign_name, value: Map.fetch!(assigns, assign_name)}]
  else
    []
  end
end)
```

Prefer outputs that include `index` and `offset_ms`; those are the repair witness.

## Timeline summary

```elixir
recording_id = PhoenixReplay.Recordings.list_summaries() |> List.first() |> Map.fetch!(:id)
recording = PhoenixReplay.Recordings.fetch!(recording_id)

recording.events
|> Enum.with_index()
|> Enum.map(fn {{offset_ms, type, payload}, index} ->
  keys = if is_map(payload), do: Map.keys(payload), else: []
  %{index: index, offset_ms: offset_ms, type: type, payload_keys: keys}
end)
```

## Re-render verification

LiveView templates are pure functions of assigns. When you can reconstruct assigns from a recording, render the target view with the project’s existing helpers or `Phoenix.LiveViewTest` helpers.

Do not use `phoenix_vapor` for this workflow yet. It currently pulls QuickBEAM compiler internals through its published dependency graph, which is not part of the stable webdev verification path.

Do not claim a replay-based fix is verified unless you name the recording, the event index or assign delta inspected, and the rendered output or failure you checked.

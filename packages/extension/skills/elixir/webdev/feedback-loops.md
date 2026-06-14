# Web Feedback Loops

Treat web work as verification work: check a witness before claiming success.

## First check: installed webdev packages

Start by asking the running BEAM which webdev packages are loaded. Keep this as an explicit eval check, not status-bar noise:

```elixir
%{
  phoenix?: Code.ensure_loaded?(Phoenix),
  live_view?: Code.ensure_loaded?(Phoenix.LiveView),
  volt?: Code.ensure_loaded?(Volt),
  quickbeam?: Code.ensure_loaded?(QuickBEAM),
  phoenix_replay?: Code.ensure_loaded?(PhoenixReplay),
  phoenix_iconify?: Code.ensure_loaded?(PhoenixIconify)
}
```

If a package is missing, verify the dependency and setup before using package-specific recipes below.

## Loop 1: browser console → BEAM logs → agent

When `volt` is installed, browser `console.*` messages are forwarded into Elixir `Logger` with a `[Volt][browser]` prefix. Inspect them with eval:

```elixir
if Code.ensure_loaded?(Volt.Dev.ConsoleForwarder) do
  Pi.logs(grep: "\\[Volt\\]\\[browser\\]", tail: 100)
else
  {:error, :volt_not_loaded}
end
```

Use this after JS, SFC, CSS, or HMR-sensitive edits. Prefer log output that carries the runtime error, stack, source, or component name over asking the user to reload and describe what happened.

## Loop 2: replay = typed UI ground truth

When `phoenix_replay` is installed, LiveView recordings contain event and assigns timelines:

```elixir
if Code.ensure_loaded?(PhoenixReplay.Recordings) do
  PhoenixReplay.Recordings.list_summaries()
else
  {:error, :phoenix_replay_not_loaded}
end
```

A recording event has this shape:

```elixir
{offset_ms, event_type, payload}
```

where `event_type` is one of `:mount`, `:event`, `:handle_params`, `:info`, or `:assigns`.

Fetch a recording before debugging UI state by guesswork:

```elixir
if Code.ensure_loaded?(PhoenixReplay.Recordings) do
  id = PhoenixReplay.Recordings.list_summaries() |> List.first() |> Map.fetch!(:id)
  PhoenixReplay.Recordings.fetch!(id)
else
  {:error, :phoenix_replay_not_loaded}
end
```

## Loop 3: render/check without a browser

Use package APIs directly from eval when present:

```elixir
%{
  iconify?: Code.ensure_loaded?(PhoenixIconify),
  oxide?: Code.ensure_loaded?(Oxide),
  vize?: Code.ensure_loaded?(Vize)
}
```

Then run the focused checks in `ui-verification.md`. A good verification output names the missing icon, missing Tailwind candidate, compile error, recording event index, or rendered HTML fragment.

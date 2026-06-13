# Volt Workflows

Use these only when `volt` is installed. Prefer projects installed with `mix igniter.install volt` on the current published line (`volt ~> 0.14`, resolving QuickBEAM `~> 0.10.15`). Verify first:

```elixir
Code.ensure_loaded?(Volt)
```

Volt runs frontend tooling in the app’s BEAM. Prefer eval and logs over shelling out to separate Node tools.

## Browser console after HMR

Volt forwards browser console messages to Logger with `[Volt][browser]` prefixes:

```elixir
if Code.ensure_loaded?(Volt.Dev.ConsoleForwarder) do
  Pi.logs(grep: "\\[Volt\\]\\[browser\\]", tail: 100)
else
  {:error, :volt_not_loaded}
end
```

After editing JS, CSS, or SFC files in a running app, check these logs before asking the user to reload. HMR may already have applied the change.

## Production build

```elixir
if Code.ensure_loaded?(Volt.Builder) do
  Volt.Builder.build([])
else
  {:error, :volt_not_loaded}
end
```

If it fails, preserve the file/line/message from the result or exception.

## JS lint

```elixir
files = ["assets/js/app.js"]

if Code.ensure_loaded?(Volt.JS.Check) do
  Volt.JS.Check.lint(files, [])
else
  {:error, :volt_not_loaded}
end
```

## JS formatting check

```elixir
files = ["assets/js/app.js"]

if Code.ensure_loaded?(Volt.JS.Check) do
  Volt.JS.Check.check_formatting(files)
else
  {:error, :volt_not_loaded}
end
```

## Tailwind build and rebuild

```elixir
if Code.ensure_loaded?(Volt.Tailwind) do
  Volt.Tailwind.build([])
else
  {:error, :volt_not_loaded}
end
```

For changed files:

```elixir
changed_files = ["lib/my_app_web/components/core_components.ex"]

if Code.ensure_loaded?(Volt.Tailwind) do
  Volt.Tailwind.rebuild(changed_files, [])
else
  {:error, :volt_not_loaded}
end
```

## Dev server awareness

`Volt.DevServer` is a Plug mounted inside the Phoenix endpoint; it is not a separate OS process or standalone port to poll. Report presence and runtime evidence, not invented status:

```elixir
%{
  volt?: Code.ensure_loaded?(Volt),
  dev_server?: Code.ensure_loaded?(Volt.DevServer),
  tailwind?: Code.ensure_loaded?(Volt.Tailwind)
}
```

If a UI issue appears after an edit, check console logs and run the relevant build/lint/format check. Do not claim success from compilation alone.

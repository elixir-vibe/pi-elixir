# UI Verification

Verify UI claims in eval when the relevant package is installed. Keep outputs concrete: missing icon name, missing Tailwind candidate, rendered fragment, or structured compile error.

## Icon existence

When `phoenix_iconify` is installed:

```elixir
icon = "lucide:settings"

if Code.ensure_loaded?(PhoenixIconify) do
  %{icon: icon, exists?: PhoenixIconify.icon_exists?(icon)}
else
  {:error, :phoenix_iconify_not_loaded}
end
```

Fetch the icon if needed:

```elixir
icon = "lucide:settings"

if Code.ensure_loaded?(PhoenixIconify) do
  PhoenixIconify.get_icon(icon)
else
  {:error, :phoenix_iconify_not_loaded}
end
```

Do not ship or claim an icon name works until `icon_exists?/1` returns true.

## Tailwind candidate extraction

When `oxide_ex` is installed:

```elixir
content = ~S(<div class="flex items-center gap-2 text-sm"></div>)

if Code.ensure_loaded?(Oxide) do
  Oxide.extract(content, "heex")
else
  {:error, :oxide_not_loaded}
end
```

For scanner flows:

```elixir
if Code.ensure_loaded?(Oxide) do
  scanner = Oxide.new(sources: ["lib/**/*.{ex,heex}"])
  Oxide.scan(scanner)
else
  {:error, :oxide_not_loaded}
end
```

Use this to answer “why is my class missing?” with the actual extracted or missing candidate string.

## Rendered HTML checks

Do not use `phoenix_vapor` for this workflow yet. Its published dependency graph currently pulls QuickBEAM compiler internals, which are experimental and not part of the stable webdev verification path.

Plain Phoenix projects can use their existing view/component render helpers from eval or `Phoenix.LiveViewTest` in tests. Prefer exact HTML fragments or assigns over screenshots.

## Real browser acceptance tests

Use `phoenix_test_playwright` when the user needs an actual browser: JavaScript behavior, cross-browser checks, traces, screenshots, iframe/email flows, or browser-only regressions. Do not make it the first/default verification path; prefer BEAM-native checks first (`Pi.Integrations.statuses()`, Volt browser logs, PhoenixReplay recordings, render/eval checks).

Setup, when explicitly needed:

```elixir
# mix.exs
{:phoenix_test_playwright, "~> 0.14", only: :test, runtime: false}
```

It also requires Playwright and browsers in `assets`:

```sh
cd assets
bun add -d playwright
bunx playwright install chromium --with-deps
```

Phoenix test config:

```elixir
# config/test.exs
config :phoenix_test, otp_app: :my_app
config :my_app, MyAppWeb.Endpoint, server: true
```

Runtime setup:

```elixir
# test/test_helper.exs
{:ok, _} = PhoenixTest.Playwright.Supervisor.start_link()
Application.put_env(:phoenix_test, :base_url, MyAppWeb.Endpoint.url())
```

Example:

```elixir
defmodule MyAppWeb.FeatureTest do
  use PhoenixTest.Playwright.Case, async: true

  test "home page", %{conn: conn} do
    conn
    |> visit(~p"/")
    |> assert_has("body .phx-connected")
  end
end
```

For debugging, prefer trace/screenshot evidence over prose. Example tags/config from the package docs include `@tag trace: :open` and CI retry with trace or screenshot enabled for failed tests.

## Vue SFC compile checks

When `vize_ex` is installed:

```elixir
source = """
<script setup>
const message = 'hello'
</script>

<template>
  <div>{{ message }}</div>
</template>
"""

if Code.ensure_loaded?(Vize) do
  Vize.compile_sfc(source)
else
  {:error, :vize_not_loaded}
end
```

Use structured compile errors as the witness. Do not report “the SFC is fixed” without compiling it.

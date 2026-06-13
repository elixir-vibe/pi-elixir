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

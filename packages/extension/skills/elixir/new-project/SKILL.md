---
name: elixir-new-project
description: Start or bootstrap a new Elixir project/package using Igniter and VibeKit conventions. Use when the user says to start a new package/project, mentions vibe_kit, VibeKit, Igniter, `mix igniter.new`, `mix igniter.install`, or asks to apply strict Elixir project quality setup.
---

# New Elixir Project with Igniter/VibeKit

Use this skill when creating or bootstrapping a new Elixir package/project.

## Default workflow

1. Inspect `/Users/dannote/Development/vibe_kit` for the current installer behavior before starting.
2. For Phoenix/web applications, use Phoenix first, then Igniter installers:

```sh
mix phx.new my_app
cd my_app
mix igniter.install vibe_kit --agents-md
mix igniter.install volt
mix igniter.install phoenix_replay phoenix_iconify
```

Use Phoenix + Igniter + VibeKit as the baseline. Add Volt with its Igniter installer; current published Volt should resolve to `volt ~> 0.14` and QuickBEAM `~> 0.10.15`, without the old `QuickBEAM.VM.Compiler.*` tree. `phoenix_replay` and `phoenix_iconify` are published packages. Current published releases install as dependencies through `mix igniter.install phoenix_replay phoenix_iconify` but emit missing-installer warnings for `phoenix_replay.install` and `phoenix_iconify.install`; this is expected. Apply the documented manual setup below after the deps are added.

Do not add `phoenix_vapor` to the default stack yet.

3. PhoenixReplay manual setup, when the installer only adds the dependency:

```elixir
# lib/my_app_web/router.ex
import PhoenixReplay.Router

live_session :default, on_mount: [PhoenixReplay.Recorder] do
  live "/dashboard", DashboardLive
end

scope "/" do
  pipe_through [:browser, :require_admin]
  phoenix_replay "/replay"
end
```

Mount `/replay` only behind an authenticated/admin pipeline because recordings can contain business data.

4. PhoenixIconify manual setup, when the installer only adds the dependency:

```elixir
# mix.exs
def project do
  [
    compilers: Mix.compilers() ++ [:phoenix_iconify]
  ]
end
```

```elixir
# lib/my_app_web.ex
defp html_helpers do
  quote do
    import PhoenixIconify, only: [icon: 1]
  end
end
```

5. For non-web Elixir projects/packages, prefer Igniter plus VibeKit:

```sh
mix igniter.new my_lib --install vibe_kit --agents-md
```

6. For an existing Mix project, apply VibeKit with:

```sh
mix igniter.install vibe_kit --agents-md
```

7. Use VibeKit's strict defaults unless the user requests otherwise:
   - `mix ci` alias
   - compile warnings as errors
   - tests
   - Credo strict with ExSlop
   - Dialyzer
   - ExDNA zero-clone budget
   - Reach architecture/smell checks

8. If the user says “see my vibe_kit package”, read at least:
   - `/Users/dannote/Development/vibe_kit/README.md`
   - `/Users/dannote/Development/vibe_kit/AGENTS.md`
   - `/Users/dannote/Development/vibe_kit/lib/vibe_kit/install.ex`

9. After creation or installation, run:

```sh
mix deps.get
mix ci
```

## Options to consider

Use only when appropriate or explicitly requested:

```sh
mix igniter.new my_lib --install vibe_kit --agents-md
mix igniter.new my_lib --install vibe_kit --claude-md
mix igniter.new my_lib --install vibe_kit --no-reach
mix igniter.new my_lib --install vibe_kit --no-ex-slop
mix igniter.new my_lib --install vibe_kit --no-strict-clones
```

## Rules

- Do not publish, tag, or create a GitHub repository unless explicitly requested.
- Preserve VibeKit installer idempotency expectations.
- Prefer changing VibeKit installer code with Igniter APIs over raw text edits.
- Keep generated project setup minimal and quality-gated.

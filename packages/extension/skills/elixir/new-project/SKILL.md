---
name: elixir-new-project
description: Start or bootstrap a new Elixir project/package using Igniter and VibeKit conventions. Use when the user says to start a new package/project, mentions vibe_kit, VibeKit, Igniter, `mix igniter.new`, `mix igniter.install`, or asks to apply strict Elixir project quality setup.
---

# New Elixir Project with Igniter/VibeKit

Use this skill when creating or bootstrapping a new Elixir package/project.

## Default workflow

1. Inspect `/Users/dannote/Development/vibe_kit` for the current installer behavior before starting.
2. For Phoenix/web applications, use Phoenix, then Igniter installers. Prefer the current published web stack unless the user asks otherwise:

```sh
mix phx.new my_app
cd my_app
mix igniter.install vibe_kit --agents-md
mix igniter.install volt
mix igniter.install phoenix_replay phoenix_iconify
```

`volt` has an Igniter installer and should resolve to the current Volt line (`~> 0.14`), which pulls QuickBEAM `~> 0.10.15` without the old `QuickBEAM.VM.Compiler.*` tree. `phoenix_replay` and `phoenix_iconify` are published packages; if their Igniter installers are unavailable, keep them as deps and apply their documented Phoenix router/live-session/compiler setup manually. Do not add `phoenix_vapor` to the default stack yet.

3. For non-web Elixir projects/packages, prefer Igniter plus VibeKit:

```sh
mix igniter.new my_lib --install vibe_kit --agents-md
```

4. For an existing Mix project, apply VibeKit with:

```sh
mix igniter.install vibe_kit --agents-md
```

5. Use VibeKit's strict defaults unless the user requests otherwise:
   - `mix ci` alias
   - compile warnings as errors
   - tests
   - Credo strict with ExSlop
   - Dialyzer
   - ExDNA zero-clone budget
   - Reach architecture/smell checks

5. If the user says “see my vibe_kit package”, read at least:
   - `/Users/dannote/Development/vibe_kit/README.md`
   - `/Users/dannote/Development/vibe_kit/AGENTS.md`
   - `/Users/dannote/Development/vibe_kit/lib/vibe_kit/install.ex`

6. After creation or installation, run:

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

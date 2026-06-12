---
name: elixir-new-project
description: Start or bootstrap a new Elixir project/package using Igniter and VibeKit conventions. Use when the user says to start a new package/project, mentions vibe_kit, VibeKit, Igniter, `mix igniter.new`, `mix igniter.install`, or asks to apply strict Elixir project quality setup.
---

# New Elixir Project with Igniter/VibeKit

Use this skill when creating or bootstrapping a new Elixir package/project.

## Default workflow

1. Inspect `/Users/dannote/Development/vibe_kit` for the current installer behavior before starting.
2. For Phoenix/web applications, use Phoenix plus VibeKit:

```sh
mix phx.new my_app
cd my_app
mix igniter.install vibe_kit --agents-md
```

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

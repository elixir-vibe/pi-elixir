# pi-elixir

BEAM runtime tools for [pi](https://github.com/badlogic/pi-mono). `pi-elixir` connects pi to the running Elixir application for live eval, runtime inspection, and structural Elixir code operations.

## Repository shape

```text
packages/
  extension/     # npm/pi package: TypeScript extension, tools, skill docs, embedded server launcher
  bridge/       # Mix package: Pi facade, eval runtime, stdio transport, optional MCP HTTP server
```

The npm package is still the user-facing install target. The `pi_bridge` Mix package is bundled by the extension and keeps Elixir runtime code in normal Mix/lib/test structure.

## Install

```sh
pi install npm:pi-elixir
```

Works with Phoenix apps, libraries, and other Mix projects. When a pi tool needs the embedded server and the project does not have Pi BEAM tools installed, pi asks for confirmation, adds a dev-only `:pi` dependency to `mix.exs`, runs `mix deps.get`, then starts the server.

## How it connects

The extension resolves the BEAM connection per project:

1. **External MCP endpoint** — use `PI_MCP_URL` when explicitly configured.
2. **Discovered MCP endpoint** — probes local dev ports and matches `project_name` to the `app:` in `mix.exs`.
3. **Embedded stdio transport** — starts `Pi.Transport.Stdio` in the project and sends line-delimited protocol messages over the child process pipes. If Pi BEAM tools are missing, the agent asks before editing `mix.exs` and running `mix deps.get`.

Status bar states:

| Status | Meaning |
|---|---|
| `⬡ BEAM` | Connected to an external/discovered BEAM MCP endpoint |
| `⬡ BEAM (embedded)` | Running the bundled embedded MCP server |
| `⬡ BEAM starting…` | Embedded transport is compiling/starting |
| `⬡ BEAM tools missing` | Project needs Pi BEAM setup before the embedded server can run |
| `⬡ BEAM offline` | No connection |

### Configuration

Override the connection URL:

```sh
export PI_MCP_URL=http://localhost:4001/mcp
```

Disable the embedded fallback:

```sh
export PI_DISABLE_EMBEDDED=1
```

## Executable Elixir skills

Projects can add trusted executable skills under `priv/skills`, `.pi/skills`, or `skills` using `*.skill.exs` or `skill.exs`. The BEAM loader compiles those files in the project runtime and the JS extension materializes them as temporary pi `SKILL.md` resources via `resources_discover`.

```elixir
defmodule MyApp.Skill.ReleaseChecklist do
  use Pi.Skill.Script

  skill do
    name "release-checklist"
    description "Project-specific release checks"
    markdown "Run the project release checklist and inspect app-specific runtime state."
  end
end
```

Executable skills are trusted local code. The bridge exposes their markdown as pi skill context; callable APIs are recorded in the generated skill document and stay available through Elixir eval for now.

## Bidirectional UI bridge

BEAM code can emit renderer-neutral UI events through the stdio transport:

```elixir
Pi.Plugin.UI.set_status(:indexer, "indexing")
Pi.Plugin.UI.set_progress(:import, title: "Importing", current: 3, total: 20)
Pi.Plugin.UI.set_widget(:metrics, ["Users: 42"], placement: :belowEditor)
Pi.Plugin.UI.notify("Import finished", type: :info)
```

The JS extension maps these to pi status, widgets, and notifications. Pi lifecycle events are sent back to BEAM and can be inspected with `Pi.Plugin.Event.recent/1`.

## Tools

`pi-elixir` intentionally keeps the model-facing tool surface small.

| Tool | What it does |
|---|---|
| `elixir_eval` | Evaluate code inside the running app with IEx helpers, project modules, deps, config, processes, and runtime state |
| `elixir_ast_search` | Search Elixir code by AST pattern instead of text/regex |
| `elixir_ast_replace` | Rewrite Elixir code by AST pattern instead of brittle text replacement |

Use `elixir_eval` for runtime work and `Pi.*` shortcuts when they provide bounded summaries or remove repetitive boilerplate. Use AST tools for Elixir syntax. Use LSP for editor semantics. Use shell for `git`, `mix`, and external CLIs.

## Runtime helper shape

The bundled `pi_bridge` package exposes `Pi` as an eval-friendly facade. It should stay thin:

- use Elixir/OTP stdlib directly for ordinary operations
- use `Pi.*` only for compact project/runtime summaries and repetitive introspection helpers
- use `Inspect` for arbitrary BEAM values instead of custom term serialization
- keep JS responsible for transport/tool registration, and BEAM responsible for Elixir semantics

Current helpers include:

```elixir
Pi.project()
Pi.logs(tail: 50)
Pi.clear_logs()
```

More helpers should be added only when they produce safer/better bounded output than obvious stdlib code.

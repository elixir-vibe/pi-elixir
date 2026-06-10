# pi-elixir

BEAM runtime tools for [pi](https://github.com/earendil-works/pi-coding-agent). `pi-elixir` connects pi to the running Elixir application for live eval, runtime inspection, and structural Elixir code operations. It brings ideas from [Vibe](https://github.com/elixir-vibe/vibe) into pi: compact tools, BEAM runtime truth, executable Elixir skills, project-local plugins, and OTP-backed subagents.

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

Works with Phoenix apps, libraries, monorepos with a nested Mix project, and other Mix projects. When a pi tool needs the embedded server and the project does not have Pi BEAM tools installed, pi asks for confirmation, adds a dev-only exact `:pi_bridge` dependency to `mix.exs`, runs `mix deps.get`, then starts the server:

```elixir
{:pi_bridge, "== 0.5.4", only: :dev}
```

The exact version is deliberate: the TypeScript extension and BEAM bridge are released together and must speak the same stdio protocol. If the installed `pi_bridge` version differs from the extension version, pi reports the mismatch and asks you to update the Mix dependency.

## How it connects

The normal path is embedded stdio. The extension starts `Pi.Transport.Stdio` in the Mix project and sends line-delimited protocol messages over the child process pipes. If Pi BEAM tools are missing, the agent asks before editing `mix.exs` and running `mix deps.get`.

HTTP MCP endpoints are advanced/debug escape hatches. Resolution order:

1. **Explicit HTTP MCP endpoint** — `PI_MCP_URL`, only when manually configured.
2. **Discovered HTTP MCP endpoint** — probes local dev ports and matches `project_name` to the `app:` in `mix.exs`.
3. **Embedded stdio transport** — default fallback inside the project.

Status bar states:

| Status | Meaning |
|---|---|
| `⬡ BEAM` | Connected to an external or discovered BEAM MCP endpoint, such as a Phoenix/Tidewave server whose `project_name` matches `mix.exs` `app:`. |
| `⬡ BEAM (embedded)` | Connected to the extension-owned stdio BEAM running `Pi.Transport.Stdio` inside this Mix project. |
| `⬡ BEAM starting…` | The embedded stdio process has been launched and is compiling/booting; retry the tool after it reaches ready. |
| `⬡ BEAM tools missing` | This Mix project does not yet depend on `:pi_bridge`; the first BEAM tool call can prompt to add the dev-only dependency and run `mix deps.get`. |
| `⬡ BEAM offline` | No BEAM connection is available: no matching external endpoint, embedded fallback disabled, not a Mix project, or embedded startup failed after tools were installed. |

### Configuration

Advanced/debug only: override the connection URL with a manually exposed HTTP MCP endpoint:

```sh
export PI_MCP_URL=http://localhost:4001/mcp
```

Disable the embedded fallback:

```sh
export PI_DISABLE_EMBEDDED=1
```

Feature flags are escape hatches:

| Capability | Default | Escape hatch |
|---|---:|---|
| Stateful `elixir_eval` | on | `PI_ELIXIR_STATEFUL_EVAL=0` |
| Eval sidecar snapshots | on | `PI_ELIXIR_EVAL_SIDECAR=0` |
| BEAM LLM / ReqLLM | on | `PI_ELIXIR_LLM=0` |
| BEAM sessions/widgets/control | on | `PI_ELIXIR_SESSIONS=0` |
| Project plugins/hooks/UI/commands | on | `PI_ELIXIR_PLUGINS=0` |
| Executable Elixir skills | on | `PI_ELIXIR_SKILLS=0` |
| Extra-short eval previews | off | `PI_ELIXIR_COMPACT_EVAL_PREVIEW=1` |

### Debugging

`pi-elixir` follows pi core's snapshot-first debugging style. Run this hidden slash command from pi to write the current in-memory extension diagnostics:

```text
/elixir:debug
```

The snapshot is written to:

```text
~/.pi/agent/pi-elixir-debug.log
```

For responsiveness investigations, enable automatic snapshots when the extension detects event-loop lag during an active turn:

```sh
export PI_ELIXIR_DEBUG=1
# or: export PI_ELIXIR_DEBUG=debug
```

Use verbose mode only when you need fuller diagnostic values:

```sh
export PI_ELIXIR_DEBUG=verbose
```

Override the snapshot path with:

```sh
export PI_ELIXIR_DEBUG_LOG=/tmp/pi-elixir-debug.json
```

Snapshots include the recent in-memory diagnostic ring, active turns, active diagnostic spans, lifecycle hook timings, connection resolution phases, embedded BEAM startup/ready/error/exit details, tool/plugin hook timings, bridge request handler timings, and executable skill discovery/materialization timings. Values are compacted by default; `PI_ELIXIR_DEBUG=verbose` keeps fuller diagnostic values.

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

## OTP sessions and subagents

`pi-elixir` keeps one pi Node/TUI process and one embedded BEAM process. Subagents are OTP sessions inside that BEAM, not extra pi processes:

```text
pi Node/TUI
  └─ embedded BEAM
       ├─ Pi.LLM.Broker
       └─ Pi.Session.Supervisor
            ├─ Pi.Session.Worker
            └─ Pi.Session.Worker
```

`Pi.Agent.parallel/2` and `fanout/2` run through child `Pi.Session` workers. Sessions emit `pi_session` snapshots over stdio. Active/running work appears in a compact below-editor widget; completed root session trees are rendered inline in the transcript so the result is part of conversation history rather than a permanent footer.

Rows are intentionally minimal and label-light:

```text
✗ edge_showcase
  1 done · 1 failed · 1 cancelled
  ├─ ✓ ok  passed
  ├─ ✗ fail failed  boom
  └─ ○ slow cancelled  wait forever
  (expand for details)
```

Expanded rows show useful semantic previews without redundant labels:

```text
✗ edge_showcase
  1 done · 1 failed · 1 cancelled
  ├─ ✓ ok  passed
  │  “happy path”
  │  started → llm → done · 0ms
  ├─ ✗ fail failed  boom
  │  “explode”
  │  started → llm → failed · 0ms
  └─ ○ slow cancelled  wait forever
     “wait forever”
     started → llm → cancelled · 20ms
```

The renderer uses pi keybinding hints from core helpers; it does not hardcode concrete shortcut names.

Private control commands are available for active sessions without adding model-facing tools. The TUI accepts either `id=session_123` or the raw `session_123` as the command argument:

```text
/elixir:sessions.cancel id=session_123
/elixir:sessions.rerun id=session_123
```

Active BEAM snapshots are widget-only and are reloaded directly from the bridge when the extension reconnects. Completed root session trees are sent once as pi custom messages named `elixir-sessions`, so completed results become part of transcript history without live-update artifacts. Snapshot payloads include prompt/response previews, timing, run count/version fields, live current activity, and recent streaming output so compact and expanded renderers do not parse text blobs.

## Bidirectional UI bridge

BEAM code can emit structured UI payloads through the stdio transport, and the TS extension renders them in pi:

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

Structured output helpers make eval results render nicely in pi while keeping values as ordinary Elixir data until the final step:

```elixir
Path.wildcard("lib/pi/**/*.ex")
|> Enum.map(&%{path: &1, bytes: File.stat!(&1).size})
|> Enum.sort_by(& &1.bytes, :desc)
|> Enum.take(8)
|> Pi.table(columns: [:path, :bytes])
```

Final eval values auto-render when their shape is known. Use `Pi.output/2` only when you want to force rendering options such as column order:

```elixir
Path.wildcard("lib/pi/**/*.ex")
|> Enum.map(&%{path: &1, bytes: File.stat!(&1).size})
|> Enum.sort_by(& &1.bytes, :desc)
|> Enum.take(8)
|> Pi.output(columns: [:path, :bytes])
```

Pass `:columns` when row data is map-based and the presentation order matters. Without it, columns are inferred from map keys.

```elixir
Pi.Bridge.Info.snapshot(:stdio).apis.runtime
|> Enum.map(fn api ->
  functions = Enum.map(api.functions, &"#{&1.name}/#{&1.arity}")
  %{
    api: api.name,
    module: inspect(api.module),
    total: length(functions),
    functions: Enum.take(functions, 5) |> Enum.join(", ")
  }
end)
|> Pi.table(columns: [:api, :module, :total, :functions])
```

Docs/source discovery is pipeline-first and auto-renders through the generic output protocol:

```elixir
Pi.Docs.module(Pi.Output)
|> Pi.Docs.functions()
|> Pi.Docs.search("table")
```

Use source slices when you want read-tool-like context for installed modules:

```elixir
Pi.Docs.module(Pi.Output)
|> Pi.Docs.function(:table, 2)
|> Pi.Docs.source(context: 25)
```

Use bounded web fetches when the result should stay typed/renderable and raw `Req` is too open-ended:

```elixir
Pi.Web.fetch!("https://example.com", format: :text)
```

More helpers should be added only when they produce safer/better bounded output than obvious stdlib code.

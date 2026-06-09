# Changelog

## Unreleased

## 0.5.4 - 2026-06-09

### Added

- BEAM session snapshots now carry activity metadata including last activity time, current activity start time, and turn count.
- BEAM session trees now show token/cost usage summaries and recursive nested child status aggregation.
- Added TUI/session debugging workflow notes for monitored tmux/asciinema playground runs.

### Changed

- Elixir tool call previews normalize multiline arguments into a single pi-style preview line.
- Completed BEAM session trees remain transcript-first while live/running snapshots stay widget-only.

### Fixed

- Removed repeated live `elixir-sessions` transcript entries that caused TUI artifacts during subagent startup.
- Fixed nested BEAM session summary branch alignment in compact trees.

## 0.5.3 - 2026-06-09

### Changed

- Improved extension import readability with runtime-safe `#src/*` package import aliases.

## 0.5.2 - 2026-06-09

### Added

- BEAM `llm_stream` routing through pi's active model with `llm_chunk`, `llm_done`, and `llm_error` delivery.
- Version alignment enforcement between the npm extension and installed `pi_bridge`; mismatches now tell users exactly which Mix dependency to install.
- Hex package build validation in the strict release gate.

### Changed

- Pi BEAM install prompts now prefer exact Hex dependencies like `{:pi_bridge, "== 0.5.2", only: :dev}` instead of leaking local checkout paths.
- BEAM session trees are width-aware and parallel child sessions use meaningful child labels.

### Fixed

- `pi_bridge` startup info now reports the bridge application version rather than the consuming Mix project version.

## 0.5.1 - 2026-06-09

### Added

- Hidden `/elixir:debug` command that writes a snapshot-style diagnostic dump to `~/.pi/agent/pi-elixir-debug.log`, following pi core's debugging style.
- `PI_ELIXIR_DEBUG=1|debug|verbose` responsiveness diagnostics, including automatic event-loop lag snapshots during active turns and optional verbose diagnostic values.
- Diagnostic timing spans for lifecycle hooks, connection resolution, embedded BEAM startup/ready/error/exit, bridge request handlers, plugin tool hooks, tool calls, and executable skill discovery/materialization.

### Changed

- Mix project resolution no longer recursively scans arbitrary nested directories from broad working directories; it now only accepts the current `mix.exs` or known bundled `packages/bridge/mix.exs` layout.

### Fixed

- Avoided extension hot-path filesystem traversal that could stall pi's Node event loop and delay interrupt handling when pi was launched from broad monorepo roots such as `~/Development`.

## 0.5.0 - 2026-06-09

### Added

- Root-level pnpm workspace/npm package metadata and pack validation so `pnpm pack` includes both the TypeScript extension and bundled `packages/bridge` sources without custom copy scripts.
- Strict JSONCodec protocol structs for stdio, MCP, LLM, API inventory, bridge info, integration status, and plugin/skill metadata.
- Namespaced protocol families: `Pi.Protocol.API.*`, `Pi.Protocol.MCP.*`, `Pi.Protocol.LLM.*`, and `Pi.Protocol.Integration.*`.
- `Pi.LLM` complete/stream APIs over the active pi stdio session.
- ReqLLM adapter/provider route for `pi:current`.
- `Pi.Agent.Run` for structured chain/parallel/fanout orchestration results.
- `Pi.Agent.Messages` normalization using `Pi.Protocol.LLM.Message`.
- Supervised plugin lifecycle with `Pi.Plugin.Supervisor`, `Pi.Plugin.Manager`, and isolated `Pi.Plugin.Worker` processes.
- Vibe-inspired plugin API macro, default API aliases, dynamic load/unload, shutdown callback, and `Pi.Plugin.Waiters`.
- Dune-backed `Pi.Eval.Sandbox`, `Pi.Eval.sandbox/2`, and `elixir_sandbox_eval` for restricted untrusted Elixir snippets.
- BEAM-to-pi event bus publishing with `Pi.Plugin.Event.emit/2`.
- BEAM plugin slash commands exposed as `/elixir:<name>` commands.
- BEAM session APIs for info, active tools, append-entry persistence, and visible custom transcript messages.
- Plugin `tool_call/3` and `tool_result/3` hooks for blocking or patching tool execution.
- Dedicated `elixir-new-project` skill for Igniter/VibeKit project bootstrapping.
- Executable skill and plugin examples plus a demo fixture Mix project.
- Extension-owned stdio smoke tests covering ready info, LLM completion, and streaming.
- Protocol JSON examples in `packages/bridge/docs/protocol.md` with tests covering the documented shapes.
- Transcript-first OTP session rendering with compact/expanded BEAM session trees, edge-state handling, and live streaming previews.

### Changed

- Bridge internals now prefer structs over ad-hoc protocol maps.
- Tests now mirror source tree structure more closely.
- Extension TypeScript protocol shapes now live in `src/protocol/types.ts`.
- Extension session code is split under `src/sessions/*` and bridge helpers under `src/bridge/*`, including plugin tool hook handling.
- Integration tests default to `packages/fixtures/demo_project` instead of the bridge package itself.
- Elixir skills are organized under `skills/elixir/*` while keeping stable skill names.
- `Pi.Protocol.Session.Snapshot` now includes prompt/response previews, run count, completion time, current activity, and recent output fields; streaming snapshots report `current: "streaming"` while output is arriving.
- `Pi.Session.append_entry/3` and `send_message/3` now accept keyword data for ergonomic Elixir call sites.

### Fixed

- Mix projects without `:pi_bridge` are now shown as `BEAM tools missing` instead of starting a doomed embedded BEAM and getting stuck offline.
- Monorepo roots such as `pi-elixir` now resolve nested Mix projects for BEAM status and tools.
- `elixir_eval` exceptions now return tool errors instead of successful text payloads.
- AST tool scripts now report missing `ex_ast` as normal tool output instead of eval exceptions.
- LLM stream completion now halts immediately on `llm_done` instead of timing out.
- Stdio stream events are routed through `Pi.LLM.Broker` to the stream owner process.
- Malformed stdio protocol payloads are ignored without crashing the transport loop.

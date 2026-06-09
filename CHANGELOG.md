# Changelog

## Unreleased

### Added

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
- Extension session code is split under `src/sessions/*` and bridge helpers under `src/bridge/*`.
- Integration tests default to `packages/fixtures/demo_project` instead of the bridge package itself.
- Elixir skills are organized under `skills/elixir/*` while keeping stable skill names.
- `Pi.Protocol.Session.Snapshot` now includes prompt/response previews, run count, completion time, current activity, and recent output fields.
- `Pi.Session.append_entry/3` and `send_message/3` now accept keyword data for ergonomic Elixir call sites.

### Fixed

- Mix projects without `:pi_bridge` are now shown as `BEAM tools missing` instead of starting a doomed embedded BEAM and getting stuck offline.
- Monorepo roots such as `pi-elixir` now resolve nested Mix projects for BEAM status and tools.
- `elixir_eval` exceptions now return tool errors instead of successful text payloads.
- AST tool scripts now report missing `ex_ast` as normal tool output instead of eval exceptions.
- LLM stream completion now halts immediately on `llm_done` instead of timing out.
- Stdio stream events are routed through `Pi.LLM.Broker` to the stream owner process.
- Malformed stdio protocol payloads are ignored without crashing the transport loop.

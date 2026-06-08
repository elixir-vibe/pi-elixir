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
- Executable skill and plugin examples plus a demo fixture Mix project.
- Extension-owned stdio smoke tests covering ready info, LLM completion, and streaming.
- Protocol JSON examples in `packages/bridge/docs/protocol.md`.

### Changed

- Bridge internals now prefer structs over ad-hoc protocol maps.
- Tests now mirror source tree structure more closely.
- Extension TypeScript protocol shapes now live in `src/protocol/types.ts`.
- Integration tests default to `packages/fixtures/demo_project` instead of the bridge package itself.

### Fixed

- LLM stream completion now halts immediately on `llm_done` instead of timing out.
- Stdio stream events are routed through `Pi.LLM.Broker` to the stream owner process.
- Malformed stdio protocol payloads are ignored without crashing the transport loop.

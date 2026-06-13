# Changelog

## Unreleased

## 0.6.15 - 2026-06-13

### Added

- Discover executable skills shipped by dependency packages under app `priv/skills` directories.
- Added webdev skill guidance for integration health checks and optional PhoenixTestPlaywright browser acceptance tests.
- Added integration coverage for installer progress, rollback, and Hex network failures.

### Changed

- Bridge installation now streams `mix deps.get` progress and rolls back `mix.exs` if dependency fetching fails.
- Hex network failures during bridge install now include retry guidance.

## 0.6.14 - 2026-06-13

### Added

- Added an `elixir-webdev` skill for Phoenix/LiveView UI workflows, Volt feedback loops, replay debugging, and UI verification.
- Added Volt, PhoenixReplay, and PhoenixIconify integration status badges.

### Changed

- Updated new-project guidance for Phoenix + Igniter + VibeKit apps with Volt, PhoenixReplay, and PhoenixIconify setup.

## 0.6.13 - 2026-06-12

### Changed

- Elixir tools now wait briefly for an embedded BEAM that is still starting before returning the compiling guidance.
- Reduced optional compile warning noise for ReqLLM and Reach/Makeup integrations.

## 0.6.12 - 2026-06-12

### Changed

- Automatic `pi_bridge` installs now default `mix deps.get` to `HEX_HTTP_CONCURRENCY=1` to reduce first-run Hex fetch flakiness while preserving explicit user settings.

## 0.6.11 - 2026-06-12

### Added

- Non-interactive Elixir tool calls can install the dev-only `pi_bridge` dependency automatically, with `PI_ELIXIR_AUTO_INSTALL=0` as an opt-out.
- `Pi.CodeMap.context/2` now returns module-level context for module targets, including macro-heavy modules such as Phoenix routers.

## 0.6.10 - 2026-06-12

### Changed

- Updated the bridge lockfile to Reach 2.7.4 so module-only CodeMap context requests fail gracefully instead of crashing in Reach target resolution.
- Updated ExDNA to 1.5.3 and extracted shared eval output helpers to keep the strict clone budget at zero.

## 0.6.9 - 2026-06-12

### Added

- Documented the recommended project stack: Phoenix + Igniter + VibeKit for web apps, and Igniter + VibeKit for other Elixir projects.

### Fixed

- Structured tree output now handles nested structs, fixing `Self.status()` rendering when bridge plugin commands are present.

## 0.6.8 - 2026-06-12

### Fixed

- Avoid stale extension context crashes from late embedded startup notices after session replacement or shutdown.

## 0.6.7 - 2026-06-12

### Added

- `/elixir:doctor` and `/elixir:install` commands for setup diagnostics and explicit per-project bridge installation.
- Manual tmux/asciinema setup-flow coverage for non-Mix directories, missing bridge dependency, wrong Elixir startup failures, happy path tools, and duplicate package conflicts.

### Changed

- Local dogfood install now removes the published npm package first to avoid duplicate tool registration.
- QuackDB mirror defaults to `localhost` for the client URI to match the server endpoint.

### Fixed

- Embedded stdio tool dispatch now returns logged error results for BEAM-side crashes instead of silently timing out.
- Embedded startup failures now surface stderr in doctor output and clear stale unavailable state after successful restarts.
- Integration smoke avoids unnecessary `mix deps.get` when fixture dependencies are already present.

## 0.6.6 - 2026-06-11

### Added

- Reach-backed `Pi.CodeMap` / preloaded `CodeMap` for semantic project maps, target context, callers/callees, smells, and post-edit `CodeMap.reflect/1` workflows.
- Supervised BEAM agent jobs via `Pi.Agent.start/2`, `Pi.Agent.await/2`, `Pi.Agent.result/1`, `Pi.Agent.cancel/1`, and `Pi.Agent.run_many/2`.
- Parent-visible BEAM agent job lifecycle events in session snapshots and the extension session renderer.
- Lightweight embedded stdio integration smoke in the default release gate.

### Changed

- Split host pi session RPC helpers into `Pi.Host`, keeping `Pi.Session` focused on BEAM runtime sessions.
- Switched ReqLLM examples and helpers to `Pi.ReqLLM.current_model/0` instead of the legacy `"pi:current"` string.
- Split extension renderers by domain while keeping the existing renderer barrel for compatibility.
- Elixir development guidance now requires `CodeMap.reflect(changed: true)` after non-trivial Elixir edits when Reach is available.

### Fixed

- Preserved labels for named Elixir AST searches across the JSON boundary.
- Captured automatic `mix deps.get` output and surfaced it only on failure instead of leaking install noise into the TUI.
- Hardened Elixir tool availability outside Mix projects and when Elixir/Mix is missing from `PATH`.
- Added abort cleanup and a hard timeout for embedded BEAM tool calls so stuck calls do not hang forever.
- Precompiled the fixture project in the stdio smoke setup so cold CI compile time is not counted as bridge startup time.

## 0.6.5 - 2026-06-10

### Added

- Eval self-introspection facade via `Pi.Self` / preloaded `Self` with bridge status, eval bindings, QuackDB mirror status, active sessions, plugin/skill inventory, and session-history recall helpers.
- `Pi.Quack.status/0` for compact QuackDB mirror counts and database metadata.
- Documentation and skill prompts for `Self.status/0`, `Self.quack/0`, `Self.bindings/0`, `Self.sessions/0`, and `Self.context/2`.

## 0.6.4 - 2026-06-10

### Added

- Structured eval output helpers: `Pi.table/2`, `Pi.tree/2`, `Pi.code/3`, `Pi.text/2`, and `Pi.Output`.
- Automatic pi-native eval rendering for list-of-map tables and map trees.
- Humane dogfood reload commands: `/elixir:restart` and `/elixir:refresh`.
- Eval-callable development helpers via `Pi.Dev` / `Dev`: `status/0`, `compile/1`, `reload/1`, `loaded/1`, `restart/1`, and `refresh/1`.
- Embedded stdio integration coverage for `Dev.status/0`, `Dev.compile/0`, and typed eval file pipelines.

### Changed

- Elixir skill guidance now frames `elixir_eval` as a typed Elixir shell for runtime, docs, and structured file workflows.

## 0.6.3 - 2026-06-10

### Changed

- Keep the Elixir/BEAM connection footer quiet during healthy or background startup states.
- Report Elixir setup failures as session-history notices instead of persistent footer status.
- Read the extension package version from disk at runtime to avoid stale JSON import cache after dogfood reloads.

### Fixed

- Incompatible `pi_bridge` dependency errors now remain native tool errors so pi renders the tool block with the error background.

## 0.6.2 - 2026-06-10

### Changed

- Release from the configured npm trusted publisher workflow so npm and Hex versions are aligned again.

## 0.6.1 - 2026-06-10

### Changed

- Publish workflow now relies on npm trusted publishing instead of passing an empty npm auth token.

### Fixed

- Eval error rendering now uses structured BEAM exception metadata for compact inline origins and expanded stack frames.
- `elixir_eval` failures now reliably drive pi's native tool error state.

## 0.6.0 - 2026-06-10

### Added

- Stateful Livebook-style `elixir_eval` sessions with persisted sidecar snapshots for bindings and eval environment across pi resume/branch navigation.
- Eval state helpers: `Pi.Eval.bindings/0,1`, `Pi.Eval.reset/0,1`, and `Pi.Eval.forget/1,2`.
- First-class ExAST dependency for structural Elixir search and rewrite tools.
- BEAM/extension feature flags for stateful eval, eval sidecars, LLM bridge requests, BEAM sessions, plugins, executable skills, and compact eval previews.
- `Pi.Features.gate/2` DSL for BEAM-side feature-gated code paths.

### Changed

- README and package docs now position stdio as the default transport and `PI_MCP_URL` as an advanced/debug escape hatch.
- Docs now explicitly describe pi-owned LLM handling with `Pi.ReqLLM` as an adapter over pi's active model path.
- Normal JS unit tests exclude integration tests; `pnpm --dir packages/extension run test:integration` runs embedded stdio/MCP integration tests explicitly.
- Repository metadata and docs now point to `elixir-vibe/pi-elixir`.
- Elixir development skill guidance now strongly prefers ExAST for Elixir code-shape search/refactors and BEAM docs APIs for installed module/function docs.

### Fixed

- Eval sidecar restore now uses safe binary decoding with a reduced safe snapshot representation instead of deserializing raw `Macro.Env` terms.
- Added regression coverage for restoring eval sidecar snapshots after evaluator restart.

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

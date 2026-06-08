# Changelog

## 0.3.0

### New

- **AST pattern search and replace** — `elixir_ast_search` and `elixir_ast_replace` tools powered by [ExAST](https://hex.pm/packages/ex_ast). Search and replace Elixir code by structure, not text. Variables capture, `_` is a wildcard, structs match partially. Requires `ex_ast` as a project dependency.
- **GitHub Actions CI** — lint, format, vitest, Elixir script tests

## 0.2.0

### New

- **ETS table inspector** — list all tables sorted by memory/size, inspect contents with Erlang match patterns
- **OS-assigned ports** — embedded server uses port 0 instead of a fixed range, eliminating collisions between concurrent pi sessions

### Fixed

- **Wrong-server bug** — native discovery no longer falls back to a mismatched project's server when app name doesn't match
- **sup_tree crash** on library projects without an OTP supervision tree

### Changed

- **Elixir code extracted to `.exs` files** — tool scripts (top, process_info, sup_tree, deps_tree, types, ets) are standalone Elixir files with proper syntax highlighting and editor support
- **Codebase split into modules** — `index.ts` (993→79 lines), 13 individual tool files, shared helpers and renderers
- **73 tests** — 58 vitest (unit + integration against a real embedded server), 15 ExUnit for Elixir tool scripts
- **Tooling** — oxlint, oxfmt, vitest

## 0.1.0

Initial release.

- **12 BEAM introspection tools**: eval, docs, source, SQL, logs, hex search, schemas, supervision tree, process top, process info, dependency tree, type specs
- **Auto-connect** to running BEAM MCP endpoints (probes localhost:4000–4009, matches by app name)
- **Embedded MCP server** starts automatically for any Elixir project — no config or deps needed. Uses Bandit/Plug when available (Phoenix), falls back to a zero-dep OTP gen_tcp server (libraries)
- **Syntax highlighting** for Elixir output, SQL results, docs, and logs in the TUI
- **Skill** that teaches the agent BEAM introspection patterns (runtime module discovery, Ecto schema introspection, process state, Phoenix routes, OTP supervision trees, AST manipulation)

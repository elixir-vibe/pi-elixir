# Workflow and Verification

1. Inspect runtime/source with `elixir_eval`, AST tools, LSP, and `read`.
2. Make focused edits with `edit`/`write`.
3. Verify narrowly first:
   - `mix test test/path.exs:line`
   - `mix test --failed`
   - `mix compile`
4. Run formatting:
   - `mix format`
5. For final gates, use the project’s aliases (`mix ci`, `mix check`, etc.) when present.
6. If validation fails, inspect the failure details and iterate. Do not rerun blindly just to rediscover the same error.

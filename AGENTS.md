# Agent Notes

## Releases

When releasing a new tagged version:

1. Bump all package versions together and update `CHANGELOG.md`.
   - Root `package.json` version and `packages/bridge/mix.exs` `:pi_bridge` version must match exactly.
   - The extension intentionally installs/checks an exact Hex dependency such as `{:pi_bridge, "== X.Y.Z", only: :dev}`.
2. Run `pnpm run check`.
   - This includes JS checks, BEAM `mix ci`, Hex package build validation, npm pack validation, and a version-alignment guard.
3. Commit the bump, tag `vX.Y.Z`, and push the commit and tag.
4. Confirm the Publish GitHub Actions workflow succeeds and publishes both:
   - `pi_bridge` to Hex.
   - `pi-elixir` to npm.
5. Manually create the GitHub Release for the tag with release notes from `CHANGELOG.md`.

The current publish workflow publishes npm and Hex packages, but it does not create GitHub Releases automatically.

## Local dogfooding

For local development, start pi with the checkout extension directly:

```bash
pnpm dogfood
```

This bypasses package discovery and the last published npm package. Use it as the default way to develop `pi-elixir` with `pi-elixir` itself. Pass normal pi args directly after the script name, for example:

```bash
pnpm dogfood --model openai/gpt-5.5 --thinking high
pnpm dogfood --continue
pnpm dogfood "initial prompt"
```

If you are already inside pi with a new-enough `pi-elixir` extension loaded, run:

```text
/elixir:dogfood
```

That installs the current checkout with `pi install .` and reloads pi.

Optional helpers:

```bash
pnpm run dogfood:install # add this checkout to pi package settings
pnpm run dogfood:smoke   # non-interactive version smoke; should print current pi_bridge version
```

If BEAM status shows offline, call `elixir_eval` once and check for a version mismatch. A mismatch like “extension expects 0.5.x” means the current TUI is still running an old installed extension instance. If `dogfood:smoke` returns the current version but the TUI still says offline, investigate the status widget/startup path rather than the bridge itself.

From the repo root, the extension should resolve the nested Mix project at `packages/bridge/mix.exs` and start embedded stdio there. Manual bridge smoke:

```bash
cd packages/bridge
mix run --no-halt -e 'Pi.Transport.Stdio.start()'
```

## Checks and integration tests

`pnpm run check` is the normal release gate. JS unit tests intentionally exclude `packages/extension/test/integration/**` for speed; run the integration suite explicitly when touching embedded stdio, MCP HTTP routing, resolver behavior, or fixture-project startup:

```bash
pnpm --dir packages/extension run test:integration
```

## Feature flags

Feature flags are defaults-on escape hatches for noisy, sensitive, or experimental environments:

- `PI_ELIXIR_STATEFUL_EVAL=0` — make `elixir_eval` stateless.
- `PI_ELIXIR_EVAL_SIDECAR=0` — keep eval state in memory only; do not write sidecar snapshots.
- `PI_ELIXIR_LLM=0` — disable BEAM-initiated `Pi.LLM` / `Pi.ReqLLM` requests.
- `PI_ELIXIR_SESSIONS=0` — disable BEAM session widgets/control affordances.
- `PI_ELIXIR_PLUGINS=0` — disable project-local plugins, hooks, UI events, and commands.
- `PI_ELIXIR_SKILLS=0` — disable executable Elixir skill discovery.
- `PI_ELIXIR_COMPACT_EVAL_PREVIEW=1` — force extra-short one-line eval previews.

When adding BEAM-side feature checks, prefer the call-site DSL:

```elixir
require Pi.Features

Pi.Features.gate :llm do
  # feature body
end
```

## Debugging TUI/session issues

When investigating interactive TUI artifacts, do not run `pi` as a long unattended foreground command. Use a monitored playground:

1. Create a temporary Mix project and depend on the local bridge by path. Prefer a variable for the repository root, not a user-specific absolute path:
   ```bash
   export PI_ELIXIR_REPO=$(git rev-parse --show-toplevel)
   ```
   ```elixir
   {:pi_bridge, path: System.fetch_env!("PI_ELIXIR_REPO") <> "/packages/bridge", only: :dev}
   ```
   Or write the resolved path into the temp project's `mix.exs` from a script using `$REPO/packages/bridge`.
2. Run pi inside `tmux` with an isolated session directory and asciinema recording:
   ```bash
   REPO=$(git rev-parse --show-toplevel)
   PI_OFFLINE=1 \
   PI_ELIXIR_DEBUG=1 \
   PI_CODING_AGENT_SESSION_DIR=/tmp/pi-elixir-smoke-sessions \
   asciinema rec -q -c "pi --approve --no-context-files --extension '$REPO/packages/extension/src/index.ts' --tools elixir_eval \"$(cat prompt.txt)\"" /tmp/pi-elixir-smoke.cast
   ```
3. Poll the tmux pane every few seconds while the scenario runs:
   ```bash
   tmux capture-pane -t <session-name> -p -S -80
   ```
4. After the run, inspect both artifacts:
   - The `.cast` file for frame-by-frame TUI rendering/ANSI artifacts.
   - The JSONL file under `PI_CODING_AGENT_SESSION_DIR` for persisted transcript entries.

Expected BEAM session behavior:
- Live/running BEAM session snapshots should be widget-only.
- Completed root session trees should persist as a single `custom_message` with `customType: "elixir-sessions"`.
- There should not be repeated live `type: "custom"` entries for `elixir-sessions`.
- Complex session trees should show compact status and usage summaries, e.g. `2 done · 1 failed · ↑2.0k ↓400 $0.005`.

Useful playground scenarios:
- Parallel children completing at staggered times.
- Nested groups with mixed success/failure/cancelled children.
- Streaming children that emit `recentOutput`.
- Width-constrained panes to check truncation and branch guide alignment.

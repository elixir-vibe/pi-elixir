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

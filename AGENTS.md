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

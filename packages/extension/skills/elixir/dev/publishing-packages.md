# Publishing Elixir packages

Use this guidance whenever the user asks to release, publish, ship, or update a Hex package.

## Non-negotiable release rules

- Do **not** add arbitrary links to GitHub release notes. In particular, do not add HexDocs links, Hex package links, marketing links, or generated URLs unless the user explicitly asks for them.
- Do **not** create or edit GitHub releases unless the user explicitly asks for a GitHub release. Publishing to Hex and creating a GitHub release are separate actions.
- Do **not** embellish release notes. Use the changelog wording or a terse bullet list of actual changes.
- Always publish docs when publishing a Hex package unless the user explicitly says not to:
  ```bash
  mix hex.publish package --yes
  mix hex.publish docs --yes
  ```
- If Hex asks for 2FA, stop and ask for the current code. Do not retry blindly. When a code is provided, pipe it to the command.
- Never leave a downstream project on a local path dependency after dogfooding. Revert to a released Hex dependency before finalizing.

## Pre-release checklist

1. Confirm the repo is clean or understand exactly what is being released:
   ```bash
   git status --short --branch
   ```
2. Update package version in `mix.exs`.
3. Update `CHANGELOG.md`:
   - Move relevant items out of `Unreleased`.
   - Add version and date.
   - Keep entries factual and concise.
4. Format changed files:
   ```bash
   mix format
   ```
5. Run the project’s test gate, normally:
   ```bash
   mix test
   ```
   If the project documents a different release gate, use that.
6. Commit and push release prep before publishing:
   ```bash
   git add mix.exs CHANGELOG.md ...
   git commit -m "Prepare X.Y.Z release"
   git push
   ```

## Dogfooding before publishing

When another local project depends on the package being released:

1. Temporarily switch the downstream dependency to a local path.
2. Use the new API in the downstream project if that is the point of the release.
3. Run focused downstream tests and at least one smoke command relevant to the change.
4. Revert the downstream dependency to Hex before publishing unless the user explicitly wants a temporary path dependency.
5. After publishing, update the downstream project to the released version and commit that separately.

## Publishing sequence

Run package publish first, then docs:

```bash
mix hex.publish package --yes
mix hex.publish docs --yes
```

If both require 2FA and the same code is still valid, it can be piped to both commands. If either command fails due to 2FA expiry, ask for a new code.

## GitHub releases

Only do this when the user explicitly requests it.

If requested:

- Title should be exactly the tag, e.g. `v0.5.9`, unless user says otherwise.
- Notes should be copied from `CHANGELOG.md` for that version, with no extra links.
- Do not add HexDocs links.
- Do not add Hex package links.
- Do not add generated prose.

Example:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "$(awk '/^## X.Y.Z /{flag=1; next} /^## /{flag=0} flag' CHANGELOG.md)"
```

## Downstream update after publish

1. Change dependency constraint to the released Hex version, e.g. `~> X.Y.Z`.
2. Run:
   ```bash
   mix deps.update package_name
   mix test path/to/focused_test.exs
   ```
3. Run any smoke command relevant to the release.
4. Commit with a direct message:
   ```bash
   git commit -m "Update PackageName to X.Y.Z"
   ```

## Final response

Report only what happened:

- package version published
- docs published
- tests/smokes run
- downstream update commit if any
- repo clean/synced status

Do not include extra release-note links unless the user asked for them.

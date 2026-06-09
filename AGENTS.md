# Agent Notes

## Releases

When releasing a new tagged version:

1. Bump package versions and update `CHANGELOG.md`.
2. Run `pnpm run check`.
3. Commit the bump, tag `vX.Y.Z`, and push the commit and tag.
4. Confirm the Publish GitHub Actions workflow succeeds and publishes npm.
5. Manually create the GitHub Release for the tag with release notes from `CHANGELOG.md`.

The current publish workflow publishes to npm only; it does not create GitHub Releases automatically.

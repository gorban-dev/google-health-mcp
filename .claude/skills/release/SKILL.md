---
name: release
description: Publish a new release of google-health-mcp to npm and GitHub. Use when the user asks to release, publish a version, or ship changes to npm.
---

# Releasing google-health-mcp

Releases are driven by git tags: pushing a `v*` tag runs `.github/workflows/release.yml`, which lints, tests, builds, publishes to npm (trusted publishing, no tokens) and creates a GitHub release whose notes are the version's section from `CHANGELOG.md`.

## Steps

1. Make sure `main` is clean and green locally:
   ```bash
   git status              # no uncommitted changes
   npm run lint && npm test
   ```
2. Decide the bump: default is `patch` — fixes AND small additions (CLI commands, echoed fields). `minor` is reserved for new MCP tools or notable features — confirm with Sergey first. `major` for breaking changes to tool schemas or config format.
3. MANDATORY: add a `## [x.y.z] — YYYY-MM-DD` section to `CHANGELOG.md` (Keep a Changelog format: Added/Changed/Fixed; include upgrade steps for existing users when behavior or config recommendations change) and a compare link at the bottom. The release workflow uses this section as the GitHub release notes — a version without a section falls back to auto-generated notes, which is a bug, not a feature. Record internal details in `docs/journal.md` (gitignored). Commit the changelog.
4. Bump the version and tag (one command does both):
   ```bash
   npm version patch   # or minor / major — creates commit "x.y.z" and tag "vx.y.z"
   ```
   If `package.json` was already bumped ahead of time (version not yet on npm), skip `npm version` and tag manually: `git tag v$(node -p "require('./package.json').version")`.
5. Push the commit and the tag:
   ```bash
   git push && git push --tags
   ```
6. Verify: `gh run watch` until the Release workflow is green, then `npm view google-health-mcp version` must show the new version.

## Guardrails

- The workflow refuses to publish when the tag does not match `package.json` version.
- Never run `npm publish` locally as the primary path — it requires an interactive 2FA browser login. It is only the fallback if CI publishing is broken; run it from a normal terminal, not from an agent session.
- Do not delete/re-push a tag to "fix" a bad release; npm versions are immutable. Bump again.

## One-time prerequisite (already done if a release has succeeded before)

npm trusted publishing must be configured for the package: npmjs.com → package `google-health-mcp` → Settings → Trusted Publisher → GitHub Actions, repository `gorban-dev/google-health-mcp`, workflow `release.yml`. Requires the npm account owner (`gor-dev`) to be logged in.

# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [SemVer](https://semver.org/); until 1.0.0 the MCP tool schemas may change in minor versions.

## [0.2.0] — 2026-07-26

### Added
- Range read tools for agent-side analysis and recommendations:
  - `get_nutrition_range` — per-day calories, protein/fat/carbs, fiber, sugar and water via daily rollups (one API call per 90 days instead of one `get_food_log` per day).
  - `get_weight_range` — daily average weight (kg) and body fat (%).
  - `get_heart_rate_range` — daily resting heart rate plus min/avg/max BPM.
  - `get_workouts` — exercise sessions with type, duration, calories, average heart rate, distance and steps.
  - `get_health_overview` — day-by-day table combining steps, calories in/out, macros, water, weight, resting heart rate, sleep minutes and workouts; degrades gracefully (with a `warnings` field) when the health-metrics scope is missing.
- `log_weight` — log body weight (kg), optionally with body fat percentage; `delete_food_log` deletes weight/body-fat entries too.
- `health_metrics_and_measurements.readonly` and `.writeonly` added to the default scope set — required for weight, body fat, heart rate and the already-shipped `get_hrv`. Existing installs: re-run `npx -y google-health-mcp@latest auth` once to grant them.

### Not added
- `update_food_log`: investigated in depth 2026-07-26. `dataPoints.patch` itself works (verified on hydration-log: body = full data value without `name`, no `updateMask`), but nutrition-log returns HTTP 500 `INTERNAL_ERROR` on every field combination. Root cause is a legacy Fitbit restriction the v4 backend inherited: food logs created via `foodName` (anonymous food — the only creatable kind in v4) were never editable; v4 surfaces this as 500 instead of a clean error. Delete + re-log remains the correction path; details in docs/journal.md.

## [0.1.3] — 2026-07-26

### Added
- `version` command (`npx -y google-health-mcp version`, also `--version` / `-v`).
- `doctor` prints its own version in the header and compares it against the latest version on npm. Informational only: a 3-second timeout, silent when the registry is unreachable, never fails the health check.

### Changed
- `setup` and the README now recommend `google-health-mcp@latest` (with an explicit `@latest` tag) in the MCP client config. Without a tag, npx serves a cached copy indefinitely and never picks up new releases.

### Upgrading an existing installation
If you installed before 0.1.3, your MCP client config points at the bare `google-health-mcp` spec and npx will keep serving the old cached version. One-time fix:

1. In your MCP client config, change `"args": ["-y", "google-health-mcp"]` to `"args": ["-y", "google-health-mcp@latest"]`.
2. Clear the npx cache: `rm -rf ~/.npm/_npx` (it is only a download cache — your credentials and tokens in `~/.config/google-health-mcp/` are not touched).
3. Restart the MCP client. Verify with `npx -y google-health-mcp@latest doctor` — the header should show the current version.

After that, updates arrive automatically on every client start.

## [0.1.2] — 2026-07-26

### Added
- `log_meal` and `log_food` echo per-item `confidence` back in the `logged` result ([#1](https://github.com/gorban-dev/google-health-mcp/issues/1)). Google Health has no metadata slot, so confidence is still not stored there; the echo lets a client agent persist provenance alongside the returned entry names.
- CI workflow (lint + tests on push/PR), README badges, cover image.

### Fixed
- (from unpublished 0.1.1) `delete_food_log` returns a clear error on 403 `DATA_POINT_NOT_OWNED_BY_CLIENT`: Google forbids deleting entries created by another OAuth client — those must be deleted in the Google Health app.

## [0.1.1] — not published

Version bump existed only in git; the changes shipped as part of 0.1.2.

## [0.1.0] — 2026-07-24

First release: MCP server over the Google Health API with bring-your-own Google Cloud credentials. Tools: `log_meal`, `log_food`, `log_water`, `delete_food_log`, nutrition/sleep/activity reads. CLI: `setup`, `auth`, `doctor`.

[0.2.0]: https://github.com/gorban-dev/google-health-mcp/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/gorban-dev/google-health-mcp/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/gorban-dev/google-health-mcp/compare/v0.1.0...v0.1.2
[0.1.0]: https://github.com/gorban-dev/google-health-mcp/releases/tag/v0.1.0

# google-health-mcp

MCP server for the **Google Health API**: any AI agent with vision can log your meals (calories and macros) into Google Health, and read back your sleep, activity and nutrition to reason about them together.

Typical flow: you photograph your food and send it to your agent (Hermes Agent via Telegram, OpenClaw, Claude Desktop, Cursor...). The agent estimates the dishes and macros from the photo, calls `log_meal`, and a minute later the meal is in the Google Health app on your phone, next to your sleep and workouts.

Built for the new Google Health API (`health.googleapis.com/v4`) — the legacy Fitbit Web API shuts down in September 2026 and this server does **not** depend on it.

## Why you need your own Google Cloud project (read this first)

This server has no "log in and go" button, and that is deliberate. Google classifies all health scopes as **restricted**:

- An unverified app is capped at **100 users for the lifetime of the Cloud project**. The counter never resets. A single shared app published to npm would burn those slots within a day and die for everyone.
- Removing the cap requires Google's Trust & Safety review plus a **yearly CASA security audit ($500–4500)** and an in-app disclosure screen — impossible for a local stdio server, and pointless for an open-source tool that never sees your data.
- Spreading users across several Cloud projects is forbidden by Google policy and risks a developer account ban.

So instead every user creates their **own free Google Cloud project** (~10 minutes, one time). Your data then flows directly between your machine and your Google account. The author of this package runs no servers and can see nothing.

## Setup

Requirements: Node.js 20+, a Google account with Google Health (Fitbit) data.

```bash
npx -y google-health-mcp setup
```

The interactive wizard walks you through every step below, opens the right console pages, and finishes with a live test request. What it will ask you to do:

1. **Create a Google Cloud project** — [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate), any name.
2. **Enable the Google Health API** — APIs & Services → Library → search "Google Health API" → Enable.
3. **Configure the OAuth consent screen** — Audience: External; fill the app name and two email fields; skip scopes and test users.
4. **Publish the app to In production.** ⚠️ If you leave the consent screen in *Testing* status, Google expires your refresh tokens after **7 days** and you will have to re-authorize weekly. The wizard checks the symptoms of this and `doctor` diagnoses it.
5. **Create an OAuth client** — Credentials → Create Credentials → OAuth client ID → type **Desktop app**. Paste the client ID and secret into the wizard.
6. **Authorize in the browser.** ⚠️ Google will show **"Google hasn't verified this app"**. This is expected and correct: the "app" is your own Cloud project created two minutes ago; there is nobody else to verify it for. Click **Advanced → Go to (your app name) (unsafe)** and grant access.

Credentials are stored in `~/.config/google-health-mcp/` (`config.json`, `tokens.json`, permissions 0600). The client secret is never logged.

Other commands:

```bash
npx -y google-health-mcp auth    # re-authorize only
npx -y google-health-mcp doctor  # diagnostics: tokens, permissions, API test call
```

### One more thing: make nutrition visible in the app

In the Google Health app, nutrition metrics (Calories in, Protein, Hydration...) start under **Not tracked**. Open Nutrition and add the metrics you care about to tracked — otherwise logged food is stored but not shown on the dashboard.

## Connect to your MCP client

The config is the same everywhere — stdio via `npx`:

```json
{
  "mcpServers": {
    "google-health": {
      "command": "npx",
      "args": ["-y", "google-health-mcp"]
    }
  }
}
```

- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).
- **Cursor**: `~/.cursor/mcp.json`.
- **Hermes Agent**: add the same block to the `mcp_servers` section of your Hermes config.
- **OpenClaw**: add to `mcp.servers` in your OpenClaw settings.

Credentials can also be injected via environment variables `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` instead of `config.json`; the timezone via `GOOGLE_HEALTH_TIMEZONE` (IANA name, defaults to the system timezone).

## Tools

Write:

| Tool | Purpose |
|---|---|
| `log_meal` | Log a whole meal as separate items (so one mistake can be deleted alone). Returns entry names and meal totals |
| `log_food` | Log a single food item |
| `log_water` | Log water intake in ml |
| `delete_food_log` | Delete entries by name — the correction path, since Google Health nutrition entries created via API are not editable |

Read:

| Tool | Purpose |
|---|---|
| `get_food_log` | Food diary and nutrient totals for a day |
| `get_daily_summary` | Steps, calories burned, active minutes |
| `get_sleep` / `get_sleep_range` | Sleep sessions with stages |
| `get_activity_range` | Per-day activity for a period |
| `get_hrv` | Daily heart rate variability |
| `get_profile` | Timezone, measurement units |

The read set exists so the agent can answer questions like "how does my eating affect my sleep" — it can correlate, not just write.

## Accuracy disclaimer

Estimating nutrition from a photo is approximate: expect on the order of **±120 kcal** for energy and **±8 g** for protein per meal even with top vision models, and errors of tens of percent for individual micronutrients. This tool is fine for tracking trends. It is **not** suitable for clinical needs — diabetes management, renal diets, or anything where dosing depends on the numbers.

## Privacy

Everything runs locally over stdio. Your OAuth tokens never leave your machine; data goes directly from your machine to Google's API. The author operates no infrastructure, collects no telemetry, and cannot see your data.

## Development

```bash
npm install
npm test        # vitest
npm run lint    # biome
npm run build
```

## License

MIT

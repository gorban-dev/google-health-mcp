import { HealthApiClient } from "../api.js";
import { configPath, fullScopes, loadConfig, saveConfig } from "../config.js";
import { TokenManager, authorize, openBrowser } from "../oauth.js";
import { ask, askUntil, pressEnter, rl, say } from "./ui.js";

const CONSOLE_NEW_PROJECT = "https://console.cloud.google.com/projectcreate";
const CONSOLE_API_LIBRARY = "https://console.cloud.google.com/apis/library";
const CONSOLE_CONSENT = "https://console.cloud.google.com/apis/credentials/consent";
const CONSOLE_CREDENTIALS = "https://console.cloud.google.com/apis/credentials";

function openAndTell(url: string): void {
  say(`  Opening: ${url}`);
  openBrowser(url);
}

export async function runSetup(): Promise<void> {
  say("");
  say("Google Health MCP — setup");
  say("=========================");
  say("");
  say("Why you need your own Google Cloud project: Google marks health scopes as");
  say('"restricted". A shared app would need Google\'s paid security audit and is');
  say("capped at 100 users for its entire lifetime otherwise. With your own free");
  say("project, your data flows only between your machine and your Google account,");
  say("and nobody else's usage can break your access. Takes about 10 minutes once.");
  say("");

  // 1. Create the project
  say("Step 1/6 — Create a Google Cloud project (any name, e.g. google-health-mcp).");
  openAndTell(CONSOLE_NEW_PROJECT);
  await pressEnter("Press Enter after the project is created...");

  // 2. Enable the API
  say("");
  say('Step 2/6 — Enable the API: search "Google Health API" and press Enable.');
  say("Make sure your new project is selected in the top-left project picker.");
  openAndTell(CONSOLE_API_LIBRARY);
  await pressEnter("Press Enter after the API is enabled...");

  // 3. Consent screen + production status
  say("");
  say("Step 3/6 — Configure the OAuth consent screen:");
  say("  - Audience: External");
  say("  - Fill app name and the two email fields; skip scopes and test users");
  say('  - IMPORTANT: press "Publish app" so Publishing status is In production.');
  say("    In Testing status Google expires refresh tokens after 7 days and you");
  say("    would have to re-authorize weekly.");
  openAndTell(CONSOLE_CONSENT);
  await pressEnter("Press Enter when the consent screen shows In production...");

  // 4. OAuth client
  say("");
  say("Step 4/6 — Create the OAuth client:");
  say("  Credentials → Create Credentials → OAuth client ID → Application type: Desktop app.");
  openAndTell(CONSOLE_CREDENTIALS);
  const clientId = await askUntil(
    "\nPaste the Client ID:",
    (v) => v.endsWith(".apps.googleusercontent.com") && v.length > 40,
  );
  const clientSecret = await askUntil("Paste the Client secret:", (v) => v.length >= 10);

  const config = { ...loadConfig(), clientId, clientSecret };
  const timezone = await ask(
    `Timezone as IANA name [${Intl.DateTimeFormat().resolvedOptions().timeZone}]:`,
  );
  if (timezone) config.timezone = timezone;
  saveConfig(config);
  say(`Saved ${configPath()} (permissions 0600).`);

  // 5. Authorize
  say("");
  say("Step 5/6 — Authorize in the browser.");
  say('EXPECTED: Google will show "Google hasn\'t verified this app". That is normal —');
  say("the app is YOUR OWN Cloud project, there is nobody else to verify it for.");
  say('Click "Advanced" → "Go to <your app name> (unsafe)" and grant access.');
  say("");
  const tokens = await authorize({
    clientId,
    clientSecret,
    scopes: fullScopes(config),
    onAuthUrl: (url) => say(`If the browser did not open, visit:\n${url}\n`),
  });
  say(`Authorized. Granted scopes: ${tokens.scopes.length}.`);

  // 6. Smoke test
  say("");
  say("Step 6/6 — Test request...");
  const api = new HealthApiClient(new TokenManager(clientId, clientSecret));
  try {
    await api.getSettings();
    say("API responds. Setup complete.");
  } catch (e) {
    say(`Test request failed: ${e instanceof Error ? e.message : e}`);
    say("Run `npx @gorban/google-health-mcp doctor` for diagnostics.");
  }

  say("");
  say("Add this to your MCP client config (Claude Desktop, Cursor, Hermes, OpenClaw):");
  say("");
  say(
    JSON.stringify(
      {
        mcpServers: {
          "google-health": {
            command: "npx",
            args: ["-y", "@gorban/google-health-mcp"],
          },
        },
      },
      null,
      2,
    ),
  );
  say("");
  say("Credentials and tokens stay in your config directory; the server reads them itself.");
  rl.close();
}

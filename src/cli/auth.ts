import { fullScopes, loadConfig } from "../config.js";
import { authorize } from "../oauth.js";
import { rl, say } from "./ui.js";

export async function runAuth(): Promise<void> {
  const config = loadConfig();
  if (!config.clientId || !config.clientSecret) {
    say("No OAuth credentials configured. Run `npx google-health-mcp setup` first.");
    process.exitCode = 1;
    rl.close();
    return;
  }
  say("Opening the browser for authorization...");
  say('If Google shows "hasn\'t verified this app": Advanced → Go to app (it is your own app).');
  const tokens = await authorize({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: fullScopes(config),
    onAuthUrl: (url) => say(`If the browser did not open, visit:\n${url}\n`),
  });
  say(`Authorized. Granted scopes: ${tokens.scopes.length}.`);
  rl.close();
}

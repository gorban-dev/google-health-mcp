import { existsSync, statSync } from "node:fs";
import { ApiError, HealthApiClient } from "../api.js";
import { configPath, loadConfig, loadTokens, tokensPath } from "../config.js";
import { AuthError, TokenManager } from "../oauth.js";
import { rl, say } from "./ui.js";

function check(label: string, ok: boolean, detail?: string): boolean {
  say(`${ok ? " OK " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

export async function runDoctor(): Promise<void> {
  say("google-health-mcp doctor");
  say("");
  let healthy = true;

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  healthy = check("Node.js >= 20", nodeMajor >= 20, `running ${process.versions.node}`) && healthy;

  const config = loadConfig();
  healthy =
    check(
      "OAuth credentials configured",
      Boolean(config.clientId && config.clientSecret),
      config.clientId
        ? `client ${config.clientId.slice(0, 12)}...`
        : `checked env and ${configPath()}`,
    ) && healthy;

  const tokens = loadTokens();
  healthy = check("Tokens present", Boolean(tokens), tokensPath()) && healthy;

  for (const path of [configPath(), tokensPath()]) {
    if (existsSync(path)) {
      const mode = statSync(path).mode & 0o777;
      healthy =
        check(`Permissions 0600 on ${path}`, mode === 0o600, `actual 0${mode.toString(8)}`) &&
        healthy;
    }
  }

  if (config.clientId && config.clientSecret && tokens) {
    const manager = new TokenManager(config.clientId, config.clientSecret);
    try {
      await manager.getAccessToken(true);
      check("Refresh token valid", true);
    } catch (e) {
      healthy = check("Refresh token valid", false, e instanceof Error ? e.message : String(e));
      if (e instanceof AuthError && e.message.includes("Testing")) {
        say("      ^ Symptom of a consent screen left in Testing status (7-day tokens).");
      }
    }

    const api = new HealthApiClient(manager);
    try {
      await api.getSettings();
      check("API test request (settings)", true);
    } catch (e) {
      const detail =
        e instanceof ApiError && e.status === 403
          ? `${e.message} (403 on data with a working token often means legacy fitness.* scopes were mixed in — re-run auth)`
          : e instanceof Error
            ? e.message
            : String(e);
      healthy = check("API test request (settings)", false, detail);
    }
  }

  say("");
  say(healthy ? "All checks passed." : "Some checks failed — see above.");
  process.exitCode = healthy ? 0 : 1;
  rl.close();
}

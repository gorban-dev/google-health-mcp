import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig, StoredTokens } from "./types.js";

export const DEFAULT_SCOPES = [
  "nutrition.writeonly",
  "nutrition.readonly",
  "sleep.readonly",
  "activity_and_fitness.readonly",
  "settings.readonly",
  "profile.readonly",
];

export const SCOPE_PREFIX = "https://www.googleapis.com/auth/googlehealth.";

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".config");
  return join(base, "google-health-mcp");
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJsonPrivate(path: string, value: unknown): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function tokensPath(): string {
  return join(configDir(), "tokens.json");
}

/** Env vars take precedence over config.json so MCP client configs can inject credentials. */
export function loadConfig(): AppConfig {
  const file = readJson<AppConfig>(configPath()) ?? {};
  return {
    ...file,
    clientId: process.env.GOOGLE_CLIENT_ID ?? file.clientId,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? file.clientSecret,
    timezone: process.env.GOOGLE_HEALTH_TIMEZONE ?? file.timezone,
  };
}

export function saveConfig(config: AppConfig): void {
  writeJsonPrivate(configPath(), config);
}

export function loadTokens(): StoredTokens | undefined {
  const tokens = readJson<StoredTokens>(tokensPath());
  if (!tokens?.accessToken || !tokens.refreshToken) return undefined;
  return tokens;
}

export function saveTokens(tokens: StoredTokens): void {
  writeJsonPrivate(tokensPath(), tokens);
}

export function resolveTimezone(config: AppConfig): string {
  return config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function fullScopes(config: AppConfig): string[] {
  const short = config.scopes && config.scopes.length > 0 ? config.scopes : DEFAULT_SCOPES;
  return short.map((s) => `${SCOPE_PREFIX}${s}`);
}

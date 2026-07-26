import { readFileSync } from "node:fs";

export function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** Latest version published to npm, or null when the registry is unreachable. */
export async function latestPublishedVersion(timeoutMs = 3000): Promise<string | null> {
  try {
    const res = await fetch("https://registry.npmjs.org/google-health-mcp/latest", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

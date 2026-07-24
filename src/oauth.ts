import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { loadTokens, saveTokens } from "./config.js";
import type { StoredTokens } from "./types.js";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** Refresh this many ms before the reported expiry. */
const EXPIRY_SLACK_MS = 60_000;

export class AuthError extends Error {}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
    const desc = typeof body.error_description === "string" ? `: ${body.error_description}` : "";
    throw new AuthError(`Token request failed (${code})${desc}`);
  }
  return body as unknown as TokenResponse;
}

export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: false });
  child.on("error", () => {
    /* the caller always prints the URL as a fallback */
  });
  child.unref();
}

export interface AuthorizeOptions {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  /** Called with the authorization URL; print it so the user can open it manually. */
  onAuthUrl?: (url: string) => void;
  timeoutMs?: number;
}

/**
 * Authorization Code + PKCE with a loopback redirect on a random port.
 * Deliberately omits include_granted_scopes: previously granted legacy
 * fitness.* scopes in the same client would poison the token and Google
 * Health rejects it with 403 on data reads.
 */
export async function authorize(opts: AuthorizeOptions): Promise<StoredTokens> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.search = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  }).toString();

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new AuthError("Timed out waiting for the OAuth redirect (5 minutes)."));
    }, opts.timeoutMs ?? 300_000);

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const gotCode = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (err || !gotCode || gotState !== state) {
        res.end(
          "<h2>Authorization failed.</h2><p>You can close this tab and return to the terminal.</p>",
        );
        clearTimeout(timer);
        server.close();
        reject(new AuthError(err ? `Authorization denied: ${err}` : "Invalid OAuth callback."));
        return;
      }
      res.end("<h2>Authorized.</h2><p>You can close this tab and return to the terminal.</p>");
      clearTimeout(timer);
      server.close();
      resolve(gotCode);
    });

    opts.onAuthUrl?.(authUrl.toString());
    openBrowser(authUrl.toString());
  });

  const tok = await tokenRequest({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (!tok.refresh_token) {
    throw new AuthError(
      "Google did not return a refresh token. Re-run authorization; if it persists, remove the app on https://myaccount.google.com/permissions and try again.",
    );
  }
  const tokens: StoredTokens = {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    scopes: (tok.scope ?? opts.scopes.join(" ")).split(" "),
  };
  saveTokens(tokens);
  return tokens;
}

/** Serves fresh access tokens, refreshing and persisting transparently. */
export class TokenManager {
  private cached: StoredTokens | undefined;

  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  async getAccessToken(forceRefresh = false): Promise<string> {
    this.cached ??= loadTokens();
    if (!this.cached) {
      throw new AuthError(
        "Not authorized. Run `npx @gorban/google-health-mcp setup` (first time) or `... auth`.",
      );
    }
    if (forceRefresh || Date.now() >= this.cached.expiresAt - EXPIRY_SLACK_MS) {
      await this.refresh();
    }
    return (this.cached as StoredTokens).accessToken;
  }

  private async refresh(): Promise<void> {
    const current = this.cached as StoredTokens;
    let tok: TokenResponse;
    try {
      tok = await tokenRequest({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: current.refreshToken,
        grant_type: "refresh_token",
      });
    } catch (e) {
      if (e instanceof AuthError && e.message.includes("invalid_grant")) {
        throw new AuthError(
          "Refresh token rejected (invalid_grant). Most common cause: the OAuth consent screen is in Testing status, which limits refresh tokens to 7 days. Publish the app to In production and re-run `auth`.",
        );
      }
      throw e;
    }
    this.cached = {
      ...current,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? current.refreshToken,
      expiresAt: Date.now() + tok.expires_in * 1000,
    };
    saveTokens(this.cached);
  }
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HealthApiClient } from "./api.js";
import { loadConfig, resolveTimezone } from "./config.js";
import { TokenManager } from "./oauth.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { packageVersion } from "./version.js";

/**
 * Builds the MCP server independent of transport, so a Streamable HTTP
 * transport can be added later without touching tool code.
 */
export function buildServer(): McpServer {
  const config = loadConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Missing Google OAuth credentials. Run `npx google-health-mcp setup`, or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  const tokens = new TokenManager(config.clientId, config.clientSecret);
  const api = new HealthApiClient(tokens);
  const ctx = { api, timezone: resolveTimezone(config) };

  const server = new McpServer({ name: "google-health-mcp", version: packageVersion() });
  registerWriteTools(server, ctx);
  registerReadTools(server, ctx);
  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  // stdout belongs to the protocol; all human output goes to stderr.
  console.error("google-health-mcp: stdio server running");
}

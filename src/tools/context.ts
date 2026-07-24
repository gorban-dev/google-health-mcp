import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HealthApiClient } from "../api.js";

export interface ToolContext {
  api: HealthApiClient;
  timezone: string;
}

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(e: unknown): CallToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Wraps a handler so any thrown ApiError/AuthError becomes a readable tool error. */
export function safe<A extends unknown[]>(
  fn: (...args: A) => Promise<CallToolResult>,
): (...args: A) => Promise<CallToolResult> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResult(e);
    }
  };
}

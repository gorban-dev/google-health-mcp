import { describe, expect, it, vi } from "vitest";
import { ApiError, HealthApiClient } from "./api.js";
import type { TokenManager } from "./oauth.js";

function stubTokens(): TokenManager & { refreshCalls: number } {
  const stub = {
    refreshCalls: 0,
    async getAccessToken(forceRefresh = false) {
      if (forceRefresh) stub.refreshCalls++;
      return forceRefresh ? "token-refreshed" : "token-1";
    },
  };
  return stub as unknown as TokenManager & { refreshCalls: number };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("HealthApiClient.request", () => {
  it("refreshes the token and retries once on 401", async () => {
    const tokens = stubTokens();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: "unauthorized" } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const api = new HealthApiClient(tokens, fetchMock);

    await expect(api.request("GET", "users/me/settings")).resolves.toEqual({ ok: true });
    expect(tokens.refreshCalls).toBe(1);
    const secondCall = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((secondCall.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-refreshed",
    );
  });

  it("retries on 429 respecting Retry-After, then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "Retry-After": "0" }))
      .mockResolvedValueOnce(jsonResponse(429, {}, { "Retry-After": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const api = new HealthApiClient(stubTokens(), fetchMock);

    await expect(api.request("GET", "users/me/settings")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after two 429 retries", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(429, { error: { message: "rate limited" } }, { "Retry-After": "0" }),
      );
    const api = new HealthApiClient(stubTokens(), fetchMock);

    await expect(api.request("GET", "users/me/settings")).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces the scope hint on 403", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(403, { error: { message: "Permission denied" } }));
    const api = new HealthApiClient(stubTokens(), fetchMock);

    await expect(api.request("GET", "users/me/settings")).rejects.toThrow(/missing scope/);
  });
});

describe("caching", () => {
  it("serves repeated list calls from cache and invalidates on write", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const path = String(url);
      if (path.includes(":batchDelete")) return jsonResponse(200, { done: true, response: {} });
      return jsonResponse(200, { dataPoints: [{ name: "p1" }] });
    });
    const api = new HealthApiClient(stubTokens(), fetchMock);

    await api.listDataPoints("nutrition-log", "f");
    await api.listDataPoints("nutrition-log", "f");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await api.batchDeleteDataPoints("nutrition-log", ["p1"]);
    await api.listDataPoints("nutrition-log", "f");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps unrelated data type caches on write", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const path = String(url);
      if (path.endsWith("dataPoints") && !path.includes("sleep")) {
        return jsonResponse(200, { done: true, response: { name: "new" } });
      }
      return jsonResponse(200, { dataPoints: [] });
    });
    const api = new HealthApiClient(stubTokens(), fetchMock);

    await api.listDataPoints("sleep", "f");
    await api.createDataPoint("nutrition-log", { nutritionLog: undefined });
    await api.listDataPoints("sleep", "f");
    // one list + one create; the second list is a cache hit
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("collects all pages when listing", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const hasToken = String(url).includes("pageToken=t1");
      return hasToken
        ? jsonResponse(200, { dataPoints: [{ name: "p2" }] })
        : jsonResponse(200, { dataPoints: [{ name: "p1" }], nextPageToken: "t1" });
    });
    const api = new HealthApiClient(stubTokens(), fetchMock);

    const points = await api.listDataPoints("nutrition-log");
    expect(points.map((p) => p.name)).toEqual(["p1", "p2"]);
  });
});

describe("point get / update / search", () => {
  const NAME = "users/42/dataTypes/nutrition-log/dataPoints/777";

  it("getDataPoint GETs the resource name and caches", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, { name: NAME }));
    const api = new HealthApiClient(stubTokens(), fetchMock);
    await expect(api.getDataPoint(NAME)).resolves.toEqual({ name: NAME });
    await api.getDataPoint(NAME);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`https://health.googleapis.com/v4/${NAME}`);
    await api.getDataPoint(NAME, false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("updateDataPoint PATCHes without name in the body and invalidates the cache", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "PATCH")
        return jsonResponse(200, { done: true, response: { name: NAME } });
      return jsonResponse(200, { dataPoints: [{ name: NAME }] });
    });
    const api = new HealthApiClient(stubTokens(), fetchMock);
    await api.listDataPoints("nutrition-log");
    await api.updateDataPoint(NAME, { name: NAME, nutritionLog: { interval: {} } } as never);
    const patchCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit).method === "PATCH");
    expect(String(patchCall?.[0])).toBe(`https://health.googleapis.com/v4/${NAME}`);
    const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
    expect(body.name).toBeUndefined();
    expect(body.nutritionLog).toBeDefined();
    await api.listDataPoints("nutrition-log");
    expect(
      fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method !== "PATCH"),
    ).toHaveLength(2);
  });

  it("searchDataPoints requests one page with filter and pageSize", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { dataPoints: [{ name: "f1" }], nextPageToken: "t" }));
    const api = new HealthApiClient(stubTokens(), fetchMock);
    const points = await api.searchDataPoints("food", 'food.display_name = "x"', 10);
    expect(points).toEqual([{ name: "f1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("filter")).toBe('food.display_name = "x"');
    expect(url.searchParams.get("pageSize")).toBe("10");
  });
});

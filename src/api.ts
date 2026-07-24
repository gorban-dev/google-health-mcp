import type { TokenManager } from "./oauth.js";
import type { DailyRollUpResponse, DataPoint, ListDataPointsResponse, Operation } from "./types.js";

const BASE_URL = "https://health.googleapis.com/v4";
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 30_000;
const MAX_429_RETRIES = 2;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{ reason?: string; metadata?: Record<string, string> }>;
  };
}

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get("Retry-After");
  const fromHeader = header ? Number(header) * 1000 : Number.NaN;
  const backoff = Number.isFinite(fromHeader) ? fromHeader : 1000 * 2 ** attempt;
  return Math.min(backoff, MAX_RETRY_AFTER_MS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HealthApiClient {
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private tokens: TokenManager,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${BASE_URL}/${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    let forceRefresh = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.tokens.getAccessToken(forceRefresh);
      forceRefresh = false;
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      if (res.ok) return (await res.json()) as T;

      if (res.status === 401 && attempt === 0) {
        forceRefresh = true;
        continue;
      }
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        await sleep(retryAfterMs(res, attempt));
        continue;
      }

      const body = (await res.json().catch(() => ({}))) as GoogleErrorBody;
      const reason = body.error?.details?.find((d) => d.reason)?.reason;
      let message = body.error?.message ?? `HTTP ${res.status}`;
      if (reason === "DATA_POINT_NOT_OWNED_BY_CLIENT") {
        message =
          "Google only lets the application that created an entry delete it, and this entry was created elsewhere (another API client or the Fitbit app). Ask the user to delete it manually in the Google Health app.";
      } else if (res.status === 403) {
        message += " — likely a missing scope. Check the configured scopes and re-run `auth`.";
      }
      throw new ApiError(res.status, message, reason);
    }
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private invalidate(dataType: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`/${dataType}/`) || key.endsWith(`/${dataType}`)) this.cache.delete(key);
    }
  }

  // ---- dataPoints ----

  async listDataPoints(dataType: string, filter?: string, useCache = true): Promise<DataPoint[]> {
    const load = async () => {
      const points: DataPoint[] = [];
      let pageToken: string | undefined;
      do {
        const query: Record<string, string> = {};
        if (filter) query.filter = filter;
        if (pageToken) query.pageToken = pageToken;
        const page = await this.request<ListDataPointsResponse>(
          "GET",
          `users/me/dataTypes/${dataType}/dataPoints`,
          { query },
        );
        points.push(...(page.dataPoints ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return points;
    };
    const key = `list/${dataType}/${filter ?? ""}`;
    return useCache ? this.cached(key, load) : load();
  }

  async createDataPoint(dataType: string, body: DataPoint): Promise<DataPoint> {
    const op = await this.request<Operation>("POST", `users/me/dataTypes/${dataType}/dataPoints`, {
      body,
    });
    if (op.error) throw new ApiError(op.error.code, op.error.message);
    this.invalidate(dataType);
    return op.response ?? {};
  }

  async batchDeleteDataPoints(dataType: string, names: string[]): Promise<number> {
    const op = await this.request<Operation>(
      "POST",
      `users/me/dataTypes/${dataType}/dataPoints:batchDelete`,
      { body: { names } },
    );
    if (op.error) throw new ApiError(op.error.code, op.error.message);
    this.invalidate(dataType);
    const deleted = (op.response as { dataPoints?: unknown[] } | undefined)?.dataPoints;
    return deleted?.length ?? names.length;
  }

  /** Daily aggregates; range is a closed-open civil date interval. */
  async dailyRollUp(
    dataType: string,
    startDate: string,
    endDate: string,
  ): Promise<DailyRollUpResponse> {
    const toCivil = (d: string) => {
      const [year, month, day] = d.split("-").map(Number);
      return { date: { year, month, day } };
    };
    const key = `rollup/${dataType}/${startDate}/${endDate}`;
    return this.cached(key, () =>
      this.request<DailyRollUpResponse>(
        "POST",
        `users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`,
        { body: { range: { start: toCivil(startDate), end: toCivil(endDate) } } },
      ),
    );
  }

  // ---- profile / settings ----

  async getProfile(): Promise<Record<string, unknown>> {
    return this.cached("profile", () => this.request("GET", "users/me/profile"));
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return this.cached("settings", () => this.request("GET", "users/me/settings"));
  }
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { civilDayFilter, nextDay, sumLogs } from "../mappers.js";
import { isValidDate, todayInTimezone } from "../time.js";
import type { NutritionLog, RollupDataPoint } from "../types.js";
import { type ToolContext, jsonResult, safe } from "./context.js";

const dateParam = z
  .string()
  .optional()
  .describe("YYYY-MM-DD in the user's timezone; defaults to today");

/** Max civil-date span for heart-rate-derived types per API docs. */
const HR_MAX_RANGE_DAYS = 14;
const MAX_RANGE_DAYS = 90;

function assertDate(d: string): void {
  if (!isValidDate(d)) throw new Error(`Invalid date "${d}", expected YYYY-MM-DD.`);
}

function assertRange(start: string, end: string): void {
  assertDate(start);
  assertDate(end);
  if (start >= end) throw new Error(`Range start ${start} must be before end ${end}.`);
  if (daysBetween(start, end) > MAX_RANGE_DAYS) {
    throw new Error(`Range too large, max ${MAX_RANGE_DAYS} days.`);
  }
}

function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Strip civil time wrappers from a rollup point: {date, ...typed value}. */
function flattenRollup(point: RollupDataPoint): Record<string, unknown> {
  const { civilStartTime, civilEndTime, ...value } = point;
  const d = civilStartTime?.date;
  const date = d
    ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
    : undefined;
  return { date, ...value };
}

/** dailyRollUp with automatic chunking to respect the 14-day cap on HR-derived types. */
async function rolledUpDays(
  ctx: ToolContext,
  dataType: string,
  start: string,
  end: string,
): Promise<Record<string, unknown>[]> {
  const chunkDays = [
    "total-calories",
    "active-minutes",
    "heart-rate",
    "calories-in-heart-rate-zone",
  ].includes(dataType)
    ? HR_MAX_RANGE_DAYS
    : MAX_RANGE_DAYS;
  const out: Record<string, unknown>[] = [];
  for (let from = start; from < end; from = addDays(from, chunkDays)) {
    const to = addDays(from, chunkDays) < end ? addDays(from, chunkDays) : end;
    const res = await ctx.api.dailyRollUp(dataType, from, to);
    out.push(...(res.rollupDataPoints ?? []).map(flattenRollup));
  }
  return out;
}

function sleepFilter(start: string, end: string): string {
  return `sleep.interval.civil_end_time >= "${start}" AND sleep.interval.civil_end_time < "${end}"`;
}

async function fetchSleep(ctx: ToolContext, start: string, end: string) {
  const points = await ctx.api.listDataPoints("sleep", sleepFilter(start, end));
  return points.map((p) => {
    const sleep = p.sleep as Record<string, unknown> | undefined;
    return { name: p.name, ...sleep };
  });
}

export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_food_log",
    {
      title: "Get food log for a day",
      description:
        "Read the Google Health food diary for one day: every logged item with its resource name (needed for delete_food_log), daily nutrient totals and water intake.",
      inputSchema: { date: dateParam },
    },
    safe(async ({ date }) => {
      const day = date ?? todayInTimezone(ctx.timezone);
      assertDate(day);
      const [foodPoints, waterPoints] = await Promise.all([
        ctx.api.listDataPoints("nutrition-log", civilDayFilter("nutrition_log", day)),
        ctx.api.listDataPoints("hydration-log", civilDayFilter("hydration_log", day)),
      ]);
      const items = foodPoints.map((p) => {
        const log = p.nutritionLog as NutritionLog;
        return {
          name: p.name,
          food: log.foodDisplayName,
          mealType: log.mealType,
          calories: log.energy?.kcal,
          protein: log.nutrients?.find((n) => n.nutrient === "PROTEIN")?.quantity.grams,
          fat: log.totalFat?.grams,
          carbs: log.totalCarbohydrate?.grams,
          time: log.interval.startTime,
        };
      });
      const waterMl = waterPoints.reduce(
        (sum, p) => sum + (p.hydrationLog?.amountConsumed.milliliters ?? 0),
        0,
      );
      return jsonResult({
        date: day,
        items,
        totals: sumLogs(foodPoints.map((p) => p.nutritionLog as NutritionLog)),
        waterMl,
      });
    }),
  );

  server.registerTool(
    "get_daily_summary",
    {
      title: "Get daily activity summary",
      description:
        "Steps, total burned calories and active minutes for one day from Google Health.",
      inputSchema: { date: dateParam },
    },
    safe(async ({ date }) => {
      const day = date ?? todayInTimezone(ctx.timezone);
      assertDate(day);
      const end = nextDay(day);
      const [steps, calories, activeMinutes] = await Promise.all([
        rolledUpDays(ctx, "steps", day, end),
        rolledUpDays(ctx, "total-calories", day, end),
        rolledUpDays(ctx, "active-minutes", day, end),
      ]);
      return jsonResult({
        date: day,
        steps: steps[0],
        totalCalories: calories[0],
        activeMinutes: activeMinutes[0],
      });
    }),
  );

  server.registerTool(
    "get_sleep",
    {
      title: "Get sleep for a night",
      description:
        "Sleep sessions ending on the given date (i.e. the night leading into that morning), with stages and summary, from Google Health.",
      inputSchema: { date: dateParam },
    },
    safe(async ({ date }) => {
      const day = date ?? todayInTimezone(ctx.timezone);
      assertDate(day);
      return jsonResult({ date: day, sessions: await fetchSleep(ctx, day, nextDay(day)) });
    }),
  );

  server.registerTool(
    "get_sleep_range",
    {
      title: "Get sleep for a date range",
      description:
        "Sleep sessions whose end falls inside [start, end) civil dates, with stages and summaries, from Google Health.",
      inputSchema: {
        start: z.string().describe("YYYY-MM-DD, inclusive"),
        end: z.string().describe("YYYY-MM-DD, exclusive"),
      },
    },
    safe(async ({ start, end }) => {
      assertRange(start, end);
      return jsonResult({ start, end, sessions: await fetchSleep(ctx, start, end) });
    }),
  );

  server.registerTool(
    "get_activity_range",
    {
      title: "Get activity for a date range",
      description:
        "Per-day steps, total burned calories and active minutes for [start, end) from Google Health. Useful for correlating nutrition with activity over a week or month.",
      inputSchema: {
        start: z.string().describe("YYYY-MM-DD, inclusive"),
        end: z.string().describe("YYYY-MM-DD, exclusive"),
      },
    },
    safe(async ({ start, end }) => {
      assertRange(start, end);
      const [steps, calories, activeMinutes] = await Promise.all([
        rolledUpDays(ctx, "steps", start, end),
        rolledUpDays(ctx, "total-calories", start, end),
        rolledUpDays(ctx, "active-minutes", start, end),
      ]);
      return jsonResult({ start, end, steps, totalCalories: calories, activeMinutes });
    }),
  );

  server.registerTool(
    "get_hrv",
    {
      title: "Get heart rate variability",
      description:
        "Daily heart rate variability (RMSSD and related metrics measured during sleep) for [start, end) from Google Health.",
      inputSchema: {
        start: z.string().describe("YYYY-MM-DD, inclusive"),
        end: z.string().describe("YYYY-MM-DD, exclusive"),
      },
    },
    safe(async ({ start, end }) => {
      assertRange(start, end);
      const filter = `daily_heart_rate_variability.date >= "${start}" AND daily_heart_rate_variability.date < "${end}"`;
      const points = await ctx.api.listDataPoints("daily-heart-rate-variability", filter);
      return jsonResult({
        start,
        end,
        days: points.map((p) => ({ name: p.name, ...(p.dailyHeartRateVariability as object) })),
      });
    }),
  );

  server.registerTool(
    "get_profile",
    {
      title: "Get user profile and settings",
      description:
        "User settings from Google Health: timezone, measurement units (weight/distance/water), food language, plus basic profile. Call once per session before logging if timezone matters.",
      inputSchema: {},
    },
    safe(async () => {
      const [profile, settings] = await Promise.allSettled([
        ctx.api.getProfile(),
        ctx.api.getSettings(),
      ]);
      return jsonResult({
        configuredTimezone: ctx.timezone,
        profile: profile.status === "fulfilled" ? profile.value : { error: String(profile.reason) },
        settings:
          settings.status === "fulfilled" ? settings.value : { error: String(settings.reason) },
      });
    }),
  );
}

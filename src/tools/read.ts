import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  activeMinutesTotal,
  civilDateOf,
  civilDateToIso,
  civilDayFilter,
  durationToMinutes,
  exerciseToWorkout,
  nextDay,
  rollupToNutritionDay,
  sumLogs,
} from "../mappers.js";
import { isValidDate, todayInTimezone } from "../time.js";
import type {
  ActiveMinutesRollupValue,
  BodyFatRollupValue,
  HeartRateRollupValue,
  HydrationLogRollupValue,
  NutritionLog,
  NutritionLogRollupValue,
  RollupDataPoint,
  SessionTimeInterval,
  SleepSummary,
  WeightRollupValue,
} from "../types.js";
import { type ToolContext, jsonResult, safe } from "./context.js";

const dateParam = z
  .string()
  .optional()
  .describe("YYYY-MM-DD in the user's timezone; defaults to today");

const rangeParams = {
  start: z.string().describe("YYYY-MM-DD, inclusive"),
  end: z.string().describe("YYYY-MM-DD, exclusive"),
};

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

function rollupDate(point: RollupDataPoint): string | undefined {
  return civilDateToIso(point.civilStartTime?.date);
}

/** Strip civil time wrappers from a rollup point: {date, ...typed value}. */
function flattenRollup(point: RollupDataPoint): Record<string, unknown> {
  const { civilStartTime, civilEndTime, ...value } = point;
  return { date: rollupDate(point), ...value };
}

function sortedByDate(days: Map<string, Record<string, unknown>>): Record<string, unknown>[] {
  return [...days.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
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

function restingHrFilter(start: string, end: string): string {
  return `daily_resting_heart_rate.date >= "${start}" AND daily_resting_heart_rate.date < "${end}"`;
}

function exerciseFilter(start: string, end: string): string {
  return `exercise.interval.civil_start_time >= "${start}" AND exercise.interval.civil_start_time < "${end}"`;
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
    "get_nutrition_range",
    {
      title: "Get nutrition for a date range",
      description:
        "Per-day nutrition totals for [start, end): calories, protein, fat, carbs, fiber, sugar and water. One call instead of get_food_log per day — use for analyzing the diet over a week or month.",
      inputSchema: rangeParams,
    },
    safe(async ({ start, end }) => {
      assertRange(start, end);
      const [food, water] = await Promise.all([
        ctx.api.dailyRollUp("nutrition-log", start, end),
        ctx.api.dailyRollUp("hydration-log", start, end),
      ]);
      const days = new Map<string, Record<string, unknown>>();
      for (const p of food.rollupDataPoints ?? []) {
        const date = rollupDate(p);
        if (!date) continue;
        days.set(date, {
          date,
          ...rollupToNutritionDay((p.nutritionLog ?? {}) as NutritionLogRollupValue),
        });
      }
      for (const p of water.rollupDataPoints ?? []) {
        const date = rollupDate(p);
        if (!date) continue;
        const row = days.get(date) ?? { date };
        row.waterMl =
          (p.hydrationLog as HydrationLogRollupValue | undefined)?.amountConsumed?.millilitersSum ??
          0;
        days.set(date, row);
      }
      return jsonResult({ start, end, days: sortedByDate(days) });
    }),
  );

  server.registerTool(
    "get_weight_range",
    {
      title: "Get weight and body fat for a date range",
      description:
        "Daily average weight (kg) and body fat (%) for [start, end) from Google Health. Days without measurements are omitted. Requires the health_metrics_and_measurements.readonly scope; on a 403 re-run `npx google-health-mcp auth`.",
      inputSchema: rangeParams,
    },
    safe(async ({ start, end }) => {
      assertRange(start, end);
      const [weight, bodyFat] = await Promise.all([
        ctx.api.dailyRollUp("weight", start, end),
        ctx.api.dailyRollUp("body-fat", start, end),
      ]);
      const days = new Map<string, Record<string, unknown>>();
      for (const p of weight.rollupDataPoints ?? []) {
        const date = rollupDate(p);
        const grams = (p.weight as WeightRollupValue | undefined)?.weightGramsAvg;
        if (!date || grams === undefined) continue;
        days.set(date, { date, weightKg: Math.round(grams / 100) / 10 });
      }
      for (const p of bodyFat.rollupDataPoints ?? []) {
        const date = rollupDate(p);
        const pct = (p.bodyFat as BodyFatRollupValue | undefined)?.bodyFatPercentageAvg;
        if (!date || pct === undefined) continue;
        const row = days.get(date) ?? { date };
        row.bodyFatPct = Math.round(pct * 10) / 10;
        days.set(date, row);
      }
      return jsonResult({ start, end, days: sortedByDate(days) });
    }),
  );

  server.registerTool(
    "get_heart_rate_range",
    {
      title: "Get heart rate for a date range",
      description:
        "Daily resting heart rate plus min/avg/max BPM for [start, end) from Google Health. Requires the health_metrics_and_measurements.readonly scope; on a 403 re-run `npx google-health-mcp auth`.",
      inputSchema: rangeParams,
    },
    safe(async ({ start, end }) => {
      assertRange(start, end);
      const [rolled, resting] = await Promise.all([
        rolledUpDays(ctx, "heart-rate", start, end),
        ctx.api.listDataPoints("daily-resting-heart-rate", restingHrFilter(start, end)),
      ]);
      const days = new Map<string, Record<string, unknown>>();
      for (const r of rolled) {
        const date = r.date as string | undefined;
        if (!date) continue;
        const hr = r.heartRate as HeartRateRollupValue | undefined;
        days.set(date, {
          date,
          minBpm: hr?.beatsPerMinuteMin,
          avgBpm: hr?.beatsPerMinuteAvg,
          maxBpm: hr?.beatsPerMinuteMax,
        });
      }
      for (const p of resting) {
        const date = civilDateToIso(p.dailyRestingHeartRate?.date);
        if (!date) continue;
        const row = days.get(date) ?? { date };
        row.restingBpm = Number(p.dailyRestingHeartRate?.beatsPerMinute) || undefined;
        days.set(date, row);
      }
      return jsonResult({ start, end, days: sortedByDate(days) });
    }),
  );

  server.registerTool(
    "get_workouts",
    {
      title: "Get workouts for a date range",
      description:
        "Exercise sessions starting inside [start, end) from Google Health: type, duration, calories, average heart rate, distance and steps per workout.",
      inputSchema: rangeParams,
    },
    safe(async ({ start, end }) => {
      assertRange(start, end);
      const points = await ctx.api.listDataPoints("exercise", exerciseFilter(start, end));
      return jsonResult({ start, end, workouts: points.map(exerciseToWorkout) });
    }),
  );

  server.registerTool(
    "get_health_overview",
    {
      title: "Get day-by-day health overview",
      description:
        "One call for trend analysis and recommendations: per-day steps, calories burned, active minutes, calories eaten + macros, water, weight, resting heart rate, sleep minutes and workouts for [start, end). Start here when reasoning about the user's health; drill down with get_sleep_range, get_workouts or get_food_log for details.",
      inputSchema: rangeParams,
    },
    safe(async ({ start, end }) => {
      assertRange(start, end);
      const warnings: string[] = [];
      const optional = <T>(label: string, p: Promise<T>): Promise<T | undefined> =>
        p.catch((e) => {
          warnings.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
          return undefined;
        });
      const [
        steps,
        calories,
        activeMinutes,
        food,
        water,
        weight,
        resting,
        sleepSessions,
        workouts,
      ] = await Promise.all([
        rolledUpDays(ctx, "steps", start, end),
        rolledUpDays(ctx, "total-calories", start, end),
        rolledUpDays(ctx, "active-minutes", start, end),
        ctx.api.dailyRollUp("nutrition-log", start, end),
        ctx.api.dailyRollUp("hydration-log", start, end),
        optional("weight", ctx.api.dailyRollUp("weight", start, end)),
        optional(
          "restingHeartRate",
          ctx.api.listDataPoints("daily-resting-heart-rate", restingHrFilter(start, end)),
        ),
        ctx.api.listDataPoints("sleep", sleepFilter(start, end)),
        ctx.api.listDataPoints("exercise", exerciseFilter(start, end)),
      ]);

      const days = new Map<string, Record<string, unknown>>();
      const day = (date: string): Record<string, unknown> => {
        const row = days.get(date) ?? { date };
        days.set(date, row);
        return row;
      };
      for (const r of steps) {
        if (!r.date) continue;
        day(r.date as string).steps = Number((r.steps as { countSum?: string })?.countSum) || 0;
      }
      for (const r of calories) {
        if (!r.date) continue;
        day(r.date as string).caloriesOut = (r.totalCalories as { kcalSum?: number })?.kcalSum;
      }
      for (const r of activeMinutes) {
        if (!r.date) continue;
        day(r.date as string).activeMinutes = activeMinutesTotal(
          r.activeMinutes as ActiveMinutesRollupValue | undefined,
        );
      }
      for (const p of food.rollupDataPoints ?? []) {
        const date = rollupDate(p);
        if (!date) continue;
        const n = rollupToNutritionDay((p.nutritionLog ?? {}) as NutritionLogRollupValue);
        Object.assign(day(date), {
          caloriesIn: n.calories,
          protein: n.protein,
          fat: n.fat,
          carbs: n.carbs,
        });
      }
      for (const p of water.rollupDataPoints ?? []) {
        const date = rollupDate(p);
        if (!date) continue;
        day(date).waterMl =
          (p.hydrationLog as HydrationLogRollupValue | undefined)?.amountConsumed?.millilitersSum ??
          0;
      }
      for (const p of weight?.rollupDataPoints ?? []) {
        const date = rollupDate(p);
        const grams = (p.weight as WeightRollupValue | undefined)?.weightGramsAvg;
        if (!date || grams === undefined) continue;
        day(date).weightKg = Math.round(grams / 100) / 10;
      }
      for (const p of resting ?? []) {
        const date = civilDateToIso(p.dailyRestingHeartRate?.date);
        if (!date) continue;
        day(date).restingBpm = Number(p.dailyRestingHeartRate?.beatsPerMinute) || undefined;
      }
      for (const p of sleepSessions) {
        const s = p.sleep as { interval?: SessionTimeInterval; summary?: SleepSummary } | undefined;
        const date =
          civilDateToIso(s?.interval?.civilEndTime?.date) ??
          civilDateOf(s?.interval?.endTime, s?.interval?.endUtcOffset);
        const minutes = Number(s?.summary?.minutesAsleep);
        if (!date || !Number.isFinite(minutes)) continue;
        const row = day(date);
        row.sleepMinutes = ((row.sleepMinutes as number) ?? 0) + minutes;
      }
      for (const p of workouts) {
        const ex = p.exercise;
        const date =
          civilDateToIso(ex?.interval?.civilStartTime?.date) ??
          civilDateOf(ex?.interval?.startTime, ex?.interval?.startUtcOffset);
        if (!date) continue;
        const row = day(date);
        const label = `${ex?.displayName ?? ex?.exerciseType ?? "workout"} (${
          durationToMinutes(ex?.activeDuration) ?? "?"
        } min)`;
        row.workouts = [...((row.workouts as string[]) ?? []), label];
      }
      return jsonResult({
        start,
        end,
        days: sortedByDate(days),
        ...(warnings.length > 0 ? { warnings } : {}),
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

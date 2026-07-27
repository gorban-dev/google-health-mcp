import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type FoodLogChanges,
  buildIdentifiedLog,
  resolveServing,
  updateFoodLog,
} from "../food-log.js";
import { type FoodItemInput, MEAL_TYPE_MAP, itemToNutritionLog, sumItems } from "../mappers.js";
import {
  civilToUtc,
  isValidDate,
  logInterval,
  mealStart,
  sampleTimeAt,
  todayInTimezone,
} from "../time.js";
import { type ToolContext, errorResult, jsonResult, safe } from "./context.js";

const foodItemShape = {
  name: z.string().describe("Dish or ingredient name, in the user's language"),
  calories: z.number().min(0).describe("Energy in kcal"),
  protein: z.number().min(0).optional().describe("Protein, grams"),
  fat: z.number().min(0).optional().describe("Total fat, grams"),
  carbs: z.number().min(0).optional().describe("Total carbohydrates, grams"),
  fiber: z.number().min(0).optional().describe("Dietary fiber, grams"),
  sugar: z.number().min(0).optional().describe("Sugar, grams"),
  sodium: z.number().min(0).optional().describe("Sodium, MILLIGRAMS"),
  servingDescription: z
    .string()
    .optional()
    .describe('Human-readable portion, e.g. "1 plate", "150 g" — appended to the food name'),
  confidence: z
    .enum(["high", "medium", "low"])
    .optional()
    .describe("Your honest confidence in this estimate"),
};

const mealTypeParam = z
  .enum(["breakfast", "lunch", "dinner", "snack"])
  .describe("Meal category. If the user did not say, infer from the local time of day");

const dateParam = z
  .string()
  .optional()
  .describe("YYYY-MM-DD in the user's timezone; defaults to today");

const timeParam = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .optional()
  .describe(
    "HH:MM local time the food was eaten; defaults to now (today) or a typical hour for the meal",
  );

const LOG_MEAL_DESCRIPTION = `Log a full meal (several dishes) to Google Health. Estimation methodology, follow it strictly:
- Estimate portion sizes from reference objects in the photo: plate (~26 cm), cutlery, a hand, a glass.
- Break composite dishes into components (e.g. "борщ" = broth + beef + vegetables + sour cream) and log each as a separate item.
- Fill calories and macros (protein/fat/carbs) for every item; add fiber/sugar/sodium when you can estimate them.
- Set "confidence" honestly per item. When confidence is low for a significant item, ASK the user instead of guessing.
- If the user did not name the meal type, infer it from the local time of day.
Each item becomes a separate entry, so the user can delete one mistaken item without touching the rest. Returns created entry names (keep them if the user may want corrections), per-item confidence echoed back, and meal totals. To fix a mistaken entry use update_food_log (the entry is recreated under a new name) or delete_food_log + re-log.`;

function resolveDate(date: string | undefined, timezone: string): string {
  const d = date ?? todayInTimezone(timezone);
  if (!isValidDate(d)) throw new Error(`Invalid date "${d}", expected YYYY-MM-DD.`);
  return d;
}

export function registerWriteTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "log_meal",
    {
      title: "Log a meal",
      description: LOG_MEAL_DESCRIPTION,
      inputSchema: {
        mealType: mealTypeParam,
        items: z.array(z.object(foodItemShape)).min(1).describe("Recognized food items"),
        date: dateParam,
        time: timeParam,
        notes: z
          .string()
          .optional()
          .describe("Free-form note; echoed back, not stored in Google Health"),
      },
    },
    safe(async ({ mealType, items, date, time, notes }) => {
      const day = resolveDate(date, ctx.timezone);
      const apiMealType = MEAL_TYPE_MAP[mealType];
      if (!apiMealType) return errorResult(`Unknown mealType "${mealType}".`);
      const start = time
        ? civilToUtc(day, time, ctx.timezone)
        : mealStart(day, apiMealType, ctx.timezone);
      const interval = logInterval(start, ctx.timezone);

      const created: Array<{
        name: string;
        item: string;
        calories: number;
        confidence?: "high" | "medium" | "low";
      }> = [];
      for (const item of items as FoodItemInput[]) {
        const point = await ctx.api.createDataPoint("nutrition-log", {
          nutritionLog: itemToNutritionLog(item, apiMealType, interval),
        });
        created.push({
          name: point.name ?? "",
          item: item.name,
          calories: item.calories,
          ...(item.confidence ? { confidence: item.confidence } : {}),
        });
      }
      return jsonResult({
        logged: created,
        totals: sumItems(items as FoodItemInput[]),
        mealType,
        date: day,
        ...(notes ? { notes } : {}),
      });
    }),
  );

  server.registerTool(
    "log_food",
    {
      title: "Log a single food item",
      description:
        "Log one food item to Google Health. Same estimation rules as log_meal. Prefer log_meal when the user ate several things at once.",
      inputSchema: {
        ...foodItemShape,
        mealType: mealTypeParam,
        date: dateParam,
        time: timeParam,
      },
    },
    safe(async ({ mealType, date, time, ...item }) => {
      const day = resolveDate(date, ctx.timezone);
      const apiMealType = MEAL_TYPE_MAP[mealType];
      if (!apiMealType) return errorResult(`Unknown mealType "${mealType}".`);
      const start = time
        ? civilToUtc(day, time, ctx.timezone)
        : mealStart(day, apiMealType, ctx.timezone);
      const point = await ctx.api.createDataPoint("nutrition-log", {
        nutritionLog: itemToNutritionLog(
          item as FoodItemInput,
          apiMealType,
          logInterval(start, ctx.timezone),
        ),
      });
      const foodItem = item as FoodItemInput;
      return jsonResult({
        logged: {
          name: point.name ?? "",
          item: foodItem.name,
          ...(foodItem.confidence ? { confidence: foodItem.confidence } : {}),
        },
      });
    }),
  );

  server.registerTool(
    "log_food_from_db",
    {
      title: "Log a food from the database",
      description:
        "Log a food from the Google Health food database by foodId (from search_food). Nutrition comes from the database, scaled to the portion. Unlike log_meal/log_food entries, entries logged this way ARE editable in place with update_food_log.",
      inputSchema: {
        foodId: z.string().describe("Full food resource name returned by search_food"),
        amount: z
          .number()
          .positive()
          .optional()
          .describe("Portion count in the chosen unit, default 1"),
        unitId: z
          .string()
          .optional()
          .describe(
            "Unit resource name from search_food units; defaults to the food's default serving",
          ),
        mealType: mealTypeParam,
        date: dateParam,
        time: timeParam,
      },
    },
    safe(async ({ foodId, amount, unitId, mealType, date, time }) => {
      const day = resolveDate(date, ctx.timezone);
      const apiMealType = MEAL_TYPE_MAP[mealType];
      if (!apiMealType) return errorResult(`Unknown mealType "${mealType}".`);
      const foodPoint = await ctx.api.getDataPoint(foodId as string);
      if (!foodPoint.food) return errorResult(`"${foodId}" is not a food database entry.`);
      const serving = resolveServing(foodPoint.food, unitId as string | undefined);
      const qty = (amount as number | undefined) ?? 1;
      const start = time
        ? civilToUtc(day, time, ctx.timezone)
        : mealStart(day, apiMealType, ctx.timezone);
      const log = buildIdentifiedLog(
        foodId as string,
        foodPoint.food,
        serving,
        qty,
        apiMealType,
        logInterval(start, ctx.timezone),
      );
      const point = await ctx.api.createDataPoint("nutrition-log", { nutritionLog: log });
      return jsonResult({
        logged: {
          name: point.name ?? "",
          item: foodPoint.food.displayName?.trim() ?? "",
          calories: log.energy?.kcal,
          amount: qty,
          ...(serving.foodMeasurementUnitDisplayName
            ? { unit: serving.foodMeasurementUnitDisplayName }
            : {}),
        },
        editable: true,
      });
    }),
  );

  server.registerTool(
    "update_food_log",
    {
      title: "Update a food log entry",
      description:
        "Edit an existing nutrition entry by its resource name. Entries from log_food_from_db are edited in place (change amount/unitId/mealType/date/time). Entries from log_meal/log_food cannot be edited by Google — they are transparently deleted and recreated with the changes, so the response carries a NEW name and recreated: true (update saved references).",
      inputSchema: {
        name: z.string().describe("Full nutrition-log resource name"),
        mealType: mealTypeParam.optional(),
        date: dateParam,
        time: timeParam,
        amount: z
          .number()
          .positive()
          .optional()
          .describe("New portion count (database entries only)"),
        unitId: z.string().optional().describe("New unit resource name (database entries only)"),
        foodName: z.string().optional().describe("New dish name (anonymous entries only)"),
        calories: z.number().min(0).optional().describe("New kcal (anonymous entries only)"),
        protein: z.number().min(0).optional().describe("Protein, grams (anonymous only)"),
        fat: z.number().min(0).optional().describe("Total fat, grams (anonymous only)"),
        carbs: z.number().min(0).optional().describe("Carbohydrates, grams (anonymous only)"),
        fiber: z.number().min(0).optional().describe("Dietary fiber, grams (anonymous only)"),
        sugar: z.number().min(0).optional().describe("Sugar, grams (anonymous only)"),
        sodium: z.number().min(0).optional().describe("Sodium, MILLIGRAMS (anonymous only)"),
        servingDescription: z
          .string()
          .optional()
          .describe("Portion text appended to foodName; only together with foodName"),
      },
    },
    safe(async ({ name, ...changes }) => {
      if (!/^users\/[^/]+\/dataTypes\/nutrition-log\/dataPoints\/[^/]+$/.test(name as string)) {
        return errorResult(
          `"${name}" is not a nutrition-log entry name. Only nutrition entries can be updated.`,
        );
      }
      if (Object.values(changes).every((v) => v === undefined)) {
        return errorResult("Nothing to change — pass at least one field.");
      }
      const result = await updateFoodLog(
        ctx.api,
        name as string,
        changes as FoodLogChanges,
        ctx.timezone,
      );
      return jsonResult({
        updated: {
          name: result.name,
          item: result.log.foodDisplayName,
          mealType: result.log.mealType,
          calories: result.log.energy?.kcal,
        },
        ...(result.recreated ? { recreated: true } : {}),
      });
    }),
  );

  server.registerTool(
    "log_water",
    {
      title: "Log water intake",
      description: "Log drinking water (or other liquid) intake in milliliters to Google Health.",
      inputSchema: {
        amountMl: z.number().positive().describe("Amount in milliliters"),
        date: dateParam,
        time: timeParam,
      },
    },
    safe(async ({ amountMl, date, time }) => {
      const day = resolveDate(date, ctx.timezone);
      const start = time
        ? civilToUtc(day, time, ctx.timezone)
        : mealStart(day, "ANYTIME", ctx.timezone);
      const point = await ctx.api.createDataPoint("hydration-log", {
        hydrationLog: {
          amountConsumed: { milliliters: amountMl },
          interval: logInterval(start, ctx.timezone),
        },
      });
      return jsonResult({ logged: { name: point.name ?? "", amountMl } });
    }),
  );

  server.registerTool(
    "log_weight",
    {
      title: "Log body weight",
      description:
        "Log a body weight measurement (kg) to Google Health, optionally with body fat percentage. Defaults to now for today, 08:00 for past dates. Weight entries are not editable: to fix one, delete_food_log with the returned name(s), then log again.",
      inputSchema: {
        weightKg: z.number().positive().describe("Weight in kilograms"),
        bodyFatPct: z
          .number()
          .min(1)
          .max(75)
          .optional()
          .describe("Body fat percentage, if measured"),
        date: dateParam,
        time: timeParam,
        notes: z.string().optional().describe("Free-form note stored with the weight entry"),
      },
    },
    safe(async ({ weightKg, bodyFatPct, date, time, notes }) => {
      const day = resolveDate(date, ctx.timezone);
      const at = time
        ? civilToUtc(day, time, ctx.timezone)
        : day === todayInTimezone(ctx.timezone)
          ? new Date()
          : civilToUtc(day, "08:00", ctx.timezone);
      const sampleTime = sampleTimeAt(at, ctx.timezone);
      const weightPoint = await ctx.api.createDataPoint("weight", {
        weight: {
          sampleTime,
          weightGrams: Math.round(weightKg * 1000),
          ...(notes ? { notes } : {}),
        },
      });
      const logged: Record<string, unknown> = { name: weightPoint.name ?? "", weightKg };
      if (bodyFatPct !== undefined) {
        const fatPoint = await ctx.api.createDataPoint("body-fat", {
          bodyFat: { sampleTime, percentage: bodyFatPct },
        });
        logged.bodyFat = { name: fatPoint.name ?? "", bodyFatPct };
      }
      return jsonResult({ logged, date: day });
    }),
  );

  server.registerTool(
    "delete_food_log",
    {
      title: "Delete food log entries",
      description:
        "Delete data point entries created by this server — nutrition, hydration, weight or body fat — by their full resource names (as returned by log_meal, log_food, log_water, log_weight or get_food_log). Use when the user wants to correct a mistaken entry: delete it, then log the corrected version.",
      inputSchema: {
        names: z.array(z.string()).min(1).describe("Full data point resource names to delete"),
      },
    },
    safe(async ({ names }) => {
      const byType = new Map<string, string[]>();
      for (const name of names as string[]) {
        const m = name.match(/^users\/[^/]+\/dataTypes\/([^/]+)\/dataPoints\/[^/]+$/);
        if (!m || !m[1]) return errorResult(`Invalid data point name: "${name}"`);
        const list = byType.get(m[1]) ?? [];
        list.push(name);
        byType.set(m[1], list);
      }
      let deleted = 0;
      for (const [dataType, typeNames] of byType) {
        deleted += await ctx.api.batchDeleteDataPoints(dataType, typeNames);
      }
      return jsonResult({ deleted });
    }),
  );
}

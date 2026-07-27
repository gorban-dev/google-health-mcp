// Identified-food helpers: portion resolution, client-side nutrition scaling,
// and update branching (the v4 server does not compute nutrition from `food`).
import type { HealthApiClient } from "./api.js";
import { MEAL_TYPE_MAP, civilDateOf, itemToNutritionLog } from "./mappers.js";
import type { FoodItemInput } from "./mappers.js";
import { civilToUtc, isValidDate, logInterval, mealStart } from "./time.js";
import type { Food, FoodServing, MealType, NutritionLog, SessionTimeInterval } from "./types.js";

export function resolveServing(food: Food, unitId?: string): FoodServing {
  const servings = food.servings ?? [];
  if (!unitId) {
    const def = food.defaultServing ?? servings[0];
    if (!def) throw new Error("This food has no serving units in the database.");
    return def;
  }
  const match = servings.find((s) => s.foodMeasurementUnit === unitId);
  if (!match) {
    const known = servings
      .map((s) => `${s.foodMeasurementUnit} (${s.foodMeasurementUnitDisplayName ?? "?"})`)
      .join(", ");
    throw new Error(`Unknown unitId "${unitId}". Valid units for this food: ${known}`);
  }
  return match;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Nutrition for `amount` of `serving`, scaled from the food's per-default-serving values. */
export function scaledNutrition(
  food: Food,
  serving: FoodServing,
  amount: number,
): Pick<NutritionLog, "energy" | "nutrients" | "totalFat" | "totalCarbohydrate"> {
  const factor = amount * (serving.multiplier ?? 1);
  const out: Pick<NutritionLog, "energy" | "nutrients" | "totalFat" | "totalCarbohydrate"> = {};
  if (food.energyAvg) out.energy = { kcal: Math.round(food.energyAvg.kcal * factor * 10) / 10 };
  if (food.totalFat) out.totalFat = { grams: round3(food.totalFat.grams * factor) };
  if (food.totalCarbohydrate) {
    out.totalCarbohydrate = { grams: round3(food.totalCarbohydrate.grams * factor) };
  }
  if (food.nutrients?.length) {
    out.nutrients = food.nutrients.map((n) => ({
      nutrient: n.nutrient,
      quantity: { grams: round3(n.quantity.grams * factor) },
    }));
  }
  return out;
}

export function buildIdentifiedLog(
  foodId: string,
  food: Food,
  serving: FoodServing,
  amount: number,
  mealType: MealType,
  interval: SessionTimeInterval,
): NutritionLog {
  return {
    food: foodId,
    mealType,
    interval,
    serving: { amount, foodMeasurementUnit: serving.foodMeasurementUnit },
    ...scaledNutrition(food, serving, amount),
  };
}

/** PATCH bodies must carry the interval without server-derived civil time fields. */
export function cleanInterval(interval: SessionTimeInterval): SessionTimeInterval {
  return {
    startTime: interval.startTime,
    endTime: interval.endTime,
    startUtcOffset: interval.startUtcOffset,
    endUtcOffset: interval.endUtcOffset,
  };
}

export interface FoodLogChanges {
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
  date?: string;
  time?: string;
  amount?: number;
  unitId?: string;
  foodName?: string;
  calories?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
  sugar?: number;
  /** Milligrams, like log_food. */
  sodium?: number;
  servingDescription?: string;
}

const ANONYMOUS_ONLY = [
  "foodName",
  "calories",
  "protein",
  "fat",
  "carbs",
  "fiber",
  "sugar",
  "sodium",
  "servingDescription",
] as const;
const IDENTIFIED_ONLY = ["amount", "unitId"] as const;

function nutrientOf(log: NutritionLog, nutrient: string): number | undefined {
  return log.nutrients?.find((n) => n.nutrient === nutrient)?.quantity.grams;
}

/** New interval if date/time changed; the existing one (cleaned) otherwise. */
function resolveInterval(
  log: NutritionLog,
  changes: FoodLogChanges,
  mealType: MealType,
  timezone: string,
): SessionTimeInterval {
  if (!changes.date && !changes.time) return cleanInterval(log.interval);
  const day =
    changes.date ?? civilDateOf(log.interval.startTime, log.interval.startUtcOffset) ?? "";
  const start = changes.time
    ? civilToUtc(day, changes.time, timezone)
    : mealStart(day, mealType, timezone);
  return logInterval(start, timezone);
}

/**
 * Edit a nutrition-log entry. Identified entries (with `food`) are PATCHed in
 * place; anonymous entries are not editable server-side (500) and are deleted
 * and recreated, returning the NEW name with recreated: true.
 */
export async function updateFoodLog(
  api: HealthApiClient,
  name: string,
  changes: FoodLogChanges,
  timezone: string,
): Promise<{ name: string; recreated: boolean; log: NutritionLog }> {
  const point = await api.getDataPoint(name, false);
  const log = point.nutritionLog;
  if (!log) throw new Error(`"${name}" is not a nutrition-log entry.`);
  const mealType = changes.mealType ? MEAL_TYPE_MAP[changes.mealType] : undefined;
  if (changes.mealType && !mealType) throw new Error(`Unknown mealType "${changes.mealType}".`);
  if (changes.date && !isValidDate(changes.date)) {
    throw new Error(`Invalid date "${changes.date}", expected YYYY-MM-DD.`);
  }
  if (changes.servingDescription !== undefined && changes.foodName === undefined) {
    throw new Error("servingDescription can only be changed together with foodName.");
  }

  if (log.food) {
    const rejected = ANONYMOUS_ONLY.filter((k) => changes[k] !== undefined);
    if (rejected.length > 0) {
      throw new Error(
        `This is an identified (database) entry; ${rejected.join(", ")} cannot be set — nutrition comes from the database. Change amount/unitId instead.`,
      );
    }
    const effectiveMealType = mealType ?? log.mealType ?? "ANYTIME";
    const merged: NutritionLog = {
      ...log,
      mealType: effectiveMealType,
      interval: resolveInterval(log, changes, effectiveMealType, timezone),
    };
    if (changes.amount !== undefined || changes.unitId !== undefined) {
      const foodPoint = await api.getDataPoint(log.food);
      if (!foodPoint.food) throw new Error(`Food "${log.food}" not found in the database.`);
      const serving = resolveServing(
        foodPoint.food,
        changes.unitId ?? log.serving?.foodMeasurementUnit,
      );
      const amount = changes.amount ?? log.serving?.amount ?? 1;
      merged.serving = { amount, foodMeasurementUnit: serving.foodMeasurementUnit };
      Object.assign(merged, scaledNutrition(foodPoint.food, serving, amount));
    }
    const updated = await api.updateDataPoint(name, { nutritionLog: merged });
    return { name: updated.name ?? name, recreated: false, log: merged };
  }

  const rejected = IDENTIFIED_ONLY.filter((k) => changes[k] !== undefined);
  if (rejected.length > 0) {
    throw new Error(
      `This is an anonymous entry; ${rejected.join(", ")} only apply to database entries. Change calories/protein/fat/carbs directly.`,
    );
  }
  const effectiveMealType = mealType ?? log.mealType ?? "ANYTIME";
  const displayName = changes.foodName
    ? changes.servingDescription
      ? `${changes.foodName} (${changes.servingDescription})`
      : changes.foodName
    : (log.foodDisplayName ?? "");
  // Only FoodItemInput's nutrients survive a recreate; other stored nutrients would be lost.
  const item: FoodItemInput = {
    name: displayName,
    calories: changes.calories ?? log.energy?.kcal ?? 0,
    protein: changes.protein ?? nutrientOf(log, "PROTEIN"),
    fat: changes.fat ?? log.totalFat?.grams,
    carbs: changes.carbs ?? log.totalCarbohydrate?.grams,
    fiber: changes.fiber ?? nutrientOf(log, "DIETARY_FIBER"),
    sugar: changes.sugar ?? nutrientOf(log, "SUGAR"),
    sodium: changes.sodium ?? mgOrUndefined(nutrientOf(log, "SODIUM")),
  };
  const rebuilt = itemToNutritionLog(
    item,
    effectiveMealType,
    resolveInterval(log, changes, effectiveMealType, timezone),
  );
  await api.batchDeleteDataPoints("nutrition-log", [name]);
  let created: Awaited<ReturnType<typeof api.createDataPoint>>;
  try {
    created = await api.createDataPoint("nutrition-log", { nutritionLog: rebuilt });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      `The original entry was deleted but recreating it failed: ${reason}. Re-log it with log_food using these values: ${JSON.stringify(item)}.`,
    );
  }
  return { name: created.name ?? "", recreated: true, log: rebuilt };
}

/** Stored sodium is grams; FoodItemInput takes milligrams. */
function mgOrUndefined(grams: number | undefined): number | undefined {
  return grams === undefined ? undefined : grams * 1000;
}

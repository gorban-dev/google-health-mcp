import type {
  ActiveMinutesRollupValue,
  CivilDate,
  DataPoint,
  Exercise,
  Food,
  MealType,
  NutrientQuantity,
  NutritionLog,
  NutritionLogRollupValue,
  SessionTimeInterval,
} from "./types.js";

export interface FoodItemInput {
  name: string;
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
  sugar?: number;
  /** Milligrams — converted to grams for the API. */
  sodium?: number;
  servingDescription?: string;
  confidence?: "high" | "medium" | "low";
}

export const MEAL_TYPE_MAP: Record<string, MealType> = {
  breakfast: "BREAKFAST",
  lunch: "LUNCH",
  dinner: "DINNER",
  snack: "SNACK",
};

export function itemToNutritionLog(
  item: FoodItemInput,
  mealType: MealType,
  interval: SessionTimeInterval,
): NutritionLog {
  const nutrients: NutrientQuantity[] = [];
  if (item.protein !== undefined) {
    nutrients.push({ nutrient: "PROTEIN", quantity: { grams: item.protein } });
  }
  if (item.fiber !== undefined) {
    nutrients.push({ nutrient: "DIETARY_FIBER", quantity: { grams: item.fiber } });
  }
  if (item.sugar !== undefined) {
    nutrients.push({ nutrient: "SUGAR", quantity: { grams: item.sugar } });
  }
  if (item.sodium !== undefined) {
    nutrients.push({ nutrient: "SODIUM", quantity: { grams: item.sodium / 1000 } });
  }

  const displayName = item.servingDescription
    ? `${item.name} (${item.servingDescription})`
    : item.name;

  const log: NutritionLog = {
    foodDisplayName: displayName,
    mealType,
    energy: { kcal: item.calories },
    interval,
  };
  if (item.fat !== undefined) log.totalFat = { grams: item.fat };
  if (item.carbs !== undefined) log.totalCarbohydrate = { grams: item.carbs };
  if (nutrients.length > 0) log.nutrients = nutrients;
  return log;
}

export interface MealTotals {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export function sumItems(items: FoodItemInput[]): MealTotals {
  return items.reduce<MealTotals>(
    (acc, i) => ({
      calories: acc.calories + i.calories,
      protein: acc.protein + (i.protein ?? 0),
      fat: acc.fat + (i.fat ?? 0),
      carbs: acc.carbs + (i.carbs ?? 0),
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

function nutrientGrams(log: NutritionLog, nutrient: string): number {
  return log.nutrients?.find((n) => n.nutrient === nutrient)?.quantity.grams ?? 0;
}

/** Totals across nutrition-log points already fetched from the API. */
export function sumLogs(logs: NutritionLog[]): MealTotals & { fiber: number; sugar: number } {
  return logs.reduce(
    (acc, log) => ({
      calories: acc.calories + (log.energy?.kcal ?? 0),
      protein: acc.protein + nutrientGrams(log, "PROTEIN"),
      fat: acc.fat + (log.totalFat?.grams ?? 0),
      carbs: acc.carbs + (log.totalCarbohydrate?.grams ?? 0),
      fiber: acc.fiber + nutrientGrams(log, "DIETARY_FIBER"),
      sugar: acc.sugar + nutrientGrams(log, "SUGAR"),
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0 },
  );
}

export interface FoodSearchResult {
  foodId: string;
  name: string;
  brand?: string;
  caloriesPerServing?: number;
  serving?: string;
  units: Array<{ unitId: string; name?: string; multiplier?: number }>;
  protein?: number;
  fat?: number;
  carbs?: number;
}

/** Compact a public food database point for tool output (raw points are ~300 lines). */
export function foodSearchResult(point: DataPoint): FoodSearchResult {
  const food: Food = point.food ?? {};
  const def = food.defaultServing;
  const protein = food.nutrients?.find((n) => n.nutrient === "PROTEIN")?.quantity.grams;
  return {
    foodId: point.name ?? "",
    name: food.displayName?.trim() ?? "",
    ...(food.brand ? { brand: food.brand } : {}),
    ...(food.energyAvg ? { caloriesPerServing: food.energyAvg.kcal } : {}),
    ...(def?.foodMeasurementUnitDisplayName
      ? { serving: `${def.amount ?? 1} ${def.foodMeasurementUnitDisplayName}` }
      : {}),
    units: (food.servings ?? []).map((s) => ({
      unitId: s.foodMeasurementUnit,
      ...(s.foodMeasurementUnitDisplayName ? { name: s.foodMeasurementUnitDisplayName } : {}),
      ...(s.multiplier !== undefined ? { multiplier: s.multiplier } : {}),
    })),
    ...(protein !== undefined ? { protein } : {}),
    ...(food.totalFat ? { fat: food.totalFat.grams } : {}),
    ...(food.totalCarbohydrate ? { carbs: food.totalCarbohydrate.grams } : {}),
  };
}

/** Civil-date closed-open filter for session data types, e.g. nutrition_log. */
export function civilDayFilter(snakeType: string, date: string, endDate?: string): string {
  const end = endDate ?? nextDay(date);
  const field = `${snakeType}.interval.civil_start_time`;
  return `${field} >= "${date}" AND ${field} < "${end}"`;
}

export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function civilDateToIso(date: CivilDate | undefined): string | undefined {
  if (!date) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/**
 * Civil date of an RFC-3339 timestamp shifted by a protobuf offset ("10800s").
 * List responses carry only UTC time + offset, without civil time fields.
 */
export function civilDateOf(
  time: string | undefined,
  utcOffset: string | undefined,
): string | undefined {
  if (!time) return undefined;
  const ms = Date.parse(time);
  if (!Number.isFinite(ms)) return undefined;
  const offsetSec = Number.parseFloat(utcOffset ?? "0");
  const shifted = ms + (Number.isFinite(offsetSec) ? offsetSec * 1000 : 0);
  return new Date(shifted).toISOString().slice(0, 10);
}

/** Protobuf duration string ("5400s") to whole minutes. */
export function durationToMinutes(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  const seconds = Number.parseFloat(duration);
  return Number.isFinite(seconds) ? Math.round(seconds / 60) : undefined;
}

export interface NutritionDayTotals {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  sugar: number;
}

/** Daily nutrition-log rollup value to flat per-day totals. */
export function rollupToNutritionDay(v: NutritionLogRollupValue): NutritionDayTotals {
  const grams = (n: string) => v.nutrients?.find((x) => x.nutrient === n)?.quantity?.gramsSum ?? 0;
  return {
    calories: v.energy?.kcalSum ?? 0,
    protein: grams("PROTEIN"),
    fat: v.totalFat?.gramsSum ?? 0,
    carbs: v.totalCarbohydrate?.gramsSum ?? 0,
    fiber: grams("DIETARY_FIBER"),
    sugar: grams("SUGAR"),
  };
}

/** Total active minutes across LIGHT/MODERATE/VIGOROUS levels. */
export function activeMinutesTotal(v: ActiveMinutesRollupValue | undefined): number {
  return (v?.activeMinutesRollupByActivityLevel ?? []).reduce(
    (sum, level) => sum + (Number(level.activeMinutesSum) || 0),
    0,
  );
}

/** Exercise data point to a compact workout row for tool output. */
export function exerciseToWorkout(p: DataPoint): Record<string, unknown> {
  const ex: Exercise = p.exercise ?? {};
  const m = ex.metricsSummary ?? {};
  const durationMin =
    durationToMinutes(ex.activeDuration) ??
    (ex.interval?.startTime && ex.interval.endTime
      ? Math.round((Date.parse(ex.interval.endTime) - Date.parse(ex.interval.startTime)) / 60_000)
      : undefined);
  return {
    name: p.name,
    type: ex.exerciseType,
    displayName: ex.displayName,
    start: ex.interval?.startTime,
    durationMin,
    calories: m.caloriesKcal,
    avgHeartRate: m.averageHeartRateBeatsPerMinute
      ? Number(m.averageHeartRateBeatsPerMinute)
      : undefined,
    distanceKm:
      m.distanceMillimeters !== undefined
        ? Math.round(m.distanceMillimeters / 10_000) / 100
        : undefined,
    steps: m.steps !== undefined ? Number(m.steps) : undefined,
    ...(ex.notes ? { notes: ex.notes } : {}),
  };
}

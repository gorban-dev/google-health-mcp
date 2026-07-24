import type { MealType, NutrientQuantity, NutritionLog, SessionTimeInterval } from "./types.js";

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

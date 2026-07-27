// Identified-food helpers: portion resolution, client-side nutrition scaling,
// and update branching (the v4 server does not compute nutrition from `food`).
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

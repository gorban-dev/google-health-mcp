import { describe, expect, it } from "vitest";
import { buildIdentifiedLog, cleanInterval, resolveServing, scaledNutrition } from "./food-log.js";
import type { Food } from "./types.js";

const CUP = "users/me/dataTypes/food-measurement-unit/dataPoints/251";
const GRAM = "users/me/dataTypes/food-measurement-unit/dataPoints/147";

const pumpkin: Food = {
  displayName: "100% Pure Pumpkin",
  energyAvg: { kcal: 50 },
  totalFat: { grams: 0.5 },
  totalCarbohydrate: { grams: 4 },
  nutrients: [{ nutrient: "PROTEIN", quantity: { grams: 1 } }],
  defaultServing: {
    amount: 1,
    foodMeasurementUnit: CUP,
    foodMeasurementUnitDisplayName: "cup",
    multiplier: 1,
  },
  servings: [
    { amount: 1, foodMeasurementUnit: CUP, foodMeasurementUnitDisplayName: "cup", multiplier: 1 },
    {
      amount: 1,
      foodMeasurementUnit: GRAM,
      foodMeasurementUnitDisplayName: "gram",
      multiplier: 0.109,
    },
  ],
};

describe("resolveServing", () => {
  it("defaults to the default serving", () => {
    expect(resolveServing(pumpkin).foodMeasurementUnit).toBe(CUP);
  });
  it("finds an explicit unit", () => {
    expect(resolveServing(pumpkin, GRAM).foodMeasurementUnitDisplayName).toBe("gram");
  });
  it("rejects an unknown unit, listing valid ones", () => {
    expect(() => resolveServing(pumpkin, "users/me/x/9")).toThrow(/cup/);
  });
  it("rejects a food without servings", () => {
    expect(() => resolveServing({ displayName: "X" })).toThrow(/no serving/i);
  });
});

describe("scaledNutrition", () => {
  it("scales kcal and every nutrient by amount x multiplier", () => {
    const n = scaledNutrition(pumpkin, resolveServing(pumpkin, GRAM), 200);
    expect(n.energy?.kcal).toBeCloseTo(50 * 200 * 0.109, 1);
    expect(n.nutrients?.[0]?.quantity.grams).toBeCloseTo(1 * 200 * 0.109, 3);
    expect(n.totalFat?.grams).toBeCloseTo(0.5 * 200 * 0.109, 3);
    expect(n.totalCarbohydrate?.grams).toBeCloseTo(4 * 200 * 0.109, 3);
  });
  it("treats a missing multiplier as 1 and omits absent fields", () => {
    const n = scaledNutrition({ energyAvg: { kcal: 10 } }, { foodMeasurementUnit: CUP }, 2);
    expect(n.energy?.kcal).toBe(20);
    expect(n.totalFat).toBeUndefined();
    expect(n.nutrients).toBeUndefined();
  });
  it("omits energy when the food has no energyAvg", () => {
    const n = scaledNutrition({ totalFat: { grams: 1 } }, { foodMeasurementUnit: CUP }, 2);
    expect(n.energy).toBeUndefined();
    expect(n.totalFat?.grams).toBe(2);
  });
});

describe("buildIdentifiedLog", () => {
  it("assembles the wire shape", () => {
    const interval = {
      startTime: "2026-07-27T10:00:00Z",
      endTime: "2026-07-27T10:01:00Z",
      startUtcOffset: "10800s",
      endUtcOffset: "10800s",
    };
    const log = buildIdentifiedLog(
      "users/42/dataTypes/food/dataPoints/1",
      pumpkin,
      resolveServing(pumpkin),
      2,
      "LUNCH",
      interval,
    );
    expect(log.food).toBe("users/42/dataTypes/food/dataPoints/1");
    expect(log.serving).toEqual({ amount: 2, foodMeasurementUnit: CUP });
    expect(log.energy?.kcal).toBe(100);
    expect(log.mealType).toBe("LUNCH");
    expect(log.foodDisplayName).toBeUndefined();
  });
});

describe("cleanInterval", () => {
  it("keeps only the four wire fields", () => {
    expect(
      cleanInterval({
        startTime: "a",
        endTime: "b",
        startUtcOffset: "1s",
        endUtcOffset: "2s",
        civilStartTime: { date: { year: 2026, month: 7, day: 27 } },
      }),
    ).toEqual({ startTime: "a", endTime: "b", startUtcOffset: "1s", endUtcOffset: "2s" });
  });
});

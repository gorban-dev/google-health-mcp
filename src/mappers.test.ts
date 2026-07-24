import { describe, expect, it } from "vitest";
import { civilDayFilter, itemToNutritionLog, sumItems, sumLogs } from "./mappers.js";
import type { SessionTimeInterval } from "./types.js";

const interval: SessionTimeInterval = {
  startTime: "2026-07-24T10:00:00.000Z",
  endTime: "2026-07-24T10:01:00.000Z",
  startUtcOffset: "10800s",
  endUtcOffset: "10800s",
};

describe("itemToNutritionLog", () => {
  it("maps macros into API quantity structures", () => {
    const log = itemToNutritionLog(
      { name: "Гречка", calories: 450, protein: 32, fat: 12, carbs: 55, fiber: 6 },
      "LUNCH",
      interval,
    );
    expect(log.energy).toEqual({ kcal: 450 });
    expect(log.totalFat).toEqual({ grams: 12 });
    expect(log.totalCarbohydrate).toEqual({ grams: 55 });
    expect(log.nutrients).toContainEqual({ nutrient: "PROTEIN", quantity: { grams: 32 } });
    expect(log.nutrients).toContainEqual({ nutrient: "DIETARY_FIBER", quantity: { grams: 6 } });
    expect(log.mealType).toBe("LUNCH");
  });

  it("converts sodium from milligrams to grams", () => {
    const log = itemToNutritionLog({ name: "Суп", calories: 100, sodium: 800 }, "DINNER", interval);
    expect(log.nutrients).toContainEqual({ nutrient: "SODIUM", quantity: { grams: 0.8 } });
  });

  it("appends serving description to the display name", () => {
    const log = itemToNutritionLog(
      { name: "Борщ", calories: 200, servingDescription: "1 тарелка" },
      "LUNCH",
      interval,
    );
    expect(log.foodDisplayName).toBe("Борщ (1 тарелка)");
  });

  it("omits optional fields that were not provided", () => {
    const log = itemToNutritionLog({ name: "Чай", calories: 0 }, "SNACK", interval);
    expect(log.totalFat).toBeUndefined();
    expect(log.nutrients).toBeUndefined();
  });
});

describe("totals", () => {
  it("sums item macros treating missing values as zero", () => {
    expect(
      sumItems([
        { name: "a", calories: 100, protein: 10 },
        { name: "b", calories: 200, fat: 5, carbs: 20 },
      ]),
    ).toEqual({ calories: 300, protein: 10, fat: 5, carbs: 20 });
  });

  it("sums fetched logs including nutrient array values", () => {
    const totals = sumLogs([
      {
        energy: { kcal: 450 },
        totalFat: { grams: 12 },
        totalCarbohydrate: { grams: 55 },
        nutrients: [
          { nutrient: "PROTEIN", quantity: { grams: 32 } },
          { nutrient: "SUGAR", quantity: { grams: 4 } },
        ],
        interval,
      },
      { energy: { kcal: 100 }, interval },
    ]);
    expect(totals).toEqual({ calories: 550, protein: 32, fat: 12, carbs: 55, fiber: 0, sugar: 4 });
  });
});

describe("civilDayFilter", () => {
  it("builds a closed-open one-day filter", () => {
    expect(civilDayFilter("nutrition_log", "2026-07-24")).toBe(
      'nutrition_log.interval.civil_start_time >= "2026-07-24" AND nutrition_log.interval.civil_start_time < "2026-07-25"',
    );
  });

  it("rolls over month boundaries", () => {
    expect(civilDayFilter("hydration_log", "2026-07-31")).toContain('< "2026-08-01"');
  });
});

import { describe, expect, it } from "vitest";
import {
  activeMinutesTotal,
  civilDateOf,
  civilDateToIso,
  civilDayFilter,
  durationToMinutes,
  exerciseToWorkout,
  itemToNutritionLog,
  rollupToNutritionDay,
  sumItems,
  sumLogs,
} from "./mappers.js";
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

describe("civilDateToIso", () => {
  it("pads month and day", () => {
    expect(civilDateToIso({ year: 2026, month: 7, day: 4 })).toBe("2026-07-04");
  });

  it("returns undefined for missing date", () => {
    expect(civilDateToIso(undefined)).toBeUndefined();
  });
});

describe("civilDateOf", () => {
  it("shifts a UTC timestamp by the offset before taking the date", () => {
    expect(civilDateOf("2026-07-25T22:30:00Z", "10800s")).toBe("2026-07-26");
    expect(civilDateOf("2026-07-25T22:30:00Z", "0s")).toBe("2026-07-25");
  });

  it("returns undefined for missing time", () => {
    expect(civilDateOf(undefined, "10800s")).toBeUndefined();
  });
});

describe("durationToMinutes", () => {
  it("converts protobuf duration strings to whole minutes", () => {
    expect(durationToMinutes("5400s")).toBe(90);
    expect(durationToMinutes("90.5s")).toBe(2);
  });

  it("returns undefined for missing or malformed values", () => {
    expect(durationToMinutes(undefined)).toBeUndefined();
    expect(durationToMinutes("abc")).toBeUndefined();
  });
});

describe("rollupToNutritionDay", () => {
  it("flattens a nutrition-log rollup value", () => {
    expect(
      rollupToNutritionDay({
        energy: { kcalSum: 1850 },
        totalFat: { gramsSum: 60 },
        totalCarbohydrate: { gramsSum: 210 },
        nutrients: [
          { nutrient: "PROTEIN", quantity: { gramsSum: 95 } },
          { nutrient: "DIETARY_FIBER", quantity: { gramsSum: 22 } },
          { nutrient: "SUGAR", quantity: { gramsSum: 40 } },
        ],
      }),
    ).toEqual({ calories: 1850, protein: 95, fat: 60, carbs: 210, fiber: 22, sugar: 40 });
  });

  it("defaults missing fields to zero", () => {
    expect(rollupToNutritionDay({})).toEqual({
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0,
      sugar: 0,
    });
  });
});

describe("activeMinutesTotal", () => {
  it("sums minutes across activity levels", () => {
    expect(
      activeMinutesTotal({
        activeMinutesRollupByActivityLevel: [
          { activityLevel: "LIGHT", activeMinutesSum: "120" },
          { activityLevel: "MODERATE", activeMinutesSum: "30" },
          { activityLevel: "VIGOROUS", activeMinutesSum: "15" },
        ],
      }),
    ).toBe(165);
  });

  it("returns zero for missing rollup", () => {
    expect(activeMinutesTotal(undefined)).toBe(0);
  });
});

describe("exerciseToWorkout", () => {
  it("maps an exercise data point to a compact workout row", () => {
    const workout = exerciseToWorkout({
      name: "users/me/dataTypes/exercise/dataPoints/abc",
      exercise: {
        displayName: "Run",
        exerciseType: "RUNNING",
        activeDuration: "2520s",
        interval,
        metricsSummary: {
          caloriesKcal: 420,
          distanceMillimeters: 7_150_000,
          steps: "6900",
          averageHeartRateBeatsPerMinute: "152",
        },
      },
    });
    expect(workout).toMatchObject({
      type: "RUNNING",
      displayName: "Run",
      durationMin: 42,
      calories: 420,
      avgHeartRate: 152,
      distanceKm: 7.15,
      steps: 6900,
    });
  });

  it("falls back to the interval when activeDuration is missing", () => {
    const workout = exerciseToWorkout({
      exercise: {
        exerciseType: "WALKING",
        interval: {
          ...interval,
          startTime: "2026-07-24T10:00:00.000Z",
          endTime: "2026-07-24T10:30:00.000Z",
        },
      },
    });
    expect(workout.durationMin).toBe(30);
  });
});

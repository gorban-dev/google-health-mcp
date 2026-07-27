import { describe, expect, it, vi } from "vitest";
import { HealthApiClient } from "./api.js";
import {
  buildIdentifiedLog,
  cleanInterval,
  resolveServing,
  scaledNutrition,
  updateFoodLog,
} from "./food-log.js";
import type { TokenManager } from "./oauth.js";
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

function stubTokens(): TokenManager {
  return {
    async getAccessToken() {
      return "t";
    },
  } as unknown as TokenManager;
}
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ENTRY = "users/42/dataTypes/nutrition-log/dataPoints/777";
const FOOD = "users/42/dataTypes/food/dataPoints/2000251121";
const CUP2 = "users/me/dataTypes/food-measurement-unit/dataPoints/251";
const interval = {
  startTime: "2026-07-27T10:00:00Z",
  endTime: "2026-07-27T10:01:00Z",
  startUtcOffset: "10800s",
  endUtcOffset: "10800s",
  civilStartTime: { date: { year: 2026, month: 7, day: 27 } },
};

describe("updateFoodLog: identified entries", () => {
  const identified = {
    name: ENTRY,
    nutritionLog: {
      food: FOOD,
      mealType: "LUNCH",
      interval,
      serving: { amount: 1, foodMeasurementUnit: CUP2 },
      energy: { kcal: 50 },
    },
  };
  const foodPoint = {
    name: FOOD,
    food: {
      displayName: "Pumpkin",
      energyAvg: { kcal: 50 },
      defaultServing: {
        foodMeasurementUnit: CUP2,
        foodMeasurementUnitDisplayName: "cup",
        multiplier: 1,
      },
      servings: [
        { foodMeasurementUnit: CUP2, foodMeasurementUnitDisplayName: "cup", multiplier: 1 },
      ],
    },
  };

  it("PATCHes a full body without name or civil times", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "PATCH")
        return jsonResponse(200, { done: true, response: { name: ENTRY } });
      if (String(url).includes("/food/")) return jsonResponse(200, foodPoint);
      return jsonResponse(200, identified);
    });
    const api = new HealthApiClient(stubTokens(), fetchMock);
    const res = await updateFoodLog(api, ENTRY, { mealType: "dinner", amount: 2 }, "Europe/Athens");
    expect(res).toMatchObject({ name: ENTRY, recreated: false });
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit).method === "PATCH");
    const body = JSON.parse((patch?.[1] as RequestInit).body as string);
    expect(body.name).toBeUndefined();
    expect(body.nutritionLog.mealType).toBe("DINNER");
    expect(body.nutritionLog.serving.amount).toBe(2);
    expect(body.nutritionLog.energy.kcal).toBe(100);
    expect(body.nutritionLog.interval.civilStartTime).toBeUndefined();
  });

  it("rejects anonymous-only fields on an identified entry", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, identified));
    const api = new HealthApiClient(stubTokens(), fetchMock);
    await expect(updateFoodLog(api, ENTRY, { calories: 200 }, "UTC")).rejects.toThrow(
      /identified/i,
    );
  });
});

describe("updateFoodLog: anonymous entries", () => {
  const anonymous = {
    name: ENTRY,
    nutritionLog: {
      foodDisplayName: "Гречка (1 plate)",
      mealType: "LUNCH",
      interval,
      energy: { kcal: 450 },
      nutrients: [{ nutrient: "PROTEIN", quantity: { grams: 20 } }],
    },
  };

  it("deletes and recreates with merged changes", async () => {
    const NEW = "users/42/dataTypes/nutrition-log/dataPoints/888";
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes(":batchDelete"))
        return jsonResponse(200, { done: true, response: { dataPoints: [{ name: ENTRY }] } });
      if (init?.method === "POST")
        return jsonResponse(200, { done: true, response: { name: NEW } });
      return jsonResponse(200, anonymous);
    });
    const api = new HealthApiClient(stubTokens(), fetchMock);
    const res = await updateFoodLog(api, ENTRY, { calories: 300 }, "Europe/Athens");
    expect(res).toMatchObject({ name: NEW, recreated: true });
    const create = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit).method === "POST" && !String(c[0]).includes(":batchDelete"),
    );
    const body = JSON.parse((create?.[1] as RequestInit).body as string);
    expect(body.nutritionLog.energy.kcal).toBe(300);
    expect(body.nutritionLog.foodDisplayName).toBe("Гречка (1 plate)");
    expect(body.nutritionLog.nutrients).toEqual([{ nutrient: "PROTEIN", quantity: { grams: 20 } }]);
  });

  it("reports loudly when the recreate fails after the delete", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes(":batchDelete"))
        return jsonResponse(200, { done: true, response: { dataPoints: [{ name: ENTRY }] } });
      if (init?.method === "POST") return jsonResponse(400, { error: { message: "boom" } });
      return jsonResponse(200, anonymous);
    });
    const api = new HealthApiClient(stubTokens(), fetchMock);
    await expect(updateFoodLog(api, ENTRY, { calories: 300 }, "UTC")).rejects.toThrow(
      /was deleted.*log_food/is,
    );
  });

  it("rejects servingDescription without foodName", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, anonymous));
    const api = new HealthApiClient(stubTokens(), fetchMock);
    await expect(
      updateFoodLog(api, ENTRY, { servingDescription: "2 plates" }, "UTC"),
    ).rejects.toThrow(/foodName/);
  });

  it("rejects identified-only fields on an anonymous entry", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, anonymous));
    const api = new HealthApiClient(stubTokens(), fetchMock);
    await expect(updateFoodLog(api, ENTRY, { amount: 2 }, "UTC")).rejects.toThrow(/anonymous/i);
  });

  it("surfaces a not-found error for a missing entry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(404, { error: { message: "Data point not found" } }));
    const api = new HealthApiClient(stubTokens(), fetchMock);
    await expect(updateFoodLog(api, ENTRY, { calories: 1 }, "UTC")).rejects.toThrow(/not found/i);
  });

  it("rejects a malformed date before touching the API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, anonymous));
    const api = new HealthApiClient(stubTokens(), fetchMock);
    await expect(updateFoodLog(api, ENTRY, { date: "July 27" }, "UTC")).rejects.toThrow(
      /expected YYYY-MM-DD/,
    );
  });
});

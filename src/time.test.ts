import { describe, expect, it } from "vitest";
import { civilToUtc, isValidDate, logInterval, utcOffsetSeconds } from "./time.js";

describe("utcOffsetSeconds", () => {
  it("returns +3h for Cyprus in summer (EEST)", () => {
    expect(utcOffsetSeconds(new Date("2026-07-24T12:00:00Z"), "Asia/Nicosia")).toBe(10800);
  });

  it("returns +2h for Cyprus in winter (EET)", () => {
    expect(utcOffsetSeconds(new Date("2026-01-15T12:00:00Z"), "Asia/Nicosia")).toBe(7200);
  });

  it("handles negative offsets", () => {
    expect(utcOffsetSeconds(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-18000);
  });
});

describe("civilToUtc", () => {
  it("converts local lunch time to the correct UTC instant", () => {
    const utc = civilToUtc("2026-07-24", "13:00", "Asia/Nicosia");
    expect(utc.toISOString()).toBe("2026-07-24T10:00:00.000Z");
  });

  it("handles UTC timezone as identity", () => {
    expect(civilToUtc("2026-07-24", "13:00", "UTC").toISOString()).toBe(
      "2026-07-24T13:00:00.000Z",
    );
  });
});

describe("logInterval", () => {
  it("spans exactly one minute with matching offsets", () => {
    const start = new Date("2026-07-24T10:00:00Z");
    const interval = logInterval(start, "Asia/Nicosia");
    expect(interval.startTime).toBe("2026-07-24T10:00:00.000Z");
    expect(interval.endTime).toBe("2026-07-24T10:01:00.000Z");
    expect(interval.startUtcOffset).toBe("10800s");
    expect(interval.endUtcOffset).toBe("10800s");
  });
});

describe("isValidDate", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isValidDate("2026-07-24")).toBe(true);
  });
  it("rejects other formats and garbage", () => {
    expect(isValidDate("24.07.2026")).toBe(false);
    expect(isValidDate("2026-13-40")).toBe(false);
    expect(isValidDate("today")).toBe(false);
  });
});

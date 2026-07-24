// Civil-time helpers. The API requires SessionTimeInterval with explicit UTC offsets;
// all date math here is done against the user's configured IANA timezone, never the
// server's locale.

import type { SessionTimeInterval } from "./types.js";

/** UTC offset in seconds for the given instant in the given IANA timezone. */
export function utcOffsetSeconds(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  });
  const name = dtf.formatToParts(instant).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 3600 + Number(m[3]) * 60);
}

/** Today's date (YYYY-MM-DD) in the given timezone. */
export function todayInTimezone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

/**
 * Convert local civil time in a timezone to a UTC Date.
 * Two-pass offset estimation handles DST edges well enough for meal logging.
 */
export function civilToUtc(date: string, timeHHMM: string, timeZone: string): Date {
  const naive = new Date(`${date}T${timeHHMM}:00Z`);
  let offset = utcOffsetSeconds(naive, timeZone);
  const firstGuess = new Date(naive.getTime() - offset * 1000);
  offset = utcOffsetSeconds(firstGuess, timeZone);
  return new Date(naive.getTime() - offset * 1000);
}

/**
 * Build the interval for a log entry. The API rejects zero-length intervals,
 * so every entry spans one minute.
 */
export function logInterval(start: Date, timeZone: string): SessionTimeInterval {
  const end = new Date(start.getTime() + 60_000);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    startUtcOffset: `${utcOffsetSeconds(start, timeZone)}s`,
    endUtcOffset: `${utcOffsetSeconds(end, timeZone)}s`,
  };
}

const MEAL_DEFAULT_TIME: Record<string, string> = {
  BEFORE_BREAKFAST: "07:30",
  BREAKFAST: "08:00",
  BEFORE_LUNCH: "12:00",
  LUNCH: "13:00",
  BEFORE_DINNER: "18:00",
  DINNER: "19:00",
  AFTER_DINNER: "21:00",
  SNACK: "16:00",
  ANYTIME: "12:00",
};

/**
 * Start instant for a log entry: "now" when logging for today (the usual
 * photo-at-the-table flow), otherwise a conventional hour for the meal type.
 */
export function mealStart(date: string, mealType: string, timeZone: string): Date {
  if (date === todayInTimezone(timeZone)) return new Date();
  return civilToUtc(date, MEAL_DEFAULT_TIME[mealType] ?? "12:00", timeZone);
}

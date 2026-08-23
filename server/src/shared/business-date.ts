/**
 * Salon-local "business date" helpers. All day-boundary math happens in the
 * salon's timezone so a 01:30 IST punch belongs to the IST calendar day, not UTC.
 */

/** YYYY-MM-DD in the given IANA timezone. */
export function businessDateIn(timezone: string, when: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
}

const DAY_PARTS = ["year", "month", "day", "hour", "minute", "second"] as const;

type ZonedParts = Record<(typeof DAY_PARTS)[number], number>;

function zonedParts(timezone: string, when: Date): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const result = {} as Record<string, number>;
  for (const part of formatter.formatToParts(when)) {
    if ((DAY_PARTS as readonly string[]).includes(part.type)) {
      result[part.type] = Number(part.value);
    }
  }
  // Intl can emit "24" for midnight with hour12: false — normalize.
  if (result.hour === 24) result.hour = 0;
  return result as unknown as ZonedParts;
}

/** Approximate UTC epoch for a wall-clock time in the timezone (DST-safe enough for day bounds). */
export function zonedTimeToUtc(timezone: string, dateStr: string, hour = 0, minute = 0): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = zonedParts(timezone, new Date(guess));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = guess - asUtc;
  return new Date(guess + offset);
}

export function zonedDayRange(timezone: string, dateStr: string): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(timezone, dateStr, 0, 0),
    end: zonedTimeToUtc(timezone, dateStr, 24, 0)
  };
}

export function zonedWeekday(timezone: string, dateStr: string): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(zonedTimeToUtc(timezone, dateStr, 12, 0));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

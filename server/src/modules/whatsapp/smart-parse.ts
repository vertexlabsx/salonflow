/* Deterministic natural-language parsing helpers for the WhatsApp assistant.
   Rule-based on purpose: works offline, is fast and fully testable. The LLM
   (ai-receptionist.service) remains available as a fallback layer where wired. */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };

function localToday(timezone: string): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
}

function isoKey(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

function at(daysFromToday: number, timezone: string): Date {
  const d = new Date(localToday(timezone));
  d.setDate(d.getDate() + daysFromToday);
  return d;
}

function isValidIso(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoFrom(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parses a natural date from text: "29 Aug", "Aug 29", "29/08", weekdays,
 *  "next friday", "kal/tomorrow", "parso/day after tomorrow", "today",
 *  "in N days", "next week", "this weekend". Returns YYYY-MM-DD or null.
 *  Relative/weekday references always resolve to today or a future date. */
export function parseNaturalDate(value: string, timezone = "Asia/Kolkata"): string | null {
  const lower = value.toLowerCase();
  if (!lower) return null;
  const today = localToday(timezone);

  const yyyy = lower.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (yyyy) {
    const candidate = isoFrom(Number(yyyy[1]), Number(yyyy[2]), Number(yyyy[3]));
    if (isValidIso(candidate)) return candidate;
  }

  const dmy = lower.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (dmy) {
    const candidate = isoFrom(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    if (isValidIso(candidate)) return candidate;
  }

  const dm = lower.match(/\b(\d{1,2})[-/.]([01]?\d)\b/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const candidate = isoFrom(today.getFullYear(), month, day);
      if (isValidIso(candidate)) return candidate;
    }
  }

  const monthKeys = Object.keys(MONTHS).join("|");
  const strippedDayFirst = lower.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthKeys})[a-z]*\\b`, "i"));
  if (strippedDayFirst) {
    const candidateMonth = MONTHS[strippedDayFirst[2]!.toLowerCase()];
    const candidate = isoFrom(today.getFullYear(), candidateMonth, Number(strippedDayFirst[1]));
    if (isValidIso(candidate)) return candidate;
  }
  const strippedMonthFirst = lower.match(new RegExp(`\\b(${monthKeys})[a-z]*\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));
  if (strippedMonthFirst) {
    const candidateMonth = MONTHS[strippedMonthFirst[1]!.toLowerCase()];
    const candidate = isoFrom(today.getFullYear(), candidateMonth, Number(strippedMonthFirst[2]));
    if (isValidIso(candidate)) return candidate;
  }

  if (/\b(day after tomorrow|parso)\b/.test(lower)) return isoKey(at(2, timezone), timezone);
  if (/\b(tomorrow|kal)\b/.test(lower)) return isoKey(at(1, timezone), timezone);
  if (/\b(today|aaj)\b/.test(lower)) return isoKey(at(0, timezone), timezone);

  const inDays = lower.match(/\bin\s+(\d+)\s+days?\b/);
  if (inDays) return isoKey(at(Math.max(0, Math.min(Number(inDays[1]), 60)), timezone), timezone);

  if (/\bnext week\b/.test(lower)) return isoKey(at(7, timezone), timezone);

  if (/\b(this|coming|next)?\s*weekend\b/.test(lower) || /\bweekend\b/.test(lower)) {
    for (let offset = 0; offset <= 6; offset += 1) {
      const [y, m, d] = isoKey(at(offset, timezone), timezone).split("-").map(Number);
      const weekday = new Date(Date.UTC(y || 0, (m || 1) - 1, d || 1)).getUTCDay();
      if (weekday === 6 || weekday === 0) return isoKey(at(offset, timezone), timezone);
    }
  }

  const weekdayPattern =
    /\b(next\s+)?(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\b/;
  const weekdayMatch = lower.match(weekdayPattern);
  if (weekdayMatch) {
    const target = WEEKDAYS[weekdayMatch[2]!];
    const forceNext = !!weekdayMatch[1];
    const [y, m, d] = isoKey(today, timezone).split("-").map(Number);
    const todayLocalWeekday = new Date(Date.UTC(y || 0, (m || 1) - 1, d || 1)).getUTCDay();
    let offset = (target - todayLocalWeekday + 7) % 7;
    if (offset === 0 && (forceNext || !/\b(this|tonight)\b/.test(lower))) {
      offset = 7;
    }
    return isoKey(at(offset, timezone), timezone);
  }

  return null;
}

/** Parses a time preference from text. Returns a concrete "HH:mm" when an exact
 *  clock time is spoken ("3pm", "15:00", "11 baje"), plus after/before minute
 *  windows for day-parts, "after X"/"before X" phrasings, and ranges
 *  ("4-7pm", "between 3 and 6pm", "sometime"). A `flexible: true` flag is set
 *  when the user defers the choice ("first available", "anytime", "asap"). */
export function parseTimePreference(value: string): { time?: string; after?: number; before?: number; flexible?: boolean } {
  const lower = value.toLowerCase();
  const toMinutes = (hour: number, minute: number) => hour * 60 + minute;
  const normalizeMeridiem = (hour: number, meridiem: string) => {
    if (meridiem === "pm" && hour < 12) return hour + 12;
    if (meridiem === "am" && hour === 12) return 0;
    return hour;
  };

  const betweenRange = /(?:^|\s)between\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:and|-)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(lower);
  if (betweenRange) {
    const hour1 = normalizeMeridiem(Number(betweenRange[1]), betweenRange[3] || "");
    const hour2 = normalizeMeridiem(Number(betweenRange[4]), betweenRange[6] || "");
    const minute1 = Number(betweenRange[2] || "0");
    const minute2 = Number(betweenRange[5] || "0");
    if (hour1 >= 0 && hour1 < 24 && hour2 >= 0 && hour2 < 24 && minute1 < 60 && minute2 < 60 && hour2 > hour1) {
      return { after: toMinutes(hour1, minute1), before: toMinutes(hour2, minute2) };
    }
  }

  const range = /\b(\d{1,2})(?::(\d{2}))?\s*(?:to|till|until|~|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(lower);
  if (range) {
    const hour1 = normalizeMeridiem(Number(range[1]), range[5] || "");
    const hour2 = normalizeMeridiem(Number(range[3]), range[5] || "");
    const minute1 = Number(range[2] || "0");
    const minute2 = Number(range[4] || "0");
    if (hour1 >= 0 && hour1 < 24 && hour2 >= 0 && hour2 < 24 && minute1 < 60 && minute2 < 60 && hour2 > hour1) {
      return { after: toMinutes(hour1, minute1), before: toMinutes(hour2, minute2) };
    }
  }

  const meridiem = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (meridiem) {
    const hour = normalizeMeridiem(Number(meridiem[1]), meridiem[3] || "");
    const minute = Number(meridiem[2] || "0");
    if (hour >= 0 && hour < 24 && minute < 60) {
      if (/\b(after|from|post)\b/.test(lower)) return { after: toMinutes(hour, minute) };
      if (/\b(before|till|until|by)\b/.test(lower)) return { before: toMinutes(hour, minute) };
      return { time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
    }
  }

  const clock = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour >= 0 && hour < 24 && minute < 60) {
      if (/\b(after|from|post)\b/.test(lower)) return { after: toMinutes(hour, minute) };
      if (/\b(before|till|until|by)\b/.test(lower)) return { before: toMinutes(hour, minute) };
      return { time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
    }
  }

  const baje = lower.match(/\b(\d{1,2})\s*baje\b/);
  if (baje) {
    let hour = Number(baje[1]);
    if (/\b(raat|shaam)\b/.test(lower) && hour < 12) hour += 12;
    if (hour > 0 && hour < 24 && !/\b(subah|morning)\b/.test(lower)) {
      if (/\b(after|from)\b/.test(lower)) return { after: toMinutes(hour, 0) };
      return { time: `${String(hour).padStart(2, "0")}:00` };
    }
  }

  if (/\b(morning|subah|subha)\b/.test(lower)) return { before: 12 * 60 };
  if (/\b(afternoon|noon|lunch)\b/.test(lower)) return { after: 12 * 60, before: 16 * 60 };
  if (/\b(evening|shaam)\b/.test(lower)) return { after: 16 * 60 };
  if (/\b(night|raat)\b/.test(lower)) return { after: 18 * 60 };
  if (/\b(between)\b/.test(lower) && /(?:after|from)\b.*\b(before|to|until)\b/.test(lower)) {
    const afterHit = lower.match(/(?:after|from)\s+(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?/);
    const beforeHit = lower.match(/(?:before|to|until)\s+(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?/);
    if (afterHit && beforeHit) {
      const hour1 = normalizeMeridiem(Number(afterHit[1]), afterHit[3] || "");
      const hour2 = normalizeMeridiem(Number(beforeHit[1]), beforeHit[3] || "");
      if (hour1 >= 0 && hour1 < 24 && hour2 >= 0 && hour2 < 24 && hour2 > hour1) {
        return { after: toMinutes(hour1, Number(afterHit[2] || "0")), before: toMinutes(hour2, Number(beforeHit[2] || "0")) };
      }
    }
  }
  const flexible = /\b(first available|earliest|asap|a\.s\.a\.p|whenever|anytime|any time|sometime|soonest|earliest slot|first slot|convenient)\b/.test(lower);
  return flexible ? { flexible: true } : {};
}

/** Filters (or redirects to nearest) slots given a time preference. */
export function filterSlotsByPreference(slots: Array<{ label: string; startAt: Date }>, preference: { time?: string; after?: number; before?: number } | null): Array<{ label: string; startAt: Date }> {
  if (!preference) return slots;
  if (preference.time) {
    const exact = slots.filter((slot) => slot.label === preference.time);
    if (exact.length) return exact;
    const [targetHour, targetMinute] = (preference.time || "").split(":").map(Number);
    const target = (targetHour || 0) * 60 + (targetMinute || 0);
    let nearest: Array<{ label: string; startAt: Date }> = [];
    let bestDelta = 46;
    for (const slot of slots) {
      const [h, m] = slot.label.split(":").map(Number);
      const slotMinutes = (h || 0) * 60 + (m || 0);
      const delta = Math.abs(slotMinutes - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        nearest = [slot];
      } else if (delta === bestDelta) {
        nearest.push(slot);
      }
    }
    return bestDelta <= 45 ? nearest : [];
  }
  return slots.filter((slot) => {
    const [h, m] = slot.label.split(":").map(Number);
    const value = (h || 0) * 60 + (m || 0);
    return (preference.after == null || value >= preference.after) && (preference.before == null || value <= preference.before);
  });
}

/** Cleans a name for fuzzy comparison: lowercase, alphanumerics only. */
export function normalizedNameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u0900-\u097F]/g, "");
}

function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(prev[j] + 1, current[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = current[j];
  }
  return prev[b.length];
}

export interface NameMatch {
  name: string;
  ambiguous?: boolean;
}

/** Best-effort fuzzy name resolution. Exact key match wins, then containment,
 *  then edit distance within a lenient threshold. */
export function closestName(candidates: string[], input: string): NameMatch | null {
  const inKey = normalizedNameKey(input);
  if (!inKey || !candidates.length) return null;
  const indexed = candidates.map((name) => ({ name, key: normalizedNameKey(name) }));

  const exact = indexed.filter((item) => item.key === inKey);
  if (exact.length === 1) return { name: exact[0].name };
  if (exact.length > 1) return { name: exact[0].name, ambiguous: true };

  const contained = indexed.filter((item) => item.key.includes(inKey) || inKey.includes(item.key));
  if (contained.length === 1) return { name: contained[0].name };
  if (contained.length > 1) return { name: contained[0].name, ambiguous: true };

  let best: { name: string; key: string } | null = null;
  let bestDistance = Infinity;
  for (const item of indexed) {
    const distance = levenshtein(inKey, item.key);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  const threshold = Math.max(2, Math.floor(inKey.length * 0.25));
  if (best && bestDistance <= threshold) {
    const tied = indexed.filter((item) => item !== best && levenshtein(inKey, item.key) === bestDistance);
    return { name: best.name, ambiguous: tied.length > 0 };
  }
  return null;
}

/** Resolves a slot from a user message: index, exact label, normalized clock
 *  time, or the nearest slot to a spoken time/day-part.
 *  Returns { candidate } when unambiguous, else { candidates } to ask. */
export function pickBestSlot(slots: Array<{ label: string; startAt: Date }>, text: string): { candidate?: { label: string; startAt: Date }; candidates?: Array<{ label: string; startAt: Date }> } {
  if (!slots.length) return {};
  const trimmed = text.trim();
  const exact = slots.find((slot) => slot.label === trimmed);
  if (exact) return { candidate: exact };
  const index = Number(trimmed) - 1;
  if (Number.isInteger(index) && index >= 0 && index < slots.length) return { candidate: slots[index] };

  const narrowed = filterSlotsByPreference(slots, parseTimePreference(trimmed));
  if (narrowed.length === 1) return { candidate: narrowed[0] };
  if (narrowed.length > 1) return { candidates: narrowed.slice(0, 3) };
  return { candidates: slots.slice(0, 3) };
}

export interface BookingHintFilter {
  matched: Array<{ startAt: Date; staffName?: string; serviceNames?: string[] }>;
  hasDateHint: boolean;
  hasNameHint: boolean;
}

/** Filters upcoming bookings by date/time-of-day and staff/service name hints
 *  found in the user's text. Pure and DB-free: staff names must be attached to
 *  the booking objects before calling. */
export function filterBookingsByHints(bookings: Array<{ startAt: Date; staffName?: string; serviceNames?: string[] }>, text: string, timezone: string): BookingHintFilter {
  const lower = text.toLowerCase();
  let hasDateHint = false;
  let matched = [...bookings];

  const weekPattern = /\b(this week|upcoming week|next week|this weekend|weekend|coming days)\b/;
  const explicitDate = parseNaturalDate(text, timezone);
  const dayWindow = explicitDate || (/^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null);
  const preference = parseTimePreference(text);

  const inWindow = (startAt: Date, startMin: number, endMin: number): boolean => {
    const local = new Date(startAt.toLocaleString("en-US", { timeZone: timezone }));
    const minutes = local.getHours() * 60 + local.getMinutes();
    return minutes >= startMin && minutes < endMin;
  };

  if (weekPattern.test(lower)) {
    const todayKey = isoKey(localToday(timezone), timezone);
    matched = matched.filter((booking) => {
      const key = isoKey(new Date(booking.startAt), timezone);
      if (key === todayKey) return true;
      return new Date(key) > new Date(todayKey) && new Date(key) <= new Date(isoKey(at(6, timezone), timezone));
    });
    hasDateHint = true;
  } else if (dayWindow) {
    matched = matched.filter((booking) => isoKey(new Date(booking.startAt), timezone) === dayWindow);
    hasDateHint = true;
  } else if (preference && (preference.after != null || preference.before != null)) {
    matched = matched.filter((booking) => {
      const afterOk = preference.after == null || inWindow(booking.startAt, preference.after, 24 * 60);
      const beforeOk = preference.before == null || inWindow(booking.startAt, 0, preference.before);
      return afterOk && beforeOk;
    });
    hasDateHint = true;
  }

  const inputKey = normalizedNameKey(lower);
  const inputTokens = lower.split(/[\s,./:]+/).map(normalizedNameKey).filter((token) => token.length >= 3);
  const tokenHits = (key: string): boolean => {
    if (!key) return false;
    if (key.includes(inputKey) || inputKey.includes(key)) return true;
    for (const token of inputTokens) {
      if (key.includes(token)) return true;
      if (levenshtein(token, key) <= Math.max(1, Math.floor(key.length * 0.3))) return true;
      const firstName = key.split(/\s/)[0];
      if (token === firstName) return true;
    }
    return false;
  };
  const hasStaffOrServiceHint = bookings.some((booking) => {
    const staffKey = booking.staffName ? normalizedNameKey(booking.staffName) : "";
    const serviceKeys = (booking.serviceNames || []).map(normalizedNameKey);
    return tokenHits(staffKey) || serviceKeys.some((key) => tokenHits(key));
  });

  if (hasStaffOrServiceHint) {
    matched = matched.filter((booking) => {
      const staffKey = booking.staffName ? normalizedNameKey(booking.staffName) : "";
      const serviceKeys = (booking.serviceNames || []).map(normalizedNameKey);
      return tokenHits(staffKey) || serviceKeys.some((key) => tokenHits(key));
    });
  }

  return { matched, hasDateHint, hasNameHint: hasStaffOrServiceHint };
}

/** Friendly label describing what the user asked about ("tomorrow", "Friday, 05 Sep", "this week"). */
export function hintLabel(text: string, timezone = "Asia/Kolkata"): string {
  const lower = text.toLowerCase();
  if (/\b(day after tomorrow|parso)\b/.test(lower)) return "day after tomorrow";
  if (/\b(tomorrow|kal)\b/.test(lower)) return "tomorrow";
  if (/\b(today|aaj)\b/.test(lower)) return "today";
  if (/\b(this week|upcoming week|coming days)\b/.test(lower)) return "the coming week";
  if (/\b(next week)\b/.test(lower)) return "next week";
  if (/\b(this weekend|weekend)\b/.test(lower)) return "this weekend";
  const date = parseNaturalDate(text, timezone);
  if (date) {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y || 0, (m || 1) - 1, d || 1)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }
  return "that time";
}
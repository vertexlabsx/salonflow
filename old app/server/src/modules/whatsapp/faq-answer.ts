/* Deterministic FAQ answering for the WhatsApp assistant.
   Rule-based and DB-free on purpose: the caller resolves catalogue/branch
   specifics and passes them in, so this module is pure and unit-testable. */

import { parseNaturalDate } from "./smart-parse";

export interface FaqBranchHours {
  name: string;
  timezone?: string;
  hours: Array<{ weekday: number; open: string; close: string; closed?: boolean }>;
}

export interface FaqService {
  name: string;
  pricePaise: number;
  durationMinutes: number;
}

export interface FaqStaff {
  name: string;
}

export interface FaqContext {
  salonName?: string;
  contact?: string;
  address?: string;
  personality?: "friendly" | "luxury" | "quick" | "hinglish";
  branches?: FaqBranchHours[];
  services?: FaqService[];
  staff?: FaqStaff[];
  customAnswers?: Array<{ question: string; answer: string; keywords?: string[]; enabled?: boolean }>;
}

export interface FaqResult {
  action: string;
  answer: string;
  matched: string;
}

const WEEKDAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** "9:00 AM - 7:00 PM (closed)" human-readable label for a single branch day. */
function dayLabel(hours: Array<{ weekday: number; open: string; close: string; closed?: boolean }>, weekday: number): string {
  const day = hours.find((h) => h.weekday === weekday);
  if (!day || day.closed) return "Closed";
  return `${day.open} - ${day.close}`;
}

/** Groups weekdays with identical open/close times into friendly ranges. */
function hoursSummaryFor(branch: FaqBranchHours): string {
  const condensed: Array<{ range: string; label: string }> = [];
  let start = -1;
  for (let i = 0; i < 7; i += 1) {
    const label = dayLabel(branch.hours, i);
    if (start === -1) {
      start = i;
      condensed.push({ range: WEEKDAY_ORDER[i]!, label });
      continue;
    }
    const last = condensed[condensed.length - 1]!;
    if (last.label === label) {
      last.range = last.range.includes("-") ? last.range.split(" - ")[0]! + ` - ${WEEKDAY_ORDER[i]}` : `${last.range} - ${WEEKDAY_ORDER[i]}`;
    } else {
      condensed.push({ range: WEEKDAY_ORDER[i]!, label });
    }
  }
  return condensed.map((entry) => `${entry.range}: ${entry.label}`).join("\n");
}

function money(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

/** Detects a salon-service price question and formats the answer from the injected catalogue. */
function priceAnswer(text: string, ctx: FaqContext): FaqResult | null {
  const services = ctx.services || [];
  if (!services.length) return { action: "faq_price_empty", answer: "I don't have the price list handy right now. Send MENU and choose Book appointment to see services and prices.", matched: "price" };
  const queried = text.toLowerCase().replace(/\b(what|whats|what's|is|the|for|of|a|an|ka|ki|ke|price|prices|rates?|rate|cost|kitna|kitne|kitni|fees?|charge|charges)\b/g, " ").replace(/\s+/g, " ").trim();
  let best: FaqService | null = null;
  const inputKey = queried.replace(/[^a-z0-9]/g, "").toLowerCase();
  if (inputKey.length >= 3) {
    best = services.find((s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, "") === inputKey) || null;
    if (!best) best = services.find((s) => {
      const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return key.includes(inputKey) || inputKey.includes(key);
    }) || null;
    if (!best) best = services.find((s) => s.name.toLowerCase().split(/\s+/)[0] === queried.split(/\s+/)[0]) || null;
  }
  if (best) return { action: "faq_price", answer: `${best.name} is ${money(best.pricePaise)} and takes ${best.durationMinutes} minutes. Send 'Book appointment' and I'll slot it in.`, matched: "price" };
  const shortest = services.slice().sort((a, b) => a.name.length - b.name.length)[0]!;
  return { action: "faq_price_hint", answer: `Prices start at ${money(shortest.pricePaise)} for ${shortest.name}. To see everything, send 'Book appointment' and choose a category.`, matched: "price" };
}

function serviceDetailAnswer(text: string, ctx: FaqContext, kind: "duration" | "price"): FaqResult | null {
  const services = ctx.services || [];
  if (!services.length) return null;
  const cleaned = text.toLowerCase().replace(/\b(how|long|much|many|time|take|takes|duration|minutes?|mins?|kitna|kitni|der|lagega|lagta|hai|is|the|for|of|a|an|ka|ki|ke)\b/g, " ").replace(/\s+/g, " ").trim();
  const inputKey = cleaned.replace(/[^a-z0-9]/g, "");
  const hit = services.find((service) => {
    const key = service.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return inputKey.length >= 3 && (key.includes(inputKey) || inputKey.includes(key));
  });
  if (!hit) return null;
  if (kind === "duration") return { action: "faq_duration", answer: `${hit.name} takes ${hit.durationMinutes} minutes. Price: ${money(hit.pricePaise)}.`, matched: "duration" };
  return { action: "faq_price", answer: `${hit.name} is ${money(hit.pricePaise)} and takes ${hit.durationMinutes} minutes. Send 'Book appointment' and I'll slot it in.`, matched: "price" };
}

function hoursAnswer(ctx: FaqContext): FaqResult {
  if (!ctx.branches || !ctx.branches.length) return { action: "faq_hours_empty", answer: "I can help with appointments, but I don't have the salon's opening hours loaded right now. Send 'Book appointment' to get started.", matched: "hours" };
  const single = ctx.branches.length === 1;
  const body =
    ctx.branches
      .map((branch) => (single ? hoursSummaryFor(branch) : `${branch.name}:\n${hoursSummaryFor(branch)}`))
      .join(single ? "" : "\n\n");
  return { action: "faq_hours", answer: `Here are our opening hours:\n${body}`, matched: "hours" };
}

function branchFilteredContext(text: string, ctx: FaqContext): FaqContext {
  const branches = ctx.branches || [];
  const key = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const matched = branches.filter((branch) => {
    const branchKey = branch.name.toLowerCase();
    const first = branchKey.split(/\s+/)[0] || "";
    return (first.length >= 3 && key.includes(first)) || key.includes(branchKey);
  });
  return matched.length === 1 ? { ...ctx, branches: matched } : ctx;
}

function daySpecificHoursAnswer(text: string, ctx: FaqContext): FaqResult | null {
  if (!ctx.branches || !ctx.branches.length) return null;
  const date = parseNaturalDate(text, ctx.branches[0]?.timezone || "Asia/Kolkata");
  if (!date) return null;
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year || 0, (month || 1) - 1, day || 1)).getUTCDay();
  const label = ctx.branches
    .map((branch) => {
      const hours = dayLabel(branch.hours, weekday);
      return ctx.branches!.length === 1 ? hours : `${branch.name}: ${hours}`;
    })
    .join("\n");
  return { action: "faq_day_hours", answer: `${WEEKDAY_ORDER[weekday]} hours:\n${label}`, matched: "hours" };
}

function faqFor(text: string, ctx: FaqContext): FaqResult | null {
  const lower = text.toLowerCase();
  if (!lower) return null;
  const scoped = branchFilteredContext(text, ctx);
  for (const item of ctx.customAnswers || []) {
    if (item.enabled === false || !item.answer.trim()) continue;
    const haystack = [item.question, ...(item.keywords || [])].join(" ").toLowerCase();
    const tokens = haystack.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
    if (tokens.length && tokens.some((token) => lower.includes(token))) return { action: "faq_custom", answer: item.answer.trim(), matched: "custom" };
  }

  if (matchAny(lower, [
    /\b(open|close|tim(?:e|ing)s?|hour|hours|opening|kab (?:khul|band)|kya samay|kitne baje)\b/,
    /\b(khulta|khulta hai|band hota|samay|timing)\b/
  ])) return daySpecificHoursAnswer(text, scoped) || hoursAnswer(scoped);

  if (matchAny(lower, [/\b(where|location|located|address|addresss|kahan|kahaan)\b/, /\b(area|city|branch address)\b/])) {
    return scoped.address
      ? { action: "faq_address", answer: `We're at: ${scoped.address}. Send MENU and choose Book appointment to pick a time.`, matched: "location" }
      : { action: "faq_address_empty", answer: "I don't have our address loaded right now. Send MENU and choose 'Book appointment' to get started.", matched: "location" };
  }

  if (matchAny(lower, [/\b(contact|call|phone|number|telephone|digits|whatsapp|reach you|talk)(?!.*booking)\b/, /\b(mob(?:ile)? no)\b/])) {
    if (scoped.contact) return { action: "faq_contact", answer: `You can reach us at ${scoped.contact}. Or send MENU and book an appointment right here.`, matched: "contact" };
    return { action: "faq_contact_empty", answer: "For phone support, please call the salon directly. To book with me, send 'Book appointment'.", matched: "contact" };
  }

  if (matchAny(lower, [
    /\b(book an? (express|standard|premium)|book a haircut|book appointment)\b/,
    /\b(how (do|to) book|how can i book|process|start)\b/
  ])) return { action: "faq_how_to_book", answer: "To book: send 'Book appointment', pick a service (or type one like 'haircut'), choose staff, a day and a time, then CONFIRM. I can also understand things like 'book a haircut tomorrow 3pm'.", matched: "how_to_book" };

  if (matchAny(lower, [/\b(duration|how long|kitni der|kitna time|minutes?|mins?|takes?)\b/])) return serviceDetailAnswer(text, ctx, "duration") || { action: "faq_duration_hint", answer: "Most service durations are shown while booking. Send 'Book appointment' and choose a service to see exact time and price.", matched: "duration" };

  if (matchAny(lower, [/\b(price|prices|rate|rates|cost|charge|kitna|kitne|kitni|fees)\b/])) return serviceDetailAnswer(text, ctx, "price") || priceAnswer(text, ctx);

  if (matchAny(lower, [/\b(staff|stylists?|barbers?|therapists?|team|who works|kaun|kiske saath)\b/])) {
    const names = (ctx.staff || []).map((person) => person.name).filter(Boolean).slice(0, 10);
    if (names.length) return { action: "faq_staff", answer: `Available staff:\n${names.map((name, index) => `${index + 1}. ${name}`).join("\n")}\nYou can pick staff during booking, or type something like 'book haircut with ${names[0]} tomorrow 3pm'.`, matched: "staff" };
    return { action: "faq_staff_empty", answer: "You can choose available staff during booking. Send 'Book appointment' to start.", matched: "staff" };
  }

  if (matchAny(lower, [/\b(waitlist|waiting list|wait list)\b/])) return { action: "faq_waitlist", answer: "If a slot is full, just ask and I'll add you to the waitlist and message you the moment a spot opens.", matched: "waitlist" };

  return null;
}

function applyPersonality(result: FaqResult | null, ctx: FaqContext): FaqResult | null {
  if (!result) return null;
  if (ctx.personality === "quick") return result;
  if (ctx.personality === "luxury") return { ...result, answer: `Of course. ${result.answer}` };
  if (ctx.personality === "hinglish") return { ...result, answer: `${result.answer}\nAap booking ke liye day/time bhi bhej sakte hain.` };
  return result;
}

/** Entry point for the router: returns a canned answer for FAQ-ish messages, else null. */
export function answerFaq(text: string, ctx: FaqContext): FaqResult | null {
  return applyPersonality(faqFor(text, ctx), ctx);
}

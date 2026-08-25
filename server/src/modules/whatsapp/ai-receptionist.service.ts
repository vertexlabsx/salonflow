import { loadEnv } from "../../config/env";

export interface AiReceptionistResult {
  intent: "BOOK_APPOINTMENT" | "CANCEL_APPOINTMENT" | "RESCHEDULE_APPOINTMENT" | "CHECK_APPOINTMENT" | "SERVICES" | "PRICES" | "HUMAN_SUPPORT" | "GENERAL_QUESTION";
  branch?: string;
  service?: string;
  date?: string;
  time?: string;
  language?: string;
  isSalonRelated?: boolean;
  reply?: string;
}

function normalizeTime(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  const exact = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (exact) return `${exact[1]!.padStart(2, "0")}:${exact[2]}`;
  const meridiem = trimmed.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!meridiem) return value;
  let hour = Number(meridiem[1]);
  const minute = meridiem[2] || "00";
  if (meridiem[3] === "pm" && hour < 12) hour += 12;
  if (meridiem[3] === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localFallbackEntities(text: string): Partial<AiReceptionistResult> {
  const lower = text.toLowerCase();
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const date = lower.includes("day after tomorrow") || lower.includes("parso") ? addDays(today, 2).toLocaleDateString("en-CA") : lower.includes("tomorrow") || lower.includes("kal") ? addDays(today, 1).toLocaleDateString("en-CA") : lower.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const rawTime = lower.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/)?.[0] || lower.match(/\b\d{1,2}:\d{2}\b/)?.[0] || lower.match(/\b\d{1,2}\s*baje\b/)?.[0]?.replace(/\s*baje\b/, lower.includes("raat") && !lower.includes("subah") ? "pm" : "");
  const time = normalizeTime(rawTime);
  const service = /baal|hair|haircut|kaat|kat|cut/.test(lower) ? "Haircut" : undefined;
  const isIndic = /[\u0600-\u06FF\u0900-\u097F]|\b(tu|tum|aap|kaisa|kaisi|kaise|hai|hain|mujhe|baal|kaatna|kal|parso|raat|subah|shaam|baje|chahiye|bata|batao|shukriya)\b/.test(lower);
  return { ...(date ? { date } : {}), ...(time ? { time } : {}), ...(service ? { service } : {}), language: isIndic ? "hi-Latn" : "en", isSalonRelated: /book|appointment|hair|spa|skin|nail|makeup|beard|colour|color|service|price|baal|kaat|kat|cut|salon/.test(lower) };
}

export async function extractReceptionistIntent(text: string): Promise<AiReceptionistResult> {
  const lower = text.toLowerCase();
  const local = localFallbackEntities(text);
  const fallback: AiReceptionistResult = { ...(lower.includes("cancel") ? { intent: "CANCEL_APPOINTMENT" } : lower.includes("reschedule") || lower.includes("instead") || lower.includes("come at") ? { intent: "RESCHEDULE_APPOINTMENT" } : lower.includes("price") || lower.includes("rate") ? { intent: "PRICES" } : lower.includes("service") ? { intent: "SERVICES" } : local.isSalonRelated ? { intent: "BOOK_APPOINTMENT" } : { intent: "GENERAL_QUESTION" }), ...local };
  const env = loadEnv();
  if (!env.OPENAI_API_KEY) return fallback;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `You are a multilingual salon WhatsApp receptionist for SalonFlow. Understand English, Hindi, Hinglish, Urdu, Punjabi-style roman text, and mixed language. Today is ${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })} in Asia/Kolkata.

Return only compact JSON with: intent, branch, service, date, time, language, isSalonRelated, reply.

Intent must be one of: BOOK_APPOINTMENT, CANCEL_APPOINTMENT, RESCHEDULE_APPOINTMENT, CHECK_APPOINTMENT, SERVICES, PRICES, HUMAN_SUPPORT, GENERAL_QUESTION.

Use YYYY-MM-DD date and HH:mm 24-hour time. Convert natural phrases: kal/tomorrow, parso/day after tomorrow, raat ko 11 baje, shaam 5 baje, subah 10 baje. Map baal kaatna / hair cut / haircut to Haircut.

Language must reflect the user's language and script. If user writes roman Hindi/Hinglish like "tu kaisa hai", use language "hi-Latn" and reply in roman Hindi/Hinglish. If user writes Urdu script, reply in Urdu script. If user writes English, reply in English.

For casual/non-booking messages like "tu kaisa hai?", "how are you?", or greetings, set intent GENERAL_QUESTION, isSalonRelated false, and provide a short same-language friendly receptionist reply that gently offers salon help. Example for "tu kaisa hai?": {"intent":"GENERAL_QUESTION","language":"hi-Latn","isSalonRelated":false,"reply":"Main theek hoon, shukriya. Appointment book karni ho toh service aur time bata do."}

For unrelated personal statements like "kal mein ghar jaunga", set isSalonRelated false and reply in the same language that you can only help with salon appointments, services, prices, cancellations, reschedules, or staff support.

Never invent price, staff, availability, or booking status.` },
          { role: "user", content: text.slice(0, 500) }
        ]
      })
    });
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || "{}") as Partial<AiReceptionistResult>;
    return { ...fallback, ...parsed, intent: parsed.intent || fallback.intent, date: parsed.date || fallback.date, time: normalizeTime(parsed.time) || fallback.time, service: parsed.service || fallback.service, language: parsed.language || fallback.language, isSalonRelated: parsed.isSalonRelated ?? fallback.isSalonRelated } as AiReceptionistResult;
  } catch {
    return fallback;
  }
}

import { loadEnv } from "../../config/env";

export interface AiReceptionistResult {
  intent: "BOOK_APPOINTMENT" | "CANCEL_APPOINTMENT" | "RESCHEDULE_APPOINTMENT" | "CHECK_APPOINTMENT" | "SERVICES" | "PRICES" | "HUMAN_SUPPORT" | "GENERAL_QUESTION";
  service?: string;
  date?: string;
  time?: string;
}

function normalizeTime(value?: string): string | undefined {
  if (!value) return undefined;
  const exact = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (exact) return `${exact[1]!.padStart(2, "0")}:${exact[2]}`;
  return value;
}

export async function extractReceptionistIntent(text: string): Promise<AiReceptionistResult> {
  const lower = text.toLowerCase();
  const fallback: AiReceptionistResult = lower.includes("cancel") ? { intent: "CANCEL_APPOINTMENT" } : lower.includes("reschedule") ? { intent: "RESCHEDULE_APPOINTMENT" } : lower.includes("price") || lower.includes("rate") ? { intent: "PRICES" } : /book|appointment|hair|spa|skin|nail|makeup|beard|colour|color|service/.test(lower) ? { intent: "BOOK_APPOINTMENT" } : { intent: "GENERAL_QUESTION" };
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
          { role: "system", content: `Extract salon WhatsApp receptionist intent and entities. Today is ${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })} in Asia/Kolkata. Return only compact JSON with intent, service, date, time. Use YYYY-MM-DD date and HH:mm 24-hour time. Convert phrases like tomorrow, day after tomorrow, 3pm, evening. Never invent price, staff, availability, or status.` },
          { role: "user", content: text.slice(0, 500) }
        ]
      })
    });
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || "{}") as Partial<AiReceptionistResult>;
    return { ...fallback, ...parsed, intent: parsed.intent || fallback.intent, time: normalizeTime(parsed.time) } as AiReceptionistResult;
  } catch {
    return fallback;
  }
}

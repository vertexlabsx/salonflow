/* OpenAI tool-calling concierge for the WhatsApp assistant.
   Phase 2 of the "smarter chat" plan: answers open questions (prices, hours,
   availability, booking lookups, greetings) in the customer's own language
   using the salon's REAL catalogue and schedule. Only ever operates on
   fallback/menu paths in the router, and any booking it proposes is re-verified
   deterministically before the customer confirms. */

import { loadEnv } from "../../config/env";
import { SalonModel } from "../../models/salon.model";
import { BranchModel } from "../../models/branch.model";
import { ServiceModel } from "../../models/service.model";
import { UserModel } from "../../models/user.model";
import { AppointmentModel } from "../../models/appointment.model";
import { AppointmentSlotLockModel } from "../../models/appointment-slot-lock.model";
import { ScheduleModel } from "../../models/schedule.model";
import { LeaveModel } from "../../models/leave.model";
import { CustomerModel } from "../../models/customer.model";
import { zonedTimeToUtc, zonedWeekday } from "../../shared/business-date";
import { parseNaturalDate } from "./smart-parse";

export interface ConciergeProposal {
  branchId: string;
  serviceIds: string[];
  serviceNames: string[];
  staffId: string;
  staffName: string;
  date: string;
  startAt: string;
  label: string;
  durationMinutes: number;
  value: number;
}

export interface ConciergeResult {
  reply: string;
  proposal?: ConciergeProposal;
  handoff?: boolean;
}

interface ConciergeInput {
  text: string;
  salonId: string;
  branchId: string;
  customerId: string;
}

const BOOKING_BLOCKING_STATUSES = ["pending", "booked", "confirmed", "arrived", "in_service"];

function minutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return (h === 24 ? 0 : h) * 60 + m;
}

function localDateKey(timezone: string, when: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
}

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

interface SlotReport {
  label: string;
  staffId: string;
  staffName: string;
  startAt: Date;
}

async function isBlockFree(input: { salonId: string; branchId: string; staffId: string; startAt: Date; endAt: Date; date: string; timezone: string }): Promise<boolean> {
  const [schedule, leave, overlap, lockOverlap] = await Promise.all([
    ScheduleModel.findOne({ salonId: input.salonId, branchId: input.branchId, staffId: input.staffId, scheduleDate: input.date, status: { $ne: "cancelled" } }),
    LeaveModel.findOne({ salonId: input.salonId, staffId: input.staffId, status: { $in: ["pending", "approved"] }, startDate: { $lte: input.date }, endDate: { $gte: input.date } }),
    AppointmentModel.findOne({ salonId: input.salonId, staffId: input.staffId, status: { $in: BOOKING_BLOCKING_STATUSES }, startAt: { $lt: input.endAt }, endAt: { $gt: input.startAt } }),
    AppointmentSlotLockModel.findOne({ salonId: input.salonId, staffId: input.staffId, slotAt: { $gte: input.startAt, $lt: input.endAt } })
  ]);
  if (!schedule || leave || overlap || lockOverlap) return false;
  const start = localMinutes(input.startAt, input.timezone);
  const end = localMinutes(input.endAt, input.timezone);
  return start >= minutes(schedule.startTime) && end <= minutes(schedule.endTime);
}

async function findSlots(input: { salonId: string; branchId: string; staffId: string; staffName: string; date: string; durationMinutes: number; maxSlots?: number }): Promise<SlotReport[]> {
  const branch = await BranchModel.findOne({ _id: input.branchId, salonId: input.salonId });
  if (!branch || !input.durationMinutes) return [];
  const timezone = branch.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
  const dayHours = branch.hours.find((hours) => hours.weekday === zonedWeekday(timezone, input.date));
  if (!dayHours || dayHours.closed) return [];
  const interval = Math.max(5, branch.slotIntervalMinutes || 15);
  const open = minutes(dayHours.open);
  const close = minutes(dayHours.close);
  const today = localDateKey(timezone);
  const nowMinutes = input.date === today ? localMinutes(new Date(), timezone) + interval : open;
  const firstSlot = Math.max(open, Math.ceil(nowMinutes / interval) * interval);
  const found: SlotReport[] = [];
  for (let slotMinute = firstSlot; slotMinute + input.durationMinutes <= close; slotMinute += interval) {
    const label = `${String(Math.floor(slotMinute / 60)).padStart(2, "0")}:${String(slotMinute % 60).padStart(2, "0")}`;
    const [hour, minute] = label.split(":").map(Number);
    const startAt = zonedTimeToUtc(timezone, input.date, hour || 0, minute || 0);
    const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);
    if (await isBlockFree({ salonId: input.salonId, branchId: input.branchId, staffId: input.staffId, startAt, endAt, date: input.date, timezone })) {
      found.push({ label, staffId: input.staffId, staffName: input.staffName, startAt });
      if (found.length >= (input.maxSlots ?? 12)) break;
    }
  }
  return found;
}

async function toolListBranches(salonId: string): Promise<string> {
  const branches = await BranchModel.find({ salonId, status: "active" }).sort({ createdAt: 1 }).lean();
  return branches.length ? JSON.stringify(branches.map((b) => ({ branch_id: String(b._id), name: b.name }))) : "[]";
}

async function toolListServices(salonId: string, branchId: string): Promise<string> {
  const services = await ServiceModel.find({
    salonId,
    status: "active",
    $or: [{ branchIds: branchId }, { branchIds: { $size: 0 } }]
  })
    .select("name category pricePaise durationMinutes eligibleStaffIds")
    .sort({ name: 1 })
    .lean();
  return JSON.stringify(
    services.map((s) => ({
      id: String(s._id),
      name: s.name,
      category: s.category || "Services",
      price: inr(s.pricePaise || 0),
      price_paise: s.pricePaise || 0,
      duration_minutes: s.durationMinutes || 0
    }))
  );
}

async function toolBusinessHours(salonId: string, branchId: string): Promise<string> {
  const branch = await BranchModel.findOne({ _id: branchId, salonId }).lean();
  if (!branch) return "Branch not found.";
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return JSON.stringify(
    branch.hours.map((h) => ({ day: days[h.weekday] || h.weekday, open: h.open, close: h.close, closed: Boolean(h.closed) }))
  );
}

async function toolCheckAvailability(input: { salonId: string; branchId: string; serviceNames: string[]; date: string; preferredTime?: string | null; staffName?: string | null }): Promise<string> {
  const date = parseNaturalDate(input.date) || input.date;
  const services = await ServiceModel.find({
    salonId: input.salonId,
    status: "active",
    $or: [{ branchIds: input.branchId }, { branchIds: { $size: 0 } }],
    name: { $in: input.serviceNames }
  })
    .select("name pricePaise durationMinutes eligibleStaffIds")
    .sort({ name: 1 })
    .lean();
  if (!services.length) return JSON.stringify({ ok: false, reason: "None of those services exist at this branch." });
  const unmatched = input.serviceNames.filter((name) => !services.some((s) => s.name === name));
  const duration = services.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  const eligibleIds = services.length ? services.map((s) => s.eligibleStaffIds || []).reduce((common, ids) => common.filter((id) => ids.includes(id))) : [];
  const staffFilter = eligibleIds.length ? { staffId: { $in: eligibleIds } } : {};
  const staff = await UserModel.find({ salonId: input.salonId, branchIds: input.branchId, status: "active", ...staffFilter }).sort({ name: 1 });
  const preferred = input.staffName ? staff.filter((u) => u.name.toLowerCase().includes(input.staffName!.toLowerCase()) || (u.staffId || "").toLowerCase().includes(input.staffName!.toLowerCase())) : staff;
  const pool = (preferred.length ? preferred : staff).map((u) => ({ staffId: u.staffId || String(u._id), staffName: u.name }));
  if (!pool.length) return JSON.stringify({ ok: false, reason: "No staff can perform all those services at this branch." });

  const perStaff: Array<{ staffName: string; slots: string[] }> = [];
  for (const p of pool.slice(0, 5)) {
    const slots = await findSlots({ salonId: input.salonId, branchId: input.branchId, staffId: p.staffId, staffName: p.staffName, date, durationMinutes: duration, maxSlots: 12 });
    for (const slot of slots) {
      const missing = perStaff.find((entry) => entry.staffName === p.staffName);
      if (missing) missing.slots.push(slot.label);
      else perStaff.push({ staffName: p.staffName, slots: [slot.label] });
    }
  }
  const flattened = perStaff.map((entry) => ({ staffName: entry.staffName, slots: entry.slots }));
  if (!flattened.length) return JSON.stringify({ ok: false, reason: `No free slots for ${services.map((s) => s.name).join(" + ")} on ${date}.` });
  return JSON.stringify({
    ok: true,
    date,
    service_names: services.map((s) => s.name),
    duration_minutes: duration,
    unmatched_services: unmatched,
    slots: flattened
  });
}

async function toolUpcomingBookings(salonId: string, customerId: string, branchId: string): Promise<string> {
  const appointments = await AppointmentModel.find({ salonId, customerId, status: { $in: ["booked", "confirmed"] }, startAt: { $gte: new Date() } })
    .select("startAt serviceNames staffId status branchId")
    .sort({ startAt: 1 })
    .limit(10)
    .lean();
  const staffIds = [...new Set(appointments.map((a) => a.staffId).filter(Boolean) as string[])];
  const staff = staffIds.length ? await UserModel.find({ salonId, staffId: { $in: staffIds } }).select("staffId name").lean() : [];
  const staffNameById = new Map(staff.map((u) => [u.staffId, u.name]));
  return JSON.stringify(
    appointments.map((a) => ({
      id: String(a._id),
      start_at: a.startAt.toISOString(),
      services: a.serviceNames || [],
      staff: staffNameById.get(a.staffId) || null,
      status: a.status,
      branch_id: a.branchId
    }))
  );
}

async function toolCustomerProfile(salonId: string, customerId: string, branchId: string): Promise<string> {
  const customer = await CustomerModel.findById(customerId).lean();
  if (!customer) return "Profile not available.";
  const preferredStaffIds = (customer.preferredStaffIds || []).filter(Boolean) as string[];
  const staff = preferredStaffIds.length ? await UserModel.find({ salonId, staffId: { $in: preferredStaffIds } }).select("staffId name").lean() : [];
  const favoriteIds = (customer.favoriteServiceIds || []).filter(Boolean) as string[];
  const names = favoriteIds.length ? await ServiceModel.find({ salonId, _id: { $in: favoriteIds } }).select("name").lean() : [];
  return JSON.stringify({
    name: customer.name || null,
    phone: customer.normalizedPhone || null,
    visit_count: Number(customer.visitCount || 0),
    last_booked_at: customer.lastBookedAt ? customer.lastBookedAt.toISOString() : null,
    preferred_staff: staff.map((u) => u.name),
    favorite_services: names.map((s) => s.name)
  });
}

interface ToolContext {
  salonId: string;
  branchId: string;
  customerId: string;
}

const TOOLS = [
  { type: "function", function: { name: "list_branches", description: "List the salon's active branches. Use before asking the user which branch.", parameters: { type: "object", properties: {}, required: [] } } },
  {
    type: "function",
    function: {
      name: "list_services",
      description: "List services (name, price, duration, category) available at a branch. Use to answer price/service questions.",
      parameters: { type: "object", properties: { branch_id: { type: "string", description: "Branch id; omit when the salon has one branch." } }, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_business_hours",
      description: "Get opening hours for a branch (today/open-close per weekday). Use to answer timing/opening questions.",
      parameters: { type: "object", properties: { branch_id: { type: "string" } }, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Check free booking slots for the given services on a date. You MUST call this before ever claiming a slot is free or proposing a booking time. Preferred_time like HH:mm is optional.",
      parameters: {
        type: "object",
        properties: {
          branch_id: { type: "string" },
          service_names: { type: "array", items: { type: "string" }, description: "Exact catalogue service names, from list_services." },
          date: { type: "string", description: "YYYY-MM-DD." },
          preferred_time: { type: "string", description: "Optional HH:mm." },
          staff_name: { type: "string", description: "Optional staff preference." }
        },
        required: ["service_names", "date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_bookings",
      description: "List the customer's upcoming appointments. Use to answer 'my bookings', 'when is my next appointment', or similar.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_customer_profile",
      description: "Return the customer's visit count, last booked date, preferred staff and favourite services. Use to personalise replies.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "talk_to_human",
      description: "Call when the customer explicitly asks for a human/owner/manager or you cannot help.",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: [] }
    }
  }
];

function parseJsonReply(content: string): { reply: string; book: Record<string, unknown> | null; handoff: boolean } {
  const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned;
  try {
    const parsed = JSON.parse(candidate) as { reply?: unknown; book?: unknown; handoff?: unknown };
    return {
      reply: typeof parsed.reply === "string" ? parsed.reply : candidate,
      book: parsed.book && typeof parsed.book === "object" && !Array.isArray(parsed.book) ? (parsed.book as Record<string, unknown>) : null,
      handoff: parsed.handoff === true || /talk_to_human/i.test(content)
    };
  } catch {
    return { reply: cleaned, book: null, handoff: /talk_to_human/i.test(content) };
  }
}

/** Runs one concierge exchange. Returns null when the exchange does not produce
 *  a usable reply (e.g. not enabled, no API key, or the model misbehaved). */
export async function conciergeChat(input: ConciergeInput): Promise<ConciergeResult | null> {
  const env = loadEnv();
  if (!env.WHATSAPP_CONCIERGE_ENABLED || !env.OPENAI_API_KEY) return null;
  const salon = await SalonModel.findById(input.salonId).lean();
  const timezone = salon?.timezone || env.SALON_TIMEZONE || "Asia/Kolkata";
  const today = localDateKey(timezone);
  const tomorrow = localDateKey(timezone, new Date(Date.now() + 24 * 60 * 60_000));
  const model = env.WHATSAPP_CONCIERGE_MODEL || env.OPENAI_MODEL || "gpt-4o-mini";
  const maxRounds = Math.max(1, env.WHATSAPP_CONCIERGE_MAX_TURNS || 4);

  const system = `You are a multilingual salon receptionist (concierge) for "${salon?.name || "the salon"}". Today is ${today} and tomorrow is ${tomorrow} (Asia/Kolkata). The customer's home branch id is ${input.branchId}.

Reply in the exact language and script the customer uses (English, Hindi, roman Hinglish, Punjabi, Urdu). Keep replies short, friendly and WhatsApp-style.

Rules:
- NEVER invent prices, staff names, opening hours, or availability. Only talk about data you fetched with a tool.
- Answer price/service questions by calling list_services. Answer timing questions with get_business_hours. Answer availability with check_availability.
- If the customer wants to book, call check_availability and then propose a SPECIFIC slot (e.g. "15:00 with Ananya") using only a slot returned by the tool. Then set book with branch_id, service_names, staff_id, date, time_label.
- For booking/cancellation/rescheduling of existing bookings, you may answer get_upcoming_bookings questions, but direct the customer's transactional commands to reply MENU.
- Greetings and small talk: answer warmly and offer salon help.
- Call talk_to_human only when asked for a person.
- End every turn with a single JSON object of the form {"reply": "...", "book": {optional}} — nothing else.`;

  const messages: Array<Record<string, unknown>> = [{ role: "system", content: system }, { role: "user", content: input.text.slice(0, 500) }];

  let rounds = 0;
  let finalContent = "";
  while (rounds < maxRounds) {
    rounds += 1;
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0, messages, tools: TOOLS })
      });
    } catch {
      return null;
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    };
    const message = payload.choices?.[0]?.message;
    if (!message) return null;
    if (!message.tool_calls?.length) {
      finalContent = message.content || "";
      break;
    }
    messages.push({ role: "assistant", content: message.content || null, tool_calls: message.tool_calls.map((toolCall) => ({ id: toolCall.id, type: "function", function: toolCall.function })) });
    const context: ToolContext = { salonId: input.salonId, branchId: input.branchId, customerId: input.customerId };
    for (const toolCall of message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      let output = "";
      switch (toolCall.function.name) {
        case "list_branches":
          output = await toolListBranches(input.salonId);
          break;
        case "list_services":
          output = await toolListServices(input.salonId, typeof args.branch_id === "string" ? args.branch_id : input.branchId);
          break;
        case "get_business_hours":
          output = await toolBusinessHours(input.salonId, typeof args.branch_id === "string" ? args.branch_id : input.branchId);
          break;
        case "check_availability":
          output = await toolCheckAvailability({
            salonId: input.salonId,
            branchId: typeof args.branch_id === "string" ? args.branch_id : input.branchId,
            serviceNames: (args.service_names as string[]) || [],
            date: typeof args.date === "string" ? args.date : today,
            preferredTime: typeof args.preferred_time === "string" ? args.preferred_time : null,
            staffName: typeof args.staff_name === "string" ? args.staff_name : null
          });
          break;
        case "get_upcoming_bookings":
          output = await toolUpcomingBookings(input.salonId, input.customerId, input.branchId);
          break;
        case "get_customer_profile":
          output = await toolCustomerProfile(input.salonId, input.customerId, input.branchId);
          break;
        case "talk_to_human":
          output = "true";
          break;
        default:
          output = "Unknown tool.";
      }
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: output });
    }
  }
  if (!finalContent) return null;

  const parsed = parseJsonReply(finalContent);
  const reply = parsed.reply.trim();
  if (!reply) return null;

  if (parsed.book) {
    const book = parsed.book;
    const serviceNames = Array.isArray(book.service_names) ? (book.service_names as unknown[]).filter((v): v is string => typeof v === "string") : typeof book.service_names === "string" ? [book.service_names] : [];
    const staffId = typeof book.staff_id === "string" ? book.staff_id : "";
    const label = typeof book.time_label === "string" ? book.time_label : "";
    const date = typeof book.date === "string" ? book.date : "";
    const branchId = typeof book.branch_id === "string" && book.branch_id ? String(book.branch_id) : input.branchId;
    if (serviceNames.length && staffId && label && date) {
      const services = await ServiceModel.find({
        salonId: input.salonId,
        status: "active",
        $or: [{ branchIds: branchId }, { branchIds: { $size: 0 } }],
        name: { $in: serviceNames }
      })
        .select("_id name pricePaise durationMinutes eligibleStaffIds")
        .lean();
      if (services.length) {
        const staff = await UserModel.findOne({ salonId: input.salonId, staffId, status: "active" }).select("name").lean();
        if (staff) {
          const duration = services.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
          const [hour, minute] = label.split(":").map(Number);
          const startAt = zonedTimeToUtc(timezone, date, hour || 0, minute || 0);
          return {
            reply,
            proposal: {
              branchId,
              serviceIds: services.map((s) => String(s._id)),
              serviceNames: services.map((s) => s.name),
              staffId,
              staffName: staff.name,
              date,
              startAt: startAt.toISOString(),
              label,
              durationMinutes: duration,
              value: services.reduce((sum, s) => sum + (s.pricePaise || 0), 0)
            }
          };
        }
      }
    }
  }

  return { reply, handoff: parsed.handoff };
}
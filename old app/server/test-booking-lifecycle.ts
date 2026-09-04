import "dotenv/config";
import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import { createApp } from "./src/app";
import { AppointmentModel } from "./src/models/appointment.model";
import { AppointmentSlotLockModel } from "./src/models/appointment-slot-lock.model";
import { CustomerModel } from "./src/models/customer.model";
import { WhatsAppBookingSessionModel } from "./src/models/whatsapp-booking-session.model";
import { BranchModel } from "./src/models/branch.model";
import { ServiceModel } from "./src/models/service.model";
import { ScheduleModel } from "./src/models/schedule.model";
import { UserModel } from "./src/models/user.model";
import { zonedTimeToUtc } from "./src/shared/business-date";

const PHONE = "919082864488";
const PROFILE = "Garv Test";
const salonId = "salon_realistic_test";
const branchId = `${salonId}_bandra`;
const BLOCKING = ["pending", "booked", "confirmed", "arrived", "in_service"];
const SLOT_LABELS = ["11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30"];

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(days: number): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return new Date(Date.UTC(Number(parts.find((p) => p.type === "year")!.value), Number(parts.find((p) => p.type === "month")!.value) - 1, Number(parts.find((p) => p.type === "day")!.value) + days, 12, 0));
}

function slotInstants(startAt: Date, endAt: Date): Date[] {
  const slots: Date[] = [];
  for (let ts = startAt.getTime(); ts < endAt.getTime(); ts += 5 * 60_000) slots.push(new Date(ts));
  return slots.length ? slots : [startAt];
}

let msgSeq = 0;
async function sendMsg(body: string) {
  msgSeq += 1;
  const payload = JSON.stringify({
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "1274287792434534" },
          contacts: [{ profile: { name: PROFILE }, wa_id: PHONE }],
          messages: [{
            id: `wamid.lifecycle_${Date.now()}_${msgSeq}`,
            from: PHONE,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "text",
            text: { body }
          }]
        }
      }]
    }]
  });
  const sign = process.env.WA_WEBHOOK_SECRET
    ? createHmac("sha256", process.env.WA_WEBHOOK_SECRET).update(payload, "utf8").digest("hex")
    : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sign) headers["x-hub-signature-256"] = `sha256=${sign}`;
  else headers["x-test-webhook"] = "true";
  const res = await fetch("http://127.0.0.1:4000/api/v1/whatsapp/webhook", {
    method: "POST",
    headers,
    body: payload
  });
  const json = (await res.json()) as { data?: { action?: string; reply?: string } };
  const action = json.data?.action || "";
  const reply = (json.data?.reply || "").split("\n").slice(0, 6).join("\n  ");
  console.log(`\n>>> "${body}"  [action=${action}]`);
  console.log(`    ${reply}`);
  if (action === "management_error") {
    console.log("    FULL:", JSON.stringify(json.data));
  }
  if (!res.ok) throw new Error(`Webhook failed (${res.status}): ${JSON.stringify(json)}`);
  return json.data || {};
}

async function findFreeStart(staffId: string, date: string, duration: number): Promise<Date | null> {
  for (const label of SLOT_LABELS) {
    const [h, m] = label.split(":").map(Number);
    const startAt = zonedTimeToUtc("Asia/Kolkata", date, h || 0, m || 0);
    const endAt = new Date(startAt.getTime() + duration * 60_000);
    const overlap = await AppointmentModel.findOne({ salonId, staffId, status: { $in: BLOCKING }, startAt: { $lt: endAt }, endAt: { $gt: startAt } });
    if (overlap) continue;
    const lock = await AppointmentSlotLockModel.findOne({ salonId, staffId, slotAt: { $gte: startAt, $lt: endAt } });
    if (lock) continue;
    return startAt;
  }
  return null;
}

async function createTestAppointment(customerId: string, staffId: string, serviceId: string, serviceName: string, durationMinutes: number, value: number, date: string, status: string) {
  const startAt = await findFreeStart(staffId, date, durationMinutes);
  if (!startAt) throw new Error(`No free start for ${staffId} on ${date}`);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  const appointment = await AppointmentModel.create({ salonId, branchId, staffId, customerId, customerName: PROFILE, serviceIds: [serviceId], serviceNames: [serviceName], durationMinutes, value, startAt, endAt, status, source: "whatsapp", paymentStatus: status === "cancelled" ? "failed" : "not_required", version: 1 });
  if (BLOCKING.includes(status)) {
    await AppointmentSlotLockModel.create(slotInstants(startAt, endAt).map((slotAt) => ({ salonId, branchId, staffId, appointmentId: String(appointment._id), slotAt })));
  }
  return appointment;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function main() {
  const external = !!process.env.WA_WEBHOOK_SECRET;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  if (!external) {
    createApp().listen(4000, "127.0.0.1", () => console.log("Server on http://127.0.0.1:4000"));
    await new Promise((r) => setTimeout(r, 1000));
  }
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI required");
  await mongoose.connect(mongoUri);

  await cleanupTestData();
  console.log("Seeded tenant:", salonId, "branch:", branchId);

  const branch = await BranchModel.findOne({ _id: branchId, salonId });
  assert(!!branch, "bandra branch exists");
  const allStaff = (await ScheduleModel.aggregate([
    { $match: { salonId, branchId: branchId, status: "scheduled", scheduleDate: { $gte: dateKey(addDays(1)) } } },
    { $group: { _id: "$staffId", dates: { $push: "$scheduleDate" } } },
    { $match: { $expr: { $gte: [{ $size: "$dates" }, 2] } } },
    { $sort: { _id: 1 } },
    { $limit: 5 }
  ])) as Array<{ _id: string; dates: string[] }>;
  assert(allStaff.length > 0, "a staff with two future scheduled dates exists");
  const staffId = allStaff[0]._id;
  const scheduleDates = allStaff[0].dates.sort();
  assert(scheduleDates.length >= 2, "staff has at least two future scheduled dates");
  const dateA = scheduleDates[0];
  const dateB = scheduleDates[1];
  console.log("Chosen staff:", staffId, "dates:", dateA, dateB);

  const service = await ServiceModel.findOne({ salonId, status: "active", branchIds: branchId, eligibleStaffIds: staffId, durationMinutes: 30 }).sort({ durationMinutes: 1 }).lean();
  assert(!!service, "a 30-min service for the chosen staff exists");
  const staffUser = await UserModel.findOne({ salonId, staffId }).lean();
  const staffName = staffUser?.name || staffId;

  const customer = await CustomerModel.findOneAndUpdate(
    { salonId, normalizedPhone: PHONE },
    { $setOnInsert: { branchId, source: "whatsapp" }, $set: { name: PROFILE, interactionStatus: "active" } },
    { upsert: true, new: true }
  );
  const customerId = String(customer._id);

  const upcomingConfirmed = await createTestAppointment(customerId, staffId, String(service._id), service.name, service.durationMinutes, service.pricePaise, dateA, "confirmed");
  const upcomingBooked = await createTestAppointment(customerId, staffId, String(service._id), service.name, service.durationMinutes, service.pricePaise, dateB, "booked");
  const pastCompleted = await createTestAppointment(customerId, staffId, String(service._id), service.name, service.durationMinutes, service.pricePaise, dateKey(addDays(-3)), "completed");
  const pastCancelled = await createTestAppointment(customerId, staffId, String(service._id), service.name, service.durationMinutes, service.pricePaise, dateKey(addDays(-4)), "cancelled");
  console.log(`Test bookings: confirmed(${upcomingConfirmed._id}) booked(${upcomingBooked._id}) completed(${pastCompleted._id}) cancelled(${pastCancelled._id})`);
  const debugCount = await AppointmentModel.countDocuments({ salonId, customerId, status: { $in: ["pending", "booked", "confirmed", "arrived"] }, startAt: { $gte: new Date() } });
  console.log("DEBUG upcoming count (handler query):", debugCount);
  const debugAll = await AppointmentModel.find({ salonId, customerId }).lean();
  for (const rec of debugAll) console.log("  DEBUG rec:", rec.status, rec.startAt.toISOString(), rec.endAt.toISOString());

  console.log("\n================ MENU ================");
  const m = await sendMsg("menu");
  assert(m.action === "menu", "menu action");

  console.log("\n================ VIEW BOOKINGS + MANAGE ================");
  const vb = await sendMsg("2");
  assert(vb.action === "view_bookings", "view bookings action");
  const mg = await sendMsg("1");
  assert(mg.action === "manage_booking", "manage booking action");

  console.log("\n================ CANCEL #1 (via manage submenu) ================");
  const c1 = await sendMsg("3");
  assert(c1.action === "needs_cancel_confirm" || c1.action === "confirm_cancel", "cancel confirm asked");
  const c1f = await sendMsg("confirm");
  assert(c1f.action === "appointment_cancelled", "cancelled action");
  let doc = await AppointmentModel.findById(upcomingConfirmed._id).lean();
  assert(doc && doc.status === "cancelled", "first appointment is cancelled");
  assert((await AppointmentSlotLockModel.countDocuments({ appointmentId: String(upcomingConfirmed._id) })) === 0, "cancelled appointment locks released");

  console.log("\n================ RESCHEDULE ================");
  const r0 = await sendMsg("menu");
  assert(r0.action === "menu", "menu");
  const r1 = await sendMsg("4");
  assert(r1.action === "select_reschedule_booking", "reschedule list");
  const r2 = await sendMsg("1");
  assert(r2.action === "reschedule_started", "reschedule started");
  const r3 = await sendMsg(dateB);
  assert(r3.action === "reschedule_slots", "reschedule slots shown");
  const r4 = await sendMsg("1");
  assert(r4.action === "appointment_rescheduled", "rescheduled");
  doc = await AppointmentModel.findById(upcomingBooked._id).lean();
  assert(!!doc, "rescheduled appointment exists");
  const newDate = dateKey(new Date(doc.startAt));
  assert(newDate === dateB, `rescheduled to ${dateB} but found ${newDate}`);
  assert((await AppointmentSlotLockModel.countDocuments({ appointmentId: String(upcomingBooked._id) })) > 0, "rescheduled appointment has new locks");

  console.log("\n================ MODIFY (change date) ================");
  const x0 = await sendMsg("menu");
  const x1 = await sendMsg("5");
  assert(x1.action === "select_modify_booking", "modify list");
  const x2 = await sendMsg("1");
  assert(x2.action === "modify_started", "modify started");
  const x3 = await sendMsg("4");
  assert(x3.action === "modify_date", "modify date asked");
  const x4 = await sendMsg(dateA);
  assert(x4.action === "modify_slots", "modify slots shown");
  const x5 = await sendMsg("1");
  assert(x5.action === "confirm_modify", "modify confirm shown");
  const x6 = await sendMsg("confirm");
  assert(x6.action === "appointment_updated", "modify applied (appointment_updated action)");
  doc = await AppointmentModel.findById(upcomingBooked._id).lean();
  assert(!!doc && dateKey(new Date(doc.startAt)) === dateA, `modify moved booking to ${dateA}`);

  console.log("\n================ HISTORY + REBOOK ================");
  const h0 = await sendMsg("menu");
  const h1 = await sendMsg("3");
  assert(h1.action === "view_history", "history list");
  const h2 = await sendMsg("rebook 1");
  assert(h2.action === "rebook_staff" || h2.action === "rebook_date", "rebook started");
  const preRebookCount = await AppointmentModel.countDocuments({ salonId, customerId });
  let rebookState = "staff";
  if (h2.action === "rebook_staff") {
    const h3 = await sendMsg(staffName);
    assert(h3.action === "rebook_date", "rebook date asked");
    rebookState = "date";
  }
  const dateForRebook = rebookState === "date" ? dateA : dateA;
  const h4 = await sendMsg(dateForRebook);
  assert(h4.action === "modify_slots" || h4.action === "rebook_slots", "rebook slots shown");
  const h5 = await sendMsg("1");
  assert(h5.action === "rebook_confirm", "rebook confirm shown");
  const h6 = await sendMsg("confirm");
  assert(h6.action === "appointment_created", "rebook created");
  const postRebookCount = await AppointmentModel.countDocuments({ salonId, customerId });
  assert(postRebookCount === preRebookCount + 1, "rebook created a NEW appointment");
  const rebooked = await AppointmentModel.find({ salonId, customerId, source: "whatsapp_rebook" }).sort({ createdAt: -1 }).limit(1).lean();
  assert(rebooked.length === 1, "rebooked appointment present");
  doc = rebooked[0];
  assert(doc.status === "confirmed", "rebooked appointment confirmed");
  assert((await AppointmentSlotLockModel.countDocuments({ appointmentId: String(doc._id) })) > 0, "rebooked appointment locked");

  console.log("\n================ DONE: all checks passed ================");
  await cleanupTestData();
  if (server) server.close();
  await mongoose.disconnect();
}

async function cleanupTestData(): Promise<void> {
  const customer = await CustomerModel.findOne({ salonId, normalizedPhone: PHONE });
  if (customer) {
    const ids = (await AppointmentModel.find({ salonId, customerId: String(customer._id) }).select("_id").lean()).map((a) => String(a._id));
    if (ids.length) await AppointmentSlotLockModel.deleteMany({ salonId, appointmentId: { $in: ids } });
    await AppointmentModel.deleteMany({ salonId, customerId: String(customer._id) });
    await CustomerModel.deleteOne({ _id: customer._id });
  }
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
}

main().catch(async (e) => {
  console.error(e);
  await cleanupTestData().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
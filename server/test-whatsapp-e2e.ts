import "dotenv/config";
import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import { createApp } from "./src/app";
import { AppointmentModel, type AppointmentDocument } from "./src/models/appointment.model";
import { AppointmentSlotLockModel } from "./src/models/appointment-slot-lock.model";
import { CustomerModel } from "./src/models/customer.model";
import { WhatsAppBookingSessionModel } from "./src/models/whatsapp-booking-session.model";
import { WhatsAppOutboundModel } from "./src/models/whatsapp-outbound.model";
import { BranchModel } from "./src/models/branch.model";
import { ServiceModel } from "./src/models/service.model";
import { ScheduleModel } from "./src/models/schedule.model";
import { UserModel } from "./src/models/user.model";
import { createAppointment, transitionAppointment } from "./src/modules/appointments/appointment.service";
import { closestName, filterBookingsByHints, parseNaturalDate, parseTimePreference, pickBestSlot } from "./src/modules/whatsapp/smart-parse";
import { subscribeRealtime } from "./src/modules/realtime/realtime.service";
import { runDueReminderNudges } from "./src/jobs/whatsapp-reminders";
import { zonedTimeToUtc } from "./src/shared/business-date";
import { ApiError } from "./src/shared/http";

/**
 * End-to-end WhatsApp booking QA suite (flows A–M from the QA checklist).
 * Run locally:  npm run e2e        (mock WhatsApp provider, in-process realtime capture)
 * Run against the deployed instance on Oracle:
 *   WA_WEBHOOK_SECRET=... MONGODB_URI=... npx tsx test-whatsapp-e2e.ts
 */

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
async function postWebhook(payload: string) {
  const sign = process.env.WA_WEBHOOK_SECRET
    ? createHmac("sha256", process.env.WA_WEBHOOK_SECRET).update(payload, "utf8").digest("hex")
    : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sign) headers["x-hub-signature-256"] = `sha256=${sign}`;
  else headers["x-test-webhook"] = "true";
  const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL || "http://127.0.0.1:4000/api/v1/whatsapp/webhook";
  const res = await fetch(webhookUrl, { method: "POST", headers, body: payload });
  const json = (await res.json()) as { data?: { action?: string; reply?: string; interactive?: unknown } };
  if (!res.ok) throw new Error(`Webhook failed (${res.status}): ${JSON.stringify(json)}`);
  return json.data || {};
}

async function sendMsg(body: string, from: string = PHONE) {
  msgSeq += 1;
  const fromName = from === PHONE ? PROFILE : "Echo Tester";
  const payload = JSON.stringify({
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "1274287792434534" },
          contacts: [{ profile: { name: fromName }, wa_id: from }],
          messages: [{
            id: `wamid.e2e_${Date.now()}_${msgSeq}`,
            from,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "text",
            text: { body }
          }]
        }
      }]
    }]
  });
  const data = await postWebhook(payload);
  const action = data.action || "";
  const reply = (data.reply || "").split("\n").slice(0, 6).join("\n  ");
  console.log(`\n>>> "${body}"  [action=${action}]`);
  console.log(`    ${reply}`);
  if (action === "management_error") console.log("    FULL:", JSON.stringify(data));
  return data;
}

async function sendListReply(id: string, title: string, from: string = PHONE) {
  msgSeq += 1;
  const payload = JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "1274287792434534" }, contacts: [{ profile: { name: from === PHONE ? PROFILE : "Echo Tester" }, wa_id: from }], messages: [{ id: `wamid.e2e_${Date.now()}_${msgSeq}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } }] } }] }]
  });
  const data = await postWebhook(payload);
  const action = data.action || "";
  const reply = (data.reply || "").split("\n").slice(0, 6).join("\n  ");
  console.log(`\n>>> list_reply.id="${id}" title="${title}"  [action=${action}]`);
  console.log(`    ${reply}`);
  if (action === "management_error") console.log("    FULL:", JSON.stringify(data));
  return data;
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

async function createTestAppointment(customerId: string, staffId: string, serviceId: string, serviceName: string, durationMinutes: number, value: number, date: string, status: string): Promise<AppointmentDocument> {
  const startAt = await findFreeStart(staffId, date, durationMinutes);
  if (!startAt) throw new Error(`No free start for ${staffId} on ${date}`);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  const appointment = await AppointmentModel.create({ salonId, branchId, staffId, customerId, customerName: PROFILE, serviceIds: [serviceId], serviceNames: [serviceName], durationMinutes, value, startAt, endAt, status, source: "whatsapp", paymentStatus: "not_required", version: 1 });
  if (BLOCKING.includes(status)) {
    await AppointmentSlotLockModel.create(slotInstants(startAt, endAt).map((slotAt) => ({ salonId, branchId, staffId, appointmentId: String(appointment._id), slotAt })));
  }
  return appointment;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

function assertThrowsConflict(result: Promise<unknown>): Promise<void> {
  return result.then(
    () => {
      throw new Error("ASSERT FAILED: expected an availability conflict but the call succeeded");
    },
    (error: unknown) => {
      const isConflict = error instanceof ApiError && error.status && String(error.status) === "409";
      if (!isConflict) throw error;
    }
  );
}

async function main() {
  const external = !!process.env.WA_WEBHOOK_SECRET;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  if (!external) {
    server = createApp().listen(4000, "127.0.0.1", () => console.log("Server on http://127.0.0.1:4000"));
    await new Promise((r) => setTimeout(r, 1000));
  }
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI required");
  await mongoose.connect(mongoUri);

  // M: WhatsApp -> App sync — capture realtime events published by webhook-created changes.
  const realtimeEvents: Array<{ event: string; data: any }> = [];
  let unsubscribe: (() => void) | null = null;
  if (!external) {
    unsubscribe = subscribeRealtime(salonId, (event, data) => realtimeEvents.push({ event, data }));
  }
  const sawEvent = (event: string, predicate: (data: any) => boolean): boolean => realtimeEvents.some((entry) => entry.event === event && predicate(entry.data));

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
  const categoryServices = await ServiceModel.find({ salonId, status: "active", $or: [{ branchIds: branchId }, { branchIds: { $size: 0 } }], category: service!.category || "Hair" }).sort({ name: 1 }).limit(12).lean();
  assert(categoryServices.length >= 3, "category has enough services for remove/pagination tests");
  const staffUser = await UserModel.findOne({ salonId, staffId }).lean();
  const staffName = staffUser?.name || staffId;
  console.log("Service:", service!.name, "| staff:", staffName);

  const customer = await CustomerModel.findOneAndUpdate(
    { salonId, normalizedPhone: PHONE },
    { $setOnInsert: { branchId, source: "whatsapp" }, $set: { name: PROFILE, interactionStatus: "active" } },
    { upsert: true, new: true }
  );
  const customerId = String(customer._id);

  // Seeds: history entries only (upcoming/active bookings are created by the flows under test).
  const pastCompleted = await createTestAppointment(customerId, staffId, String(service!._id), service!.name, service!.durationMinutes, service!.pricePaise, dateKey(addDays(-3)), "completed");
  const pastCancelled = await createTestAppointment(customerId, staffId, String(service!._id), service!.name, service!.durationMinutes, service!.pricePaise, dateKey(addDays(-4)), "cancelled");
  const upcomingBooked = await createTestAppointment(customerId, staffId, String(service!._id), service!.name, service!.durationMinutes, service!.pricePaise, dateB, "booked");
  console.log(`Seeds: completed(${pastCompleted._id}) cancelled(${pastCancelled._id}) booked(${upcomingBooked._id})`);

  console.log("\n========== Q. CANCEL INTENT PRIORITY ==========");
  const cancelPhrases = ["I want to cancel an appointment", "No cancel", "I want to cancel", "Can you please cancel my appointment?", "please cancel", "delete my booking", "remove my appointment"];
  for (const phrase of cancelPhrases) {
    await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
    const result = await sendMsg(phrase);
    assert(result.action === "select_cancel_booking", `${phrase} routes to cancel booking list, not booking/service search`);
    const cancelSession = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: PHONE }).lean();
    assert(cancelSession?.state === "select_cancel_booking", `${phrase} leaves session in cancel selection`);
  }
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
  const byId = await sendMsg(`This is my booking ID: ${upcomingBooked._id}. Please cancel.`);
  assert(byId.action === "needs_cancel_confirm", "booking ID cancel moves directly to confirmation");
  const byIdSession = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: PHONE }).lean();
  assert(byIdSession?.state === "confirm_cancel" && String(byIdSession.targetAppointmentId) === String(upcomingBooked._id), "booking ID cancel targets only customer's appointment");
  assert((await AppointmentModel.findById(upcomingBooked._id).lean())?.status === "booked", "booking ID cancel does not mutate DB before confirmation");
  const backOut = await sendMsg("cancel");
  assert(backOut.action === "select_cancel_booking", "cancel at confirmation backs out instead of cancelling without confirm");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
  const rescheduleById = await sendMsg(`This is my booking ID: ${upcomingBooked._id}. I need to reschedule my booking.`);
  assert(rescheduleById.action === "reschedule_started", "booking ID reschedule directly starts reschedule for customer booking");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
  const modifyById = await sendMsg(`Please modify booking ${upcomingBooked._id}`);
  assert(modifyById.action === "modify_started", "booking ID modify directly starts modify for customer booking");
  assert((await AppointmentModel.findById(upcomingBooked._id).lean())?.status === "booked", "modify/reschedule intent shortcuts do not mutate DB before confirmation");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
  const naturalModify = await sendMsg("change staff on my appointment");
  assert(naturalModify.action === "modify_started", "natural change-staff phrase routes to modify for the single upcoming booking");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
  const naturalReschedule = await sendMsg("change my appointment time");
  assert(naturalReschedule.action === "reschedule_started", "natural change-time phrase routes to reschedule for the single upcoming booking");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
  const naturalRescheduleDate = await sendMsg(`move my booking to ${dateA}`);
  assert(["reschedule_slots", "no_slots"].includes(naturalRescheduleDate.action), "natural move-to-date phrase runs reschedule availability, not service search");
  assert(naturalRescheduleDate.action !== "no_slots" || (naturalRescheduleDate.reply || "").includes("Send another date"), "natural reschedule no-slots is state-specific");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });

  console.log("\n========== Q2. CANCELLATION VOCABULARY ==========");
  const cancellationVocab = [
    "Cancel",
    "I need to cancel my booking for today",
    "Kindly cancel my appointment",
    "Please cancel my appointment for me",
    "I would like to cancel my reservation",
    "Can I cancel my appointment?",
    "Could you cancel the booking?",
    "Cancel karo",
    "Booking cancel kar do",
    "delete my booking please",
    "Please delete my appointment",
    "I want to delete the appointment",
    "Remove my appointment",
    "Please remove my booking",
    "I need to remove my appointment",
    "Drop my appointment",
    "Dismiss the booking",
    "Cancel my slot",
    "Cancel my visit",
    "Cancel for tomorrow",
    "Call it off",
    "Call off my appointment",
    "Get rid of my booking",
    "Scrap my appointment",
    "Scratch that appointment",
    "my appointment is cancelled",
    "my booking has been deleted",
    "i want to cancel an appointment please",
    "wanna cancel",
    "I'm not coming",
    "I won't make it",
    "I can't make it",
    "something came up",
    "change of plans, cancel it",
    "I cannot attend",
    "not coming tomorrow",
    "Cancel my appointment for India Coffee House on the 29th"
  ];
  for (const phrase of cancellationVocab) {
    await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
    const result = await sendMsg(phrase);
    assert(["select_cancel_booking", "needs_cancel_confirm"].includes(result.action), `"${phrase}" routes to cancellation, got action=${result.action}`);
  }
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
  const notCancellation = [ "please don't cancel my booking", "I am not cancelling anything", "remove the first one", "keep my appointment", "don't delete anything", "I want to book a haircut this week" ];
  for (const phrase of notCancellation) {
    const result = await sendMsg(phrase);
    assert(!["select_cancel_booking", "needs_cancel_confirm"].includes(result.action), `"${phrase}" must NOT route to cancellation, got action=${result.action}`);
  }
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });

  console.log("\n========== R. REMOVE SELECTED SERVICES ==========");
  const removePhone = "919008080001";
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: removePhone });
  await sendMsg("book appointment", removePhone);
  await sendMsg("1", removePhone);
  await sendMsg(String(service!.category || "Hair"), removePhone);
  const firstRemoveService = categoryServices[0]!;
  const secondRemoveService = categoryServices[1]!;
  const rs1 = await sendMsg(String(firstRemoveService._id), removePhone);
  assert(rs1.action === "service_selected", "first draft service selected");
  await sendMsg("yes", removePhone);
  await sendMsg(String(service!.category || "Hair"), removePhone);
  const rs2 = await sendMsg(String(secondRemoveService._id), removePhone);
  assert(rs2.action === "service_selected", "second draft service selected");
  const beforeRemoveAppts = await AppointmentModel.countDocuments({ salonId, customerName: "Echo Tester", status: { $in: BLOCKING } });
  const removedBoth = await sendMsg("Remove both", removePhone);
  assert(removedBoth.action === "services_removed", "remove both clears selected draft services");
  const removeSession = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: removePhone }).lean();
  assert((removeSession?.serviceIds || []).length === 0 && (removeSession?.durationMinutes || 0) === 0 && (removeSession?.value || 0) === 0, "remove both recalculates services/duration/price to zero");
  assert(await AppointmentModel.countDocuments({ salonId, customerName: "Echo Tester", status: { $in: BLOCKING } }) === beforeRemoveAppts, "remove both does not create or modify appointments");
  await WhatsAppBookingSessionModel.findOneAndUpdate(
    { salonId, waPhone: removePhone },
    { $set: { branchId, profileName: "Echo Tester", state: "add_more_services", serviceIds: [String(firstRemoveService._id), String(secondRemoveService._id)], serviceNames: [firstRemoveService.name, secondRemoveService.name], durationMinutes: firstRemoveService.durationMinutes + secondRemoveService.durationMinutes, value: firstRemoveService.pricePaise + secondRemoveService.pricePaise, expiresAt: new Date(Date.now() + 30 * 60_000) } },
    { upsert: true, new: true }
  );
  const removeFirst = await sendMsg("remove the first one", removePhone);
  assert(removeFirst.action === "services_removed", "remove first one updates draft services");
  const afterFirstRemove = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: removePhone }).lean();
  assert((afterFirstRemove?.serviceIds || []).length === 1 && String((afterFirstRemove?.serviceIds || [])[0]) === String(secondRemoveService._id), "remove first leaves second service only");
  const removeByName = await sendMsg(`remove ${secondRemoveService.name}`, removePhone);
  assert(removeByName.action === "services_removed", "remove by service name updates draft services");
  const afterNameRemove = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: removePhone }).lean();
  assert((afterNameRemove?.serviceIds || []).length === 0, "remove by name clears matching service");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: removePhone });

  console.log("\n========== P. INTERACTIVE MAIN MENU IDS ==========");
  const menuActions = [
    ["book_appointment", "Book appointment", ["booking_flow", "booking_started", "needs_branch"]],
    ["view_bookings", "View my bookings", ["view_bookings"]],
    ["view_history", "View history", ["view_history"]],
    ["reschedule_booking", "Reschedule booking", ["select_reschedule_booking"]],
    ["modify_booking", "Modify booking", ["select_modify_booking"]],
    ["cancel_booking", "Cancel booking", ["select_cancel_booking"]],
    ["rebook_service", "Rebook a service", ["view_history"]]
  ] as const;
  for (const [id, title, expectedActions] of menuActions) {
    await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });
    const menu = await sendMsg("menu");
    assert(menu.action === "menu", `menu shown before tapping ${id}`);
    const tapped = await sendListReply(id, title);
    assert(expectedActions.includes(tapped.action as any), `${id} routes to correct handler: ${tapped.action}`);
  }
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: PHONE });

  console.log("\n========== I. INVALID INPUT ==========");
  const inv0 = await sendMsg("menu");
  assert(inv0.action === "menu", "menu shows");
  const inv1 = await sendMsg("9");
  assert(inv1.action === "menu", "garbage at menu -> menu re-shown (no error)");
  const inv2 = await sendMsg("zzz nonsense");
  assert(inv2.action === "menu", "garbage phrase -> menu re-shown");
  const fresh0 = await sendMsg("ignore me please", "919008080003");
  assert(fresh0.action === "menu", "brand-new customer sending random text gets the menu (not an error)");
  const inv3 = await sendMsg("hello");
  assert(inv3.action === "book_appointment" || inv3.action === "booking_flow" || inv3.action === "booking_started" || inv3.action === "service_selected" || inv3.action === "needs_branch", "hello starts booking; got action=" + inv3.action + " reply=" + JSON.stringify(inv3.reply).slice(0, 120));

  console.log("\n========== A. NEW BOOKING (web -> WhatsApp) ==========");
  const a0 = await sendMsg("book appointment");
  assert(["booking_flow", "booking_started", "service_selected", "needs_branch"].includes(a0.action), "booking starts: " + a0.action);
  const a1 = await sendMsg("1");
  assert(a1.action === "branch_selected" || a1.action === "search_results" || a1.action === "category_selected", "branch/category step: " + a1.action);
  const cat = await sendMsg(String(service!.category || "Hair"));
  assert(["category_selected", "search_results"].includes(cat.action), "category picked: " + cat.action);
  const moreServices = await sendListReply("more", "More");
  assert(moreServices.action === "service_page", "More advances service page");
  assert(!(moreServices.reply || "").includes(categoryServices[0]!.name), "More page contains different services from first page");
  const backServices = await sendMsg("back");
  assert(backServices.action === "service_page", "Back from More returns previous service page");
  assert((backServices.reply || "").includes(categoryServices[0]!.name), "Back page restores first service list");
  const catService = await ServiceModel.findOne({ salonId, status: "active", $or: [{ branchIds: branchId }, { branchIds: { $size: 0 } }], category: service!.category || "Hair" }).sort({ name: 1 }).lean();
  assert(!!catService, "service available in category for tap test");
  const svc = await sendMsg(String(catService!._id));
  assert(svc.action === "service_selected", "service selected via tapped id (interactive tap emulation)");
  assert(svc.service === catService!.name, "tapped service matches list row");
  const done0 = await sendMsg("DONE");
  assert(done0.action === "needs_staff", "staff list shown");
  const stf = await sendMsg("1");
  assert(stf.action === "staff_selected", "staff selected");
  const dt = await sendMsg(dateA);
  assert(dt.action === "date_selected", "date selected");
  const tm = await sendMsg("1");
  assert(tm.action === "time_selected", "slot selected");
  const bk = await sendMsg("confirm");
  assert(bk.action === "appointment_created", "booking confirmed");
  const createdId = String(bk.appointment.id);
  let createdDoc = await AppointmentModel.findById(createdId).lean();
  assert(!!createdDoc, "created appointment exists");
  assert(createdDoc!.status === "confirmed", "created appointment confirmed");
  if (!external) assert(sawEvent("appointment.created", (d) => String(d.id) === createdId), "realtime appointment.created fired for new booking (M)");
  const createdOutbound = await WhatsAppOutboundModel.find({ salonId, toPhone: PHONE }).sort({ createdAt: -1 }).limit(3).lean();
  assert(createdOutbound.some((row) => row.type === "utility" && row.body.includes(createdId)), "confirmation reply with Booking ID sent (N)");

  console.log("\n========== B. VIEW MY BOOKINGS ==========");
  const b0 = await sendMsg("2");
  assert(b0.action === "view_bookings", "bookings listed immediately (interactive + numeric)");
  const b1 = await sendMsg("1");
  assert(b1.action === "manage_booking", "manage submenu reached");

  console.log("\n========== H. BACK NAVIGATION ==========");
  const h_manage = await sendMsg("back");
  assert(h_manage.action === "view_bookings", "back from manage -> bookings list");
  const h_menu = await sendMsg("menu");
  assert(h_menu.action === "menu", "back to menu");

  console.log("\n========== E. CANCEL BOOKING ==========");
  const e0 = await sendMsg("6");
  assert(e0.action === "select_cancel_booking", "cancel list");
  const e1 = await sendMsg("1");
  assert(["needs_cancel_confirm", "confirm_cancel"].includes(e1.action), "cancel confirmation asked");
  const e2 = await sendMsg("confirm");
  assert(e2.action === "appointment_cancelled", "cancelled");
  createdDoc = await AppointmentModel.findById(createdId).lean();
  assert(createdDoc && createdDoc.status === "cancelled", "created appointment is now cancelled");
  assert((await AppointmentSlotLockModel.countDocuments({ appointmentId: createdId })) === 0, "cancelled appointment locks released");
  if (!external) assert(sawEvent("appointment.status_changed", (d) => String(d.id) === createdId && d.status === "cancelled"), "realtime status_changed cancelled (M)");

  console.log("\n========== C. RESCHEDULE (split lifecycle) ==========");
  const c0 = await sendMsg("4");
  assert(c0.action === "select_reschedule_booking", "reschedule list");
  const c1 = await sendMsg("1");
  assert(c1.action === "reschedule_started", "reschedule started");
  const c2 = await sendMsg(dateA);
  assert(c2.action === "reschedule_slots", "reschedule slots");
  const c3 = await sendMsg("1");
  assert(c3.action === "appointment_rescheduled", "rescheduled (appointment_rescheduled action)");
  const oldRescheduled = await AppointmentModel.findById(upcomingBooked._id).lean();
  assert(!!oldRescheduled, "old appointment exists");
  assert(oldRescheduled!.status === "rescheduled", "OLD appointment -> rescheduled");
  const newId = String(oldRescheduled!.rescheduledToId || "");
  assert(!!newId, "OLD appointment references new id via rescheduledToId");
  const newDoc = await AppointmentModel.findById(newId).lean();
  assert(!!newDoc, "NEW appointment exists");
  assert(newDoc!.status === "confirmed", "NEW appointment -> confirmed");
  assert(String(newDoc!.rescheduledFromId) === String(upcomingBooked._id), "NEW appointment references old id via rescheduledFromId");
  assert(String(newDoc!.customerId) === customerId, "same customer");
  assert((await AppointmentSlotLockModel.countDocuments({ appointmentId: String(upcomingBooked._id) })) === 0, "old appointment locks released");
  assert((await AppointmentSlotLockModel.countDocuments({ appointmentId: newId })) > 0, "new appointment locked");
  const activeForSlot = await AppointmentModel.countDocuments({ salonId, customerId, status: { $in: BLOCKING }, startAt: { $gte: new Date() } });
  assert(activeForSlot === 1, "exactly ONE active appointment after reschedule (no duplicates)");
  if (!external) assert(sawEvent("appointment.created", (d) => String(d.id) === newId), "realtime appointment.created for rescheduled NEW (M)");
  if (!external) assert(sawEvent("appointment.status_changed", (d) => String(d.id) === String(upcomingBooked._id) && d.status === "rescheduled"), "realtime status_changed rescheduled for OLD (M)");

  console.log("\n========== D. MODIFY BOOKING (in-place, same id) ==========");
  const d0 = await sendMsg("5");
  assert(d0.action === "select_modify_booking", "modify list");
  const d1 = await sendMsg("1");
  assert(d1.action === "modify_started", "modify started");
  const d2 = await sendMsg("4");
  assert(d2.action === "modify_date", "change date/time");
  const currentModifyDate = dateKey(new Date(newDoc!.startAt));
  const sameDateSlots = await sendMsg(currentModifyDate);
  assert(sameDateSlots.action === "modify_slots", "modify same date returns slots with current appointment excluded");
  assert(/\d{2}:\d{2}/.test(sameDateSlots.reply || ""), "same-date alternative slots are returned");
  const dBack = await sendMsg("back");
  assert(dBack.action === "modify_choose_field", "back from modify slot list returns to modify menu");
  const d2b = await sendMsg("4");
  assert(d2b.action === "modify_date", "change date/time again");
  let otherModifyDate = "";
  let d3: any = null;
  for (const candidate of scheduleDates) {
    if (candidate === currentModifyDate) continue;
    const attempt = await sendMsg(candidate);
    if (attempt.action === "modify_slots") {
      otherModifyDate = candidate;
      d3 = attempt;
      break;
    }
    assert(attempt.action === "no_slots", `unavailable alternate date returns no_slots, not wrong state: ${attempt.action}`);
  }
  assert(!!otherModifyDate && d3?.action === "modify_slots", "modify slots for another available date");
  assert(d3.action === "modify_slots", "modify slots for another available date");
  const d4 = await sendMsg("1");
  assert(d4.action === "confirm_modify", "modify confirmation shown");
  const d5 = await sendMsg("confirm");
  assert(d5.action === "appointment_updated", "modify applied (same appointment id)");
  const modifiedDoc = await AppointmentModel.findById(newId).lean();
  assert(!!modifiedDoc, "modify kept the same appointment identity");
  assert(modifiedDoc!.status === "confirmed", "modified appointment still confirmed");
  assert(dateKey(new Date(modifiedDoc!.startAt)) === otherModifyDate, `modify moved booking to ${otherModifyDate}`);
  assert((await AppointmentModel.countDocuments({ salonId, customerId, status: { $in: BLOCKING }, startAt: { $gte: new Date() } })) === 1, "modify did not create a duplicate active booking");

  console.log("\n========== G. VIEW HISTORY ==========");
  const g0 = await sendMsg("3");
  assert(g0.action === "view_history", "history listed directly (no menu-option error)");
  const historyDocs = await AppointmentModel.find({ salonId, customerId, status: { $in: ["completed", "cancelled", "no_show", "expired", "rescheduled"] } }).lean();
  assert(historyDocs.some((doc) => doc.status === "completed"), "history includes completed");
  assert(historyDocs.some((doc) => doc.status === "cancelled"), "history includes cancelled");
  assert(historyDocs.some((doc) => doc.status === "rescheduled"), "history includes rescheduled (req 7)");

  console.log("\n========== F. REBOOK (history -> rebook -> new appointment) ==========");
  const preRebookCount = await AppointmentModel.countDocuments({ salonId, customerId });
  const f0 = await sendMsg("rebook 1");
  assert(["rebook_staff", "rebook_date"].includes(f0.action), "rebook started: " + f0.action);
  let f1: any;
  if (f0.action === "rebook_staff") {
    f1 = await sendMsg(staffName);
    assert(f1.action === "rebook_date", "rebook date asked");
  }
  const f2 = await sendMsg(dateA);
  assert(["modify_slots", "rebook_slots"].includes(f2.action), "rebook slots");
  const f3 = await sendMsg("1");
  assert(f3.action === "rebook_confirm", "rebook confirmation");
  const f4 = await sendMsg("confirm");
  assert(f4.action === "appointment_created", "rebook created a NEW appointment");
  const postRebookCount = await AppointmentModel.countDocuments({ salonId, customerId });
  assert(postRebookCount === preRebookCount + 1, "rebook created exactly ONE new appointment record");
  const rebookedDoc = await AppointmentModel.find({ salonId, customerId, source: "whatsapp_rebook" }).sort({ createdAt: -1 }).limit(1).lean();
  assert(rebookedDoc.length === 1, "rebooked appointment present");
  assert(rebookedDoc[0]!.status === "confirmed", "rebooked appointment confirmed");
  assert(rebookedDoc[0]!.rescheduledFromId == null, "rebook is a fresh appointment (no reschedule link)");

  console.log("\n========== J. DUPLICATE SLOT (sequential) ==========");
  const dupStart = await findFreeStart(staffId, dateA, service!.durationMinutes);
  assert(!!dupStart, "free slot for duplicate test");
  const phoneB = "919820804255";
  await createAppointment({ salonId, branchId, serviceId: String(service!._id), startAt: dupStart!, customerName: "Dup User B", normalizedPhone: phoneB, source: "whatsapp", preferredStaffId: staffId });
  await assertThrowsConflict(createAppointment({ salonId, branchId, serviceId: String(service!._id), startAt: dupStart!, customerName: "Dup User C", normalizedPhone: "919008080003", source: "whatsapp", preferredStaffId: staffId }));
  console.log("  duplicate second attempt correctly rejected (slot race backstop)");

  console.log("\n========== K. CONCURRENT SAME-SLOT (two customers) ==========");
  const raceStart = await findFreeStart(staffId, dateA, service!.durationMinutes);
  assert(!!raceStart, "free slot for concurrency test");
  const [r1, r2] = await Promise.allSettled([
    createAppointment({ salonId, branchId, serviceId: String(service!._id), startAt: raceStart!, customerName: "Race A", normalizedPhone: "919008080001", source: "whatsapp", preferredStaffId: staffId }),
    createAppointment({ salonId, branchId, serviceId: String(service!._id), startAt: raceStart!, customerName: "Race B", normalizedPhone: "919008080002", source: "whatsapp", preferredStaffId: staffId })
  ]);
  const winners = [r1, r2].filter((r) => r.status === "fulfilled");
  const losers = [r1, r2].filter((r) => r.status === "rejected");
  assert(winners.length === 1, "exactly one customer won the race");
  assert(losers.length === 1, "exactly one customer lost the race");
  const loserError = losers[0] as PromiseRejectedResult;
  assert(loserError.reason instanceof ApiError && String(loserError.reason.status) === "409", "loser got a 409 conflict (seen in app as 'not available')");
  console.log("  concurrent race resolved: 1 winner, 1 conflict");

  console.log("\n========== L. App -> WhatsApp sync ==========");
  const syncStart = await findFreeStart(staffId, dateA, service!.durationMinutes);
  assert(!!syncStart, "free slot for app->whatsapp sync test");
  const syncDoc = await createTestAppointment(customerId, staffId, String(service!._id), service!.name, service!.durationMinutes, service!.pricePaise, dateA, "confirmed");
  await transitionAppointment(salonId, String(syncDoc._id), "cancelled", syncDoc.version);
  const syncOutbound = await WhatsAppOutboundModel.find({ salonId, appointmentId: String(syncDoc._id) }).sort({ createdAt: -1 }).lean();
  assert(syncOutbound.some((row) => row.type === "cancellation"), "app-side cancel sent a WhatsApp cancellation (L)");
  console.log("  app-side cancel produced outbound WhatsApp cancellation message");

  console.log("\n========== S1. NATURAL DATE/TIME PARSER ==========");
  const sPhone = "919008080005";
  const sPhone2 = "919008080006";
  const sPhone3 = "919008080007";
  const kolkataDaysFromNow = (n: number): string => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const base = new Date(Date.UTC(Number(parts.find((p) => p.type === "year")!.value), Number(parts.find((p) => p.type === "month")!.value) - 1, Number(parts.find((p) => p.type === "day")!.value)));
    const target = new Date(base.getTime() + n * 86400000);
    const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(target);
    return `${t.find((p) => p.type === "year")!.value}-${t.find((p) => p.type === "month")!.value}-${t.find((p) => p.type === "day")!.value}`;
  };
  const todayIST = kolkataDaysFromNow(0);
  const tomorrowIST = kolkataDaysFromNow(1);
  const daysFromToday = (iso: string) => Math.round((new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${todayIST}T00:00:00Z`).getTime()) / 86400000);
  assert(parseNaturalDate(dateKey(addDays(0))) === dateKey(addDays(0)), "S1 explicit ISO date passes through");
  assert(parseNaturalDate("tomorrow") === tomorrowIST, "S1 tomorrow resolves to the correct date");
  assert(parseNaturalDate("kal") === tomorrowIST, "S1 kal (Hindi tomorrow) resolves like tomorrow");
  assert(parseNaturalDate("parso") === kolkataDaysFromNow(2) && parseNaturalDate("day after tomorrow") === kolkataDaysFromNow(2), "S1 parso/day-after-tomorrow resolves");
  assert(parseNaturalDate(`in ${Math.max(1, daysFromToday(dateA))} days`) === dateA, "S1 'in N days' matches a known schedule date");
  const weekdayParsed = parseNaturalDate("next friday");
  assert(!!weekdayParsed && weekdayParsed >= todayIST, "S1 weekday reference is today or future");
  assert(parseNaturalDate("completely bogus date here") === null, "S1 non-date text returns null");
  assert(parseTimePreference("3 pm").time === "15:00", "S1 3 pm -> 15:00");
  assert(parseTimePreference("11:30").time === "11:30", "S1 11:30 clock time parsed");
  assert(parseTimePreference("3 baje shaam").time === "15:00", "S1 '3 baje shaam' is evening 15:00");
  assert(parseTimePreference("morning").before === 720, "S1 morning window before 12:00");
  assert(parseTimePreference("after 2pm").after === 840, "S1 after 2pm window");
  assert(parseTimePreference("zzz nonsense").time === undefined, "S1 garbage has no time");
  const fabSlots: Array<{ label: string; startAt: Date }> = ["11:00", "11:30", "12:00", "14:30", "15:00"].map((label) => ({ label, startAt: new Date(`2026-08-30T${label}:00Z`) }));
  assert(pickBestSlot(fabSlots, "11:30").candidate?.label === "11:30", "S1 exact slot picked");
  assert(pickBestSlot(fabSlots, "1").candidate?.label === "11:00", "S1 numeric index picked");
  assert(pickBestSlot(fabSlots, "2 pm").candidate?.label === "14:30", "S1 nearest-to-2pm slot picked");
  assert(pickBestSlot(fabSlots, "3 pm").candidate?.label === "15:00", "S1 closest 3pm slot picked");
  assert(closestName(["Dev Kapoor", "Priya Singh"], "dev kapoor")?.name === "Dev Kapoor", "S1 exact name match");
  assert(closestName(["Dev Kapoor", "Priya Singh"], "dev kapor")?.name === "Dev Kapoor", "S1 fuzzy typo match");
  assert(closestName(["Dev Kapoor", "Priya Singh"], "priya")?.name === "Priya Singh", "S1 partial name match");
  assert(closestName(["Dev Kapoor", "Priya Singh"], "address repeated") === null, "S1 unrelated name not matched");
  const fabBookings = [
    { startAt: zonedTimeToUtc("Asia/Kolkata", tomorrowIST, 12, 0), staffName: "Dev Kapoor", serviceNames: ["Haircut Classic"] },
    { startAt: zonedTimeToUtc("Asia/Kolkata", dateKey(addDays(4)), 18, 30), staffName: "Priya Singh", serviceNames: ["Threading"] }
  ];
  const fabMatch = filterBookingsByHints(fabBookings, `cancel the one on ${tomorrowIST}`, "Asia/Kolkata");
  assert(fabMatch.matched.length === 1 && fabMatch.hasDateHint && fabMatch.matched[0].serviceNames?.[0] === "Haircut Classic", "S1 date-hint booking filter isolates the right booking");
  const fabName = filterBookingsByHints(fabBookings, "what do I have with dev", "Asia/Kolkata");
  assert(fabName.matched.length === 1 && fabName.hasNameHint, "S1 staff-name-hint filter isolates Dev's booking");
  const fabTime = filterBookingsByHints(fabBookings, "anything in the evening", "Asia/Kolkata");
  assert(fabTime.matched.length === 1 && fabTime.matched[0].serviceNames?.[0] === "Threading", "S1 day-part hint filters to the evening booking");

  console.log("\n========== S2. BOOKING WITH NATURAL DATE/TIME ==========");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone });
  const s2Client = await CustomerModel.findOneAndUpdate({ salonId, normalizedPhone: sPhone }, { $setOnInsert: { branchId, source: "whatsapp" }, $set: { name: "Echo Tester", interactionStatus: "active" } }, { upsert: true, new: true });
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone });
  await sendMsg("book appointment", sPhone);
  await sendMsg("1", sPhone);
  await sendMsg(String(service!.category || "Hair"), sPhone);
  const s2Svc = await sendMsg(String(catService!._id), sPhone);
  assert(s2Svc.action === "service_selected", "S2 service selected in naturally-typed booking");
  const s2Staff = await sendMsg("DONE", sPhone);
  assert(s2Staff.action === "needs_staff", "S2 staff list asked");
  const s2StaffPick = await sendMsg("1", sPhone);
  assert(s2StaffPick.action === "staff_selected", "S2 staff picked");
  const naturalDatePhrase = daysFromToday(dateA) <= 1 ? "tomorrow" : `in ${Math.max(1, daysFromToday(dateA))} days`;
  const s2Date = await sendMsg(naturalDatePhrase, sPhone);
  assert(["date_selected", "no_slots"].includes(s2Date.action), "S2 natural date accepted at date step: " + s2Date.action);
  if (s2Date.action === "date_selected") {
    let s2Time: any = await sendMsg("2 pm", sPhone);
    assert(["time_selected", "needs_time", "slot_unavailable"].includes(s2Time.action), "S2 natural time accepted at slot step: " + s2Time.action);
    if (s2Time.action === "needs_time") s2Time = await sendMsg("1", sPhone);
    assert(s2Time.action === "time_selected", "S2 natural time resolves to a slot: " + s2Time.action);
  }
  const s2Draft = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone }).lean();
  if (s2Draft?.state === "select_time") assert((s2Draft.availableSlots || []).length > 0 && /\d{2}:\d{2}/.test(JSON.stringify(s2Draft.availableSlots)), "S2 natural time produced concrete slots");
  const s2Abort = await sendMsg("MENU", sPhone);
  assert(["menu", "booking_aborted"].includes(s2Abort.action), "S2 abort booking with MENU: " + s2Abort.action);
  assert(!(await AppointmentModel.findOne({ salonId, customerId: String(s2Client._id), status: { $in: BLOCKING } })), "S2 abort created no appointment");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone });

  console.log("\n========== S3. HINT-BASED CANCEL TARGETING ==========");
  const s3client = await CustomerModel.findOneAndUpdate({ salonId, normalizedPhone: sPhone2 }, { $setOnInsert: { branchId, source: "whatsapp" }, $set: { name: "Echo Tester", interactionStatus: "active" } }, { upsert: true, new: true });
  const s3CustId = String(s3client._id);
  const s3Booking = await createTestAppointment(s3CustId, staffId, String(service!._id), service!.name, service!.durationMinutes, service!.pricePaise, dateB, "booked");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });
  const s3a = await sendMsg(`cancel my appointment on ${dateB}`, sPhone2);
  assert(s3a.action === "needs_cancel_confirm", "S3 date-hint cancel jumps straight to confirmation: " + s3a.action);
  const s3c = await sendMsg("confirm", sPhone2);
  assert(s3c.action === "appointment_cancelled", "S3 hint-tagged booking is cancelled");
  assert((await AppointmentModel.findById(s3Booking._id).lean())?.status === "cancelled", "S3 cancelled appointment persisted");
  const s3BookingB = await createTestAppointment(s3CustId, staffId, String(service!._id), service!.name, service!.durationMinutes, service!.pricePaise, dateA, "booked");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });
  const s3b = await sendMsg("cancel my booking", sPhone2);
  assert(s3b.action === "select_cancel_booking", "S3 no-hint cancel with multiple bookings still lists: " + s3b.action);
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S4. NATURAL BOOKINGS Q&A ==========");
  const s4a = await sendMsg("when is my next appointment", sPhone2);
  assert(s4a.action === "view_bookings" && (s4a.reply || "").includes(service!.name), "S4 next-appointment question answers with the booking");
  const s4b = await sendMsg(`what do I have on ${dateA}`, sPhone2);
  assert(s4b.action === "view_bookings" && (s4b.reply || "").includes(service!.name), "S4 date-specified question returns matching booking");
  const s4c = await sendMsg("do I have anything this week", sPhone2);
  assert(s4c.action === "view_bookings", "S4 this-week question handled");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S5. NATURAL RESCHEDULE + SAME-TIME ==========");
  const s5 = await sendMsg(`move my booking to ${dateB} same time`, sPhone2);
  assert(["reschedule_slots", "no_slots"].includes(s5.action), "S5 natural reschedule with same-time preference: " + s5.action);
  assert((await AppointmentModel.findById(s3BookingB._id).lean())?.status === "booked", "S5 reschedule did not mutate DB before slot selection/back-out");
  await sendMsg("MENU", sPhone2);
  assert((await AppointmentModel.findById(s3BookingB._id).lean())?.status === "booked" && (await AppointmentModel.countDocuments({ salonId, customerId: s3CustId, status: { $in: BLOCKING } })) === 1, "S5 back-out left exactly one active booking");
  const s5b = await sendMsg(`reschedule to ${dateB}`, sPhone2);
  assert(["reschedule_slots", "no_slots"].includes(s5b.action), "S5 natural reschedule on a known date: " + s5b.action);
  await sendMsg("MENU", sPhone2);
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S6. MODIFY SHORTCUTS ==========");
  const s6CurStaff = (await UserModel.findOne({ salonId, staffId: String(s3BookingB.staffId) }).lean())?.name || "";
  const otherStaffName = ["Dev Kapoor", "Kabir Iyer", "Ananya Khan"].find((candidate) => candidate !== s6CurStaff) || "Dev Kapoor";
  const otherStaffUser = await UserModel.findOne({ salonId, name: otherStaffName }).lean();
  const m0 = await sendMsg("modify my booking", sPhone2);
  assert(m0.action === "modify_started", "S6 modify started for single booking");
  const storedBefore = await AppointmentModel.findById(s3BookingB._id).lean();
  if (otherStaffUser?.staffId) {
    const m1 = await sendMsg(`change staff to ${otherStaffName}`, sPhone2);
    assert(m1.action === "confirm_modify", "S6 change-staff shortcut reaches confirmation: " + m1.action);
    const m1s = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
    assert(String(m1s?.staffId) === String(otherStaffUser.staffId), "S6 change-staff shortcut updated draft staff");
    await sendMsg("cancel", sPhone2);
  }
  const m2 = await sendMsg(`remove ${service!.name}`, sPhone2);
  assert(m2.action === "services_removed", "S6 remove-by-name shortcut updates draft: " + m2.action);
  const m2s = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert((m2s?.serviceIds || []).length === 0 && (m2s?.serviceNames || []).length === 0, "S6 remove cleared all draft services");
  const m3 = await sendMsg(`add ${catService!.name}`, sPhone2);
  assert(m3.action === "confirm_modify" || m3.action === "needs_service", "S6 add-service shortcut handled: " + m3.action);
  const m3s = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert((m3s?.serviceIds || []).length >= 1 && (m3s?.serviceNames || [])[0] === catService!.name, "S6 add-service shortcut appended the service");
  await sendMsg("MENU", sPhone2);
  const storedAfter = await AppointmentModel.findById(s3BookingB._id).lean();
  assert(!!storedBefore && !!storedAfter && String(storedBefore.staffId) === String(storedAfter.staffId) && storedBefore.startAt.getTime() === storedAfter.startAt.getTime(), "S6 shortcuts did not mutate the booking before confirm");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S7. NO-SLOTS + STUCK ESCALATION ==========");
  const farFuture = dateKey(addDays(40));
  const s7a = await sendMsg(`move my booking to ${farFuture}`, sPhone2);
  assert(s7a.action === "no_slots" && ((s7a.reply || "").includes("Send another date") || (s7a.reply || "").includes("Free on")), "S7 far-future reschedule reports no_slots with friendly guidance");
  assert((await AppointmentModel.findById(s3BookingB._id).lean())?.status === "booked", "S7 no_slots did not mutate DB");
  await sendMsg("MENU", sPhone2);
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });
  await sendMsg("menu", sPhone2);
  await sendListReply("reschedule_booking", "Reschedule booking", sPhone2);
  const g1 = await sendMsg("zzz first", sPhone2);
  assert(["needs_booking", "needs_cancel_confirm"].includes(g1.action), "S7 first miss is a needs_* reply");
  const g2 = await sendMsg("qqq second", sPhone2);
  assert(["needs_booking", "needs_cancel_confirm"].includes(g2.action), "S7 second miss is a needs_* reply");
  let g3 = await sendMsg("rrr third", sPhone2);
  assert((g3.reply || "").includes("Not sure where you are?"), "S7 third consecutive miss escalates with guidance: " + g3.action);
  const g3s = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert(Number((g3s as { consecutiveFailures?: number }).consecutiveFailures || 0) === 0, "S7 counter resets after escalation");
  const g4 = await sendMsg("1", sPhone2);
  assert(g4.action === "reschedule_started", "S7 valid selection after escalation works");
  const g4s = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert(Number((g4s as { consecutiveFailures?: number }).consecutiveFailures || 0) === 0, "S7 valid action keeps counter at zero");
  await sendMsg("MENU", sPhone2);
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S8. ONE-MESSAGE BOOKING ==========");
  const s8Phone = "919008080008";
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: s8Phone });
  await CustomerModel.findOneAndUpdate({ salonId, normalizedPhone: s8Phone }, { $setOnInsert: { branchId, source: "whatsapp" }, $set: { name: "Echo Tester", interactionStatus: "active" } }, { upsert: true, new: true });
  const s8Phrase = daysFromToday(dateA) <= 1 ? "tomorrow" : `in ${Math.max(1, daysFromToday(dateA))} days`;
  const s8FreeStart = await findFreeStart(staffId, dateA, service!.durationMinutes);
  assert(!!s8FreeStart, "S8 there is a free slot to one-message book on the staff's first date");
  const s8TimeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(s8FreeStart!).replace("24:", "00:");
  const oneShot = await sendMsg(`book a ${service!.name} ${s8Phrase} at ${s8TimeLabel} with ${staffName}`, s8Phone);
  assert(oneShot.action === "booking_proposal", "S8 one-message booking produces a single confirm proposal: " + oneShot.action);
  assert((oneShot.reply || "").includes(service!.name) && (oneShot.reply || "").includes(staffName) && (oneShot.reply || "").includes("CONFIRM"), "S8 proposal summarises service/staff and asks for confirm");
  const s8Session = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: s8Phone }).lean();
  assert(s8Session?.state === "confirm_hold" && String(s8Session.staffId ?? "") === String(staffId) && !!s8Session.startAt, "S8 proposal drafts the booking with staff/date/time filled");
  assert(new Date(String(s8Session!.startAt)).getTime() === s8FreeStart!.getTime(), "S8 proposal stages the exact free slot requested");
  assert(!(await AppointmentModel.findOne({ salonId, customerName: "Echo Tester", status: { $in: BLOCKING }, startAt: s8Session?.startAt })), "S8 proposal does NOT mutate DB before confirm");
  const s8Confirm = await sendMsg("confirm", s8Phone);
  assert(s8Confirm.action === "appointment_created", "S8 confirm books it in one step: " + s8Confirm.action);
  assert((s8Confirm.reply || "").includes("Tip: need to move or change this later?"), "S8 confirmation carries post-booking guidance (E5)");
  const s8Created = await AppointmentModel.findById(String((s8Confirm.appointment as { id?: string }).id || "")).lean();
  assert(!!s8Created && s8Created.status === "confirmed" && s8Created.startAt.getTime() === s8FreeStart!.getTime(), "S8 one-message booking persisted a confirmed appointment at the exact slot");
  await sendMsg("MENU", s8Phone);
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: s8Phone });

  console.log("\n========== S9. INSTANT AVAILABILITY ANSWERS ==========");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });
  const beforeAvail = await AppointmentModel.countDocuments({ salonId, customerId: s3CustId, status: { $in: BLOCKING } });
  const s9a = await sendMsg(`are you free tomorrow?`, sPhone2);
  assert(["availability", "no_slots", "needs_date"].includes(s9a.action), "S9 free-day question gets an availability answer: " + s9a.action);
  if (s9a.action === "availability") assert((s9a.reply || "").includes("free on"), "S9 availability answer lists free slots");
  const s9b = await sendMsg("any slot at 5pm this week?", sPhone2);
  assert(["availability", "no_slots", "needs_date"].includes(s9b.action), "S9 slot question answered without menus: " + s9b.action);
  const s9State = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert(!(s9State?.state || "").startsWith("select_") && s9State?.state !== "confirm_hold" && (s9State?.state || "") !== "confirm", "S9 availability replies do not hijack the booking flow");
  assert((await AppointmentModel.countDocuments({ salonId, customerId: s3CustId, status: { $in: BLOCKING } })) === beforeAvail, "S9 availability answers never mutate bookings");
  const s9c = await sendMsg("hey what time does the salon close?", sPhone2);
  assert(!["availability", "no_slots", "booking_proposal"].includes(s9c.action), "S9 non-availability shop-hours question is not a slot listing");

  console.log("\n========== S10. FULL-SENTENCE MOVE/MODIFY ==========");
  const s10a = await sendMsg(`move my ${service!.name} booking from ${dateA} to ${dateB} at 17:00`, sPhone2);
  assert(["reschedule_slots", "no_slots", "modify_slots"].includes(s10a.action), "S10 full-sentence move (from X to Y at time) resolves: " + s10a.action);
  assert((await AppointmentModel.findById(s3BookingB._id).lean())?.status === "booked", "S10 full-sentence move does not mutate DB before slot pick");
  await sendMsg("MENU", sPhone2);
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });
  const s10CurrentName = String((await UserModel.findOne({ salonId, staffId: String((await AppointmentModel.findById(s3BookingB._id).lean())?.staffId ?? "") }).lean())?.name || "");
  const s10StaffName = ["Dev Kapoor", "Kabir Iyer", "Ananya Khan"].find((name) => name && s10CurrentName && name.toLowerCase() !== s10CurrentName.toLowerCase());
  if (s10StaffName) {
    const s10Swap = await sendMsg(`change staff to ${s10StaffName}`, sPhone2);
    assert(s10Swap.action === "confirm_modify", "S10 one-sentence staff change reaches confirmation: " + s10Swap.action);
    assert((await AppointmentModel.findById(s3BookingB._id).lean())?.status === "booked", "S10 staff change does not mutate DB before confirm");
    const s10s = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
    assert(String(s10s?.staffId ?? "") !== String((await AppointmentModel.findById(s3BookingB._id).lean())?.staffId), "S10 staff change staged in draft");
    await sendMsg("cancel", sPhone2);
  }
  await sendMsg("MENU", sPhone2);
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S11. SELF-CORRECTING DISAMBIGUATION ==========");
  await sendMsg("menu", sPhone2);
  await sendListReply("reschedule_booking", "Reschedule booking", sPhone2);
  const s11a = await sendMsg("qq boss", sPhone2);
  assert(["needs_booking", "needs_cancel_confirm"].includes(s11a.action), "S11 first miss stays a needs_* reply");
  const s11b = await sendMsg("ff fumble", sPhone2);
  assert((s11b.reply || "").includes("Hmm, I couldn't understand that message.") && (s11b.reply || "").includes("Could you reply with a booking number from the list?"), "S11 second consecutive miss self-corrects with a concrete example: " + s11b.action);
  const s11c = await sendMsg("zz zog", sPhone2);
  assert((s11c.reply || "").includes("Not sure where you are?"), "S11 third miss still escalates to help");
  const s11d = await sendMsg("1", sPhone2);
  assert(s11d.action === "reschedule_started", "S11 valid follow-up works after disambiguation");
  await sendMsg("MENU", sPhone2);
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S12. POST-BOOKING GUIDANCE ==========");
  const s12 = await sendMsg("book appointment", sPhone2);
  assert(["booking_flow", "booking_started", "needs_branch"].includes(s12.action), "S12 booking reopens for guidance check");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S13. MULTI-SERVICE ONE-MESSAGE BOOKING ==========");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });
  const service2 = await ServiceModel.findOne({ salonId, status: "active", branchIds: branchId, eligibleStaffIds: staffId, durationMinutes: 30, _id: { $ne: service!._id } }).sort({ name: 1 }).lean();
  assert(!!service2, "S13 a second 30-min service for the chosen staff exists to combine");
  assert(service2!.name !== service!.name, "S13 the two services to combine are distinct");
  const s13Phrase = daysFromToday(dateB) <= 1 ? "tomorrow" : `in ${Math.max(1, daysFromToday(dateB))} days`;
  let s13Free: Date | null = null;
  for (const label of SLOT_LABELS) {
    const [hh, mm] = label.split(":").map(Number);
    const cand = zonedTimeToUtc("Asia/Kolkata", dateB, hh || 0, mm || 0);
    const candEnd = new Date(cand.getTime() + 60 * 60_000);
    if (candEnd.getTime() > zonedTimeToUtc("Asia/Kolkata", dateB, 20, 0).getTime()) break;
    const overlap = await AppointmentModel.findOne({ salonId, staffId, status: { $in: BLOCKING }, startAt: { $lt: candEnd }, endAt: { $gt: cand } });
    if (overlap) continue;
    const lock = await AppointmentSlotLockModel.findOne({ salonId, staffId, slotAt: { $gte: cand, $lt: candEnd } });
    if (lock) continue;
    s13Free = cand;
    break;
  }
  assert(!!s13Free, "S13 a free 60-minute slot within branch hours exists on the chosen staff date");
  const s13TimeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(s13Free!).replace("24:", "00:");
  const s13 = await sendMsg(`book a ${service!.name} and ${service2!.name} ${s13Phrase} at ${s13TimeLabel} with ${staffName}`, sPhone2);
  assert(s13.action === "booking_proposal", "S13 multi-service one-message booking proposes once: " + s13.action);
  assert((s13.reply || "").includes(service!.name) && (s13.reply || "").includes(service2!.name) && (s13.reply || "").includes("+"), "S13 proposal lists both services together");
  const s13Session = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert(s13Session?.state === "confirm_hold" && (s13Session.serviceIds || []).length === 2 && s13Session.durationMinutes === 60, "S13 proposal combines both services (ids + total duration)");
  assert(new Date(String(s13Session!.startAt)).getTime() === s13Free!.getTime(), "S13 proposal stages the exact requested slot");
  assert(!(await AppointmentModel.findOne({ salonId, staffId, status: { $in: BLOCKING }, serviceNames: { $size: 2 } })), "S13 proposal does not mutate DB before confirm");
  const s13Confirm = await sendMsg("confirm", sPhone2);
  assert(s13Confirm.action === "appointment_created", "S13 confirm books the multi-service appointment: " + s13Confirm.action);
  const s13Created = await AppointmentModel.findById(String((s13Confirm.appointment as { id?: string }).id || "")).lean();
  assert(!!s13Created && s13Created.serviceNames.length === 2 && s13Created.durationMinutes === 60 && s13Created.startAt.getTime() === s13Free!.getTime(), "S13 multi-service appointment persisted with both services at the right slot");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S14. FLEX PICK + CONVERSATIONAL CORRECTION ==========");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });
  let s14Date = "";
  for (const d of scheduleDates) {
    if (daysFromToday(d) < 1) continue;
    if (await findFreeStart(staffId, d, 30)) { s14Date = d; break; }
  }
  assert(!!s14Date, "S14 a free future date exists for a flexible one-message booking");
  const s14Phrase = daysFromToday(s14Date) <= 1 ? "tomorrow" : `in ${Math.max(1, daysFromToday(s14Date))} days`;
  const s14Flex = await sendMsg(`book a ${service!.name} ${s14Phrase} anytime`, sPhone2);
  assert(s14Flex.action === "booking_proposal", "S14 flexible 'anytime' booking proposes the earliest slot: " + s14Flex.action);
  const s14s0 = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert(s14s0?.state === "confirm_hold" && String(s14s0.staffId ?? "") === String(staffId) && (s14s0.date || "") === s14Date, "S14 flex proposal fills staff and date");
  assert(!(await AppointmentModel.findOne({ salonId, staffId, status: { $in: BLOCKING }, startAt: s14s0?.startAt })), "S14 flex proposal does not mutate DB before confirm");
  const s14Confirm = await sendMsg("confirm", sPhone2);
  assert(s14Confirm.action === "appointment_created", "S14 flex booking confirms in one step: " + s14Confirm.action);
  assert((s14Confirm.reply || "").includes("reminder the day before"), "S14 confirmation offers the day-before reminder (opt-in)");
  const s14ConfirmId = String((s14Confirm.appointment as { id?: string }).id || "");
  const s14Post = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert((s14Post as any)?.pendingReminder === true, "S14 session flags an awaiting reminder response");
  const s14Yes = await sendMsg("yes", sPhone2);
  assert(s14Yes.action === "reminder_optin", "S14 YES opts into the reminder: " + s14Yes.action);
  assert((await AppointmentModel.findById(s14ConfirmId).lean())?.reminderOptIn === true, "S14 reminderOptIn persisted on the appointment");
  const s14Prop2 = await sendMsg(`book a ${service!.name} ${s14Phrase} anytime`, sPhone2);
  assert(s14Prop2.action === "booking_proposal", "S14 second flex proposal opens a correction target; got action=" + s14Prop2.action + " reply=" + JSON.stringify(s14Prop2.reply).slice(0, 200));
  const s14s1 = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  const s14FirstStart = new Date(String(s14s1?.startAt || "")).getTime();
  assert(!!(s14s1 as any)?.lastAlternates, "S14 proposal stores alternate slots for correction");
  const s14Before = await AppointmentModel.countDocuments({ salonId, staffId, status: { $in: BLOCKING } });
  const s14No = await sendMsg("no, the other one", sPhone2);
  assert(s14No.action === "booking_proposal" && (s14No.reply || "").includes("How about instead"), "S14 correction swaps to the next alternate: " + s14No.action);
  const s14s2 = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert(new Date(String(s14s2?.startAt || "")).getTime() !== s14FirstStart, "S14 correction moved the proposed slot");
  const s14After = await AppointmentModel.countDocuments({ salonId, staffId, status: { $in: BLOCKING } });
  assert(s14After === s14Before, "S14 correction re-proposes without creating bookings");
  await sendMsg("cancel", sPhone2);
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S15. FIRST-AVAILABLE ESCALATION + RANGE AWARENESS ==========");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });
  const s15Phrase = daysFromToday(dateB) <= 1 ? "tomorrow" : `in ${Math.max(1, daysFromToday(dateB))} days`;
  const s15a = await sendMsg(`earliest slot ${s15Phrase}?`, sPhone2);
  assert(s15a.action === "availability_earliest", "S15 earliest-slot ask escalates to a bookable offer: " + s15a.action);
  assert((s15a.reply || "").includes("Reply YES"), "S15 earliest offer invites YES to book");
  const s15Offer = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert(!!(s15Offer as any)?.earliestOffer, "S15 earliest offer stored on the session for the YES follow-up");
  const s15b = await sendMsg("yes", sPhone2);
  assert(s15b.action === "booking_proposal" && (s15b.reply || "").includes("CONFIRM"), "S15 YES converts the offer into a single booking proposal: " + s15b.action);
  const s15OfferCleared = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert(!(s15OfferCleared as any)?.earliestOffer, "S15 offer is consumed once accepted");
  await sendMsg("cancel", sPhone2);
  const s15c = await sendMsg(`earliest slot ${s15Phrase}?`, sPhone2);
  assert(s15c.action === "availability_earliest", "S15 second earliest ask re-offers");
  const s15d = await sendMsg("no", sPhone2);
  assert(s15d.action === "offer_declined", "S15 NO declines without booking: " + s15d.action);
  const s15dSession = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: sPhone2 }).lean();
  assert(!(s15dSession as any)?.earliestOffer, "S15 declined offer is cleared");
  const s15e = await sendMsg(`any free slots ${s15Phrase} between 3 and 6 pm?`, sPhone2);
  assert(["availability", "no_slots", "needs_date"].includes(s15e.action), "S15 range-aware availability answered without menus: " + s15e.action);
  if (s15e.action === "availability") {
    const windowLabels = Array.from((s15e.reply || "").matchAll(/\b(\d{2}):(\d{2})\b/g)).map((m) => Number(m[1]) * 60 + Number(m[2]));
    assert(windowLabels.length > 0 && windowLabels.every((min) => min >= 15 * 60 && min <= 18 * 60), "S15 range availability lists only slots inside the 3-6pm window");
  }
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: sPhone2 });

  console.log("\n========== S16. DAY-BEFORE REMINDER NUDGE JOB ==========");
  await WhatsAppBookingSessionModel.deleteMany({ salonId, waPhone: s8Phone });
  const s16Cust = await CustomerModel.findOneAndUpdate({ salonId, normalizedPhone: s8Phone }, { $setOnInsert: { branchId, source: "whatsapp" }, $set: { name: "Echo Tester", interactionStatus: "booked" } }, { upsert: true, new: true });
  const s16Start = new Date(Date.now() + 23 * 60 * 60_000);
  const s16Appt = await AppointmentModel.create({ salonId, branchId, staffId, customerId: String(s16Cust._id), customerName: "Echo Tester", serviceIds: [String(service!._id)], serviceNames: [service!.name], durationMinutes: service!.durationMinutes, value: service!.pricePaise || 0, startAt: s16Start, endAt: new Date(s16Start.getTime() + service!.durationMinutes * 60_000), status: "confirmed", source: "whatsapp", paymentStatus: "not_required", version: 1, reminderOptIn: true, whatsappReminderSentAt: null });
  assert(!(await WhatsAppOutboundModel.exists({ type: "reminder", salonId, appointmentId: String(s16Appt._id) })), "S16 no reminder outbound yet");
  const s16Stats = await runDueReminderNudges();
  assert(s16Stats.attempted >= 1 && s16Stats.sent >= 1, "S16 reminder job processed the due opt-in appointment: " + JSON.stringify(s16Stats));
  const s16Outbound = await WhatsAppOutboundModel.findOne({ type: "reminder", salonId, appointmentId: String(s16Appt._id) }).sort({ createdAt: -1 }).lean();
  assert(!!s16Outbound && String(s16Outbound.toPhone) === s8Phone, "S16 reminder outbound targets the right customer");
  assert((await AppointmentModel.findById(s16Appt._id).lean())?.whatsappReminderSentAt != null, "S16 appointment flagged as reminded after send");
  const s16AfterRun = await runDueReminderNudges();
  const s16OutboundCount = await WhatsAppOutboundModel.countDocuments({ type: "reminder", salonId, appointmentId: String(s16Appt._id) });
  assert(s16AfterRun.sent === 0 && s16OutboundCount === 1, "S16 reminder job does not double-send a flagged appointment");

  console.log("\n================ DONE: all e2e checks passed ================");
  if (unsubscribe) unsubscribe();
  await cleanupTestData();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
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
  // Remove echo customers created by concurrency/duplicate tests (and their appointments/locks).
  const echoPhones = ["919008080001", "919008080002", "919008080003", "919820804255", "919008080005", "919008080006", "919008080007", "919008080008"];
  const echoCustomers = await CustomerModel.find({ salonId, normalizedPhone: { $in: echoPhones } }).select("_id").lean();
  for (const c of echoCustomers) {
    const ids = (await AppointmentModel.find({ salonId, customerId: String(c._id) }).select("_id").lean()).map((a) => String(a._id));
    if (ids.length) await AppointmentSlotLockModel.deleteMany({ salonId, appointmentId: { $in: ids } });
    await AppointmentModel.deleteMany({ salonId, customerId: String(c._id) });
    await CustomerModel.deleteOne({ _id: c._id });
  }
  await WhatsAppBookingSessionModel.deleteMany({ salonId });
}

main().catch(async (e) => {
  console.error(e);
  await cleanupTestData().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});

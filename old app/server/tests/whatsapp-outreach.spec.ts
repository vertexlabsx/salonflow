import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { cleanupCollections, seedAuthFixtures, TENANT, BRANCH_ID } from "./helpers/auth-fixtures";
import { loadEnv, setEnvForTesting } from "../src/config/env";
import { CustomerModel } from "../src/models/customer.model";
import { AppointmentModel } from "../src/models/appointment.model";
import { OwnerSettingsModel } from "../src/models/owner-settings.model";
import { WaitlistModel } from "../src/models/waitlist.model";
import { WhatsAppOutboundModel } from "../src/models/whatsapp-outbound.model";
import { sendWhatsAppMessage, withOptOutFooter } from "../src/modules/whatsapp/whatsapp.service";
import { applyDepositToAppointment, verifyOrRefreshDepositLink } from "../src/modules/whatsapp/deposit.service";
import { offerCancelledSlotToWaitlist } from "../src/modules/whatsapp/waitlist.service";
import {
  runBirthdayNudges,
  runFeedbackNudges,
  runRebookingNudges,
  runNoShowNudges,
  runAbandonedBookingNudges,
  runPaymentFailedRecovery,
  runWaitlistNudges
} from "../src/jobs/whatsapp-nudges";

beforeAll(async () => {
  await createTestWorld();
});

afterAll(async () => {
  await destroyTestWorld();
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await cleanupCollections();
  await seedAuthFixtures();
  setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "mock", META_APP_SECRET: "", META_WEBHOOK_APP_SECRET: "" });
});

async function seedCustomer(overrides: Record<string, unknown> = {}): Promise<{ id: string; phone: string }> {
  const customer = await CustomerModel.create({
    salonId: TENANT,
    branchId: BRANCH_ID,
    name: "Test Customer",
    normalizedPhone: "919999000000",
    marketingOptOut: false,
    loyaltyPoints: 10,
    ...overrides
  });
  return { id: String(customer._id), phone: "919999000000" };
}

function isoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

describe("WhatsApp outreach recovery features", () => {
  it("adds an opt-out footer to marketing-type messages only", () => {
    expect(withOptOutFooter("birthday", "Happy birthday!")).toContain("Reply STOP to opt out");
    expect(withOptOutFooter("utility", "Your booking is confirmed")).not.toContain("Reply STOP");
    expect(withOptOutFooter("deposit", "Please pay")).not.toContain("Reply STOP");
  });

  it("appends the opt-out footer on actual outbound marketing sends", async () => {
    await seedCustomer();
    await sendWhatsAppMessage({ salonId: TENANT, toPhone: "919999000000", type: "birthday", body: "Happy Birthday!" });
    const row = await WhatsAppOutboundModel.findOne({ salonId: TENANT, type: "birthday" }).lean();
    expect(row?.body).toContain("Reply STOP to opt out");
  });

  it("runs birthday nudges for today's birthday customers and dedupes", async () => {
    const m = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", month: "2-digit", day: "2-digit" }).format(new Date());
    await seedCustomer({ birthday: m });
    await seedCustomer({ name: "Other", normalizedPhone: "919999000001", birthday: "" });
    const sent = await runBirthdayNudges();
    expect(sent).toBe(1);
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "birthday" })).toBe(1);
    const again = await runBirthdayNudges();
    expect(again).toBe(0);
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "birthday" })).toBe(1);
  });

  it("sends feedback requests shortly after completed visits", async () => {
    const { id } = await seedCustomer();
    const now = new Date();
    await AppointmentModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", customerId: id, serviceIds: [], serviceNames: ["Haircut"], durationMinutes: 30, value: 50000, startAt: new Date(now.getTime() - 60 * 60_000), endAt: new Date(now.getTime() - 30 * 60_000), status: "completed" });
    const sent = await runFeedbackNudges(now);
    expect(sent).toBe(1);
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "feedback" })).toBe(1);
  });

  it("sends rebooking recommendations for past completed appointments", async () => {
    const { id } = await seedCustomer();
    const now = new Date();
    await AppointmentModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", customerId: id, serviceIds: ["s1"], serviceNames: ["Haircut"], durationMinutes: 30, value: 50000, startAt: new Date(now.getTime() - 30 * 24 * 60 * 60_000), endAt: new Date(now.getTime() - 30 * 24 * 60 * 60_000 + 30 * 60_000), status: "completed" });
    const sent = await runRebookingNudges(now);
    expect(sent).toBe(1);
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "rebooking" })).toBe(1);
  });

  it("sends no-show follow-ups for recent no-shows", async () => {
    const { id } = await seedCustomer();
    const now = new Date();
    await AppointmentModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", customerId: id, serviceIds: [], serviceNames: ["Haircut"], durationMinutes: 30, value: 50000, startAt: new Date(now.getTime() - 2 * 60 * 60_000), endAt: new Date(now.getTime() - 90 * 60_000), status: "no_show" });
    const sent = await runNoShowNudges(now);
    expect(sent).toBe(1);
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "no_show" })).toBe(1);
  });

  it("sends abandoned-booking recovery for stale pending holds", async () => {
    const { id } = await seedCustomer();
    const now = new Date();
    await AppointmentModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", customerId: id, serviceIds: [], serviceNames: ["Haircut"], durationMinutes: 30, value: 50000, startAt: new Date(now.getTime() + 60 * 60_000), endAt: new Date(now.getTime() + 90 * 60_000), status: "pending", paymentStatus: "pending", holdExpiresAt: null, createdAt: new Date(now.getTime() - 30 * 60_000) });
    const sent = await runAbandonedBookingNudges(now);
    expect(sent).toBe(1);
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "abandoned" })).toBe(1);
  });

  it("sends payment-failed recovery for expired holds", async () => {
    const { id } = await seedCustomer();
    await AppointmentModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", customerId: id, serviceIds: [], serviceNames: ["Haircut"], durationMinutes: 30, value: 50000, startAt: new Date(Date.now() + 60 * 60_000), endAt: new Date(Date.now() + 90 * 60_000), status: "expired", paymentStatus: "failed", paymentProvider: "razorpay" });
    const sent = await runPaymentFailedRecovery();
    expect(sent).toBe(1);
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "payment_failed" })).toBe(1);
  });

  it("notifies waitlist entries when off the schedule runs", async () => {
    const { id } = await seedCustomer();
    await WaitlistModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", serviceIds: ["s1"], serviceNames: ["Haircut"], date: isoToday(), customerId: id, customerPhone: "919999000000", status: "waiting", notified: false });
    const sent = await runWaitlistNudges();
    expect(sent).toBe(1);
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "waitlist" })).toBe(1);
    const entry = await WaitlistModel.findOne({ serviceIds: ["s1"] }).lean();
    expect(entry?.status).toBe("offered");
    expect(entry?.notified).toBe(true);
  });

  it("applies a configured deposit and creates a Razorpay payment link", async () => {
    setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "mock", RAZORPAY_KEY_ID: "rzp_test_key", RAZORPAY_KEY_SECRET: "rzp_test_secret" });
    await OwnerSettingsModel.create({ salonId: TENANT, branchId: "", settings: { booking: { depositsEnabled: true, depositPercent: 20 } }, lastChangedBy: "test" });
    const link = { id: "plink_test", shortUrl: "https://rzp.io/l/test" };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: link.id, short_url: link.shortUrl }) })));
    const { id } = await seedCustomer();
    const appointment = await AppointmentModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", customerName: "Test Customer", customerId: id, serviceIds: ["s1"], serviceNames: ["Haircut"], durationMinutes: 30, value: 50000, startAt: new Date(Date.now() + 60 * 60_000), endAt: new Date(Date.now() + 90 * 60_000), status: "confirmed", paymentStatus: "not_required" });
    const result = await applyDepositToAppointment({ salonId: TENANT, branchId: BRANCH_ID, appointmentId: String(appointment._id), valuePaise: 50000, customerName: "Test Customer", customerPhone: "919999000000" });
    expect(result.applied).toBe(true);
    expect(result.depositPaise).toBe(10000);
    const updated = await AppointmentModel.findById(appointment._id).lean();
    expect(updated?.status).toBe("pending");
    expect(updated?.paymentStatus).toBe("pending");
    expect(updated?.paymentProvider).toBe("razorpay");
    expect(updated?.paymentProviderId).toBe("plink_test");
    expect(updated?.holdExpiresAt).toBeTruthy();
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "deposit" })).toBe(1);
  });

  it("does not apply a deposit when Razorpay is unconfigured", async () => {
    await OwnerSettingsModel.create({ salonId: TENANT, branchId: "", settings: { booking: { depositsEnabled: true, depositPercent: 20 } }, lastChangedBy: "test" });
    setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "mock", RAZORPAY_KEY_ID: "", RAZORPAY_KEY_SECRET: "" });
    const { id } = await seedCustomer();
    const appointment = await AppointmentModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", customerId: id, serviceIds: ["s1"], serviceNames: ["Haircut"], durationMinutes: 30, value: 50000, startAt: new Date(Date.now() + 60 * 60_000), endAt: new Date(Date.now() + 90 * 60_000), status: "confirmed", paymentStatus: "not_required" });
    const result = await applyDepositToAppointment({ salonId: TENANT, branchId: BRANCH_ID, appointmentId: String(appointment._id), valuePaise: 50000, customerName: "Test Customer", customerPhone: "919999000000" });
    expect(result.applied).toBe(false);
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "deposit" })).toBe(0);
  });

  it("verifies Razorpay payment status when customer says paid", async () => {
    setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "mock", RAZORPAY_KEY_ID: "rzp_test_key", RAZORPAY_KEY_SECRET: "rzp_test_secret" });
    const { id } = await seedCustomer();
    const appointment = await AppointmentModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", customerId: id, serviceIds: ["s1"], serviceNames: ["Haircut"], durationMinutes: 30, value: 50000, startAt: new Date(Date.now() + 60 * 60_000), endAt: new Date(Date.now() + 90 * 60_000), status: "pending", paymentStatus: "pending", paymentProvider: "razorpay", paymentProviderId: "plink_paid", paymentLink: "https://rzp.io/l/paid", depositAmountPaise: 10000, holdExpiresAt: new Date(Date.now() + 20 * 60_000) });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "plink_paid", status: "paid", payments: [{ payment_id: "pay_123", status: "captured" }] }) })));
    const result = await verifyOrRefreshDepositLink({ salonId: TENANT, appointmentId: String(appointment._id), customerName: "Test Customer", customerPhone: "919999000000" });
    expect(result.status).toBe("paid");
    const updated = await AppointmentModel.findById(appointment._id).lean();
    expect(updated?.status).toBe("confirmed");
    expect(updated?.paymentStatus).toBe("paid");
    expect(updated?.paymentReference).toBe("pay_123");
  });

  it("offers a cancelled slot to the earliest matching waitlist customer", async () => {
    const { id } = await seedCustomer();
    const startAt = new Date(Date.now() + 24 * 60 * 60_000);
    const endAt = new Date(startAt.getTime() + 30 * 60_000);
    await WaitlistModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", serviceIds: ["s1"], serviceNames: ["Haircut"], date: "", preferredTime: "", customerId: id, customerPhone: "919999000000", status: "waiting", notified: false });
    const result = await offerCancelledSlotToWaitlist({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", serviceIds: ["s1"], serviceNames: ["Haircut"], startAt, endAt, value: 50000, durationMinutes: 30 });
    expect(result.offered).toBe(true);
    const entry = await WaitlistModel.findOne({ customerId: id }).lean();
    expect(entry?.status).toBe("offered");
    expect(entry?.offeredAppointmentId).toBeTruthy();
    const appointment = await AppointmentModel.findById(entry?.offeredAppointmentId).lean();
    expect(appointment?.status).toBe("pending");
    expect(await WhatsAppOutboundModel.countDocuments({ salonId: TENANT, type: "waitlist" })).toBe(1);
  });

  it("skips opted-out customers across outreach", async () => {
    await seedCustomer({ birthday: new Intl.DateTimeFormat("en-CA", { month: "2-digit", day: "2-digit" }).format(new Date()), marketingOptOut: true });
    const sent = await runBirthdayNudges();
    expect(sent).toBe(0);
  });
});

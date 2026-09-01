import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { BRANCH_ID, TENANT, cleanupCollections, seedAuthFixtures } from "./helpers/auth-fixtures";
import { ScheduleModel } from "../src/models/schedule.model";
import { AppointmentModel } from "../src/models/appointment.model";
import { ServiceModel } from "../src/models/service.model";

async function firstServiceId(): Promise<string> {
  const service = await ServiceModel.findOne({ salonId: TENANT, status: "active" }).lean();
  if (!service) throw new Error("No service seeded");
  return String(service._id);
}

let app: Express;

function dateInTz(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

beforeAll(async () => {
  ({ app } = await createTestWorld());
});

afterAll(async () => {
  await destroyTestWorld();
});

beforeEach(async () => {
  await cleanupCollections();
  await seedAuthFixtures();
  await ScheduleModel.create({
    salonId: TENANT,
    branchId: BRANCH_ID,
    staffId: "staff_seed_reception",
    scheduleDate: dateInTz(1),
    startTime: "10:00",
    endTime: "21:00",
    shiftType: "regular",
    status: "scheduled",
    version: 1
  });
});

describe("public self-booking portal", () => {
  it("lists active branches publicly by salonId", async () => {
    const res = await supertest(app).get("/api/v1/self-booking/branches").query({ salonId: TENANT });
    expect(res.status).toBe(200);
    expect(res.body.data.branches.some((b: { id: string }) => b.id === BRANCH_ID)).toBe(true);
  });

  it("lists active services for a branch", async () => {
    const res = await supertest(app).get("/api/v1/self-booking/services").query({ salonId: TENANT, branchId: BRANCH_ID });
    expect(res.status).toBe(200);
    expect(res.body.data.services.map((s: { name: string }) => s.name)).toContain("Haircut");
    expect(res.body.data.services[0].pricePaise).toBeGreaterThan(0);
  });

  it("returns only slots that are genuinely available", async () => {
    const tomorrow = dateInTz(1);
    const service = await firstServiceId();
    const res = await supertest(app).get("/api/v1/self-booking/slots").query({ salonId: TENANT, branchId: BRANCH_ID, serviceId: service, date: tomorrow });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.slots)).toBe(true);
    expect(res.body.data.slots.length).toBeGreaterThan(0);
    for (const slot of res.body.data.slots) {
      expect(typeof slot.startAt).toBe("string");
      expect(typeof slot.staffId).toBe("string");
    }
  });

  it("books an appointment (WhatsApp-confirmed) and the slot no longer appears", async () => {
    const tomorrow = dateInTz(1);
    const service = await firstServiceId();
    const slotsRes = await supertest(app).get("/api/v1/self-booking/slots").query({ salonId: TENANT, branchId: BRANCH_ID, serviceId: service, date: tomorrow });
    const { startAt } = slotsRes.body.data.slots[0];

    const book = await supertest(app).post("/api/v1/self-booking/book").send({
      salonId: TENANT, branchId: BRANCH_ID, serviceId: service, startAt,
      customerName: "Rina", phone: "9876543210"
    });
    expect(book.status).toBe(200);
    expect(book.body.data.bookingId).toBeTruthy();
    expect(book.body.data.status).toBeTruthy();

    const afterRes = await supertest(app).get("/api/v1/self-booking/slots").query({ salonId: TENANT, branchId: BRANCH_ID, serviceId: service, date: tomorrow });
    const stillAvailable = afterRes.body.data.slots.some((s: { startAt: string }) => s.startAt === startAt);
    expect(stillAvailable).toBe(false);
  });

  it("refuses cancel when the phone does not match; cancels otherwise", async () => {
    const tomorrow = dateInTz(1);
    const service = await firstServiceId();
    const slotsRes = await supertest(app).get("/api/v1/self-booking/slots").query({ salonId: TENANT, branchId: BRANCH_ID, serviceId: service, date: tomorrow });
    const book = await supertest(app).post("/api/v1/self-booking/book").send({
      salonId: TENANT, branchId: BRANCH_ID, serviceId: service, startAt: slotsRes.body.data.slots[0].startAt,
      customerName: "Rina", phone: "9876543210"
    });
    const bookingId = book.body.data.bookingId;

    const wrongPhone = await supertest(app).post("/api/v1/self-booking/cancel").send({ salonId: TENANT, appointmentId: bookingId, phone: "1111111111" });
    expect([403, 404]).toContain(wrongPhone.status);

    const rightPhone = await supertest(app).post("/api/v1/self-booking/cancel").send({ salonId: TENANT, appointmentId: bookingId, phone: "9876543210" });
    expect(rightPhone.status).toBe(200);
    expect(rightPhone.body.data.status).toBe("cancelled");
    const appt = await AppointmentModel.findById(bookingId);
    expect(appt?.status).toBe("cancelled");
  });
});

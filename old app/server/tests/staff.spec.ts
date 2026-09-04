import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { TENANT, BRANCH_ID, cleanupCollections, seedAuthFixtures, loginStaff, createUser, type StaffSession } from "./helpers/auth-fixtures";
import { AppointmentModel } from "../src/models/appointment.model";
import { CustomerModel } from "../src/models/customer.model";
import { InvoiceModel } from "../src/models/invoice.model";
import { businessDateIn, zonedDayRange } from "../src/shared/business-date";

let app: Express;
let staff: StaffSession;
let clientviewer: StaffSession;
let nobody: StaffSession;

/**
 * Anchors seeds inside the salon-local business day so assertions hold no
 * matter when the suite runs (e.g. right after IST midnight).
 */
const DAY = zonedDayRange("Asia/Kolkata", businessDateIn("Asia/Kolkata"));

function appointmentTimes(offsetMinutes: number, durationMinutes = 45): { startAt: Date; endAt: Date } {
  const startAt = new Date(DAY.start.getTime() + offsetMinutes * 60_000);
  return { startAt, endAt: new Date(startAt.getTime() + durationMinutes * 60_000) };
}

async function seedAppointments(): Promise<void> {
  const booked = appointmentTimes(600);
  const live = appointmentTimes(120, 60);
  const completed = appointmentTimes(180);
  const cancelled = appointmentTimes(240);
  await AppointmentModel.create([
    {
      salonId: TENANT,
      branchId: BRANCH_ID,
      staffId: "staff_seed_reception",
      serviceIds: ["svc_haircut"],
      serviceNames: ["Haircut"],
      durationMinutes: 45,
      value: 50_000,
      ...booked,
      status: "booked",
      chair: "Chair 1",
      source: "crm"
    },
    {
      salonId: TENANT,
      branchId: BRANCH_ID,
      staffId: "staff_seed_reception",
      serviceIds: ["svc_color"],
      serviceNames: ["Hair Color"],
      durationMinutes: 120,
      value: 250_000,
      ...live,
      status: "in_service",
      chair: "Chair 2",
      source: "crm"
    },
    {
      salonId: TENANT,
      branchId: BRANCH_ID,
      staffId: "staff_seed_reception",
      serviceIds: ["svc_facial"],
      serviceNames: ["Facial"],
      durationMinutes: 45,
      value: 120_000,
      ...completed,
      status: "completed",
      chair: "Chair 1",
      source: "crm"
    },
    {
      salonId: TENANT,
      branchId: BRANCH_ID,
      staffId: "staff_seed_reception",
      serviceIds: ["svc_pedi"],
      serviceNames: ["Pedicure"],
      durationMinutes: 45,
      value: 80_000,
      ...cancelled,
      status: "cancelled",
      chair: "Chair 3",
      source: "crm"
    },
    {
      // Other-tenant record must never leak into any staff read model.
      salonId: "tenant_other",
      branchId: "tenant_other_main",
      staffId: "staff_seed_reception",
      serviceIds: ["svc_evil"],
      serviceNames: ["Cross Tenant"],
      durationMinutes: 30,
      value: 999_00,
      ...appointmentTimes(15),
      status: "booked",
      source: "crm"
    }
  ]);
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
  staff = await loginStaff(app, "reception", "staff@123");
  await createUser({ loginId: "clientviewer", name: "Client Desk", staffId: "staff_clientviewer", staffAppPermissions: ["read:appointments", "read:clients"] });
  clientviewer = await loginStaff(app, "clientviewer", "secret@123");
  await createUser({ loginId: "norole", name: "No Perms", staffId: "staff_norole", staffAppPermissions: [] });
  nobody = await loginStaff(app, "norole", "secret@123");
});

describe("POST /api/v1/staff-os/attendance/clock-in", () => {
  it("requires authentication", async () => {
    // Satisfy the transport-level CSRF check first so we assert on auth itself.
    const { fetchCsrf } = await import("./helpers/auth-fixtures");
    const csrf = await fetchCsrf(app);
    const response = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-in")
      .set("x-csrf-token", csrf.token)
      .send({});
    expect(response.status).toBe(401);
  });

  it("requires the checkin-checkout permission", async () => {
    const response = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-in")
      .set("x-auth-token", nobody.accessToken)
      .send({});
    expect(response.status).toBe(403);
  });

  it("creates an open attendance record inside a transaction", async () => {
    const response = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-in")
      .set("x-auth-token", staff.accessToken)
      .send({ source: "staff-app" });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    const attendance = response.body.data;
    expect(attendance.id).toBeTruthy();
    expect(attendance.status).toBe("open");
    expect(attendance.clockOutAt).toBe("");
    expect(attendance.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(attendance.clockInAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("rejects a second concurrent clock-in (single open attendance)", async () => {
    const first = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-in")
      .set("x-auth-token", staff.accessToken)
      .send({});
    expect(first.status).toBe(201);

    const second = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-in")
      .set("x-auth-token", staff.accessToken)
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/already checked in/i);
  });
});

describe("POST /api/v1/staff-os/attendance/clock-out", () => {
  it("closes the open attendance and computes gross minutes", async () => {
    const checkin = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-in")
      .set("x-auth-token", staff.accessToken)
      .send({});

    // Small gap so grossMinutes is deterministic-ish (>0).
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const checkout = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-out")
      .set("x-auth-token", staff.accessToken)
      .send({ attendanceId: checkin.body.data.id });

    expect(checkout.status).toBe(200);
    expect(checkout.body.data.status).toBe("closed");
    expect(checkout.body.data.clockOutAt).toBeTruthy();
    expect(checkout.body.data.grossMinutes).toBeGreaterThanOrEqual(0);
    expect(checkout.body.data.totalWorkedMinutes).toBeGreaterThanOrEqual(0);
  });

  it("refuses to close an already-closed record and rejects foreign ids", async () => {
    const checkin = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-in")
      .set("x-auth-token", staff.accessToken)
      .send({});
    const id = checkin.body.data.id;

    const first = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-out")
      .set("x-auth-token", staff.accessToken)
      .send({ attendanceId: id });
    expect(first.status).toBe(200);

    const replay = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-out")
      .set("x-auth-token", staff.accessToken)
      .send({ attendanceId: id });
    expect(replay.status).toBe(409);

    const missing = await supertest(app)
      .post("/api/v1/staff-os/attendance/clock-out")
      .set("x-auth-token", staff.accessToken)
      .send({ attendanceId: "507f1f77bcf86cd799439011" });
    expect(missing.status).toBe(404);
  });
});

describe("GET /api/v1/staff-os/attendance", () => {
  it("lists the caller's own attendance scoped to their tenant", async () => {
    await supertest(app).post("/api/v1/staff-os/attendance/clock-in").set("x-auth-token", staff.accessToken).send({});
    const response = await supertest(app).get("/api/v1/staff-os/attendance").set("x-auth-token", staff.accessToken);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBe(1);
    expect(response.body.data[0].status).toBe("open");
  });

  it("supports date and from/to filters", async () => {
    const checkin = await supertest(app).post("/api/v1/staff-os/attendance/clock-in").set("x-auth-token", staff.accessToken).send({});
    const businessDate = checkin.body.data.businessDate as string;

    const byDate = await supertest(app)
      .get("/api/v1/staff-os/attendance")
      .query({ date: businessDate })
      .set("x-auth-token", staff.accessToken);
    expect(byDate.body.data.length).toBe(1);

    const miss = await supertest(app)
      .get("/api/v1/staff-os/attendance")
      .query({ date: "2001-01-01" })
      .set("x-auth-token", staff.accessToken);
    expect(miss.body.data.length).toBe(0);
  });
});

describe("GET /api/v1/staff-os/mobile/today", () => {
  it("returns the StaffToday contract with attendance included", async () => {
    await supertest(app).post("/api/v1/staff-os/attendance/clock-in").set("x-auth-token", staff.accessToken).send({});
    const response = await supertest(app).get("/api/v1/staff-os/mobile/today").set("x-auth-token", staff.accessToken);

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(data.schedules)).toBe(true);
    expect(data.attendance.length).toBe(1);
    expect(data.attendance[0].clockInAt).toBeTruthy();
    expect(data.activeBreak).toBeNull();
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  it("is permission-guarded", async () => {
    const response = await supertest(app).get("/api/v1/staff-os/mobile/today").set("x-auth-token", nobody.accessToken);
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/staff-self/dashboard", () => {
  it("returns the dashboard read model with today's appointments and summary", async () => {
    await seedAppointments();
    const response = await supertest(app).get("/api/v1/staff-self/dashboard").set("x-auth-token", staff.accessToken);

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.staff.fullName).toBe("Front Desk Reception");
    expect(data.staff.firstName).toBe("Front");
    expect(data.summary.todayAppointments).toBe(4);
    expect(data.summary.liveAppointments).toBe(1);
    expect(data.summary.completedAppointments).toBe(1);
    expect(data.summary.cancelledAppointments).toBe(1);
    expect(data.summary.appointmentValue).toBe(50000 + 250000 + 120000);
    expect(data.appointments).toHaveLength(4);
    expect(data.liveAppointments[0].status).toBe("in_service");
    expect(data.workReport[0].serviceNames).toEqual(["Facial"]);
    // Cross-tenant isolation
    expect(JSON.stringify(data.appointments)).not.toContain("Cross Tenant");
    expect(data.sales).toEqual([]);
  });

  it("scopes records to the caller's branches only", async () => {
    await seedAppointments();
    await AppointmentModel.create({
      salonId: TENANT,
      branchId: "tenant_aura_otherbranch",
      staffId: "staff_seed_reception",
      serviceIds: ["svc_x"],
      serviceNames: ["Other Branch"],
      durationMinutes: 30,
      value: 10_000,
      ...appointmentTimes(30),
      status: "booked",
      source: "crm"
    });

    const response = await supertest(app).get("/api/v1/staff-self/dashboard").set("x-auth-token", staff.accessToken);
    expect(JSON.stringify(response.body.data.appointments)).not.toContain("Other Branch");
  });
});

describe("GET /api/v1/staff-os/clients/:id", () => {
  async function seedClientHistory(): Promise<{ customerId: string }> {
    const customer = await CustomerModel.create({
      salonId: TENANT,
      branchId: BRANCH_ID,
      name: "Client History Tester",
      email: "history@solastio.test",
      normalizedPhone: "919999111111",
      tags: ["regular"],
      notes: "Prefers mornings.",
      source: "crm"
    });
    const startAt = appointmentTimes(600);
    await AppointmentModel.create({
      salonId: TENANT,
      branchId: BRANCH_ID,
      staffId: "staff_seed_reception",
      customerId: String(customer._id),
      serviceIds: ["svc_haircut", "svc_spa"],
      serviceNames: ["Haircut", "Hair Spa"],
      durationMinutes: 60,
      value: 170_000,
      ...startAt,
      status: "completed",
      chair: "Chair 1",
      source: "crm"
    });
    await InvoiceModel.create({
      salonId: TENANT,
      branchId: BRANCH_ID,
      customerId: String(customer._id),
      invoiceNumber: `INV-H${Date.now()}`,
      status: "issued",
      paymentStatus: "partial",
      currency: "INR",
      lines: [{ description: "Haircut + Hair Spa", quantity: 1, unitAmountPaise: 170_000, taxRateBps: 1800, totalPaise: 200_600 }],
      subtotalPaise: 170_000,
      taxPaise: 30_600,
      grandTotalPaise: 200_600,
      paidAmountPaise: 100_000,
      dueAmountPaise: 100_600,
      issuedAt: new Date(),
      voidReason: ""
    });
    return { customerId: String(customer._id) };
  }

  it("returns the client contract with appointments and purchases", async () => {
    const { customerId } = await seedClientHistory();
    const response = await supertest(app).get(`/api/v1/staff-os/clients/${customerId}`).set("x-auth-token", clientviewer.accessToken);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const data = response.body.data;

    expect(data.client).toMatchObject({
      id: customerId,
      name: "Client History Tester",
      phone: "919999111111",
      email: "history@solastio.test",
      branchId: BRANCH_ID,
      branchName: "Main Branch",
      tags: ["regular"],
      notes: "Prefers mornings.",
      visitCount: 1
    });
    expect(data.client.outstandingPaise).toBe(100_600);

    expect(data.appointments).toHaveLength(1);
    expect(data.appointments[0]).toMatchObject({
      staffId: "staff_seed_reception",
      staffName: "Front Desk Reception",
      serviceIds: ["svc_haircut", "svc_spa"],
      serviceNames: ["Haircut", "Hair Spa"],
      status: "completed",
      spendPaise: 170_000
    });
    expect(data.appointments[0].startAt).toBeTruthy();

    expect(data.purchases).toHaveLength(1);
    expect(data.purchases[0]).toMatchObject({
      invoiceNumber: expect.stringMatching(/^INV-H/),
      totalPaise: 200_600,
      paidPaise: 100_000,
      balancePaise: 100_600,
      status: "partial"
    });
    expect(data.purchases[0].createdAt).toBeTruthy();
  });

  it("requires the read:clients permission", async () => {
    const { customerId } = await seedClientHistory();
    const response = await supertest(app).get(`/api/v1/staff-os/clients/${customerId}`).set("x-auth-token", nobody.accessToken);
    expect(response.status).toBe(403);
  });

  it("rejects missing and malformed client ids", async () => {
    const malformed = await supertest(app).get("/api/v1/staff-os/clients/not-an-id").set("x-auth-token", clientviewer.accessToken);
    expect(malformed.status).toBe(404);

    const missing = await supertest(app).get("/api/v1/staff-os/clients/507f1f77bcf86cd799439011").set("x-auth-token", clientviewer.accessToken);
    expect(missing.status).toBe(404);
  });

  it("refuses clients outside the caller's branch access", async () => {
    const customer = await CustomerModel.create({
      salonId: TENANT,
      branchId: "tenant_aura_otherbranch",
      name: "Other Branch Client",
      normalizedPhone: "919999222222",
      source: "crm"
    });
    const response = await supertest(app).get(`/api/v1/staff-os/clients/${customer._id}`).set("x-auth-token", clientviewer.accessToken);
    expect(response.status).toBe(403);
  });
});

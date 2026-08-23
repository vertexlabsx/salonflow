import bcrypt from "bcryptjs";
import type { Express } from "express";
import supertest, { type Agent } from "supertest";
import mongoose from "mongoose";
import { UserModel, type UserDocument } from "../../src/models/user.model";
import { SalonModel } from "../../src/models/salon.model";
import { BranchModel } from "../../src/models/branch.model";
import { ServiceModel } from "../../src/models/service.model";
import { ScheduleModel } from "../../src/models/schedule.model";

export const TENANT = "tenant_aura";
export const BRANCH_ID = `${TENANT}_main`;

/** Seeds the baseline salon + owner + staff users for auth tests. */
export async function seedAuthFixtures(): Promise<void> {
  await SalonModel.create({
    _id: TENANT,
    name: "Aura Shine Salon & Wellness",
    timezone: "Asia/Kolkata",
    currency: "INR",
    status: "active",
    whatsappPhoneNumberIds: []
  });

  await BranchModel.create({
    _id: BRANCH_ID,
    salonId: TENANT,
    name: "Main Branch",
    timezone: "Asia/Kolkata",
    status: "active",
    slotIntervalMinutes: 30,
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "10:00", close: "21:00", closed: false }))
  });

  const common = {
    salonId: TENANT,
    branchId: BRANCH_ID,
    branchIds: [BRANCH_ID],
    status: "active" as const
  };

  await UserModel.create({
    ...common,
    loginId: "owner",
    loginIdNormalized: "owner",
    name: "Salon Owner",
    email: "owner@aurashine.test",
    passwordHash: await bcrypt.hash("owner@123", 4),
    role: "owner",
    roleDisplayName: "Owner",
    staffAppPermissions: ["*"],
    crmPermissions: ["admin:*"]
  });

  await UserModel.create({
    ...common,
    loginId: "reception",
    loginIdNormalized: "reception",
    name: "Front Desk Reception",
    passwordHash: await bcrypt.hash("staff@123", 4),
    role: "receptionist",
    roleDisplayName: "Receptionist",
    staffId: "staff_seed_reception",
    staffAppPermissions: ["read:appointments", "read:staff", "allow:staff-checkin-checkout", "create:appointments"],
    crmPermissions: ["read:appointments", "read:staff"]
  });

  await ServiceModel.create([
    { salonId: TENANT, branchIds: [BRANCH_ID], name: "Haircut", description: "Classic haircut", pricePaise: 50000, durationMinutes: 30, eligibleStaffIds: ["staff_seed_reception"], status: "active" },
    { salonId: TENANT, branchIds: [BRANCH_ID], name: "Hair Spa", description: "Relaxing hair spa treatment", pricePaise: 120000, durationMinutes: 60, eligibleStaffIds: ["staff_seed_reception"], status: "active" },
    { salonId: TENANT, branchIds: [BRANCH_ID], name: "Hair Colour", description: "Professional hair colouring", pricePaise: 250000, durationMinutes: 120, eligibleStaffIds: ["staff_seed_reception"], status: "active" }
  ]);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await ScheduleModel.create({
    salonId: TENANT,
    branchId: BRANCH_ID,
    staffId: "staff_seed_reception",
    scheduleDate: today,
    startTime: "10:00",
    endTime: "21:00",
    shiftType: "regular",
    status: "scheduled",
    version: 1
  });
}

export async function createUser(overrides: Record<string, unknown>): Promise<UserDocument> {
  return UserModel.create({
    salonId: TENANT,
    branchId: BRANCH_ID,
    branchIds: [BRANCH_ID],
    loginId: overrides.loginId,
    loginIdNormalized: String(overrides.loginId).toLowerCase(),
    name: overrides.name || "Test User",
    passwordHash: await bcrypt.hash((overrides.password as string) || "secret@123", 4),
    role: overrides.role || "stylist",
    staffId: overrides.staffId || `staff_${String(overrides.loginId)}`,
    staffAppPermissions: overrides.staffAppPermissions || ["read:appointments"],
    crmPermissions: [],
    status: "active",
    ...overrides
  });
}

export interface StaffSession {
  agent: Agent;
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
}

export async function fetchCsrf(app: Express): Promise<{ token: string; expiresAt: string }> {
  const response = await supertest(app).get("/api/v1/auth/csrf");
  if (response.status !== 200) throw new Error(`csrf fetch failed (${response.status})`);
  return { token: response.body.data.csrfToken as string, expiresAt: response.body.data.expiresAt as string };
}

/** Staff-style login (mirrors StaffAppService.login): csrf -> POST /auth/login. */
export async function loginStaff(app: Express, loginId = "reception", password = "staff@123"): Promise<StaffSession> {
  const csrf = await fetchCsrf(app);
  const response = await supertest(app)
    .post("/api/v1/auth/login")
    .set("x-csrf-token", csrf.token)
    .send({ tenantId: TENANT, loginId, password, device: { type: "staff-app" } });
  if (response.status !== 200) {
    throw new Error(`Staff login failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return {
    agent: supertest.agent(app),
    accessToken: response.body.data.accessToken as string,
    refreshToken: response.body.data.refreshToken as string,
    user: response.body.data.user as Record<string, unknown>
  };
}

export async function cleanupCollections(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

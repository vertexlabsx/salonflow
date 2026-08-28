import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "../config/mongo";
import { loadEnv } from "../config/env";
import { AppointmentModel } from "../models/appointment.model";
import { AppointmentSlotLockModel } from "../models/appointment-slot-lock.model";
import { AttendanceModel } from "../models/attendance.model";
import { BranchModel } from "../models/branch.model";
import { CustomerModel } from "../models/customer.model";
import { InvoiceModel } from "../models/invoice.model";
import { LeaveModel } from "../models/leave.model";
import { OwnerSettingsModel } from "../models/owner-settings.model";
import { SalonModel } from "../models/salon.model";
import { ScheduleModel } from "../models/schedule.model";
import { ServiceModel } from "../models/service.model";
import { TaskModel } from "../models/task.model";
import { UserModel } from "../models/user.model";
import { zonedTimeToUtc } from "../shared/business-date";

const salonId = "salon_realistic_test";
const ownerLogin = "real.owner";
const ownerPassword = "RealSalon@12345";
const staffPassword = "Staff@12345";

const names = ["Aarav", "Vivaan", "Aditya", "Kabir", "Reyansh", "Arjun", "Ishaan", "Rohan", "Priya", "Ananya", "Diya", "Aisha", "Meera", "Kavya", "Riya", "Sana", "Neha", "Tara", "Karan", "Nikhil", "Ritika", "Pooja", "Simran", "Avni", "Dev", "Yash", "Maya", "Ira", "Zara", "Anika"];
const surnames = ["Sharma", "Patel", "Mehta", "Iyer", "Kapoor", "Rao", "Nair", "Verma", "Jain", "Khan"];
const categories = ["Haircuts", "Hair Color", "Hair Spa", "Skin Care", "Facials", "Makeup", "Nails", "Waxing", "Threading", "Massage", "Bridal", "Men Grooming"];
const serviceBases = ["Classic", "Premium", "Signature", "Express", "Luxury", "Advanced", "Organic", "Keratin", "Hydra", "Glow", "Repair", "Detox", "Smoothening", "Creative", "Bridal"];

function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(days: number, hour = 10, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function minutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function slotInstants(startAt: Date, endAt: Date): Date[] {
  const slots: Date[] = [];
  for (let ts = startAt.getTime(); ts < endAt.getTime(); ts += 5 * 60_000) slots.push(new Date(ts));
  return slots;
}

async function main() {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);

  await Promise.all([
    AppointmentModel.deleteMany({ salonId }),
    AppointmentSlotLockModel.deleteMany({ salonId }),
    AttendanceModel.deleteMany({ salonId }),
    BranchModel.deleteMany({ salonId }),
    CustomerModel.deleteMany({ salonId }),
    InvoiceModel.deleteMany({ salonId }),
    LeaveModel.deleteMany({ salonId }),
    OwnerSettingsModel.deleteMany({ salonId }),
    ScheduleModel.deleteMany({ salonId }),
    ServiceModel.deleteMany({ salonId }),
    TaskModel.deleteMany({ salonId }),
    UserModel.deleteMany({ salonId })
  ]);
  await SalonModel.deleteOne({ _id: salonId });

  await SalonModel.create({ _id: salonId, name: "The Velvet Chair Salon & Spa", timezone: "Asia/Kolkata", currency: "INR", status: "active", whatsappPhoneNumberIds: [] });

  const branchIds = ["bandra", "andheri", "powai"].map((area) => `${salonId}_${area}`);
  await BranchModel.insertMany(branchIds.map((id, index) => ({
    _id: id,
    salonId,
    name: ["Bandra Flagship", "Andheri Studio", "Powai Spa Lounge"][index],
    timezone: "Asia/Kolkata",
    status: "active",
    slotIntervalMinutes: 15,
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "11:00", close: "20:00", closed: false }))
  })));

  type SeedUser = {
    salonId: string;
    loginId: string;
    loginIdNormalized: string;
    email: string;
    name: string;
    passwordHash: string;
    role: string;
    roleDisplayName: string;
    branchId: string;
    branchIds: string[];
    staffAppPermissions: string[];
    crmPermissions: string[];
    status: "active";
    hourlyRatePaise: number;
    totpEnabled: boolean;
    webauthnCredentials: never[];
    refreshTokens: never[];
    staffId?: string;
  };

  const passwordHash = await bcrypt.hash(staffPassword, 12);
  const ownerHash = await bcrypt.hash(ownerPassword, 12);
  const users: SeedUser[] = [{
    salonId,
    loginId: ownerLogin,
    loginIdNormalized: ownerLogin,
    email: "owner@velvetchair.example",
    name: "Rhea Malhotra",
    passwordHash: ownerHash,
    role: "owner",
    roleDisplayName: "Owner",
    branchId: branchIds[0],
    branchIds,
    staffAppPermissions: ["*"],
    crmPermissions: ["admin:*"],
    status: "active",
    hourlyRatePaise: 0,
    totpEnabled: false,
    webauthnCredentials: [],
    refreshTokens: []
  }];

  const staffIds: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    const staffId = `real_staff_${String(i + 1).padStart(2, "0")}`;
    staffIds.push(staffId);
    const loginId = `staff${String(i + 1).padStart(2, "0")}`;
    users.push({
      salonId,
      loginId,
      loginIdNormalized: loginId,
      email: `${loginId}@velvetchair.example`,
      name: `${names[i % names.length]} ${surnames[i % surnames.length]}`,
      passwordHash,
      role: i < 3 ? "manager" : i < 8 ? "receptionist" : "stylist",
      roleDisplayName: i < 3 ? "Branch Manager" : i < 8 ? "Receptionist" : "Senior Stylist",
      staffId,
      branchId: branchIds[i % branchIds.length],
      branchIds: [branchIds[i % branchIds.length]],
      staffAppPermissions: ["read:appointments", "create:appointments", "update:appointments", "read:staff", "allow:staff-checkin-checkout", "read:reports"],
      crmPermissions: ["read:appointments", "create:appointments", "update:appointments", "read:staff"],
      status: "active",
      hourlyRatePaise: 18000 + (i % 8) * 2500,
      totpEnabled: false,
      webauthnCredentials: [],
      refreshTokens: []
    });
  }
  await UserModel.insertMany(users);

  const services = [];
  for (let i = 0; i < 600; i += 1) {
    const category = categories[i % categories.length];
    const base = serviceBases[i % serviceBases.length];
    const durationMinutes = [30, 45, 60, 75, 90, 120][i % 6];
    services.push({
      salonId,
      branchIds: i % 5 === 0 ? branchIds : [branchIds[i % branchIds.length]],
      category,
      name: `${base} ${category} ${String(i + 1).padStart(3, "0")}`,
      description: `Realistic ${category.toLowerCase()} service package with consultation, hygiene prep, and aftercare guidance.`,
      pricePaise: 35000 + (i % 60) * 7500,
      durationMinutes,
      eligibleStaffIds: staffIds.filter((_, idx) => idx % 3 === i % 3 || idx % 5 === i % 5).slice(0, 12),
      status: i % 37 === 0 ? "inactive" : "active"
    });
  }
  const serviceDocs = await ServiceModel.insertMany(services);

  const schedules = [];
  for (const staffId of staffIds) {
    const staffIndex = staffIds.indexOf(staffId);
    for (let d = -14; d <= 30; d += 1) {
      const offDay = (staffIndex + d + 70) % 7 === 0;
      const day = addDays(d);
      schedules.push({
        salonId,
        branchId: branchIds[staffIndex % branchIds.length],
        staffId,
        scheduleDate: dateKey(day),
        startTime: offDay ? "00:00" : "11:00",
        endTime: offDay ? "00:00" : "20:00",
        shiftType: offDay ? "weekly_off" : "regular",
        status: offDay ? "leave" : "scheduled",
        version: 1
      });
    }
  }
  await ScheduleModel.insertMany(schedules);

  const customers = [];
  for (let i = 0; i < 300; i += 1) {
    customers.push({
      salonId,
      branchId: branchIds[i % branchIds.length],
      name: `${names[i % names.length]} ${surnames[(i + 3) % surnames.length]}`,
      normalizedPhone: `9198${String(70000000 + i).slice(-8)}`,
      whatsappPhoneNumberId: "",
      marketingOptOut: i % 19 === 0,
      interactionStatus: i % 9 === 0 ? "booked" : "active",
      source: i % 4 === 0 ? "shopify" : "whatsapp"
    });
  }
  const customerDocs = await CustomerModel.insertMany(customers);

  const appointments = [];
  const pendingLocks: Array<{ salonId: string; branchId: string; staffId: string; appointmentId: string; slotAt: Date }> = [];
  const lockKeys = new Set<string>();
  const branchStaff = new Map(branchIds.map((branchId) => [branchId, staffIds.filter((_, index) => branchIds[index % branchIds.length] === branchId)]));
  for (let i = 0; i < 260; i += 1) {
    const branchId = branchIds[i % branchIds.length];
    const staffPool = branchStaff.get(branchId) || staffIds;
    const staffId = staffPool[(i * 5) % staffPool.length];
    const service = serviceDocs.find((item) => item.status === "active" && item.branchIds.includes(branchId) && item.eligibleStaffIds.includes(staffId)) || serviceDocs.find((item) => item.status === "active" && item.branchIds.includes(branchId));
    if (!service) continue;
    const dayOffset = (i % 32) - 10;
    const date = dateKey(addDays(dayOffset));
    const candidateStarts = ["11:00", "11:30", "12:15", "13:00", "14:00", "15:15", "16:00", "17:00", "18:00"];
    let startAt: Date | null = null;
    let endAt: Date | null = null;
    for (let shift = 0; shift < candidateStarts.length; shift += 1) {
      const label = candidateStarts[(i + shift) % candidateStarts.length];
      if (minutes(label) + service.durationMinutes > minutes("20:00")) continue;
      const [hour, minute] = label.split(":").map(Number);
      const candidateStart = zonedTimeToUtc("Asia/Kolkata", date, hour || 0, minute || 0);
      const candidateEnd = new Date(candidateStart.getTime() + service.durationMinutes * 60_000);
      const keys = slotInstants(candidateStart, candidateEnd).map((slotAt) => `${staffId}:${slotAt.toISOString()}`);
      if (keys.some((key) => lockKeys.has(key))) continue;
      keys.forEach((key) => lockKeys.add(key));
      startAt = candidateStart;
      endAt = candidateEnd;
      break;
    }
    if (!startAt || !endAt) continue;
    const customer = customerDocs[i % customerDocs.length];
    const value = service.pricePaise;
    const paid = i % 5 !== 0;
    const status = dayOffset < 0 ? (i % 6 === 0 ? "cancelled" : "completed") : i % 5 === 0 ? "pending" : i % 3 === 0 ? "booked" : "confirmed";
    const appointmentId = new AppointmentModel()._id;
    appointments.push({
      _id: appointmentId,
      salonId,
      branchId,
      staffId,
      customerId: String(customer._id),
      customerName: customer.name,
      serviceIds: [String(service._id)],
      serviceNames: [service.name],
      durationMinutes: service.durationMinutes,
      value,
      startAt,
      endAt,
      status,
      chair: `Chair ${i % 12 + 1}`,
      source: i % 4 === 0 ? "whatsapp" : i % 6 === 0 ? "shopify" : "crm",
      paymentStatus: paid ? "paid" : "pending",
      depositAmountPaise: paid ? Math.min(50000, Math.floor(value * 0.2)) : 0,
      paymentProvider: paid ? "manual" : "none",
      version: 1
    });
    if (["pending", "booked", "confirmed", "arrived", "in_service"].includes(status)) {
      pendingLocks.push(...slotInstants(startAt, endAt).map((slotAt) => ({ salonId, branchId, staffId, appointmentId: String(appointmentId), slotAt })));
    }
  }
  const appointmentDocs = await AppointmentModel.insertMany(appointments);
  if (pendingLocks.length) await AppointmentSlotLockModel.insertMany(pendingLocks, { ordered: false });

  const invoices = appointmentDocs.slice(0, 250).map((appointment, i) => {
    const tax = Math.round(appointment.value * 0.18);
    const total = appointment.value + tax;
    const paid = appointment.paymentStatus === "paid";
    return {
      salonId,
      branchId: appointment.branchId,
      customerId: appointment.customerId,
      appointmentId: String(appointment._id),
      invoiceNumber: `VCS-${String(i + 1).padStart(5, "0")}`,
      status: "issued",
      paymentStatus: paid ? "paid" : "unpaid",
      currency: "INR",
      lines: [{ description: appointment.serviceNames[0] || "Salon service", quantity: 1, unitAmountPaise: appointment.value, taxRateBps: 1800, totalPaise: appointment.value }],
      subtotalPaise: appointment.value,
      taxPaise: tax,
      grandTotalPaise: total,
      paidAmountPaise: paid ? total : 0,
      dueAmountPaise: paid ? 0 : total,
      payments: paid ? [{ method: i % 2 === 0 ? "upi" : "card", amountPaise: total, reference: `PAY-${String(i + 1).padStart(5, "0")}`, receivedByUserId: ownerLogin, receivedAt: appointment.startAt }] : [],
      voidReason: "",
      issuedAt: appointment.startAt
    };
  });
  await InvoiceModel.insertMany(invoices);

  await LeaveModel.insertMany(staffIds.slice(0, 12).map((staffId, i) => ({ salonId, staffId, leaveType: i % 2 === 0 ? "casual" : "sick", startDate: dateKey(addDays(i + 3)), endDate: dateKey(addDays(i + 3)), reason: i % 2 === 0 ? "Personal work" : "Medical appointment", status: i % 3 === 0 ? "pending" : "approved", days: 1 })));
  await TaskModel.insertMany(Array.from({ length: 80 }, (_, i) => ({ salonId, branchId: branchIds[i % branchIds.length], staffId: i % 5 === 0 ? null : staffIds[i % staffIds.length], title: `Operational task ${i + 1}`, description: "Realistic daily salon task for testing staff workflows.", status: i % 4 === 0 ? "completed" : i % 3 === 0 ? "in_progress" : "pending", priority: i % 7 === 0 ? "high" : i % 2 === 0 ? "medium" : "low", dueAt: addDays(i % 14, 18), assignedBy: ownerLogin, version: 1 })));
  await AttendanceModel.insertMany(staffIds.flatMap((staffId, i) => [-2, -1, 0].map((d) => { const clockInAt = addDays(d, 9 + (i % 3), 30); const clockOutAt = d === 0 && i % 6 === 0 ? null : new Date(clockInAt.getTime() + 8 * 60 * 60_000); return { salonId, staffId, businessDate: dateKey(clockInAt), clockInAt, clockOutAt, status: clockOutAt ? "closed" : "open", source: "staff-app", grossMinutes: clockOutAt ? 480 : 0, breaks: clockOutAt ? [{ breakType: "lunch", startedAt: new Date(clockInAt.getTime() + 4 * 60 * 60_000), endedAt: new Date(clockInAt.getTime() + 4.5 * 60 * 60_000) }] : [] }; })));
  await OwnerSettingsModel.create({ salonId, branchId: "", settings: { booking: { depositsEnabled: true, depositPercent: 20, slotIntervalMinutes: 15 }, notifications: { whatsappReminders: true, reminderHoursBefore: 24 }, payroll: { overtimeAfterHours: 9 }, testData: true }, lastChangedBy: "seed-realistic-salon" });

  console.log(JSON.stringify({ salonId, ownerLogin, ownerPassword, staffLogin: "staff01", staffPassword, branches: branchIds.length, staff: staffIds.length, services: serviceDocs.length, customers: customerDocs.length, appointments: appointmentDocs.length, invoices: invoices.length, schedules: schedules.length }, null, 2));
  await disconnectMongo();
}

main().catch(async (error) => {
  console.error(error);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});

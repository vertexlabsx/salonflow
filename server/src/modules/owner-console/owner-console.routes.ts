import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePermissions } from "../../middleware/rbac";
import { resolveAuthorizedBranchIds } from "../../middleware/tenant-context";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { AppointmentModel, type AppointmentDocument, type AppointmentStatus } from "../../models/appointment.model";
import { BranchModel } from "../../models/branch.model";
import { CustomerModel } from "../../models/customer.model";
import { InvoiceModel, type Invoice } from "../../models/invoice.model";
import { OwnerSettingsModel } from "../../models/owner-settings.model";
import { AttendanceModel } from "../../models/attendance.model";
import { PayrollRunModel, type PayrollRun } from "../../models/payroll-run.model";
import { ServiceModel } from "../../models/service.model";
import { UserModel } from "../../models/user.model";
import { createAppointment, transitionAppointment } from "../appointments/appointment.service";
import { publishRealtimeEvent } from "../realtime/realtime.service";
import { AuditLogModel } from "../../models/audit-log.model";
import { audit } from "../../shared/audit";
import { buildTextPdf } from "../../shared/pdf";

export const ownerConsoleRouter = Router();
ownerConsoleRouter.use(requireAuth);

const READ = "read:appointments";
const WRITE = { any: ["create:appointments", "update:appointments", "admin:*"] };
const timezone = "Asia/Kolkata" as const;

function page(limit: number, offset: number, total: number) {
  const nextOffset = offset + limit < total ? offset + limit : null;
  return { limit, offset, total, hasMore: nextOffset !== null, nextOffset };
}

function operationsPage(pageNumber: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: pageNumber, pageSize, total, totalPages, hasMore: pageNumber < totalPages };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toBranchAdministration(branch: { _id: string; name: string; timezone: string; status: string; createdAt?: Date; updatedAt?: Date }) {
  return {
    id: branch._id,
    name: branch.name,
    city: "",
    address: "",
    phone: "",
    gstin: "",
    timezone: branch.timezone,
    status: branch.status,
    onlineBookingEnabled: true,
    tierAdvanceBookingDays: "30",
    peakSlotsReservedPct: 0,
    peakHoursDefinition: "",
    slug: branch._id,
    createdAt: branch.createdAt?.toISOString() || "",
    updatedAt: branch.updatedAt?.toISOString() || ""
  };
}

function defaultSettings(branchId: string) {
  return {
    branchId,
    settings: {
      workspace: { workspaceName: "Solastio Studio", defaultLandingPage: "dashboard", fastPosEnabled: true },
      localization: { country: "IN", language: "en", timezone, currency: "INR", locale: "en-IN" },
      branchBehavior: { rememberLastBranch: true, requireBranchSelection: false, allowBranchSwitch: true },
      dateTime: { dateFormat: "dd MMM yyyy", timeFormat: "12h", businessDayStartHour: 10, weekStartsOn: "monday" },
      interface: { compactMode: false, showModuleBadges: true, enableCommandSearch: true },
      defaults: { refreshReportsOnOpen: true, ownerNotifications: true, staffHints: true }
    },
    audit: { lastChangedBy: "system", lastChangedAt: new Date().toISOString() },
    supportedSections: ["workspace", "localization", "branchBehavior", "dateTime", "interface", "defaults"],
    unavailableSections: {}
  };
}

function settingsResponse(branchId: string, settings: Record<string, unknown>, lastChangedBy = "system", lastChangedAt = new Date().toISOString()) {
  return { ...defaultSettings(branchId), settings: { ...defaultSettings(branchId).settings, ...settings }, audit: { lastChangedBy, lastChangedAt }, preservedUnknownSettings: false };
}

function toServiceOption(service: { _id: unknown; name: string; branchIds: string[]; description?: string; pricePaise: number; durationMinutes: number; eligibleStaffIds?: string[]; status: string }) {
  return { id: String(service._id), name: service.name, description: service.description || "", branchId: service.branchIds[0] || null, branchIds: service.branchIds, category: null, pricePaise: service.pricePaise, durationMinutes: service.durationMinutes, eligibleStaffIds: service.eligibleStaffIds || [], status: service.status };
}

function toOwnerAppointment(doc: AppointmentDocument, lookups: { branches: Map<string, string>; customers: Map<string, { name: string; phone: string }>; staff: Map<string, string> }) {
  const customer = doc.customerId ? lookups.customers.get(doc.customerId) : undefined;
  return {
    id: String(doc._id),
    branchId: doc.branchId,
    clientId: doc.customerId || "",
    staffId: doc.staffId,
    serviceIds: doc.serviceIds,
    startAt: doc.startAt.toISOString(),
    endAt: doc.endAt?.toISOString() || null,
    status: doc.status,
    source: doc.source || "crm",
    sourceChannel: doc.source || "crm",
    notes: doc.serviceNames.join(", "),
    createdAt: doc.createdAt?.toISOString() || null,
    updatedAt: doc.updatedAt?.toISOString() || null,
    version: doc.version,
    clientName: customer?.name || doc.customerName || "Walk-in",
    clientPhone: customer?.phone || null,
    staffName: lookups.staff.get(doc.staffId) || doc.staffId,
    branchName: lookups.branches.get(doc.branchId) || doc.branchId,
    paymentStatus: doc.status === "completed" ? "paid" : "pending",
    touchupCostPaise: doc.value
  };
}

async function appointmentLookups(salonId: string, docs: AppointmentDocument[]) {
  const branchIds = [...new Set(docs.map((d) => d.branchId).filter(Boolean))];
  const customerIds = [...new Set(docs.map((d) => d.customerId).filter(Boolean))] as string[];
  const staffIds = [...new Set(docs.map((d) => d.staffId).filter(Boolean))];
  const [branches, customers, staff] = await Promise.all([
    BranchModel.find({ salonId, _id: { $in: branchIds } }),
    CustomerModel.find({ salonId, _id: { $in: customerIds.filter(Types.ObjectId.isValid) } }),
    UserModel.find({ salonId, staffId: { $in: staffIds } })
  ]);
  return {
    branches: new Map(branches.map((b) => [b._id, b.name])),
    customers: new Map(customers.map((c) => [String(c._id), { name: c.name, phone: c.normalizedPhone }])),
    staff: new Map(staff.map((u) => [u.staffId || String(u._id), u.name]))
  };
}

async function appointmentDetailResponse(salonId: string, doc: AppointmentDocument) {
  const lookups = await appointmentLookups(salonId, [doc]);
  const appointment = toOwnerAppointment(doc, lookups);
  const [customer, branch, services, staff] = await Promise.all([
    doc.customerId && Types.ObjectId.isValid(doc.customerId) ? CustomerModel.findOne({ _id: doc.customerId, salonId }) : null,
    BranchModel.findOne({ _id: doc.branchId, salonId }),
    ServiceModel.find({ _id: { $in: doc.serviceIds.filter(Types.ObjectId.isValid) }, salonId }),
    UserModel.findOne({ salonId, staffId: doc.staffId })
  ]);
  return {
    appointment,
    context: {
      client: customer ? { id: String(customer._id), name: customer.name || customer.normalizedPhone, phone: customer.normalizedPhone, email: null, branchId: customer.branchId } : null,
      staff: staff ? { id: staff.staffId || String(staff._id), name: staff.name, role: staff.roleDisplayName || staff.role, branchId: staff.branchId, status: staff.status } : null,
      branch: branch ? { id: branch._id, name: branch.name, timezone: branch.timezone, status: branch.status } : null,
      services: services.map((s) => ({ id: String(s._id), name: s.name, branchId: s.branchIds[0] || null, category: null, pricePaise: s.pricePaise, durationMinutes: s.durationMinutes, status: s.status }))
    },
    billing: { eligible: doc.status === "completed", reason: null, invoice: null },
    supportedActions: ["update", "reschedule", "cancel", "checkIn", "startService", "complete", "noShow", "setStatus", "openPos"],
    allowedStatusTransitions: ["booked", "confirmed", "arrived", "in_service", "completed", "cancelled", "no_show"],
    version: doc.version,
    activityHistory: [],
    metadata: { timezone, moneyUnit: "paise", activitySource: "appointments" }
  };
}

ownerConsoleRouter.get("/appointments", requirePermissions(READ), asyncHandler(async (req, res) => {
  const context = req.context!;
  const query = z.object({ branchId: z.string().default("all"), from: z.string(), to: z.string(), search: z.string().optional(), staffId: z.string().optional(), serviceId: z.string().optional(), clientId: z.string().optional(), status: z.string().optional(), source: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  const filter: Record<string, unknown> = { salonId: context.salonId, startAt: { $gte: new Date(query.from), $lte: new Date(query.to) } };
  const branchIds = resolveAuthorizedBranchIds(context, query.branchId === "all" ? undefined : query.branchId);
  if (branchIds.length) filter.branchId = { $in: branchIds };
  if (query.staffId) filter.staffId = query.staffId;
  if (query.serviceId) filter.serviceIds = query.serviceId;
  if (query.clientId) filter.customerId = query.clientId;
  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.search) filter.$or = [{ customerName: new RegExp(query.search, "i") }, { serviceNames: new RegExp(query.search, "i") }];
  const [total, docs] = await Promise.all([AppointmentModel.countDocuments(filter), AppointmentModel.find(filter).sort({ startAt: 1 }).skip(query.offset).limit(query.limit)]);
  const lookups = await appointmentLookups(context.salonId, docs);
  ok(res, { items: docs.map((d) => toOwnerAppointment(d, lookups)), page: page(query.limit, query.offset, total), metadata: { timezone, moneyUnit: "paise", branchIds, filters: { ...query }, supportedFilters: ["search", "staffId", "serviceId", "clientId", "status", "source"] } });
}));

ownerConsoleRouter.get("/appointments/options/branches", requirePermissions(READ), asyncHandler(async (req, res) => {
  const docs = await BranchModel.find({ salonId: req.context!.salonId }).sort({ name: 1 }).limit(500);
  ok(res, { items: docs.map((b) => ({ id: b._id, name: b.name, timezone: b.timezone, status: b.status })) });
}));

ownerConsoleRouter.get("/appointments/options/clients", requirePermissions(READ), asyncHandler(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const filter: Record<string, unknown> = { salonId: req.context!.salonId };
  if (search) filter.$or = [{ name: new RegExp(search, "i") }, { normalizedPhone: new RegExp(search.replace(/\D/g, "")) }];
  const docs = await CustomerModel.find(filter).sort({ updatedAt: -1 }).limit(500);
  ok(res, { items: docs.map((c) => ({ id: String(c._id), name: c.name || c.normalizedPhone, phone: c.normalizedPhone, email: null, branchId: c.branchId })) });
}));

ownerConsoleRouter.get("/appointments/options/staff", requirePermissions(READ), asyncHandler(async (req, res) => {
  const docs = await UserModel.find({ salonId: req.context!.salonId, role: { $ne: "owner" }, status: "active" }).sort({ name: 1 }).limit(500);
  ok(res, { items: docs.map((u) => ({ id: u.staffId || String(u._id), name: u.name, role: u.roleDisplayName || u.role, branchId: u.branchId, status: u.status })) });
}));

ownerConsoleRouter.get("/appointments/options/services", requirePermissions(READ), asyncHandler(async (req, res) => {
  const branchId = typeof req.query.branchId === "string" ? req.query.branchId : "";
  const filter: Record<string, unknown> = { salonId: req.context!.salonId, status: "active" };
  if (branchId && branchId !== "all") filter.$or = [{ branchIds: branchId }, { branchIds: { $size: 0 } }];
  const docs = await ServiceModel.find(filter).sort({ name: 1 }).limit(500);
  ok(res, { items: docs.map((s) => ({ id: String(s._id), name: s.name, branchId: s.branchIds[0] || null, category: null, pricePaise: s.pricePaise, durationMinutes: s.durationMinutes, status: s.status })) });
}));

ownerConsoleRouter.get("/administration/services", requirePermissions(READ), asyncHandler(async (req, res) => {
  const branchId = typeof req.query.branchId === "string" ? req.query.branchId : "";
  const filter: Record<string, unknown> = { salonId: req.context!.salonId };
  if (branchId && branchId !== "all") filter.$or = [{ branchIds: branchId }, { branchIds: { $size: 0 } }];
  const docs = await ServiceModel.find(filter).sort({ name: 1 }).limit(500);
  ok(res, { items: docs.map(toServiceOption), capabilities: { create: true, update: true, deactivate: true } });
}));

const serviceWriteSchema = z.object({ branchIds: z.array(z.string().trim()).default([]), name: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).default(""), pricePaise: z.coerce.number().int().min(0), durationMinutes: z.coerce.number().int().min(5).max(600), eligibleStaffIds: z.array(z.string().trim()).default([]), status: z.enum(["active", "inactive"]).default("active") });
ownerConsoleRouter.post("/administration/services", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = serviceWriteSchema.parse(req.body ?? {});
  const doc = await ServiceModel.create({ ...body, salonId: req.context!.salonId });
  await audit(req, "service.create", "service", String(doc._id));
  ok(res, { service: toServiceOption(doc) }, 201);
}));

ownerConsoleRouter.patch("/administration/services/:id", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = serviceWriteSchema.partial().parse(req.body ?? {});
  const doc = await ServiceModel.findOneAndUpdate({ _id: req.params.id, salonId: req.context!.salonId }, { $set: body }, { new: true });
  if (!doc) throw ApiError.notFound("Service not found.");
  await audit(req, "service.update", "service", String(doc._id));
  ok(res, { service: toServiceOption(doc) });
}));

ownerConsoleRouter.patch("/administration/services/:id/status", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = z.object({ status: z.enum(["active", "inactive"]) }).parse(req.body ?? {});
  const doc = await ServiceModel.findOneAndUpdate({ _id: req.params.id, salonId: req.context!.salonId }, { $set: { status: body.status } }, { new: true });
  if (!doc) throw ApiError.notFound("Service not found.");
  await audit(req, "service.status", "service", String(doc._id), { status: body.status });
  ok(res, { service: toServiceOption(doc) });
}));

ownerConsoleRouter.get("/appointments/:id", requirePermissions(READ), asyncHandler(async (req, res) => {
  const doc = await AppointmentModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!doc) throw ApiError.notFound("Appointment not found.");
  ok(res, await appointmentDetailResponse(req.context!.salonId, doc));
}));

const writeSchema = z.object({ branchId: z.string(), clientId: z.string(), staffId: z.string().optional(), serviceIds: z.array(z.string()).min(1), startAt: z.string().datetime(), source: z.string().default("crm") });
ownerConsoleRouter.post("/appointments", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = writeSchema.parse(req.body ?? {});
  const customer = Types.ObjectId.isValid(body.clientId) ? await CustomerModel.findOne({ _id: body.clientId, salonId: req.context!.salonId }) : null;
  const created = await createAppointment({ salonId: req.context!.salonId, branchId: body.branchId, serviceId: body.serviceIds[0]!, startAt: new Date(body.startAt), customerName: customer?.name || "", normalizedPhone: customer?.normalizedPhone, source: body.source === "walk_in" ? "walk_in" : "crm", preferredStaffId: body.staffId });
  const doc = await AppointmentModel.findById(created.id);
  if (!doc) throw new ApiError(500, "Appointment was created but could not be loaded.");
  await audit(req, "appointment.create", "appointment", String(doc._id), { source: body.source });
  ok(res, await appointmentDetailResponse(req.context!.salonId, doc), 201);
}));

ownerConsoleRouter.patch("/appointments/:id", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = writeSchema.partial().extend({ version: z.coerce.number().int().optional() }).parse(req.body ?? {});
  const doc = await AppointmentModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!doc) throw ApiError.notFound("Appointment not found.");
  if (body.version && body.version !== doc.version) throw ApiError.conflict("Appointment was changed by another user.", { currentVersion: doc.version });
  if (body.serviceIds?.length) {
    const service = await ServiceModel.findOne({ _id: body.serviceIds[0], salonId: req.context!.salonId, status: "active" });
    if (!service) throw ApiError.badRequest("A valid active service is required.");
    doc.serviceIds = [String(service._id)];
    doc.serviceNames = [service.name];
    doc.durationMinutes = service.durationMinutes;
    doc.value = service.pricePaise;
    if (body.startAt) doc.endAt = new Date(new Date(body.startAt).getTime() + service.durationMinutes * 60_000);
  }
  if (body.branchId) doc.branchId = body.branchId;
  if (body.staffId) doc.staffId = body.staffId;
  if (body.startAt) {
    const startAt = new Date(body.startAt);
    doc.startAt = startAt;
    doc.endAt = new Date(startAt.getTime() + doc.durationMinutes * 60_000);
  }
  doc.version += 1;
  await doc.save();
  publishRealtimeEvent(req.context!.salonId, "appointment.updated", { id: String(doc._id), branchId: doc.branchId, staffId: doc.staffId, startAt: doc.startAt.toISOString(), endAt: doc.endAt.toISOString(), status: doc.status });
  await audit(req, "appointment.update", "appointment", String(doc._id));
  ok(res, await appointmentDetailResponse(req.context!.salonId, doc));
}));

ownerConsoleRouter.post("/appointments/:id/reschedule", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = z.object({ branchId: z.string().optional(), staffId: z.string().optional(), startAt: z.string().datetime() }).parse(req.body ?? {});
  const doc = await AppointmentModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!doc) throw ApiError.notFound("Appointment not found.");
  const startAt = new Date(body.startAt);
  if (body.branchId) doc.branchId = body.branchId;
  if (body.staffId) doc.staffId = body.staffId;
  doc.startAt = startAt;
  doc.endAt = new Date(startAt.getTime() + doc.durationMinutes * 60_000);
  doc.version += 1;
  await doc.save();
  publishRealtimeEvent(req.context!.salonId, "appointment.rescheduled", { id: String(doc._id), branchId: doc.branchId, staffId: doc.staffId, startAt: doc.startAt.toISOString(), endAt: doc.endAt.toISOString(), status: doc.status });
  await audit(req, "appointment.reschedule", "appointment", String(doc._id));
  const detail = await appointmentDetailResponse(req.context!.salonId, doc);
  ok(res, { appointment: detail.appointment });
}));

async function statusResponse(req: any, status: AppointmentStatus) {
  const doc = await AppointmentModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!doc) throw ApiError.notFound("Appointment not found.");
  const updated = await transitionAppointment(req.context!.salonId, req.params.id, status, doc.version);
  const updatedDoc = await AppointmentModel.findById(updated.id);
  if (!updatedDoc) return { appointment: null };
  await audit(req, `appointment.status.${status}`, "appointment", req.params.id);
  const detail = await appointmentDetailResponse(req.context!.salonId, updatedDoc);
  return { appointment: detail.appointment };
}

ownerConsoleRouter.post("/appointments/:id/cancel", requirePermissions(WRITE), asyncHandler(async (req, res) => ok(res, await statusResponse(req, "cancelled"))));
ownerConsoleRouter.post("/appointments/:id/check-in", requirePermissions(WRITE), asyncHandler(async (req, res) => ok(res, await statusResponse(req, "arrived"))));
ownerConsoleRouter.post("/appointments/:id/start-service", requirePermissions(WRITE), asyncHandler(async (req, res) => ok(res, await statusResponse(req, "in_service"))));
ownerConsoleRouter.post("/appointments/:id/complete", requirePermissions(WRITE), asyncHandler(async (req, res) => ok(res, await statusResponse(req, "completed"))));
ownerConsoleRouter.post("/appointments/:id/no-show", requirePermissions(WRITE), asyncHandler(async (req, res) => ok(res, await statusResponse(req, "no_show"))));
ownerConsoleRouter.post("/appointments/:id/status", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = z.object({ status: z.enum(["booked", "confirmed", "arrived", "in_service", "completed", "cancelled", "no_show"]) }).parse(req.body ?? {});
  ok(res, await statusResponse(req, body.status));
}));

ownerConsoleRouter.get("/operations/clients", requirePermissions(READ), asyncHandler(async (req, res) => {
  const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().optional(), branchId: z.string().default("all"), relationship: z.string().optional(), outstanding: z.string().optional(), lastVisit: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.query);
  const filter: Record<string, unknown> = { salonId: req.context!.salonId };
  if (query.branchId !== "all") filter.branchId = query.branchId;
  if (query.search) {
    const search = escapeRegex(query.search.trim());
    const phone = query.search.replace(/\D/g, "");
    filter.$or = [{ name: new RegExp(search, "i") }, { email: new RegExp(search, "i") }, ...(phone ? [{ normalizedPhone: new RegExp(escapeRegex(phone)) }] : [])];
  }
  const [customers, branches, appointmentAgg, invoiceAgg] = await Promise.all([
    CustomerModel.find(filter).sort({ updatedAt: -1 }).limit(1000),
    BranchModel.find({ salonId: req.context!.salonId }),
    AppointmentModel.aggregate<{ _id: string; visitCount: number; lastVisitAt: Date | null; totalAppointmentValuePaise: number; noShowCount: number; rescheduleCount: number }>([
      { $match: { salonId: req.context!.salonId, customerId: { $ne: "" } } },
      { $group: { _id: "$customerId", visitCount: { $sum: 1 }, lastVisitAt: { $max: "$startAt" }, totalAppointmentValuePaise: { $sum: "$value" }, noShowCount: { $sum: { $cond: [{ $eq: ["$status", "no_show"] }, 1, 0] } }, rescheduleCount: { $sum: { $cond: [{ $eq: ["$status", "rescheduled"] }, 1, 0] } } } }
    ]),
    InvoiceModel.aggregate<{ _id: string; totalSpendPaise: number; outstandingPaise: number; purchaseCount: number }>([
      { $match: { salonId: req.context!.salonId, customerId: { $ne: "" }, status: { $ne: "void" } } },
      { $group: { _id: "$customerId", totalSpendPaise: { $sum: "$grandTotalPaise" }, outstandingPaise: { $sum: "$dueAmountPaise" }, purchaseCount: { $sum: 1 } } }
    ])
  ]);
  const branchNames = new Map(branches.map((b) => [b._id, b.name]));
  const appointmentsByClient = new Map(appointmentAgg.map((row) => [row._id, row]));
  const invoicesByClient = new Map(invoiceAgg.map((row) => [row._id, row]));
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  const rows = customers.map((c) => {
    const id = String(c._id);
    const appts = appointmentsByClient.get(id);
    const invoices = invoicesByClient.get(id);
    const visitCount = appts?.visitCount || c.visitCount || 0;
    const lastVisitAt = appts?.lastVisitAt || c.lastBookedAt || null;
    return { id, name: c.name || c.normalizedPhone, phone: c.normalizedPhone, email: c.email || "", branchId: c.branchId, branchName: branchNames.get(c.branchId) || c.branchId, status: c.interactionStatus, visitCount, totalSpendPaise: invoices?.totalSpendPaise || appts?.totalAppointmentValuePaise || 0, lastVisitAt: iso(lastVisitAt), walletBalancePaise: c.walletBalancePaise || 0, loyaltyPoints: c.loyaltyPoints || 0, membershipId: c.membershipId || "", membershipPlanName: c.membershipPlanName || "", packageName: c.packageName || "", subscriptionName: c.subscriptionName || "", outstandingPaise: invoices?.outstandingPaise || 0, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) };
  }).filter((row) => {
    if (query.relationship === "new" && row.visitCount > 1) return false;
    if (query.relationship === "returning" && row.visitCount < 2) return false;
    if (query.outstanding === "yes" && row.outstandingPaise <= 0) return false;
    if (query.lastVisit === "never" && row.lastVisitAt) return false;
    if (query.lastVisit === "range") {
      if (!row.lastVisitAt || !from || !to) return false;
      const last = new Date(row.lastVisitAt);
      if (last < from || last > to) return false;
    }
    return true;
  });
  const total = rows.length;
  const pageRows = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  ok(res, { items: pageRows, page: operationsPage(query.page, query.pageSize, total), metadata: { timezone, partial: false, unavailableSources: [] } });
}));

ownerConsoleRouter.get("/operations/clients/:id", requirePermissions(READ), asyncHandler(async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) throw ApiError.notFound("Client not found.");
  const c = await CustomerModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!c) throw ApiError.notFound("Client not found.");
  const branchFilter = String(req.query.branchId || "all");
  const scoped = branchFilter !== "all" ? { branchId: branchFilter } : {};
  const [appointments, invoices, branches] = await Promise.all([
    AppointmentModel.find({ salonId: req.context!.salonId, customerId: String(c._id), ...scoped }).sort({ startAt: -1 }).limit(200),
    InvoiceModel.find({ salonId: req.context!.salonId, customerId: String(c._id), status: { $ne: "void" }, ...scoped }).sort({ createdAt: -1 }).limit(200),
    BranchModel.find({ salonId: req.context!.salonId })
  ]);
  const branchNames = new Map(branches.map((b) => [b._id, b.name]));
  const staffIds = [...new Set(appointments.map((a) => a.staffId).filter(Boolean))];
  const staff = await UserModel.find({ salonId: req.context!.salonId, staffId: { $in: staffIds } });
  const staffNames = new Map(staff.map((u) => [u.staffId || String(u._id), u.name]));
  const totalSpendPaise = invoices.reduce((sum, i) => sum + i.grandTotalPaise, 0) || appointments.reduce((sum, a) => sum + a.value, 0);
  const outstandingPaise = invoices.reduce((sum, i) => sum + i.dueAmountPaise, 0);
  const client = { id: String(c._id), name: c.name || c.normalizedPhone, phone: c.normalizedPhone, email: c.email || "", branchId: c.branchId, branchName: branchNames.get(c.branchId) || c.branchId, status: c.interactionStatus, visitCount: appointments.length || c.visitCount || 0, totalSpendPaise, lastVisitAt: iso(appointments[0]?.startAt || c.lastBookedAt), walletBalancePaise: c.walletBalancePaise || 0, loyaltyPoints: c.loyaltyPoints || 0, membershipId: c.membershipId || "", membershipPlanName: c.membershipPlanName || "", packageName: c.packageName || "", packageCreditsRemaining: c.packageCreditsRemaining || 0, subscriptionName: c.subscriptionName || "", subscriptionStatus: c.subscriptionStatus || "", outstandingPaise, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt), gender: c.gender || "", birthday: c.birthday || "", anniversary: c.anniversary || "", tags: c.tags || [], notes: c.notes || "", address: c.address || "" };
  ok(res, {
    client,
    appointments: appointments.map((a) => ({ id: String(a._id), branchId: a.branchId, branchName: branchNames.get(a.branchId) || a.branchId, startAt: iso(a.startAt), endAt: iso(a.endAt), status: a.status, serviceIds: a.serviceIds, notes: a.serviceNames.join(", "), staffId: a.staffId, staffName: staffNames.get(a.staffId) || a.staffId, spendPaise: a.value, createdAt: iso(a.createdAt) })),
    purchases: invoices.map((i) => ({ id: String(i._id), branchId: i.branchId, branchName: branchNames.get(i.branchId) || i.branchId, items: i.lines, totalPaise: i.grandTotalPaise, paidPaise: i.paidAmountPaise, balancePaise: i.dueAmountPaise, status: i.paymentStatus, createdAt: iso(i.createdAt), invoiceId: String(i._id), invoiceNumber: i.invoiceNumber })),
    membership: c.membershipPlanName ? { id: c.membershipId || String(c._id), planName: c.membershipPlanName, planCredits: c.membershipCredits || 0, creditsRemaining: c.membershipCreditsRemaining || 0, validityDate: c.membershipValidUntil || "", status: c.membershipStatus || "active", branchId: c.branchId } : null,
    metadata: { timezone, partial: false, unavailableSources: [], branchRelationship: [...new Set([c.branchId, ...appointments.map((a) => a.branchId), ...invoices.map((i) => i.branchId)])] }
  });
}));

ownerConsoleRouter.post("/operations/clients", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const benefitSchema = { walletBalancePaise: z.coerce.number().int().min(0).optional(), loyaltyPoints: z.coerce.number().int().min(0).optional(), membershipPlanName: z.string().trim().max(120).optional(), membershipCredits: z.coerce.number().int().min(0).optional(), membershipCreditsRemaining: z.coerce.number().int().min(0).optional(), membershipValidUntil: z.string().trim().max(10).optional(), membershipStatus: z.string().trim().max(40).optional(), packageName: z.string().trim().max(120).optional(), packageCreditsRemaining: z.coerce.number().int().min(0).optional(), subscriptionName: z.string().trim().max(120).optional(), subscriptionStatus: z.string().trim().max(40).optional() };
  const body = z.object({ branchId: z.string().min(1), name: z.string().trim().min(1).max(160), phone: z.string().trim().min(5), email: z.string().trim().email().or(z.literal("")).optional(), gender: z.string().trim().max(40).optional(), birthday: z.string().trim().max(10).optional(), anniversary: z.string().trim().max(10).optional(), tags: z.array(z.string().trim().max(40)).max(30).optional(), notes: z.string().trim().max(2000).optional(), address: z.string().trim().max(500).optional(), ...benefitSchema }).parse(req.body ?? {});
  const normalizedPhone = body.phone.replace(/\D/g, "");
  const customer = await CustomerModel.findOneAndUpdate({ salonId: req.context!.salonId, normalizedPhone }, { $setOnInsert: { source: "owner" }, $set: { branchId: body.branchId, name: body.name, email: body.email || "", gender: body.gender || "", birthday: body.birthday || "", anniversary: body.anniversary || "", tags: body.tags || [], notes: body.notes || "", address: body.address || "", walletBalancePaise: body.walletBalancePaise || 0, loyaltyPoints: body.loyaltyPoints || 0, membershipPlanName: body.membershipPlanName || "", membershipCredits: body.membershipCredits || 0, membershipCreditsRemaining: body.membershipCreditsRemaining || 0, membershipValidUntil: body.membershipValidUntil || "", membershipStatus: body.membershipStatus || "", packageName: body.packageName || "", packageCreditsRemaining: body.packageCreditsRemaining || 0, subscriptionName: body.subscriptionName || "", subscriptionStatus: body.subscriptionStatus || "", interactionStatus: "active" } }, { upsert: true, new: true });
  await audit(req, "client.create", "customer", String(customer._id), { branchId: body.branchId });
  ok(res, { id: String(customer._id) }, 201);
}));

ownerConsoleRouter.patch("/operations/clients/:id", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) throw ApiError.notFound("Client not found.");
  const benefitSchema = { walletBalancePaise: z.coerce.number().int().min(0).optional(), loyaltyPoints: z.coerce.number().int().min(0).optional(), membershipPlanName: z.string().trim().max(120).optional(), membershipCredits: z.coerce.number().int().min(0).optional(), membershipCreditsRemaining: z.coerce.number().int().min(0).optional(), membershipValidUntil: z.string().trim().max(10).optional(), membershipStatus: z.string().trim().max(40).optional(), packageName: z.string().trim().max(120).optional(), packageCreditsRemaining: z.coerce.number().int().min(0).optional(), subscriptionName: z.string().trim().max(120).optional(), subscriptionStatus: z.string().trim().max(40).optional() };
  const body = z.object({ name: z.string().trim().min(1).max(160).optional(), email: z.string().trim().email().or(z.literal("")).optional(), gender: z.string().trim().max(40).optional(), birthday: z.string().trim().max(10).optional(), anniversary: z.string().trim().max(10).optional(), tags: z.array(z.string().trim().max(40)).max(30).optional(), notes: z.string().trim().max(2000).optional(), address: z.string().trim().max(500).optional(), ...benefitSchema }).parse(req.body ?? {});
  const update = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
  const c = await CustomerModel.findOneAndUpdate({ _id: req.params.id, salonId: req.context!.salonId }, { $set: update }, { new: true });
  if (!c) throw ApiError.notFound("Client not found.");
  await audit(req, "client.update", "customer", String(c._id), { fields: Object.keys(update) });
  ok(res, { id: String(c._id), updatedAt: iso(c.updatedAt) });
}));

ownerConsoleRouter.patch("/operations/clients/:id/opt-out", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = z.object({ optedOut: z.boolean() }).parse(req.body ?? {});
  const c = await CustomerModel.findOneAndUpdate({ _id: req.params.id, salonId: req.context!.salonId }, { $set: { marketingOptOut: body.optedOut } }, { new: true });
  if (!c) throw ApiError.notFound("Client not found.");
  await audit(req, "client.opt_out", "customer", String(c._id), { optedOut: body.optedOut });
  ok(res, { id: String(c._id), marketingOptOut: c.marketingOptOut });
}));

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

ownerConsoleRouter.get("/administration/audit-logs", requirePermissions(READ), asyncHandler(async (req, res) => {
  const query = z.object({ action: z.string().optional(), resourceType: z.string().optional(), actorUserId: z.string().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
  const filter: Record<string, unknown> = { salonId: req.context!.salonId };
  if (query.action) filter.action = { $regex: query.action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (query.resourceType) filter.resourceType = query.resourceType;
  if (query.actorUserId) filter.actorUserId = query.actorUserId;
  if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(query.to) } : {}) };
  const [total, docs] = await Promise.all([AuditLogModel.countDocuments(filter), AuditLogModel.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize)]);
  ok(res, {
    items: docs.map((d) => ({ id: String(d._id), actorUserId: d.actorUserId, actorRole: d.actorRole, action: d.action, resourceType: d.resourceType, resourceId: d.resourceId, ip: d.ip, metadata: d.metadata, createdAt: d.createdAt?.toISOString() || "" })),
    page: { number: query.page, size: query.pageSize, totalElements: total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
  });
}));

ownerConsoleRouter.get("/administration/audit-logs/export", requirePermissions(READ), asyncHandler(async (req, res) => {
  const query = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(req.query);
  const filter: Record<string, unknown> = { salonId: req.context!.salonId };
  if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(query.to) } : {}) };
  const docs = await AuditLogModel.find(filter).sort({ createdAt: -1 }).limit(5000);
  const header = ["timestamp", "actorUserId", "actorRole", "action", "resourceType", "resourceId", "ip"];
  const rows = docs.map((d) => [d.createdAt?.toISOString() || "", d.actorUserId, d.actorRole, d.action, d.resourceType, d.resourceId, d.ip].map(csvEscape).join(","));
  await audit(req, "audit.export", "audit_log", "", { count: docs.length });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header.join(","), ...rows].join("\n"));
}));

ownerConsoleRouter.get("/finance/invoices", requirePermissions(READ), asyncHandler(async (req, res) => {
  const query = z.object({ branchId: z.string().default("all"), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  const filter: Record<string, unknown> = { salonId: req.context!.salonId };
  if (query.branchId !== "all") filter.branchId = query.branchId;
  const [total, docs] = await Promise.all([InvoiceModel.countDocuments(filter), InvoiceModel.find(filter).sort({ createdAt: -1 }).skip(query.offset).limit(query.limit)]);
  ok(res, { items: docs.map((i) => ({ id: String(i._id), invoiceNumber: i.invoiceNumber, branchId: i.branchId, status: i.status, paymentStatus: i.paymentStatus, grandTotalPaise: i.grandTotalPaise, paidAmountPaise: i.paidAmountPaise, dueAmountPaise: i.dueAmountPaise, createdAt: i.createdAt?.toISOString() || "" })), page: page(query.limit, query.offset, total), metadata: { timezone, moneyUnit: "paise" } });
}));

function defaultTaxSettings() {
  return { gstin: "", placeOfSupply: "", defaultTaxRateBps: 0, pricesIncludeTax: false };
}

async function loadTaxSettings(salonId: string) {
  const doc = await OwnerSettingsModel.findOne({ salonId, branchId: "" }, { settings: 1 });
  const tax = ((doc?.settings as Record<string, unknown> | undefined)?.tax ?? {}) as Record<string, unknown>;
  const rate = typeof tax.defaultTaxRateBps === "number" && Number.isFinite(tax.defaultTaxRateBps) ? Math.max(0, Math.min(10000, Math.round(tax.defaultTaxRateBps))) : 0;
  return { ...defaultTaxSettings(), gstin: typeof tax.gstin === "string" ? tax.gstin : "", placeOfSupply: typeof tax.placeOfSupply === "string" ? tax.placeOfSupply : "", defaultTaxRateBps: rate, pricesIncludeTax: tax.pricesIncludeTax === true };
}

ownerConsoleRouter.get("/finance/tax-settings", requirePermissions(READ), asyncHandler(async (req, res) => ok(res, await loadTaxSettings(req.context!.salonId))));

const taxSettingsSchema = z.object({ gstin: z.string().trim().max(15).default(""), placeOfSupply: z.string().trim().max(120).default(""), defaultTaxRateBps: z.coerce.number().int().min(0).max(10000).default(0), pricesIncludeTax: z.boolean().default(false) });
ownerConsoleRouter.put("/finance/tax-settings", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = taxSettingsSchema.parse(req.body ?? {});
  const doc = await OwnerSettingsModel.findOneAndUpdate({ salonId: req.context!.salonId, branchId: "" }, { $set: { "settings.tax": body, lastChangedBy: req.context!.userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  void doc;
  await audit(req, "tax_settings.update", "settings", "tax", { ...body });
  ok(res, body);
}));

ownerConsoleRouter.post("/finance/invoices/from-appointment/:appointmentId", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const appointment = await AppointmentModel.findOne({ _id: req.params.appointmentId, salonId: req.context!.salonId });
  if (!appointment) throw ApiError.notFound("Appointment not found.");
  const invoiceNumber = `${appointment.branchId}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(appointment._id).slice(-6).toUpperCase()}`;
  const taxSettings = await loadTaxSettings(req.context!.salonId);
  const grossValue = appointment.value;
  const rateBps = taxSettings.defaultTaxRateBps;
  const taxPaise = taxSettings.pricesIncludeTax ? grossValue - Math.round(grossValue / (1 + rateBps / 10000)) : Math.round((grossValue * rateBps) / 10000);
  const netPaise = grossValue - taxPaise;
  const grandTotalPaise = taxSettings.pricesIncludeTax ? grossValue : grossValue + taxPaise;
  const doc = await InvoiceModel.findOneAndUpdate(
    { salonId: req.context!.salonId, appointmentId: String(appointment._id) },
    { $setOnInsert: { salonId: req.context!.salonId, branchId: appointment.branchId, customerId: appointment.customerId || "", appointmentId: String(appointment._id), invoiceNumber, status: "issued", paymentStatus: "unpaid", currency: "INR", lines: [{ description: appointment.serviceNames.join(", ") || "Service", quantity: 1, unitAmountPaise: netPaise, taxRateBps: rateBps, totalPaise: grossValue }], subtotalPaise: netPaise, taxPaise, grandTotalPaise, paidAmountPaise: 0, dueAmountPaise: grandTotalPaise, issuedAt: new Date(), voidReason: "" } },
    { upsert: true, new: true }
  );
  ok(res, { invoice: { id: String(doc._id), invoiceNumber: doc.invoiceNumber, status: doc.status, paymentStatus: doc.paymentStatus, grandTotalPaise: doc.grandTotalPaise, paidAmountPaise: doc.paidAmountPaise, dueAmountPaise: doc.dueAmountPaise, createdAt: doc.createdAt?.toISOString() || "" } }, 201);
}));

function invoiceDetailDto(i: Invoice & { _id: unknown }) {
  return { id: String(i._id), invoiceNumber: i.invoiceNumber, branchId: i.branchId, customerId: i.customerId || "", appointmentId: i.appointmentId || "", status: i.status, paymentStatus: i.paymentStatus, currency: i.currency, lines: i.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitAmountPaise: l.unitAmountPaise, taxRateBps: l.taxRateBps, totalPaise: l.totalPaise })), subtotalPaise: i.subtotalPaise, taxPaise: i.taxPaise, grandTotalPaise: i.grandTotalPaise, paidAmountPaise: i.paidAmountPaise, dueAmountPaise: i.dueAmountPaise, payments: i.payments.map((p) => ({ method: p.method, amountPaise: p.amountPaise, reference: p.reference, receivedByUserId: p.receivedByUserId, receivedAt: p.receivedAt.toISOString() })), voidReason: i.voidReason || "", issuedAt: i.issuedAt?.toISOString() || "", createdAt: i.createdAt?.toISOString() || "" };
}

ownerConsoleRouter.get("/finance/invoices/:id", requirePermissions(READ), asyncHandler(async (req, res) => {
  const doc = await InvoiceModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!doc) throw ApiError.notFound("Invoice not found.");
  ok(res, { invoice: invoiceDetailDto(doc) });
}));

const paymentSchema = z.object({ method: z.enum(["cash", "card", "upi", "bank_transfer", "other"]), amountPaise: z.coerce.number().int().min(1), reference: z.string().trim().max(120).default("") });
ownerConsoleRouter.post("/finance/invoices/:id/payments", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = paymentSchema.parse(req.body ?? {});
  const doc = await InvoiceModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!doc) throw ApiError.notFound("Invoice not found.");
  if (doc.status === "void") throw ApiError.badRequest("Cannot record a payment on a voided invoice.");
  if (body.amountPaise > doc.dueAmountPaise) throw ApiError.badRequest("Payment exceeds the due amount.");
  doc.payments.push({ method: body.method, amountPaise: body.amountPaise, reference: body.reference, receivedByUserId: req.context!.userId, receivedAt: new Date() });
  doc.paidAmountPaise += body.amountPaise;
  doc.dueAmountPaise -= body.amountPaise;
  doc.paymentStatus = doc.dueAmountPaise === 0 ? "paid" : "partial";
  await doc.save();
  publishRealtimeEvent(req.context!.salonId, "invoice.payment_recorded", { id: String(doc._id), invoiceNumber: doc.invoiceNumber, paymentStatus: doc.paymentStatus, paidAmountPaise: doc.paidAmountPaise, dueAmountPaise: doc.dueAmountPaise });
  await audit(req, "invoice.payment", "invoice", String(doc._id), { method: body.method, amountPaise: body.amountPaise });
  ok(res, { invoice: invoiceDetailDto(doc) }, 201);
}));

ownerConsoleRouter.post("/finance/invoices/:id/void", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body ?? {});
  const doc = await InvoiceModel.findOneAndUpdate(
    { _id: req.params.id, salonId: req.context!.salonId, status: { $ne: "void" } },
    [
      { $set: { status: "void", voidReason: body.reason, paidAmountPaise: 0, dueAmountPaise: "$grandTotalPaise", paymentStatus: "unpaid", payments: [] } }
    ],
    { new: true }
  );
  if (!doc) throw ApiError.badRequest("Invoice is already void or does not exist.");
  publishRealtimeEvent(req.context!.salonId, "invoice.voided", { id: String(doc._id), invoiceNumber: doc.invoiceNumber });
  await audit(req, "invoice.void", "invoice", String(doc._id), { reason: body.reason });
  ok(res, { invoice: invoiceDetailDto(doc) });
}));

async function payrollRunDto(salonId: string, doc: PayrollRun & { _id: unknown }) {
  const users = await UserModel.find({ salonId }, { name: 1, staffId: 1, role: 1 }).lean();
  const byStaff = new Map(users.filter((u) => u.staffId).map((u) => [u.staffId!, u]));
  return { id: String(doc._id), branchId: doc.branchId, periodStart: doc.periodStart, periodEnd: doc.periodEnd, status: doc.status, totalGrossPayPaise: doc.totalGrossPayPaise, generatedByUserId: doc.generatedByUserId, createdAt: doc.createdAt?.toISOString() || "", items: doc.items.map((i) => ({ staffId: i.staffId, name: byStaff.get(i.staffId)?.name || i.staffId, role: byStaff.get(i.staffId)?.role || "staff", grossMinutes: i.grossMinutes, overtimeMinutes: i.overtimeMinutes, grossPayPaise: i.grossPayPaise, status: i.status })) };
}

function formatRupees(paise: number): string {
  return `Rs. ${(paise / 100).toFixed(2)}`;
}

ownerConsoleRouter.post("/people/payroll/generate", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = z.object({ branchId: z.string().min(1), periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body ?? {});
  const staff = await UserModel.find({ salonId: req.context!.salonId, branchIds: body.branchId, role: { $ne: "owner" }, status: "active" });
  const start = new Date(`${body.periodStart}T00:00:00.000Z`);
  const end = new Date(`${body.periodEnd}T23:59:59.999Z`);
  const minutesByStaff = new Map<string, number>();
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const rows = await AttendanceModel.aggregate([
      { $match: { salonId: req.context!.salonId, clockInAt: { $gte: start, $lte: end } } },
      { $group: { _id: "$staffId", minutes: { $sum: "$grossMinutes" } } }
    ]);
    for (const row of rows) minutesByStaff.set(String(row._id), row.minutes || 0);
  }
  const days = Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? 7 : Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  const standardMinutes = Math.ceil(days / 7) * 48 * 60;
  const items = staff.map((u) => {
    const grossMinutes = minutesByStaff.get(u.staffId || String(u._id)) ?? 0;
    const overtimeMinutes = Math.max(0, grossMinutes - standardMinutes);
    return { staffId: u.staffId || String(u._id), grossMinutes, overtimeMinutes, grossPayPaise: Math.round((grossMinutes / 60) * (u.hourlyRatePaise || 0)), status: "draft" as const };
  });
  const totalGrossPayPaise = items.reduce((sum, item) => sum + item.grossPayPaise, 0);
  const doc = await PayrollRunModel.findOneAndUpdate({ salonId: req.context!.salonId, branchId: body.branchId, periodStart: body.periodStart, periodEnd: body.periodEnd }, { $setOnInsert: { ...body, salonId: req.context!.salonId, generatedByUserId: req.context!.userId }, $set: { items, totalGrossPayPaise, status: "draft" } }, { upsert: true, new: true });
  await audit(req, "payroll.generate", "payroll_run", String(doc._id), { itemCount: items.length, totalGrossPayPaise });
  ok(res, await payrollRunDto(req.context!.salonId, doc), 201);
}));

ownerConsoleRouter.get("/people/payroll/runs", requirePermissions(READ), asyncHandler(async (req, res) => {
  const query = z.object({ branchId: z.string().default("all"), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  const filter: Record<string, unknown> = { salonId: req.context!.salonId };
  if (query.branchId !== "all") filter.branchId = query.branchId;
  const [total, docs] = await Promise.all([PayrollRunModel.countDocuments(filter), PayrollRunModel.find(filter).sort({ createdAt: -1 }).skip(query.offset).limit(query.limit)]);
  ok(res, { items: docs.map((d) => ({ id: String(d._id), branchId: d.branchId, periodStart: d.periodStart, periodEnd: d.periodEnd, status: d.status, itemCount: d.items.length, totalGrossPayPaise: d.totalGrossPayPaise, createdAt: d.createdAt?.toISOString() || "" })), page: page(query.limit, query.offset, total) });
}));

ownerConsoleRouter.get("/people/payroll/runs/:id", requirePermissions(READ), asyncHandler(async (req, res) => {
  const doc = await PayrollRunModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!doc) throw ApiError.notFound("Payroll run not found.");
  ok(res, { run: await payrollRunDto(req.context!.salonId, doc) });
}));

ownerConsoleRouter.patch("/people/payroll/runs/:id/status", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = z.object({ status: z.enum(["draft", "approved", "paid"]) }).parse(req.body ?? {});
  const current = await PayrollRunModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!current) throw ApiError.notFound("Payroll run not found.");
  const allowed: Record<PayrollRun["status"], PayrollRun["status"][]> = { draft: ["approved"], approved: ["paid"], paid: [] };
  if (!allowed[current.status].includes(body.status)) throw ApiError.badRequest(`Cannot move a ${current.status} run to ${body.status}.`);
  const doc = await PayrollRunModel.findOneAndUpdate({ _id: req.params.id, salonId: req.context!.salonId }, { $set: { status: body.status, ...(body.status === "paid" ? { "items.$[item].status": "paid" } : {}) } }, { arrayFilters: [{ "item.status": { $ne: "paid" } }], new: true });
  publishRealtimeEvent(req.context!.salonId, "payroll.status_changed", { id: req.params.id, status: body.status });
  await audit(req, `payroll.${body.status}`, "payroll_run", req.params.id);
  ok(res, await payrollRunDto(req.context!.salonId, doc!));
}));

ownerConsoleRouter.get("/people/payroll/runs/:id/payslips/:staffId.pdf", requirePermissions(READ), asyncHandler(async (req, res) => {
  const run = await PayrollRunModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!run) throw ApiError.notFound("Payroll run not found.");
  const item = run.items.find((i) => i.staffId === req.params.staffId);
  if (!item) throw ApiError.notFound("This staff member is not part of the payroll run.");
  const user = await UserModel.findOne({ salonId: req.context!.salonId, staffId: req.params.staffId }, { name: 1, role: 1, hourlyRatePaise: 1 }).lean();
  const branch = await BranchModel.findById(run.branchId, { name: 1 }).lean();
  const pdf = buildTextPdf("Payslip", [
    { text: `${branch?.name || run.branchId} — ${run.periodStart} to ${run.periodEnd}` },
    { text: "", gapBefore: 10 },
    { text: `Employee: ${user?.name || item.staffId} (${user?.role || "staff"})`, bold: true },
    { text: `Staff ID: ${item.staffId}` },
    { text: `Payslip status: ${run.status === "paid" ? "paid" : item.status}` },
    { text: "", gapBefore: 10 },
    { text: `Gross worked minutes: ${item.grossMinutes}` },
    { text: `Overtime minutes: ${item.overtimeMinutes}` },
    { text: `Hourly rate: ${formatRupees(user?.hourlyRatePaise || 0)}` },
    { text: `Gross pay: ${formatRupees(item.grossPayPaise)}`, bold: true },
    { text: "", gapBefore: 14 },
    { text: `Generated: ${new Date().toISOString()}`, size: 8 }
  ]);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="payslip-${item.staffId}-${run.periodStart}.pdf"`);
  res.send(pdf);
}));

ownerConsoleRouter.get("/administration/branches", requirePermissions(READ), asyncHandler(async (req, res) => {
  const docs = await BranchModel.find({ salonId: req.context!.salonId }).sort({ name: 1 });
  ok(res, { items: docs.map(toBranchAdministration), capabilities: { create: true, update: true, deactivate: true, hardDelete: false, creatorAssignment: true }, availability: {} });
}));

const branchWriteSchema = z.object({ name: z.string().trim().min(1).max(160), city: z.string().trim().max(120).default(""), timezone: z.string().trim().default(timezone) });
ownerConsoleRouter.post("/administration/branches", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = branchWriteSchema.parse(req.body ?? {});
  const id = `${req.context!.salonId}_${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
  const doc = await BranchModel.findOneAndUpdate({ _id: id, salonId: req.context!.salonId }, { $setOnInsert: { _id: id, salonId: req.context!.salonId, status: "active", slotIntervalMinutes: 30, hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "10:00", close: "21:00", closed: false })) }, $set: { name: body.name, timezone: body.timezone } }, { upsert: true, new: true });
  await audit(req, "branch.upsert", "branch", doc._id);
  ok(res, { branch: toBranchAdministration(doc), creatorAssigned: true, requiresReauthentication: false }, 201);
}));

ownerConsoleRouter.patch("/administration/branches/:id", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = branchWriteSchema.partial().parse(req.body ?? {});
  const doc = await BranchModel.findOneAndUpdate({ _id: req.params.id, salonId: req.context!.salonId }, { $set: { ...(body.name ? { name: body.name } : {}), ...(body.timezone ? { timezone: body.timezone } : {}) } }, { new: true });
  if (!doc) throw ApiError.notFound("Branch not found.");
  await audit(req, "branch.update", "branch", doc._id);
  ok(res, { branch: toBranchAdministration(doc), creatorAssigned: false, requiresReauthentication: false });
}));

ownerConsoleRouter.patch("/administration/branches/:id/status", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = z.object({ status: z.enum(["active", "inactive"]) }).parse(req.body ?? {});
  const doc = await BranchModel.findOneAndUpdate({ _id: req.params.id, salonId: req.context!.salonId }, { $set: { status: body.status } }, { new: true });
  if (!doc) throw ApiError.notFound("Branch not found.");
  await audit(req, "branch.status", "branch", doc._id, { status: body.status });
  ok(res, { branch: toBranchAdministration(doc), creatorAssigned: false, requiresReauthentication: false });
}));

async function accessResponse(salonId: string) {
  const [branches, users] = await Promise.all([BranchModel.find({ salonId }).sort({ name: 1 }), UserModel.find({ salonId }).sort({ name: 1 })]);
  const defaultPermissions = ["read:appointments", "create:appointments", "update:appointments", "read:clients"];
  const permissionGroups = [
    { key: "appointments", label: "Appointments", items: ["read:appointments", "create:appointments", "update:appointments"].map((key) => ({ key, label: key, resource: "appointments", action: key.split(":")[0], sensitive: false })) },
    { key: "clients", label: "Clients", items: ["read:clients"].map((key) => ({ key, label: key, resource: "clients", action: key.split(":")[0], sensitive: true })) }
  ];
  const roles = ["owner", "admin", "receptionist", "stylist"].map((role) => ({ role, name: role[0]!.toUpperCase() + role.slice(1), description: "Default access role", isSystem: true, status: "active", permissionKeys: defaultPermissions, editable: role !== "owner", configuredKeys: [], inheritedKeys: [], effectiveKeys: defaultPermissions, allowKeys: [], denyKeys: [], policyMode: "inherited" as const, policySource: "default", editablePolicy: role !== "owner", kind: "system" as const, assignedUserCount: users.filter((u) => u.role === role).length, activeAssignedUserCount: users.filter((u) => u.role === role && u.status === "active").length }));
  return { branches: branches.map(toBranchAdministration), roles, users: users.map((u) => ({ id: String(u._id), name: u.name, loginId: u.loginId, email: u.email || "", role: u.role, branchIds: u.branchIds.length ? u.branchIds : [u.branchId], status: u.status, isLocked: false, permissionVersion: 1, lastLoginAt: "", activeSessions: 0, staffId: u.staffId })), permissionGroups, capabilities: { createRole: true, editCustomRole: true, editBuiltinStaffAppPolicy: false, restoreRoleDefaults: true, duplicateRole: true, setCustomRoleStatus: true, createUser: true, updateUser: true, disableUser: true }, safeguards: { lastActiveOwner: true, ownerEssentialAccess: true, assignmentsLimitedToOwnerBranches: true, permissionVersionInvalidation: true } };
}

ownerConsoleRouter.get("/administration/access", requirePermissions(READ), asyncHandler(async (req, res) => ok(res, await accessResponse(req.context!.salonId))));

const userWriteSchema = z.object({ name: z.string().trim().min(1).max(160), loginId: z.string().trim().min(1).max(120), email: z.string().trim().email().optional().or(z.literal("")), role: z.string().trim().min(1), branchIds: z.array(z.string().trim()).min(1), status: z.enum(["active", "disabled", "suspended"]).default("active"), password: z.string().min(8).optional() });
function userDto(u: { _id: unknown; name: string; loginId: string; email?: string; role: string; branchIds: string[]; branchId: string; status: string; staffId?: string }) {
  return { id: String(u._id), name: u.name, loginId: u.loginId, email: u.email || "", role: u.role, branchIds: u.branchIds.length ? u.branchIds : [u.branchId], status: u.status, isLocked: false, permissionVersion: 1, lastLoginAt: "", activeSessions: 0, staffId: u.staffId };
}

ownerConsoleRouter.post("/administration/users", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = userWriteSchema.parse(req.body ?? {});
  const loginIdNormalized = body.loginId.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(body.password || `Temp-${Date.now()}-${loginIdNormalized}`, 12);
  const user = await UserModel.create({ salonId: req.context!.salonId, loginId: body.loginId, loginIdNormalized, email: body.email || undefined, name: body.name, passwordHash, role: body.role, roleDisplayName: body.role, staffId: body.role === "owner" ? undefined : `${loginIdNormalized}_staff`, branchId: body.branchIds[0], branchIds: body.branchIds, staffAppPermissions: ["read:appointments", "create:appointments", "update:appointments", "read:clients"], crmPermissions: ["read:appointments", "create:appointments", "update:appointments", "read:clients"], status: body.status, totpEnabled: false, webauthnCredentials: [], refreshTokens: [] });
  await audit(req, "user.create", "user", String(user._id), { role: body.role });
  ok(res, { user: userDto(user), access: await accessResponse(req.context!.salonId) }, 201);
}));

ownerConsoleRouter.patch("/administration/users/:id", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const body = userWriteSchema.partial().parse(req.body ?? {});
  const set: Record<string, unknown> = {};
  if (body.name) set.name = body.name;
  if (body.loginId) { set.loginId = body.loginId; set.loginIdNormalized = body.loginId.toLowerCase(); }
  if (body.email !== undefined) set.email = body.email || undefined;
  if (body.role) { set.role = body.role; set.roleDisplayName = body.role; }
  if (body.branchIds?.length) { set.branchIds = body.branchIds; set.branchId = body.branchIds[0]; }
  if (body.status) set.status = body.status;
  if (body.password) set.passwordHash = await bcrypt.hash(body.password, 12);
  const user = await UserModel.findOneAndUpdate({ _id: req.params.id, salonId: req.context!.salonId }, { $set: set }, { new: true });
  if (!user) throw ApiError.notFound("User not found.");
  await audit(req, "user.update", "user", String(user._id), { changed: Object.keys(set) });
  ok(res, { user: userDto(user), access: await accessResponse(req.context!.salonId) });
}));

ownerConsoleRouter.post("/administration/roles", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const access = await accessResponse(req.context!.salonId);
  const role = access.roles.find((r) => r.role === req.body?.role) || access.roles[0];
  ok(res, { role, access, invalidatedUsers: 0, requiresReauthentication: false, impact: { affectedUsers: 0, activeAffectedUsers: 0, requiresReauthentication: false, permissionVersionIncremented: 0, affectedActiveSessions: 0, scope: "tenant", branchId: req.body?.branchId || "" } });
}));
ownerConsoleRouter.post("/administration/roles/:role/restore-defaults", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const access = await accessResponse(req.context!.salonId);
  ok(res, { role: access.roles.find((r) => r.role === req.params.role) || access.roles[0], access, invalidatedUsers: 0, requiresReauthentication: false, impact: { affectedUsers: 0, activeAffectedUsers: 0, requiresReauthentication: false, permissionVersionIncremented: 0, affectedActiveSessions: 0, scope: "tenant", branchId: req.body?.branchId || "" } });
}));
ownerConsoleRouter.get("/administration/settings", requirePermissions(READ), asyncHandler(async (req, res) => {
  const branchId = typeof req.query.branchId === "string" ? req.query.branchId : "";
  const doc = await OwnerSettingsModel.findOne({ salonId: req.context!.salonId, branchId });
  ok(res, settingsResponse(branchId, (doc?.settings || {}) as Record<string, unknown>, doc?.lastChangedBy, doc?.updatedAt?.toISOString()));
}));
ownerConsoleRouter.put("/administration/settings", requirePermissions(WRITE), asyncHandler(async (req, res) => {
  const branchId = typeof req.body?.branchId === "string" ? req.body.branchId : "";
  const settings = z.record(z.unknown()).parse(req.body?.settings || {});
  const doc = await OwnerSettingsModel.findOneAndUpdate({ salonId: req.context!.salonId, branchId }, { $set: { settings, lastChangedBy: req.context!.userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await audit(req, "settings.update", "settings", branchId || "tenant");
  ok(res, settingsResponse(branchId, doc.settings, doc.lastChangedBy, doc.updatedAt?.toISOString()));
}));

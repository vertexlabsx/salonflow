import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePermissions } from "../../middleware/rbac";
import { resolveAuthorizedBranchIds } from "../../middleware/tenant-context";
import { AppointmentModel } from "../../models/appointment.model";
import { toStaffAppointment } from "../staff/staff.types";
import { loadEnv } from "../../config/env";
import { createAppointment, transitionAppointment } from "./appointment.service";

const READ_PERMISSION = "read:appointments";
const WRITE_PERMISSION = { any: ["create:appointments", "update:appointments"] };

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);

/** Unified appointment list — walk-ins, CRM entries and WhatsApp bookings all appear here. */
appointmentsRouter.get(
  "/",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const context = req.context!;
    const query = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        staffId: z.string().trim().max(80).optional(),
        status: z.string().trim().max(30).optional(),
        source: z.string().trim().max(30).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional()
      })
      .parse(req.query);

    const branchIds = resolveAuthorizedBranchIds(context, req.query.branchId);
    const grants = context.permissions;
    const seesAll =
      grants.includes("*") || grants.includes("admin:*") || grants.includes("admin:appointments") || grants.includes("read:all-appointments");
    const filter: Record<string, unknown> = { salonId: context.salonId };
    if (branchIds.length) filter.branchId = { $in: branchIds };
    if (query.date) {
      const tz = loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
      // Salon-local calendar day match (a 00:30 IST booking belongs to the IST date).
      filter.$expr = { $eq: [{ $dateToString: { format: "%Y-%m-%d", date: "$startAt", timezone: tz } }, query.date] };
    }
    if (query.staffId && seesAll) filter.staffId = query.staffId;
    else if (!seesAll) filter.staffId = context.staffId;
    if (query.status) filter.status = query.status;
    if (query.source) filter.source = query.source;

    const docs = await AppointmentModel.find(filter).sort({ startAt: 1 }).limit(query.limit ?? 200);
    ok(res, docs.map(toStaffAppointment));
  })
);

const createSchema = z.object({
  branchId: z.string().trim().max(80).optional(),
  staffId: z.string().trim().max(80).optional(),
  serviceId: z.string().trim().min(1).max(80),
  customerName: z.string().trim().max(160).default(""),
  normalizedPhone: z.string().trim().max(40).optional(),
  startAt: z.string().datetime(),
  source: z.enum(["crm", "walk_in"]).default("walk_in")
});

appointmentsRouter.post(
  "/",
  requirePermissions(WRITE_PERMISSION),
  asyncHandler(async (req, res) => {
    const context = req.context!;
    const body = createSchema.parse(req.body ?? {});
    const startAt = new Date(body.startAt);
    if (Number.isNaN(startAt.getTime())) throw ApiError.badRequest("Invalid startAt timestamp.");
    const branchId =
      typeof req.body?.branchId === "string" && body.branchId
        ? resolveAuthorizedBranchIds(context, body.branchId)[0]!
        : context.branchId;
    ok(
      res,
      await createAppointment({
        salonId: context.salonId,
        branchId,
        serviceId: body.serviceId,
        startAt,
        customerName: body.customerName,
        normalizedPhone: body.normalizedPhone,
        source: body.source,
        preferredStaffId: body.staffId
      }),
      201
    );
  })
);

const statusSchema = z.object({
  status: z.enum(["booked", "confirmed", "arrived", "in_service", "completed", "cancelled", "no_show"]),
  version: z.coerce.number().int().min(1)
});

appointmentsRouter.patch(
  "/:id/status",
  requirePermissions(WRITE_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().trim().min(1).max(80) }).parse(req.params);
    const body = statusSchema.parse(req.body ?? {});
    if (!Types.ObjectId.isValid(params.id)) throw ApiError.badRequest("A valid appointment id is required.");
    ok(res, await transitionAppointment(req.context!.salonId, params.id, body.status, body.version));
  })
);

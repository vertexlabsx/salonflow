import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ok } from "../../shared/http";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePermissions } from "../../middleware/rbac";
import { BranchModel } from "../../models/branch.model";
import { ServiceModel } from "../../models/service.model";
import { CustomerModel } from "../../models/customer.model";
import { findAvailableStaff } from "../appointments/availability.service";
import { zonedTimeToUtc, zonedWeekday } from "../../shared/business-date";

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

catalogRouter.get(
  "/branches",
  requirePermissions("read:appointments"),
  asyncHandler(async (req, res) => {
    const docs = await BranchModel.find({ salonId: req.context!.salonId }).sort({ name: 1 });
    ok(
      res,
      docs.map((b) => ({ id: b._id, name: b.name, timezone: b.timezone, status: b.status, hours: b.hours, slotIntervalMinutes: b.slotIntervalMinutes }))
    );
  })
);

catalogRouter.post(
  "/branches",
  requirePermissions({ any: ["create:branches", "update:branches", "admin:*"] }),
  asyncHandler(async (req, res) => {
    const body = z.object({ id: z.string().trim().max(80).optional(), name: z.string().trim().min(1).max(160) }).parse(req.body ?? {});
    const id = body.id || `${req.context!.salonId}_${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
    const doc = await BranchModel.findOneAndUpdate(
      { _id: id, salonId: req.context!.salonId },
      {
        $setOnInsert: {
          _id: id,
          salonId: req.context!.salonId,
          timezone: "Asia/Kolkata",
          status: "active",
          slotIntervalMinutes: 30,
          hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "10:00", close: "21:00", closed: false }))
        },
        $set: { name: body.name }
      },
      { upsert: true, new: true }
    );
    ok(res, { id: doc._id, name: doc.name, timezone: doc.timezone, status: doc.status, hours: doc.hours, slotIntervalMinutes: doc.slotIntervalMinutes }, 201);
  })
);

catalogRouter.get(
  "/services",
  requirePermissions("read:appointments"),
  asyncHandler(async (req, res) => {
    const branchId = typeof req.query.branchId === "string" ? req.query.branchId : "";
    const filter: Record<string, unknown> = { salonId: req.context!.salonId, status: "active" };
    if (branchId) filter.$or = [{ branchIds: branchId }, { branchIds: { $size: 0 } }];
    const docs = await ServiceModel.find(filter).sort({ name: 1 });
    ok(
      res,
      docs.map((s) => ({ id: String(s._id), name: s.name, description: s.description, pricePaise: s.pricePaise, durationMinutes: s.durationMinutes, branchIds: s.branchIds }))
    );
  })
);

catalogRouter.post(
  "/services",
  requirePermissions({ any: ["create:services", "update:services", "admin:*"] }),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        id: z.string().trim().max(80).optional(),
        branchIds: z.array(z.string().trim()).default([]),
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(1000).default(""),
        pricePaise: z.coerce.number().int().min(0),
        durationMinutes: z.coerce.number().int().min(5).max(600),
        eligibleStaffIds: z.array(z.string().trim()).default([]),
        status: z.enum(["active", "inactive"]).default("active")
      })
      .parse(req.body ?? {});
    const filter = body.id ? { _id: body.id, salonId: req.context!.salonId } : { salonId: req.context!.salonId, name: body.name };
    const doc = await ServiceModel.findOneAndUpdate(filter, { $set: { ...body, salonId: req.context!.salonId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    ok(res, { id: String(doc._id), name: doc.name, description: doc.description, pricePaise: doc.pricePaise, durationMinutes: doc.durationMinutes, branchIds: doc.branchIds, eligibleStaffIds: doc.eligibleStaffIds, status: doc.status }, 201);
  })
);

catalogRouter.get(
  "/customers",
  requirePermissions("read:appointments"),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const filter: Record<string, unknown> = { salonId: req.context!.salonId };
    if (q) filter.$or = [{ normalizedPhone: new RegExp(q.replace(/\D/g, "")) }, { name: new RegExp(q, "i") }];
    const docs = await CustomerModel.find(filter).sort({ updatedAt: -1 }).limit(50);
    ok(
      res,
      docs.map((c) => ({
        id: String(c._id),
        name: c.name,
        normalizedPhone: c.normalizedPhone,
        whatsappPhoneNumberId: c.whatsappPhoneNumberId,
        interactionStatus: c.interactionStatus,
        branchId: c.branchId,
        source: c.source
      }))
    );
  })
);

catalogRouter.post(
  "/customers",
  requirePermissions({ any: ["create:customers", "update:customers", "admin:*"] }),
  asyncHandler(async (req, res) => {
    const body = z.object({ branchId: z.string().trim().min(1), name: z.string().trim().max(160), normalizedPhone: z.string().trim().min(5).max(40) }).parse(req.body ?? {});
    const doc = await CustomerModel.findOneAndUpdate(
      { salonId: req.context!.salonId, normalizedPhone: body.normalizedPhone.replace(/\D/g, "") },
      { $setOnInsert: { source: "crm" }, $set: { branchId: body.branchId, name: body.name, interactionStatus: "active" } },
      { upsert: true, new: true }
    );
    ok(res, { id: String(doc._id), name: doc.name, normalizedPhone: doc.normalizedPhone, branchId: doc.branchId, source: doc.source }, 201);
  })
);

catalogRouter.get(
  "/availability",
  requirePermissions("read:appointments"),
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        branchId: z.string().trim().min(1),
        serviceId: z.string().trim().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      })
      .parse(req.query);
    const branch = await BranchModel.findOne({ _id: query.branchId, salonId: req.context!.salonId, status: "active" });
    if (!branch) {
      ok(res, { slots: [] });
      return;
    }
    const weekday = zonedWeekday(branch.timezone, query.date);
    const hours = branch.hours.find((h) => h.weekday === weekday && !h.closed);
    if (!hours) {
      ok(res, { slots: [] });
      return;
    }
    const slots: Array<{ startAt: string; staffId: string }> = [];
    const [openH, openM] = hours.open.split(":").map(Number);
    const [closeH, closeM] = hours.close.split(":").map(Number);
    for (let min = (openH || 0) * 60 + (openM || 0); min < (closeH || 0) * 60 + (closeM || 0); min += branch.slotIntervalMinutes) {
      const hh = String(Math.floor(min / 60)).padStart(2, "0");
      const mm = String(min % 60).padStart(2, "0");
      const startAt = zonedTimeToUtc(branch.timezone, query.date, Math.floor(min / 60), min % 60);
      try {
        const available = await findAvailableStaff({ salonId: req.context!.salonId, branchId: query.branchId, serviceId: query.serviceId, startAt });
        slots.push({ startAt: startAt.toISOString(), staffId: available.staffId });
      } catch {
        // unavailable slot
      }
    }
    ok(res, { slots });
  })
);

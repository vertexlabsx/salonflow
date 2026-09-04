import { Router } from "express";
import { z } from "zod";
import { ok, asyncHandler } from "../../shared/http";
import { listPublicBranches, listPublicServices, listPublicStaff, listAvailableSlots, nextAvailableDates, bookAppointment, cancelBooking, rescheduleBooking } from "./self-booking.service";

/**
 * PUBLIC client self-booking endpoints. No auth. All queries are scoped by the
 * explicit `salonId` key so no tenant can see another's data. Slots returned are
 * validated against real availability — only genuinely open slots are listed, and
 * bookings/cancels/reschedules confirm or notify over WhatsApp.
 */
export const selfBookingRouter = Router();

const salonScope = z.object({
  salonId: z.string().trim().min(1)
});

selfBookingRouter.get("/branches", asyncHandler(async (req, res) => {
  const { salonId } = salonScope.parse(req.query);
  ok(res, { branches: await listPublicBranches(salonId) });
}));

selfBookingRouter.get("/services", asyncHandler(async (req, res) => {
  const { salonId, branchId } = z.object({ salonId: z.string().trim().min(1), branchId: z.string().trim().min(1) }).parse(req.query);
  ok(res, { services: await listPublicServices(salonId, branchId) });
}));

selfBookingRouter.get("/staff", asyncHandler(async (req, res) => {
  const { salonId, branchId, serviceId } = z.object({ salonId: z.string().trim().min(1), branchId: z.string().trim().min(1), serviceId: z.string().trim().optional() }).parse(req.query);
  ok(res, { staff: await listPublicStaff(salonId, branchId, serviceId) });
}));

selfBookingRouter.get("/slots", asyncHandler(async (req, res) => {
  const { salonId, branchId, serviceId, date, staffId, maxSlots } = z.object({
    salonId: z.string().trim().min(1),
    branchId: z.string().trim().min(1),
    serviceId: z.string().trim().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    staffId: z.string().trim().optional(),
    maxSlots: z.coerce.number().int().min(1).max(48).optional()
  }).parse(req.query);
  ok(res, await listAvailableSlots({ salonId, branchId, serviceId, date, staffId, maxSlots }));
}));

selfBookingRouter.get("/available-dates", asyncHandler(async (req, res) => {
  const { salonId, branchId, serviceId, fromDate, count } = z.object({
    salonId: z.string().trim().min(1),
    branchId: z.string().trim().min(1),
    serviceId: z.string().trim().min(1),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    count: z.coerce.number().int().min(1).max(14).optional()
  }).parse(req.query);
  ok(res, { dates: await nextAvailableDates({ salonId, branchId, serviceId, fromDate, count }) });
}));

selfBookingRouter.post("/book", asyncHandler(async (req, res) => {
  const input = z.object({
    salonId: z.string().trim().min(1),
    branchId: z.string().trim().min(1),
    serviceId: z.string().trim().min(1),
    startAt: z.string().min(1),
    customerName: z.string().trim().min(1).max(160),
    phone: z.string().trim().min(7).max(20),
    preferredStaffId: z.string().trim().optional()
  }).parse(req.body);
  ok(res, await bookAppointment(input));
}));

selfBookingRouter.post("/cancel", asyncHandler(async (req, res) => {
  const input = z.object({
    salonId: z.string().trim().min(1),
    appointmentId: z.string().trim().min(1),
    phone: z.string().trim().min(7).max(20)
  }).parse(req.body);
  ok(res, await cancelBooking(input));
}));

selfBookingRouter.post("/reschedule", asyncHandler(async (req, res) => {
  const input = z.object({
    salonId: z.string().trim().min(1),
    appointmentId: z.string().trim().min(1),
    phone: z.string().trim().min(7).max(20),
    branchId: z.string().trim().optional(),
    serviceId: z.string().trim().optional(),
    newStartAt: z.string().min(1)
  }).parse(req.body);
  ok(res, await rescheduleBooking(input));
}));

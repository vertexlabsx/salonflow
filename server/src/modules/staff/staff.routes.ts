import { Router } from "express";
import { z } from "zod";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePermissions } from "../../middleware/rbac";
import { clockIn, clockOut, listAttendance } from "./staff.service";
import {
  endBreak,
  listLeaves,
  listPayroll,
  listTargets,
  overtimeSummary,
  recentNotifications,
  requestLeave,
  startBreak,
  updateNotificationStatus,
  updateTask
} from "./staff-os.service";
import {
  cancelShiftSwap,
  chatMessages,
  chatThreads,
  conversations,
  conversationMessages,
  createShiftSwap,
  listShiftSwaps,
  myCalendar,
  respondShiftSwap,
  sendChatMessage,
  swapCoworkers,
  updateReceipts,
  updateSchedule,
  workspacePreferences
} from "./staff-self.service";
import { enterpriseOs } from "./enterprise-os.service";

const READ_PERMISSION = "read:appointments";
const CHECKIN_PERMISSION = "allow:staff-checkin-checkout";

const leaveSchema = z.object({
  leaveType: z.string().trim().min(1).max(40),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(500).default("")
});

const taskPatchSchema = z.object({
  status: z.string().trim().min(1).max(30),
  version: z.coerce.number().int().min(1)
});

export const staffOsRouter = Router();
staffOsRouter.use(requireAuth);

staffOsRouter.get(
  "/mobile/today",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    ok(res, await import("./staff.service").then((mod) => mod.staffToday(req.context!, query.date)));
  })
);

staffOsRouter.get(
  "/attendance",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional()
      })
      .parse(req.query);
    ok(res, await listAttendance(req.context!, query));
  })
);

staffOsRouter.post(
  "/attendance/clock-in",
  requirePermissions(CHECKIN_PERMISSION),
  asyncHandler(async (req, res) => {
    const body = z.object({ source: z.string().trim().max(60).optional() }).parse(req.body ?? {});
    ok(res, await clockIn(req.context!, body.source || "staff-app"), 201);
  })
);

staffOsRouter.post(
  "/attendance/clock-out",
  requirePermissions(CHECKIN_PERMISSION),
  asyncHandler(async (req, res) => {
    const body = z.object({ attendanceId: z.string().trim().min(1).max(80) }).parse(req.body ?? {});
    ok(res, await clockOut(req.context!, body.attendanceId));
  })
);

staffOsRouter.post(
  "/attendance/break-start",
  requirePermissions(CHECKIN_PERMISSION),
  asyncHandler(async (req, res) => {
    const body = z.object({ breakType: z.string().trim().max(40).optional() }).parse(req.body ?? {});
    ok(res, await startBreak(req.context!, body.breakType || "regular"), 201);
  })
);

staffOsRouter.post(
  "/attendance/break-end",
  requirePermissions(CHECKIN_PERMISSION),
  asyncHandler(async (req, res) => {
    ok(res, await endBreak(req.context!));
  })
);

staffOsRouter.get(
  "/attendance/overtime-summary",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const query = z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    ok(res, await overtimeSummary(req.context!, query.asOf));
  })
);

staffOsRouter.get(
  "/leaves",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }).parse(req.query);
    ok(res, await listLeaves(req.context!, query.limit ?? 6));
  })
);

staffOsRouter.get(
  "/leave-balances",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (_req, res) => {
    const now = new Date().toISOString();
    ok(res, [
      { id: "casual", leaveType: "Casual", openingBalance: 0, accrued: 0, used: 0, balance: 0, updatedAt: now },
      { id: "sick", leaveType: "Sick", openingBalance: 0, accrued: 0, used: 0, balance: 0, updatedAt: now }
    ]);
  })
);

staffOsRouter.post(
  "/leaves",
  requirePermissions("read:appointments"),
  asyncHandler(async (req, res) => {
    const body = leaveSchema.parse(req.body ?? {});
    ok(res, await requestLeave(req.context!, body), 201);
  })
);

staffOsRouter.get(
  "/mobile/payroll",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    ok(res, await listPayroll(req.context!));
  })
);

staffOsRouter.get(
  "/mobile/targets",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    ok(res, await listTargets(req.context!));
  })
);

staffOsRouter.patch(
  "/tasks/:taskId",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ taskId: z.string().trim().min(1).max(80) }).parse(req.params);
    const body = taskPatchSchema.parse(req.body ?? {});
    await updateTask(req.context!, params.taskId, body.status, body.version);
    ok(res, { id: params.taskId, status: body.status });
  })
);

/* ── Staff self-service ─────────────────────────────────────────────────── */

export const staffSelfRouter = Router();
staffSelfRouter.use(requireAuth);

export const teamChatRouter = Router();
teamChatRouter.use(requireAuth);
teamChatRouter.get("/conversations", requirePermissions(READ_PERMISSION), asyncHandler(async (req, res) => ok(res, await conversations(req.context!))));
teamChatRouter.get(
  "/conversations/:conversationId/messages",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ conversationId: z.string().trim().min(1).max(80) }).parse(req.params);
    ok(res, await conversationMessages(req.context!, params.conversationId));
  })
);
teamChatRouter.post(
  "/conversations/:conversationId/receipts",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ conversationId: z.string().trim().min(1).max(80) }).parse(req.params);
    const body = z.object({ messageIds: z.array(z.string().trim()).max(200).default([]), status: z.string().trim().max(20).default("read") }).parse(req.body ?? {});
    await updateReceipts(req.context!, params.conversationId, body.messageIds, body.status);
    ok(res, { updated: body.messageIds.length });
  })
);
teamChatRouter.post(
  "/private-owner",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (_req, res) => ok(res, { created: false }))
);

/* Verified-punch surface: disabled until branch devices are provisioned. The
   app then falls back to the plain transactional punch path. */
staffSelfRouter.get(
  "/attendance-verification-policy",
  requirePermissions(CHECKIN_PERMISSION),
  asyncHandler(async (req, res) => {
    ok(res, {
      branchId: req.context!.branchId,
      status: "disabled",
      radiusMeters: 0,
      maxAccuracyMeters: 0,
      enforceClockIn: false,
      enforceClockOut: false,
      requireVerifiedAttestation: false,
      version: 1
    });
  })
);

staffSelfRouter.get(
  "/attendance-device",
  requirePermissions(CHECKIN_PERMISSION),
  asyncHandler(async () => {
    throw ApiError.unavailableFeature("Attendance device registration is not enabled for this branch.");
  })
);

staffSelfRouter.post(
  "/attendance-device/register",
  requirePermissions(CHECKIN_PERMISSION),
  asyncHandler(async () => {
    throw ApiError.unavailableFeature("Attendance device registration is not enabled for this branch.");
  })
);

staffSelfRouter.post(
  "/attendance-challenge",
  requirePermissions(CHECKIN_PERMISSION),
  asyncHandler(async () => {
    throw ApiError.unavailableFeature("Verified punches are not enabled for this branch.");
  })
);

staffSelfRouter.post(
  "/attendance-verified-punch",
  requirePermissions(CHECKIN_PERMISSION),
  asyncHandler(async () => {
    throw ApiError.unavailableFeature("Verified punches are not enabled for this branch.");
  })
);

staffSelfRouter.get(
  "/dashboard",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    ok(res, await import("./staff.service").then((mod) => mod.staffDashboard(req.context!)));
  })
);

staffSelfRouter.get(
  "/enterprise-os",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    void req.query;
    ok(res, await enterpriseOs(req.context!));
  })
);

staffSelfRouter.get(
  "/workspace-preferences",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    ok(res, await workspacePreferences(req.context!));
  })
);

staffSelfRouter.get(
  "/business",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const dashboard = (await import("./staff.service").then((mod) => mod.staffDashboard(req.context!))) as {
      staff: unknown;
      summary: { todayAppointments: number; completedAppointments: number; appointmentValue: number };
      appointments: Array<Record<string, unknown>>;
    };
    const today = new Date().toISOString().slice(0, 10);
    const zeroPerformance = {
      statusCounts: { booked: 0, confirmed: 0, arrived: 0, inService: 0, completed: 0, cancelled: 0, noShow: 0, other: 0 },
      invoiceCount: 0,
      actualWorkedMinutes: 0,
      estimatedWorkedMinutes: 0,
      attendanceMinutes: 0,
      breakMinutes: 0,
      dutyMinutes: 0,
      utilizationPercent: null,
      attributedGrossPaise: null,
      attributedDiscountPaise: null,
      attributedCouponDiscountPaise: null,
      attributedAfterDiscountPaise: null,
      attributedGstPaise: null,
      attributedPaidPaise: null,
      attributedDuePaise: null,
      averageBillPaise: null,
      revenuePerWorkedHourPaise: null,
      serviceRevenuePaise: null,
      productRevenuePaise: null,
      membershipRevenuePaise: null,
      packageRevenuePaise: null,
      giftCardRevenuePaise: null
    };
    ok(res, {
      date: today,
      range: { from: String(req.query.from || today), to: String(req.query.to || today), timeZone: "Asia/Kolkata" },
      staff: dashboard.staff,
      billingVisible: false,
      permissions: { billing: false, earnings: false, targets: true, invoiceDetail: false },
      summary: {
        appointments: dashboard.summary.todayAppointments,
        completedServices: dashboard.summary.completedAppointments,
        scheduledMinutes: 0,
        completedMinutes: 0,
        workedMinutes: 0,
        bills: 0,
        subtotalPaise: 0,
        discountPaise: 0,
        couponDiscountPaise: 0,
        afterDiscountPaise: 0,
        gstPaise: 0,
        totalPaise: dashboard.summary.appointmentValue,
        paidPaise: 0,
        duePaise: 0
      },
      performance: zeroPerformance,
      earnings: null,
      targets: [],
      services: [],
      dailyBreakdown: [],
      pagination: { page: 1, pageSize: 20, totalItems: dashboard.appointments.length, totalPages: 1, hasMore: false },
      appointments: dashboard.appointments.map((appointment) => ({
        ...appointment,
        businessDate: today,
        state: appointment["status"] || "booked",
        workedMinutes: 0,
        timer: {
          appointmentId: appointment["id"],
          status: appointment["status"] || "booked",
          live: appointment["status"] === "in_service",
          startedAt: null,
          completedAt: null,
          timeSource: "estimated",
          elapsedMinutes: 0,
          totalMinutes: appointment["durationMinutes"] || 0,
          remainingMinutes: appointment["durationMinutes"] || 0,
          overrunMinutes: 0,
          progress: 0
        },
        billing: null,
        attribution: null
      }))
    });
  })
);

staffSelfRouter.get(
  "/business/invoices/:invoiceId",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const id = String(req.params.invoiceId);
    ok(res, {
      id,
      invoiceNumber: id,
      status: "draft",
      appointmentId: "",
      createdAt: new Date().toISOString(),
      totals: { saleId: "", invoiceId: id, invoiceNumber: id, invoiceStatus: "draft", subtotalPaise: 0, discountPaise: 0, couponDiscountPaise: 0, afterDiscountPaise: 0, gstPaise: 0, totalPaise: 0, paidPaise: 0, duePaise: 0 },
      items: [],
      payments: []
    });
  })
);

staffSelfRouter.patch(
  "/notifications/:id",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().trim().min(1).max(80) }).parse(req.params);
    const body = z.object({ status: z.string().trim().min(1).max(20) }).parse(req.body ?? {});
    await updateNotificationStatus(req.context!, params.id, body.status);
    ok(res, { id: params.id, status: body.status });
  })
);

staffSelfRouter.patch(
  "/calendar/:scheduleId",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ scheduleId: z.string().trim().min(1).max(80) }).parse(req.params);
    const body = z
      .object({
        status: z.string().trim().max(30).optional(),
        version: z.coerce.number().int().min(1).optional()
      })
      .parse(req.body ?? {});
    if (!body.status && typeof body.version !== "number") throw ApiError.badRequest("Nothing to update.");
    ok(res, await updateSchedule(req.context!, params.scheduleId, { status: body.status }, body.version));
  })
);

staffSelfRouter.get(
  "/calendar",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    ok(res, await myCalendar(req.context!));
  })
);

staffSelfRouter.get("/shift-swap-coworkers", requirePermissions(READ_PERMISSION), asyncHandler(async (req, res) => ok(res, await swapCoworkers(req.context!))));

staffSelfRouter.get("/shift-swaps", requirePermissions(READ_PERMISSION), asyncHandler(async (req, res) => ok(res, await listShiftSwaps(req.context!))));

staffSelfRouter.post(
  "/shift-swaps",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        scheduleId: z.string().trim().min(1).max(80),
        toStaffId: z.string().trim().min(1).max(80),
        reason: z.string().trim().max(500).default("")
      })
      .parse(req.body ?? {});
    ok(res, await createShiftSwap(req.context!, body), 201);
  })
);

staffSelfRouter.post(
  "/shift-swaps/:id/respond",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().trim().min(1).max(80) }).parse(req.params);
    const body = z
      .object({
        decision: z.enum(["accept", "decline"]),
        version: z.coerce.number().int().min(1),
        note: z.string().trim().max(500).default("")
      })
      .parse(req.body ?? {});
    ok(res, await respondShiftSwap(req.context!, params.id, body.decision, body.version, body.note));
  })
);

staffSelfRouter.post(
  "/shift-swaps/:id/cancel",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().trim().min(1).max(80) }).parse(req.params);
    const body = z.object({ version: z.coerce.number().int().min(1) }).parse(req.body ?? {});
    ok(res, await cancelShiftSwap(req.context!, params.id, body.version));
  })
);

staffSelfRouter.get("/chat/threads", requirePermissions(READ_PERMISSION), asyncHandler(async (req, res) => ok(res, await chatThreads(req.context!))));

staffSelfRouter.get(
  "/chat/threads/:threadId/messages",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ threadId: z.string().trim().min(1).max(80) }).parse(req.params);
    ok(res, await chatMessages(req.context!, params.threadId));
  })
);

staffSelfRouter.post(
  "/chat/messages",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        threadId: z.string().trim().min(1).max(80),
        body: z.string().trim().min(1).max(4000)
      })
      .parse(req.body ?? {});
    ok(res, await sendChatMessage(req.context!, body.threadId, body.body), 201);
  })
);

staffSelfRouter.get("/team-chat/conversations", requirePermissions(READ_PERMISSION), asyncHandler(async (req, res) => ok(res, await conversations(req.context!))));

staffSelfRouter.get(
  "/team-chat/conversations/:conversationId/messages",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ conversationId: z.string().trim().min(1).max(80) }).parse(req.params);
    ok(res, await conversationMessages(req.context!, params.conversationId));
  })
);

staffSelfRouter.post(
  "/team-chat/conversations/:conversationId/receipts",
  requirePermissions(READ_PERMISSION),
  asyncHandler(async (req, res) => {
    const params = z.object({ conversationId: z.string().trim().min(1).max(80) }).parse(req.params);
    const body = z
      .object({
        messageIds: z.array(z.string().trim()).max(200).default([]),
        status: z.string().trim().max(20).default("read")
      })
      .parse(req.body ?? {});
    await updateReceipts(req.context!, params.conversationId, body.messageIds, body.status);
    ok(res, { updated: body.messageIds.length });
  })
);

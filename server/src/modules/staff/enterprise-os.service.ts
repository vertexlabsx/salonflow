import type { Request } from "express";
import { AppointmentModel } from "../../models/appointment.model";
import { requireContext } from "../../middleware/tenant-context";
import { businessDateIn } from "../../shared/business-date";
import { loadEnv } from "../../config/env";
import { toStaffAppointment } from "./staff.types";
import { activeTasks, listTargets, overtimeSummary, recentNotifications } from "./staff-os.service";
import { myCalendar, workspacePreferences } from "./staff-self.service";

type Context = NonNullable<Request["context"]>;

export async function enterpriseOs(context: Context): Promise<unknown> {
  const env = loadEnv();
  const tz = env.SALON_TIMEZONE || "Asia/Kolkata";
  const today = businessDateIn(tz);

  const [dashboard, calendar, tasks, notifications, overtime, targets] = await Promise.all([
    import("./staff.service").then((mod) => mod.staffDashboard(context)),
    myCalendar(context),
    activeTasks(context),
    recentNotifications(context),
    overtimeSummary(context, today),
    listTargets(context)
  ]);

  const dashboardData = dashboard as {
    staff: Record<string, unknown>;
    summary: {
      appointments: number;
      todayAppointments: number;
      appointmentValue: number;
      revenue: number;
      completedAppointments: number;
    };
    todayAppointments: Array<{ id: string; serviceNames: string[]; startAt: string; endAt: string; status: string; durationMinutes: number }>;
    liveAppointments: Array<{ id: string; status: string }>;
    workReport: Array<Record<string, unknown>>;
  };

  const now = Date.now();
  const timeline = dashboardData.todayAppointments.map((a) => ({
    id: a.id,
    serviceNames: a.serviceNames,
    startAt: a.startAt,
    endAt: a.endAt,
    status: a.status,
    state: new Date(a.startAt).getTime() <= now && now < new Date(a.endAt).getTime() ? "live" : "scheduled",
    minutesToStart: Math.round((new Date(a.startAt).getTime() - now) / 60_000),
    durationMinutes: a.durationMinutes
  }));

  const inProgress = await AppointmentModel.find({
    salonId: context.salonId,
    staffId: context.staffId,
    status: "in_service"
  }).limit(20);

  const serviceTimers = inProgress.map((doc) => {
    const dto = toStaffAppointment(doc);
    const elapsedMinutes = Math.max(0, Math.round((now - new Date(dto.startAt).getTime()) / 60_000));
    const totalMinutes = Math.max(1, dto.durationMinutes);
    return {
      appointmentId: dto.id,
      status: dto.status,
      elapsedMinutes,
      totalMinutes,
      remainingMinutes: Math.max(0, totalMinutes - elapsedMinutes),
      progress: Math.min(100, Math.round((elapsedMinutes / totalMinutes) * 100))
    };
  });

  const firstName = String(dashboardData.staff.firstName ?? "");
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()));
  const greeting = hour < 12 ? `Good morning, ${firstName}` : hour < 17 ? `Good afternoon, ${firstName}` : `Good evening, ${firstName}`;
  const target = targets[0] as { targetValue?: number; achievedValue?: number } | undefined;
  const targetValue = target?.targetValue ?? 0;
  const achievedValue = target?.achievedValue ?? 0;

  return {
    staff: dashboardData.staff,
    home: {
      greeting,
      todayAppointments: dashboardData.summary.todayAppointments,
      expectedRevenue: dashboardData.summary.appointmentValue,
      tasks: tasks.length,
      pendingPayments: 0,
      recentNotifications: notifications.length,
      targetProgress: {
        label: "Monthly Revenue Target",
        targetValue,
        achievedValue,
        percentage: targetValue > 0 ? Math.min(100, Math.round((achievedValue / targetValue) * 100)) : 0,
        remaining: Math.max(0, targetValue - achievedValue)
      }
    },
    timeline,
    serviceTimers,
    performance: {
      revenue: dashboardData.summary.revenue,
      completedServices: dashboardData.summary.completedAppointments,
      avgUtilization: 0,
      avgRating: 0,
      productivityScore: 0,
      strengths: [],
      opportunities: []
    },
    leaderboard: [
      {
        rank: 1,
        staffId: context.staffId || context.userId,
        staffName: String(dashboardData.staff.fullName ?? ""),
        revenue: dashboardData.summary.appointmentValue,
        score: Math.min(100, dashboardData.summary.completedAppointments * 10),
        rating: 0,
        days: 30,
        isMe: true
      }
    ],
    gamification: { points: 0, level: 1, stars: 0, dailyStreak: 0, monthlyStreak: 0, badges: [] },
    notifications,
    tasks,
    calendar,
    reports: {}
  };
}

import { describe, expect, it } from "vitest";
import { StaffDashboard, StaffEnterpriseOs, StaffToday, StaffUser } from "../../core/staff-app.service";
import { buildStaffDashboardViewModel, DashboardViewModelInput, shouldShowDashboardRecommendation } from "./staff-dashboard.model";

const user: StaffUser = { id: "user-1", name: "Mira Sen", loginId: "mira", email: "mira@example.com", role: "custom-specialist", staffId: "staff-1", branchId: "branch-1", branchIds: ["branch-1"], permissions: [] };
const appointment = { id: "appt-1", staffId: "staff-1", branchId: "branch-1", serviceIds: ["service-1"], serviceNames: ["Hair spa"], durationMinutes: 60, value: 120000, startAt: "2026-07-14T12:00:00.000Z", endAt: "2026-07-14T13:00:00.000Z", status: "confirmed", chair: "", source: "" };
const dashboard: StaffDashboard = {
  staff: { id: "staff-1", fullName: "Mira Sen", firstName: "Mira", lastName: "Sen", mobile: "", email: "", roleId: "custom", department: "", designation: "", status: "active" },
  summary: { appointments: 1, todayAppointments: 1, liveAppointments: 0, completedAppointments: 0, cancelledAppointments: 0, salesCount: 0, revenue: 125000, appointmentValue: 120000 },
  todayAppointments: [appointment], liveAppointments: [], workReport: [], appointments: [appointment], sales: []
};
const today: StaffToday = { date: "2026-07-14", schedules: [{ id: "shift-1", scheduleDate: "2026-07-14", startTime: "09:00", endTime: "18:00", shiftType: "regular", status: "scheduled" }], attendance: [], activeBreak: null, tasks: [{ id: "task-1", title: "Confirm consultation", description: "", status: "open", priority: "high", dueAt: "", version: 1 }] };
const enterprise: StaffEnterpriseOs = {
  staff: dashboard.staff,
  home: { greeting: "", todayAppointments: 1, expectedRevenue: 125000, tasks: 1, pendingPayments: 0, recentNotifications: 0, targetProgress: { label: "", targetValue: 0, achievedValue: 0, percentage: 0, remaining: 0 } },
  timeline: [], serviceTimers: [], performance: { revenue: 125000, completedServices: 0, avgUtilization: 55, avgRating: 4.8, productivityScore: 72, strengths: [], opportunities: [] }, leaderboard: [], gamification: { points: 40, level: 2, stars: 1, dailyStreak: 1, monthlyStreak: 1, badges: [] }, notifications: [], tasks: [], calendar: [], reports: {}
};

function input(permissions: string[], overrides: Partial<DashboardViewModelInput> = {}): DashboardViewModelInput {
  const grants = new Set(permissions);
  return {
    user: { ...user, permissions }, dashboard, enterprise, today, overtime: null, leaveBalances: [], now: new Date("2026-07-14T11:30:00.000Z"),
    hasPermission: (permission) => grants.has(permission),
    ...overrides
  };
}

describe("staff dashboard permission-first view model", () => {
  it("labels the workspace chat tool without implying it is team-only", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"]));
    expect(vm.tools.find((tool) => tool.id === "chat")).toMatchObject({ label: "Chat", hint: "Team and private owner chat" });
  });

  it("keeps attendance in the hero without duplicating first-viewport actions", () => {
    const allowed = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "allow:staff-checkin-checkout"]));
    const restricted = buildStaffDashboardViewModel(input(["read:appointments"]));
    expect(allowed.hero).toMatchObject({ title: "Ready to start your shift? 👋", detail: "Not clocked in", shiftAssigned: true, shift: "09:00–18:00" });
    expect(allowed.quickActions.some((action) => action.id === "attendance")).toBe(false);
    expect(allowed.quickActions).toHaveLength(4);
    expect(allowed.quickActions.some((action) => allowed.hero.actions.some((hero) => hero.primary && (hero.id === action.id || hero.route === action.route)))).toBe(false);
    expect(restricted.quickActions.some((action) => action.id === "attendance")).toBe(false);
    expect(allowed.hero.actions).toMatchObject([{ id: "attendance", label: "Clock In", primary: true }, { id: "schedule", label: "Today’s Schedule" }]);
  });

  it("models the two permission-safe no-shift states", () => {
    const clockAllowed = buildStaffDashboardViewModel(input(["read:appointments", "allow:staff-checkin-checkout"], { today: { ...today, schedules: [] } }));
    const clockRestricted = buildStaffDashboardViewModel(input(["read:appointments"], { today: { ...today, schedules: [] } }));
    expect(clockAllowed.hero).toMatchObject({ title: "Ready to start? 👋", detail: "No shift assigned today", hint: "You can still clock in if required.", shiftAssigned: false, shift: "" });
    expect(clockAllowed.hero.actions).toMatchObject([{ id: "attendance", label: "Clock In", primary: true }, { id: "schedule", label: "Today’s Schedule" }]);
    expect(clockRestricted.hero).toMatchObject({ title: "No shift assigned today", hint: "Check today’s schedule or contact your manager." });
    expect(clockRestricted.hero.actions).toEqual([{ id: "schedule", label: "Today’s Schedule", route: "/staff/appointments", primary: true }]);
  });

  it("deduplicates the hero recommendation and lets a partial warning take precedence", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "allow:staff-checkin-checkout"]));
    const primary = vm.hero.actions[0];
    const identity = [primary.id, primary.appointmentId || "", primary.route || "", vm.hero.title].join(":");
    const recommendation = { identity, text: vm.hero.title, hero: vm.hero, hintsEnabled: true, dismissedIdentity: "", hasPartialWarning: false };
    expect(shouldShowDashboardRecommendation(recommendation)).toBe(false);
    expect(shouldShowDashboardRecommendation({ ...recommendation, identity: "distinct", text: "Review preparation", hasPartialWarning: true })).toBe(false);
  });

  it("prioritizes and acts on an active service after attendance", () => {
    const active = { ...appointment, status: "in-service" };
    const activeDashboard = { ...dashboard, liveAppointments: [active], todayAppointments: [active], summary: { ...dashboard.summary, liveAppointments: 1 } };
    const attended = { ...today, attendance: [{ id: "attendance-1", businessDate: today.date, clockInAt: "2026-07-14T03:30:00.000Z", clockOutAt: "", status: "clocked_in", source: "staff-app", overtimeMinutes: 0, grossMinutes: 0, totalBreakMinutes: 0, totalWorkedMinutes: 0, scheduledShiftMinutes: 540, overtimeCalculationStatus: "pending", overtimeReviewReason: "", overtimePolicyVersion: "1" }] };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "update:appointments", "allow:staff-checkin-checkout"], { dashboard: activeDashboard, today: attended }));
    expect(vm.work.mode).toBe("active");
    expect(vm.hero).toMatchObject({ title: "You’re clocked in", detail: expect.stringContaining("Clocked in at"), shift: "09:00–18:00" });
    expect(vm.hero.actions).toMatchObject([{ id: "queue", route: "/staff/queue", primary: true }, { id: "attendance-details", route: "/staff/attendance" }]);
    expect(vm.work.actions).toEqual([{ id: "open-appointment", label: "Open appointment", route: "/staff/appointments", primary: true }]);
  });

  it("puts permitted critical floor alerts ahead of attendance and service work", () => {
    const lateEnterprise = { ...enterprise, home: { ...enterprise.home, pendingPayments: 2 } };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:finance", "allow:staff-checkin-checkout"], { enterprise: lateEnterprise }));
    expect(vm.hero.title).toBe("The floor needs attention");
    expect(vm.hero.actions[0]).toMatchObject({ route: "/staff/business", primary: true });
    expect(vm.alerts.map((alert) => alert.id)).toEqual(["payments"]);
    expect(vm.hero.actions.filter((action) => action.primary)).toHaveLength(1);
  });

  it("uses real break and completed-attendance state instead of offering another clock-in", () => {
    const openAttendance = { id: "attendance-1", businessDate: today.date, clockInAt: "2026-07-14T03:30:00.000Z", clockOutAt: "", status: "clocked_in", source: "staff-app", overtimeMinutes: 0, grossMinutes: 0, totalBreakMinutes: 0, totalWorkedMinutes: 0, scheduledShiftMinutes: 540, overtimeCalculationStatus: "pending", overtimeReviewReason: "", overtimePolicyVersion: "1" };
    const noAppointments = { ...dashboard, todayAppointments: [], liveAppointments: [], summary: { ...dashboard.summary, todayAppointments: 0 } };
    const onBreak = buildStaffDashboardViewModel(input(["read:appointments", "allow:staff-checkin-checkout"], { dashboard: noAppointments, today: { ...today, attendance: [openAttendance], activeBreak: { id: "break-1", status: "active" }, tasks: [] } }));
    const completed = buildStaffDashboardViewModel(input(["read:appointments", "allow:staff-checkin-checkout"], { dashboard: noAppointments, today: { ...today, schedules: [{ ...today.schedules[0], status: "completed" }], attendance: [{ ...openAttendance, clockOutAt: "2026-07-14T12:30:00.000Z", status: "clocked_out" }], tasks: [] } }));
    expect(onBreak.hero.title).toBe("You’re clocked in");
    expect(onBreak.hero.actions[0]).toMatchObject({ kind: "end-break", label: "End break" });
    expect(completed.hero.title).toBe("Your shift is complete");
    expect(completed.hero.actions.some((action) => action.kind === "clock")).toBe(false);
  });

  it("prioritizes an urgent open task ahead of a distant appointment", () => {
    const distant = { ...appointment, startAt: "2026-07-14T15:00:00.000Z", endAt: "2026-07-14T16:00:00.000Z" };
    const attended = { ...today, attendance: [{ id: "attendance-1", businessDate: today.date, clockInAt: "2026-07-14T03:30:00.000Z", clockOutAt: "", status: "clocked_in", source: "staff-app", overtimeMinutes: 0, grossMinutes: 0, totalBreakMinutes: 0, totalWorkedMinutes: 0, scheduledShiftMinutes: 540, overtimeCalculationStatus: "pending", overtimeReviewReason: "", overtimePolicyVersion: "1" }] };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"], { dashboard: { ...dashboard, todayAppointments: [distant], appointments: [distant] }, today: attended }));
    expect(vm.hero).toMatchObject({ title: "You’re clocked in", actions: [{ id: "next", route: "/staff/appointments", primary: true }, { id: "attendance-details" }] });
  });

  it("shows upcoming assigned work with timing and permission-safe actions", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments"]));
    expect(vm.work).toMatchObject({ mode: "upcoming", title: "Assigned appointment", status: "Confirmed", meta: expect.stringContaining("In 30 min") });
    expect(vm.work.actions).toEqual([{ id: "open-appointment", label: "Open appointment", route: "/staff/appointments", primary: true }]);
  });

  it("models waiting appointments with sage emphasis and only valid service actions", () => {
    const waiting = { ...appointment, status: "arrived" };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "update:appointments"], { dashboard: { ...dashboard, todayAppointments: [waiting], appointments: [waiting] } }));
    expect(vm.work).toMatchObject({ mode: "waiting", tone: "sage", title: "Assigned appointment", status: "Arrived" });
    expect(vm.work.meta).not.toMatch(/elapsed/i);
    expect(vm.work.actions).toEqual([{ id: "open-appointment", label: "Open appointment", route: "/staff/appointments", primary: true }]);
  });

  it("uses connected timer elapsed data and the queue route for an active service", () => {
    const active = { ...appointment, status: "in-service" };
    const timedEnterprise = { ...enterprise, serviceTimers: [{ appointmentId: active.id, status: active.status, elapsedMinutes: 35, totalMinutes: 60, remainingMinutes: 25, progress: 58 }] };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "update:appointments"], { dashboard: { ...dashboard, liveAppointments: [active], todayAppointments: [active] }, enterprise: timedEnterprise }));
    expect(vm.work).toMatchObject({ mode: "active", tone: "sage", meta: "35 min elapsed", progress: 58 });
    expect(vm.work.actions).toEqual([{ id: "open-service", label: "Open service", route: "/staff/queue", primary: true }]);
  });

  it("uses amber only when the connected timeline marks an appointment late", () => {
    const delayed = { ...appointment, startAt: "2026-07-14T11:00:00.000Z", endAt: "2026-07-14T12:30:00.000Z" };
    const lateEnterprise = { ...enterprise, timeline: [{ id: delayed.id, serviceNames: delayed.serviceNames, startAt: delayed.startAt, endAt: delayed.endAt, status: delayed.status, state: "late", minutesToStart: -30, durationMinutes: delayed.durationMinutes }] };
    const vm = buildStaffDashboardViewModel(input(["read:appointments"], { dashboard: { ...dashboard, todayAppointments: [delayed], appointments: [delayed] }, enterprise: lateEnterprise }));
    expect(vm.work).toMatchObject({ mode: "delayed", tone: "amber", meta: expect.stringContaining("30 min late") });
    expect(vm.work.actions[0]).toMatchObject({ label: "Open appointment", route: "/staff/appointments", primary: true });
  });

  it("never grants financial visibility from a role name and caps performance at three", () => {
    const restricted = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"]));
    const financial = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "read:finance"]));
    expect(restricted.performance.some((metric) => metric.label === "Revenue")).toBe(false);
    expect(restricted.alerts.some((alert) => alert.id === "payments")).toBe(false);
    expect(restricted.performance.map((metric) => metric.label)).toEqual(["Productivity", "Services", "Utilization"]);
    expect(financial.performance.map((metric) => metric.label)).toEqual(["Revenue", "Productivity", "Services"]);
    expect(financial.performance).toHaveLength(3);
    expect(financial.performance[0]).toMatchObject({ label: "Revenue", value: expect.stringMatching(/₹\s?1,250/), hint: "Today’s sales" });
    expect(financial.tools.some((tool) => tool.id === "payroll")).toBe(true);
  });

  it("formats dashboard summary revenue as integer paise with the shared formatter", () => {
    const withPaise = { ...dashboard, summary: { ...dashboard.summary, revenue: 125099 } };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:finance"], { dashboard: withPaise }));
    expect(vm.performance[0].value.replace(/\s/g, "")).toBe("₹1,250.99");
  });

  it("supports a custom restricted role using permissions rather than role defaults", () => {
    const vm = buildStaffDashboardViewModel(input([], { user: { ...user, role: "owner" } }));
    expect(vm.quickActions).toEqual([]);
    expect(vm.tools.map((tool) => tool.id)).toEqual(["settings"]);
  });

  it("orders authorized content by role profile without granting missing permissions", () => {
    const receptionist = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "allow:staff-checkin-checkout"], { user: { ...user, role: "receptionist" } }));
    const inventory = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "allow:staff-checkin-checkout"], { user: { ...user, role: "inventory-manager" } }));
    expect(receptionist.quickActions.map((action) => action.id)).toEqual(["appointments", "queue", "tasks", "calendar"]);
    expect(receptionist.tools[0].id).toBe("settings");
    expect(inventory.quickActions.map((action) => action.id)).toEqual(["queue", "appointments", "tasks", "calendar"]);
  });

  it("adds compact live metadata with meaningful zero language to quick actions", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff", "allow:staff-checkin-checkout"]));
    expect(vm.quickActions.find((action) => action.id === "appointments")?.status).toBe("1 today");
    expect(vm.quickActions.find((action) => action.id === "queue")?.status).toBe("No live services");
    expect(vm.quickActions.find((action) => action.id === "tasks")?.status).toBe("1 pending");
  });

  it("builds four backed overview metrics or a complete three-metric fallback", () => {
    const complete = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"]));
    const fallback = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"], { enterprise: null }));
    expect(complete.overview.map((metric) => metric.label)).toEqual(["Appointments", "Completed", "Open tasks", "Alerts"]);
    expect(fallback.overview).toHaveLength(3);
    expect(fallback.overview.every((metric) => metric.hint.length > 0)).toBe(true);
  });

  it("types and bounds performance progress using connected score data", () => {
    const outOfRange = { ...enterprise, performance: { ...enterprise.performance, productivityScore: 120, avgUtilization: -5 } };
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"], { enterprise: outOfRange }));
    expect(vm.performance.find((metric) => metric.label === "Productivity")).toMatchObject({ progress: 100, progressLabel: "Productivity 120 out of 100" });
    expect(vm.performance.find((metric) => metric.label === "Productivity")?.explanation).toContain("completed services provide the fallback");
    expect(vm.performance.find((metric) => metric.label === "Utilization")?.progress).toBe(0);
    expect(vm.performance).toHaveLength(3);
  });

  it("keeps Settings in the fixed workspace", () => {
    const vm = buildStaffDashboardViewModel(input(["read:appointments", "read:staff"]));
    expect(vm.tools.some((tool) => tool.id === "settings")).toBe(true);
    expect(vm.tools.length).toBeLessThanOrEqual(6);
  });

  it("uses the next-work empty state without a redundant global empty state", () => {
    const emptyDashboard = { ...dashboard, summary: { ...dashboard.summary, appointments: 0, todayAppointments: 0, revenue: 0, appointmentValue: 0 }, todayAppointments: [], appointments: [] };
    const emptyToday = { ...today, tasks: [] };
    const vm = buildStaffDashboardViewModel(input(["read:appointments"], { dashboard: emptyDashboard, enterprise: null, today: emptyToday }));
    expect(vm).not.toHaveProperty("empty");
    expect(vm.work.mode).toBe("empty");
    expect(vm.work).toMatchObject({ eyebrow: "Next appointment", meta: "Schedule clear", title: "No appointment waiting right now.", detail: "", scheduleRoute: "/staff/appointments", scheduleActionLabel: "View Schedule →" });
    expect(vm.overview[0]).toMatchObject({ value: "0", hint: "No bookings" });
  });
});

import { StaffAppointment, StaffDashboard, StaffEnterpriseOs, StaffLeaveBalance, StaffOvertimeSummary, StaffToday, StaffUser } from "../../core/staff-app.service";
import { formatPaiseInr } from "../../core/paise-inr.pipe";

export type DashboardActionKind = "clock" | "end-break";
export type DashboardAction = {
  id: string;
  label: string;
  route?: string | readonly string[];
  kind?: DashboardActionKind;
  appointmentId?: string;
  primary?: boolean;
  status?: string;
};
export type DashboardMetric = { label: string; value: string; hint: string; route?: string; progress?: number; progressLabel?: string; explanation?: string };
export type DashboardAlert = { id: string; title: string; detail: string; route: string; tone: "critical" | "attention" };
export type DashboardTool = { id: string; label: string; hint: string; route: string };
export type DashboardWork = {
  mode: "active" | "upcoming" | "waiting" | "delayed" | "empty";
  tone: "neutral" | "sage" | "amber";
  eyebrow: string;
  title: string;
  detail: string;
  meta: string;
  status?: string;
  progress?: number;
  queueRoute?: string;
  scheduleRoute?: string;
  scheduleActionLabel?: string;
  actions: DashboardAction[];
};

export type StaffDashboardViewModel = {
  hero: { eyebrow: string; title: string; detail: string; hint: string; shift: string; shiftAssigned: boolean; actions: DashboardAction[] };
  quickActions: DashboardAction[];
  overview: DashboardMetric[];
  work: DashboardWork;
  alerts: DashboardAlert[];
  performanceRoute?: string;
  performance: DashboardMetric[];
  tools: DashboardTool[];
};

export type DashboardRecommendationState = {
  identity: string;
  text: string;
  hero: StaffDashboardViewModel["hero"];
  hintsEnabled: boolean;
  dismissedIdentity: string;
  hasPartialWarning: boolean;
};

export type DashboardViewModelInput = {
  user: StaffUser | null;
  dashboard: StaffDashboard;
  enterprise: StaffEnterpriseOs | null;
  today: StaffToday | null;
  overtime: StaffOvertimeSummary | null;
  leaveBalances: StaffLeaveBalance[];
  now?: Date;
  hasPermission: (permission: string) => boolean;
};

type ActionContext = DashboardViewModelInput & {
  activeAppointment: StaffAppointment | null;
  nextAppointment: StaffAppointment | null;
  openTaskCount: number;
  priorityTask: StaffToday["tasks"][number] | null;
  openAttendance: StaffToday["attendance"][number] | null;
  staleOpenAttendance: StaffToday["attendance"][number] | null;
  shiftCompleted: boolean;
};

type RegistryItem<T> = {
  item: T;
  permissions?: readonly string[];
  anyPermission?: readonly string[];
  when?: (context: ActionContext) => boolean;
};

const FINANCIAL_PERMISSIONS = ["read:finance", "read:sales", "read:payments", "read:invoices"] as const;
const ATTENDANCE_PERMISSIONS = ["allow:staff-checkin-checkout", "write:staff"] as const;

const QUICK_ACTIONS: readonly RegistryItem<DashboardAction>[] = [
  { item: { id: "attendance", label: "Attendance", kind: "clock" }, anyPermission: ATTENDANCE_PERMISSIONS },
  { item: { id: "appointments", label: "Appointments", route: "/staff/appointments" }, permissions: ["read:appointments"] },
  { item: { id: "queue", label: "Today’s Queue", route: "/staff/queue" }, permissions: ["read:appointments"] },
  { item: { id: "tasks", label: "Tasks", route: "/staff/tasks" }, permissions: ["read:staff"] },
  { item: { id: "calendar", label: "Calendar", route: "/staff/calendar" }, permissions: ["read:appointments"] }
];

const TOOLS: readonly RegistryItem<DashboardTool>[] = [
  { item: { id: "calendar", label: "My Shifts", hint: "Roster and schedule", route: "/staff/calendar" }, permissions: ["read:appointments"] },
  { item: { id: "leave", label: "Leave", hint: "Requests and balances", route: "/staff/leaves" }, permissions: ["read:staff"] },
  { item: { id: "chat", label: "Chat", hint: "Team and private owner chat", route: "/staff/chat" }, permissions: ["read:staff"] },
  { item: { id: "reports", label: "Reports", hint: "Work summaries", route: "/staff/reports" }, permissions: ["read:staff"] },
  { item: { id: "payroll", label: "Payroll", hint: "Pay statements", route: "/staff/payroll" }, anyPermission: ["read:payroll", "read:finance"] },
  { item: { id: "settings", label: "Settings", hint: "Workspace preferences", route: "/staff/settings" } }
];

type DashboardRoleProfile = {
  aliases: readonly string[];
  quick: readonly string[];
  overview: readonly string[];
  performance: readonly string[];
  tools: readonly string[];
};

const ROLE_PROFILES: readonly DashboardRoleProfile[] = [
  { aliases: ["frontdesk", "receptionist"], quick: ["appointments", "queue", "tasks", "attendance"], overview: ["Alerts", "Appointments", "Open tasks", "Completed"], performance: ["Services", "Utilization", "Productivity", "Revenue"], tools: ["settings", "calendar", "chat", "reports", "leave", "payroll"] },
  { aliases: ["stylist", "seniorstylist", "therapist", "staff", "staffappuser"], quick: ["attendance", "appointments", "queue", "tasks"], overview: ["Appointments", "Completed", "Open tasks", "Alerts"], performance: ["Productivity", "Services", "Utilization", "Rating", "Revenue"], tools: ["calendar", "settings", "leave", "chat", "reports", "payroll"] },
  { aliases: ["manager", "salonmanager", "staffappmanager"], quick: ["tasks", "appointments", "queue", "attendance"], overview: ["Alerts", "Open tasks", "Appointments", "Completed"], performance: ["Productivity", "Utilization", "Services", "Revenue", "Rating"], tools: ["reports", "calendar", "settings", "chat", "payroll", "leave"] },
  { aliases: ["owner", "admin", "staffappadmin"], quick: ["appointments", "tasks", "queue", "attendance"], overview: ["Alerts", "Appointments", "Completed", "Open tasks"], performance: ["Revenue", "Productivity", "Utilization", "Services", "Rating"], tools: ["reports", "payroll", "calendar", "settings", "chat", "leave"] },
  { aliases: ["cashier", "inventory", "inventorymanager", "cashierinventory"], quick: ["queue", "appointments", "tasks", "attendance"], overview: ["Alerts", "Appointments", "Completed", "Open tasks"], performance: ["Revenue", "Services", "Utilization", "Productivity", "Rating"], tools: ["reports", "payroll", "settings", "calendar", "chat", "leave"] }
];

const DEFAULT_ROLE_PROFILE: DashboardRoleProfile = {
  aliases: [], quick: [], overview: [], performance: [], tools: []
};

function allowed<T>(entry: RegistryItem<T>, input: DashboardViewModelInput | ActionContext): boolean {
  if (entry.permissions?.some((permission) => !input.hasPermission(permission))) return false;
  if (entry.anyPermission?.length && !entry.anyPermission.some(input.hasPermission)) return false;
  return !entry.when || entry.when(input as ActionContext);
}

function isActiveStatus(status: string): boolean {
  return ["in-service", "in service", "inprogress", "in progress", "running", "active", "started"].includes(String(status || "").trim().toLowerCase());
}

function isOpenAttendance(item: StaffToday["attendance"][number]): boolean {
  return !item.clockOutAt && !/out|closed|complete/i.test(String(item.status || ""));
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "Time unavailable" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function durationLabel(minutes: number): string {
  const safe = Math.max(0, Number(minutes || 0));
  return `${Math.floor(safe / 60)}h ${safe % 60}m`;
}

function compactDurationLabel(minutes: number): string {
  const safe = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${remainder} min`;
}

function minutesUntilLabel(minutes: number): string {
  if (minutes <= 0) return "Due now";
  return `In ${compactDurationLabel(minutes)}`;
}

function openTasks(input: DashboardViewModelInput): StaffToday["tasks"] {
  return (input.today?.tasks || []).filter((task) => String(task.status || "open").toLowerCase() !== "completed");
}

function taskPriority(task: StaffToday["tasks"][number], now: Date): number {
  const priority = String(task.priority || "").toLowerCase();
  const dueAt = new Date(task.dueAt || "").getTime();
  if (["urgent", "critical"].includes(priority) || (Number.isFinite(dueAt) && dueAt < now.getTime())) return 0;
  if (priority === "high") return 1;
  return 2;
}

function nextAppointment(input: DashboardViewModelInput): StaffAppointment | null {
  const now = (input.now || new Date()).getTime();
  return [...(Array.isArray(input.dashboard.todayAppointments) ? input.dashboard.todayAppointments : [])]
    .filter((item) => !isActiveStatus(item.status) && new Date(item.endAt || item.startAt).getTime() >= now)
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())[0] || null;
}

function context(input: DashboardViewModelInput): ActionContext {
  const liveAppointments = Array.isArray(input.dashboard.liveAppointments) ? input.dashboard.liveAppointments : [];
  const todayAppointments = Array.isArray(input.dashboard.todayAppointments) ? input.dashboard.todayAppointments : [];
  const activeAppointment = liveAppointments.find((item) => isActiveStatus(item.status))
    || todayAppointments.find((item) => isActiveStatus(item.status)) || null;
  const tasks = openTasks(input);
  const attendance = input.today?.attendance || [];
  const now = input.now || new Date();
  const staleCutoffMs = now.getTime() - 36 * 60 * 60 * 1000;
  const isStaleClock = (item: StaffToday["attendance"][number]) => {
    const clockInMs = new Date(item.clockInAt || "").getTime();
    return Number.isFinite(clockInMs) && clockInMs < staleCutoffMs;
  };
  return {
    ...input,
    activeAppointment,
    nextAppointment: nextAppointment(input),
    openTaskCount: tasks.length,
    priorityTask: [...tasks].sort((left, right) => taskPriority(left, input.now || new Date()) - taskPriority(right, input.now || new Date()))[0] || null,
    openAttendance: attendance.find((item) => isOpenAttendance(item) && !isStaleClock(item)) || null,
    staleOpenAttendance: attendance.find((item) => isOpenAttendance(item) && isStaleClock(item)) || null,
    shiftCompleted: (input.today?.schedules || []).some((schedule) => /completed|closed|finished|ended/i.test(String(schedule.status || "")))
  };
}

function appointmentActions(input: ActionContext, appointment: StaffAppointment, mode: DashboardWork["mode"]): DashboardAction[] {
  const actions: DashboardAction[] = [];
  const appointmentRoute = input.hasPermission("read:appointments") ? "/staff/appointments" : undefined;
  const queueRoute = input.hasPermission("read:appointments") && input.hasPermission("read:staff") ? "/staff/queue" : appointmentRoute;
  if (mode === "active") {
    if (queueRoute) actions.push({ id: queueRoute === "/staff/queue" ? "open-service" : "open-appointment", label: queueRoute === "/staff/queue" ? "Open service" : "Open appointment", route: queueRoute, primary: true });
  } else if (mode === "waiting") {
    if (appointmentRoute) actions.push({ id: "open-appointment", label: "Open appointment", route: appointmentRoute, primary: !actions.length });
  } else {
    if (appointmentRoute) actions.push({ id: "open-appointment", label: "Open appointment", route: appointmentRoute, primary: true });
  }
  return actions.slice(0, 3);
}

function alerts(input: ActionContext): DashboardAlert[] {
  const home = input.enterprise?.home;
  if (!home) return [];
  const result: DashboardAlert[] = [];
  if (home.pendingPayments > 0 && FINANCIAL_PERMISSIONS.some(input.hasPermission)) result.push({ id: "payments", title: `${home.pendingPayments} pending payment${home.pendingPayments === 1 ? "" : "s"}`, detail: "Checkout needs attention.", route: "/staff/business", tone: "critical" });
  const unread = (input.enterprise?.notifications || []).filter((note) => String(note.status || "unread") !== "read").length;
  if (unread > 0 && input.hasPermission("read:appointments")) result.push({ id: "unread", title: `${unread} unread notification${unread === 1 ? "" : "s"}`, detail: "Review the latest operational updates.", route: "/staff/notifications", tone: "attention" });
  return result.slice(0, 4);
}

function work(input: ActionContext): DashboardWork {
  const active = input.activeAppointment;
  if (active) {
    const timer = (input.enterprise?.serviceTimers || []).find((item) => item.appointmentId === active.id);
    const overrun = timer ? Math.max(0, timer.elapsedMinutes - timer.totalMinutes) : 0;
    return {
      mode: "active", tone: overrun ? "amber" : "sage", eyebrow: "Current service", title: "Assigned appointment",
      detail: (active.serviceNames || []).join(", ") || "Service", status: statusLabel(active.status),
      meta: timer ? (overrun ? `${compactDurationLabel(timer.elapsedMinutes)} elapsed · ${compactDurationLabel(overrun)} over` : `${compactDurationLabel(timer.elapsedMinutes)} elapsed`) : "Timer unavailable",
      progress: timer?.progress, actions: appointmentActions(input, active, "active"),
      queueRoute: input.hasPermission("read:appointments") && input.hasPermission("read:staff") ? "/staff/queue" : undefined,
    };
  }
  const next = input.nextAppointment;
  if (next) {
    const status = String(next.status || "").trim().toLowerCase();
    const timeline = (input.enterprise?.timeline || []).find((item) => item.id === next.id);
    const waiting = ["arrived", "checked-in", "checked in", "queued"].includes(status);
    const delayed = timeline?.state === "late";
    const mode: DashboardWork["mode"] = waiting ? "waiting" : delayed ? "delayed" : "upcoming";
    const minutesToStart = timeline?.minutesToStart ?? Math.round((new Date(next.startAt).getTime() - (input.now || new Date()).getTime()) / 60000);
    return {
      mode, tone: delayed ? "amber" : waiting ? "sage" : "neutral", eyebrow: waiting ? "Appointment waiting" : delayed ? "Running late" : "Next appointment",
      title: "Assigned appointment", detail: `${(next.serviceNames || []).join(", ") || "Service"} · ${next.durationMinutes || 0} min`,
      meta: delayed ? `${timeLabel(next.startAt)} · ${compactDurationLabel(Math.abs(minutesToStart))} late` : waiting ? timeLabel(next.startAt) : `${timeLabel(next.startAt)} · ${minutesUntilLabel(minutesToStart)}`,
      status: statusLabel(next.status), actions: appointmentActions(input, next, mode), queueRoute: input.hasPermission("read:appointments") && input.hasPermission("read:staff") ? "/staff/queue" : undefined
    };
  }
  return {
    mode: "empty", tone: "neutral", eyebrow: "Next appointment", title: "No appointment waiting right now.", detail: "", meta: "Schedule clear", actions: [],
    queueRoute: input.hasPermission("read:appointments") && input.hasPermission("read:staff") ? "/staff/queue" : undefined,
    scheduleRoute: input.hasPermission("read:appointments") ? "/staff/appointments" : undefined,
    scheduleActionLabel: input.hasPermission("read:appointments") ? "View Schedule →" : undefined
  };
}

function statusLabel(value: string): string {
  const text = String(value || "scheduled").trim().replace(/[_-]+/g, " ");
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hero(input: ActionContext, activeAlerts: DashboardAlert[]): StaffDashboardViewModel["hero"] {
  const schedules = Array.isArray(input.today?.schedules) ? input.today.schedules : [];
  const shift = schedules[0];
  const shiftText = shift ? `${shift.startTime || "--"}–${shift.endTime || "--"}` : "";
  const canClock = ATTENDANCE_PERMISSIONS.some(input.hasPermission);
  const canOpenAttendance = [...ATTENDANCE_PERMISSIONS, "read:staff"].some(input.hasPermission);
  let title = "Your day is ready";
  let detail = "";
  let hint = "";
  let eyebrow = "Today";
  const actions: DashboardAction[] = [];
  if (activeAlerts.some((item) => item.tone === "critical")) {
    title = "The floor needs attention"; detail = activeAlerts[0].detail; actions.push({ id: "urgent", label: "Review urgent items", route: activeAlerts[0].route, primary: true });
  } else if (input.staleOpenAttendance) {
    eyebrow = "Needs attention";
    title = "Clock needs owner approval";
    detail = "Your last shift wasn’t clocked out";
    hint = "Ask your owner to close it, then you can clock in fresh.";
    if (canOpenAttendance) actions.push({ id: "attendance-details", label: "Attendance", route: "/staff/attendance", primary: true });
  } else if (input.openAttendance) {
    eyebrow = "Clocked in";
    title = "You're clocked in";
    detail = `Clocked in at ${timeLabel(input.openAttendance.clockInAt)}`;
    if (input.today?.activeBreak && canClock) {
      actions.push({ id: "end-break", label: "End break", kind: "end-break", primary: true });
    } else if (canClock) {
      actions.push({ id: "clock-out", label: "Clock Out", kind: "clock", primary: true });
    }
    if (canOpenAttendance) actions.push({ id: "attendance-details", label: "Attendance", route: "/staff/attendance" });
  } else if (input.shiftCompleted) {
    title = "Your shift is complete"; detail = "Today’s attendance has been recorded.";
    if (input.hasPermission("read:appointments")) actions.push({ id: "schedule", label: "Today’s Schedule", route: "/staff/appointments", primary: true });
  } else {
    if (shift && canClock) {
      title = "Ready to start your shift? 👋";
      detail = "Not clocked in";
      actions.push({ id: "attendance", label: "Clock In", kind: "clock", primary: true });
    } else if (!shift && canClock) {
      title = "Ready to start? 👋";
      detail = "No shift assigned today";
      hint = "You can still clock in if required.";
      actions.push({ id: "attendance", label: "Clock In", kind: "clock", primary: true });
    } else if (!shift) {
      title = "No shift assigned today";
      hint = "Check today’s schedule or contact your manager.";
    } else {
      title = "Your shift is scheduled";
      detail = "Not clocked in";
    }
    if (input.hasPermission("read:appointments")) actions.push({ id: "schedule", label: "Today’s Schedule", route: "/staff/appointments", primary: !actions.length });
  }
  if (!actions.length && input.hasPermission("read:appointments")) actions.push({ id: "appointments", label: "Today’s Schedule", route: "/staff/appointments", primary: true });
  return { eyebrow, title, detail, hint, shift: shiftText, shiftAssigned: !!shift, actions: actions.slice(0, 2) };
}

function roleProfile(input: DashboardViewModelInput): DashboardRoleProfile {
  const role = String(input.user?.role || "").replace(/[\s_-]/g, "").toLowerCase();
  return ROLE_PROFILES.find((profile) => profile.aliases.includes(role)) || DEFAULT_ROLE_PROFILE;
}

function orderByIds<T>(items: readonly T[], preferred: readonly string[], id: (item: T) => string): T[] {
  return items.map((item, index) => ({ item, index, preferredIndex: preferred.indexOf(id(item)) }))
    .sort((left, right) => (left.preferredIndex < 0 ? 999 : left.preferredIndex) - (right.preferredIndex < 0 ? 999 : right.preferredIndex) || left.index - right.index)
    .map(({ item }) => item);
}

function orderedTools(input: DashboardViewModelInput): DashboardTool[] {
  const permitted = TOOLS.filter((entry) => allowed(entry, input)).map((entry) => entry.item);
  return orderByIds(permitted, roleProfile(input).tools, (item) => item.id);
}

function sameAction(left: DashboardAction, right: DashboardAction): boolean {
  if (left.id === right.id) return true;
  if (!left.route || !right.route) return false;
  const routeKey = (route: string | readonly string[]) => Array.isArray(route) ? route.join("/") : route;
  return routeKey(left.route) === routeKey(right.route);
}

function normalizedRecommendationValue(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function shouldShowDashboardRecommendation(state: DashboardRecommendationState): boolean {
  if (!state.identity || !state.hintsEnabled || state.dismissedIdentity === state.identity || state.hasPartialWarning) return false;
  const primary = state.hero.actions.find((action) => action.primary) || state.hero.actions[0];
  if (!primary) return true;
  const actionIdentity = [primary.id, primary.appointmentId || "", primary.route || "", state.hero.title || ""].join(":");
  const recommendationText = normalizedRecommendationValue(state.text);
  return state.identity !== actionIdentity
    && recommendationText !== normalizedRecommendationValue(state.hero.title)
    && recommendationText !== normalizedRecommendationValue(primary.label);
}

function quickActionStatus(id: string, input: ActionContext): string | undefined {
  const summary = input.dashboard.summary || {};
  if (id === "appointments") return summary.todayAppointments ? `${summary.todayAppointments} today` : "No bookings";
  if (id === "queue") return summary.liveAppointments ? `${summary.liveAppointments} live` : "No live services";
  if (id === "tasks") return input.openTaskCount ? `${input.openTaskCount} pending` : "All clear";
  if (id === "attendance") return input.today?.activeBreak ? "On break" : input.staleOpenAttendance ? "Needs owner" : input.openAttendance ? "Clocked in" : input.shiftCompleted ? "Shift complete" : "Not clocked in";
  if (id === "calendar") return "View shifts";
  return undefined;
}

export function buildStaffDashboardViewModel(input: DashboardViewModelInput): StaffDashboardViewModel {
  const ctx = context(input);
  const activeAlerts = alerts(ctx);
  const dashboardTools = orderedTools(input).slice(0, 6).map((item) => {
    if (item.id === "leave") return { ...item, hint: `${(Array.isArray(input.leaveBalances) ? input.leaveBalances : []).reduce((sum, balance) => sum + Number(balance?.balance || 0), 0)} days available` };
    if (item.id === "reports") return { ...item, hint: `${input.dashboard?.summary?.completedAppointments || 0} completed today` };
    if (item.id === "calendar" && input.overtime) return { ...item, hint: `${durationLabel(input.overtime?.weekMinutes || 0)} overtime this week` };
    return item;
  });
  const heroModel = hero(ctx, activeAlerts);
  const quick = QUICK_ACTIONS
    .filter((entry) => allowed(entry, ctx))
    .map((entry) => {
      if (entry.item.id === "attendance") {
        if (ctx.staleOpenAttendance) {
          return { ...entry.item, label: "Attendance", kind: undefined, route: "/staff/attendance", status: quickActionStatus(entry.item.id, ctx) };
        }
        if (!ctx.openAttendance && (ctx.shiftCompleted || !!ctx.today?.activeBreak)) {
          return { ...entry.item, label: "Attendance", kind: undefined, route: "/staff/attendance", status: quickActionStatus(entry.item.id, ctx) };
        }
        return { ...entry.item, label: ctx.openAttendance ? "Clock out" : "Clock in", kind: "clock" as DashboardActionKind, status: quickActionStatus(entry.item.id, ctx) };
      }
      return { ...entry.item, status: quickActionStatus(entry.item.id, ctx) };
    })
    .filter((action) => !heroModel.actions.some((heroAction) => heroAction.primary && sameAction(action, heroAction)));
  const overview: DashboardMetric[] = [
    { label: "Appointments", value: String(input.dashboard?.summary?.todayAppointments || 0), hint: input.dashboard?.summary?.todayAppointments ? "Assigned today" : "No bookings", route: "/staff/appointments" }
  ];
  if (input.hasPermission("read:staff")) overview.push(
    { label: "Completed", value: String(input.dashboard?.summary?.completedAppointments || 0), hint: input.dashboard?.summary?.completedAppointments ? "Services finished" : "No services finished", route: "/staff/reports" },
    { label: "Open tasks", value: String(ctx.openTaskCount), hint: ctx.openTaskCount ? "Needs follow-up" : "All clear", route: "/staff/tasks" }
  );
  if (input.enterprise && input.hasPermission("read:appointments")) {
    const unread = (input.enterprise.notifications || []).filter((note) => String(note?.status || "unread") !== "read").length;
    overview.push({ label: "Alerts", value: String(activeAlerts.length), hint: activeAlerts.length ? `${unread || activeAlerts.length} to review` : "No alerts", route: "/staff/notifications" });
  }
  const orderedOverview = orderByIds(overview, roleProfile(input).overview, (metric) => metric.label);
  const performance: DashboardMetric[] = [];
  if (input.hasPermission("read:staff") && input.enterprise?.performance) {
    const perf = input.enterprise.performance;
    performance.push(
      { label: "Productivity", value: `${perf.productivityScore || 0}/100`, hint: "Current score", progress: perf.productivityScore || 0, progressLabel: `Productivity ${perf.productivityScore || 0} out of 100`, explanation: "Productivity uses the average connected daily score; completed services provide the fallback when daily records are unavailable." },
      { label: "Services", value: String(perf.completedServices || input.dashboard?.summary?.completedAppointments || 0), hint: "Completed" },
      { label: "Utilization", value: `${perf.avgUtilization || 0}%`, hint: "Average utilization", progress: perf.avgUtilization || 0, progressLabel: `Utilization ${perf.avgUtilization || 0} percent` }
    );
  }
  if (FINANCIAL_PERMISSIONS.some(input.hasPermission)) {
    const value = input.dashboard?.summary?.revenue;
    if (Number.isSafeInteger(value) && value >= 0) performance.push({ label: "Revenue", value: formatPaiseInr(value), hint: "Today’s sales", route: "/staff/business" });
  }
  const performanceOrder = ["Revenue", "Productivity", "Services", ...roleProfile(input).performance];
  const orderedPerformance = orderByIds(performance, performanceOrder, (metric) => metric.label).slice(0, 3).map((metric) => ({
    ...metric,
    progress: metric.progress === undefined ? undefined : Math.min(100, Math.max(0, Number(metric.progress) || 0))
  }));
  const workItem = work(ctx);
  const quickActions = orderByIds(quick, roleProfile(input).quick, (action) => action.id).slice(0, 4);
  return {
    hero: heroModel, quickActions, overview: orderedOverview.slice(0, 4), work: workItem, alerts: activeAlerts,
    performanceRoute: input.hasPermission("read:staff") ? "/staff/performance" : undefined,
    performance: orderedPerformance, tools: dashboardTools
  };
}

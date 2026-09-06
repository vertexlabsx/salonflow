import { Component, OnDestroy, computed, effect, signal, untracked } from "@angular/core";
import { DecimalPipe } from "@angular/common";
import { Router } from "@angular/router";
import { PaiseInrPipe, formatPaiseInr } from "../../core/paise-inr.pipe";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import {
  OwnerActionItem,
  OwnerBranchComparisonValue,
  OwnerDashboardComparisonValue,
  OwnerDashboardDestination,
  OwnerDashboardFilterValue,
  OwnerDashboardKpi,
  OwnerDashboardKpis,
  OwnerDashboardResponse,
  OwnerDashboardSummary,
  OwnerDashboardTrend,
  OwnerRevenueAggregates
} from "./owner-dashboard.models";
import { OwnerDashboardItemComponent, OwnerKpiCardComponent, OwnerRevenueChartComponent, OwnerStatusBadgeComponent } from "./owner-dashboard.components";

type KpiKey = keyof OwnerDashboardKpis;
type AggregateKey = keyof OwnerRevenueAggregates;
type SummaryKey = "positive" | "attention" | "operational";

interface KpiDefinition { key: KpiKey; label: string; route: string; filters: { [key: string]: OwnerDashboardFilterValue }; }
interface AggregateDefinition { key: AggregateKey; label: string; }

const KPI_DEFINITIONS: KpiDefinition[] = [
  { key: "netRevenuePaise", label: "Net revenue", route: "/owner/revenue", filters: { metric: "netRevenue" } },
  { key: "grossSalesPaise", label: "Gross sales", route: "/owner/revenue", filters: { metric: "grossSales" } },
  { key: "appointments", label: "Appointments", route: "/owner/appointments", filters: {} },
  { key: "completedAppointments", label: "Completed", route: "/owner/appointments", filters: { status: "completed" } },
  { key: "newClients", label: "New clients", route: "/owner/clients", filters: { relationship: "new" } },
  { key: "returningClients", label: "Returning clients", route: "/owner/clients", filters: { relationship: "returning" } },
  { key: "averageBillPaise", label: "Average bill", route: "/owner/reports", filters: {} },
  { key: "outstandingPaise", label: "Outstanding", route: "/owner/revenue", filters: { metric: "outstanding" } }
];

const AGGREGATE_DEFINITIONS: AggregateDefinition[] = [
  { key: "grossSalesPaise", label: "Gross sales" }, { key: "netRevenuePaise", label: "Net revenue" },
  { key: "discountsPaise", label: "Discounts" }, { key: "taxesPaise", label: "Taxes" },
  { key: "outstandingPaise", label: "Outstanding" }, { key: "refundsPaise", label: "Refunds" },
  { key: "serviceRevenuePaise", label: "Service revenue" }, { key: "productRevenuePaise", label: "Product revenue" }
];

const SAFE_OWNER_ROUTES = new Set(["/owner/appointments", "/owner/clients", "/owner/staff", "/owner/attendance", "/owner/leave-requests", "/owner/revenue", "/owner/reports", "/owner/payroll", "/owner/inventory", "/owner/billing", "/owner/marketing", "/owner/notifications", "/owner/branches", "/owner/settings"]);

@Component({
  standalone: true,
  imports: [DecimalPipe, PaiseInrPipe, OwnerKpiCardComponent, OwnerStatusBadgeComponent, OwnerDashboardItemComponent, OwnerRevenueChartComponent],
  templateUrl: "./owner-dashboard.page.html",
  styleUrls: ["./owner-shell.styles.css", "./owner-dashboard.page.css"]
})
export class OwnerDashboardPage implements OnDestroy {
  readonly data = signal<OwnerDashboardResponse | null>(null);
  readonly loading = signal(false);
  readonly blockingError = signal("");
  readonly refreshError = signal("");
  readonly showAllMetrics = signal(false);
  readonly expandedActions = signal(false);
  readonly realtimeConnected = signal(false);
  readonly kpiDefinitions = KPI_DEFINITIONS;
  readonly aggregateDefinitions = AGGREGATE_DEFINITIONS;
  readonly summaryGroups: Array<{ key: SummaryKey; label: string; description: string }> = [
    { key: "positive", label: "Positive changes", description: "Measured improvements against the previous period." },
    { key: "attention", label: "Attention required", description: "Measured conditions that need owner review." },
    { key: "operational", label: "Operational status", description: "Recorded operating conditions for this context." }
  ];
  readonly hasData = computed(() => this.data() !== null);
  readonly backgroundRefreshing = computed(() => this.loading() && this.hasData());
  readonly sortedActions = computed(() => [...(this.data()?.actionCentre.items || [])].sort((a, b) => this.severityWeight(a.severity) - this.severityWeight(b.severity) || String(a.relevantDate || "9999").localeCompare(String(b.relevantDate || "9999"))));
  readonly visibleActions = computed(() => this.sortedActions().slice(0, this.expandedActions() ? 24 : 6));
  readonly visibleStaff = computed(() => (this.data()?.staffOperations.staff || []).slice(0, 4));
  readonly unavailableActionCategories = computed(() => Object.entries(this.data()?.actionCentre.categories || {}).filter(([, category]) => !category.available));
  readonly showBranchComparison = computed(() => !this.context.selectedBranchId() && (this.data()?.branchComparison.branches.length || 0) > 1);
  readonly dailyTargetPaise = 3500000;
  readonly revenueTargetPercent = computed(() => {
    const current = this.data()?.kpis?.netRevenuePaise?.current || 0;
    if (!current) return 0;
    return Math.min(100, Math.round((current / this.dailyTargetPaise) * 100));
  });
  readonly occupancyPercent = computed(() => {
    const total = this.data()?.kpis?.appointments?.current || 0;
    const completed = this.data()?.kpis?.completedAppointments?.current || 0;
    if (!total) return 0;
    return Math.min(100, Math.round((completed / total) * 100));
  });
  readonly serviceRevenuePercent = computed(() => {
    const gross = this.data()?.revenue?.aggregates?.grossSalesPaise?.current || 1;
    const service = this.data()?.revenue?.aggregates?.serviceRevenuePaise?.current || 0;
    if (!gross) return 0;
    return Math.min(100, Math.round((service / gross) * 100));
  });
  readonly productRevenuePercent = computed(() => {
    const gross = this.data()?.revenue?.aggregates?.grossSalesPaise?.current || 1;
    const product = this.data()?.revenue?.aggregates?.productRevenuePaise?.current || 0;
    if (!gross) return 0;
    return Math.min(100, Math.round((product / gross) * 100));
  });
  private requestId = 0;
  private socket: WebSocket | null = null;
  private reconnectTimer = 0;
  private realtimeBranch = "";
  private destroyed = false;

  constructor(readonly owner: OwnerAppService, readonly context: OwnerContextService, private readonly router: Router) {
    effect(() => {
      const branchId = this.context.selectedBranchId() || "all";
      const range = this.context.period();
      const dates = this.context.periodRange();
      untracked(() => { void this.connectRealtime(branchId); void this.load({ branchId, range, ...(range === "custom" ? { from: dates.start, to: dates.end } : {}) }); });
    });
  }

  ngOnDestroy(): void { this.destroyed = true; window.clearTimeout(this.reconnectTimer); this.socket?.close(); }

  refresh(): void {
    if (this.loading()) return;
    const range = this.context.period(); const dates = this.context.periodRange();
    void this.load({ branchId: this.context.selectedBranchId() || "all", range, ...(range === "custom" ? { from: dates.start, to: dates.end } : {}) });
  }

  metric(key: KpiKey): OwnerDashboardKpi | null { return this.data()?.kpis[key] || null; }
  aggregate(key: AggregateKey): OwnerDashboardComparisonValue | null { return this.data()?.revenue.aggregates[key] || null; }
  summaries(key: SummaryKey): OwnerDashboardSummary[] { return this.data()?.summaries[key] || []; }
  ownerGreeting(): string { return String(this.owner.user()?.name || "Owner").trim().split(/\s+/)[0] || "Owner"; }
  generatedLabel(): string { return this.dateTime(this.data()?.context.generatedAt); }
  branchName(branchId: string): string { return this.data()?.context.accessibleBranches.find((branch) => branch.id === branchId)?.name || branchId; }
  initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "—"; }
  humanize(value: string): string { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
  statusLabel(value: string): string { return value === "clockedIn" ? "Clocked in" : value === "scheduledWithAppointments" ? "Scheduled · booked" : value === "scheduled" ? "Scheduled" : "Status unavailable"; }
  formatDate(value: string | null | undefined): string { if (!value) return "Date not supplied"; const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(this.context.effectiveLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: value.length === 10 ? "UTC" : this.context.effectiveTimezone() }).format(date); }
  formatHour(value: string): string { const [hour] = value.split(":").map(Number); if (!Number.isFinite(hour)) return value; return new Intl.DateTimeFormat(this.context.effectiveLocale(), { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, hour))); }
  trendLabel(trend: OwnerDashboardTrend): string { return trend === "positive" ? "Increased" : trend === "negative" ? "Decreased" : trend === "flat" ? "No change" : "Comparison unavailable"; }
  comparisonText(metric: OwnerDashboardComparisonValue): string { if (!metric.availability.available) return metric.availability.reason || "Unavailable"; if (!metric.comparisonAvailable || metric.previous === null) return "Previous comparison unavailable"; const delta = metric.percentDelta === null ? this.value(metric.absoluteDelta, metric.unit) : `${Math.abs(metric.percentDelta).toLocaleString(this.context.effectiveLocale(), { maximumFractionDigits: 1 })}%`; return `${this.trendLabel(metric.trend)} ${delta} · previous ${this.value(metric.previous, metric.unit)}`; }
  summaryValue(row: OwnerDashboardSummary): string { return this.value(row.currentValue, row.metricKey.toLowerCase().includes("paise") ? "paise" : "count"); }
  summaryMeta(row: OwnerDashboardSummary): string { return row.comparisonValue === null ? "Measured in the selected period" : `Previous ${this.value(row.comparisonValue, row.metricKey.toLowerCase().includes("paise") ? "paise" : "count")}`; }
  actionValue(item: OwnerActionItem): string { if (item.valuePaise !== undefined) return formatPaiseInr(item.valuePaise); if (item.value !== undefined && item.threshold !== undefined) return `${item.value.toLocaleString(this.context.effectiveLocale())} · threshold ${item.threshold.toLocaleString(this.context.effectiveLocale())}`; return item.value !== undefined ? item.value.toLocaleString(this.context.effectiveLocale()) : ""; }
  actionMeta(item: OwnerActionItem): string { return [this.branchName(item.branchId), item.relevantDate ? this.formatDate(item.relevantDate) : "Date not supplied"].join(" · "); }
  branchMetric(row: OwnerBranchComparisonValue): string { return row.availability.available && row.current !== null ? this.value(row.current, row.unit) : "Unavailable"; }
  branchMetricNote(row: OwnerBranchComparisonValue): string { return row.availability.available ? this.comparisonText(row) : row.availability.reason || "Metric unavailable"; }

  openKpi(definition: KpiDefinition): void { this.openDestination({ route: definition.route, filters: this.withCurrentContext(definition.filters) }); }
  openAppointments(filters: { [key: string]: OwnerDashboardFilterValue } = {}): void { this.openDestination({ route: "/owner/appointments", filters: this.withCurrentContext(filters) }); }
  openStaff(): void { this.openDestination({ route: "/owner/staff", filters: this.withCurrentContext({}) }); }
  openDestination(destination: OwnerDashboardDestination): void {
    if (!SAFE_OWNER_ROUTES.has(destination.route)) return;
    const queryParams = this.safeQueryParams(destination.filters);
    const commands = destination.route.split("/").filter(Boolean);
    void this.router.navigate(commands, { queryParams });
  }

  private async load(params: { branchId: string; range: string; from?: string; to?: string }): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true); this.blockingError.set(""); this.refreshError.set("");
    try {
      const response = await this.owner.dashboard(params);
      if (id !== this.requestId) return;
      this.data.set(response);
      this.expandedActions.set(false);
      this.context.markSuccessfulRefresh();
    } catch {
      if (id !== this.requestId) return;
      if (!this.data()) this.blockingError.set("The owner dashboard could not be loaded. Check the connection and try again.");
      else this.refreshError.set("The latest refresh failed. Previously loaded data remains visible.");
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  private withCurrentContext(filters: { [key: string]: OwnerDashboardFilterValue }): { [key: string]: OwnerDashboardFilterValue } {
    const range = this.data()?.context.currentRange;
    return { ...filters, branchId: this.context.selectedBranchId() || "all", ...(range ? { from: range.from, to: range.to } : {}) };
  }
  private safeQueryParams(filters: { [key: string]: OwnerDashboardFilterValue }): { [key: string]: string | number | boolean | string[] | number[] } {
    const safe: { [key: string]: string | number | boolean | string[] | number[] } = {};
    for (const [key, value] of Object.entries(filters)) {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || /^(apiRoute|sourceRoute|trace|tenantId)$/i.test(key) || value === null) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") safe[key] = value;
      else if (Array.isArray(value)) {
        const strings = value.filter((entry): entry is string => typeof entry === "string");
        const numbers = value.filter((entry): entry is number => typeof entry === "number");
        if (strings.length === value.length) safe[key] = strings;
        else if (numbers.length === value.length) safe[key] = numbers;
      }
    }
    return safe;
  }
  private value(value: number | null, unit: string): string { if (value === null) return "Unavailable"; return unit === "paise" ? formatPaiseInr(value) : value.toLocaleString(this.context.effectiveLocale()); }
  private dateTime(value?: string): string { if (!value) return "Not refreshed"; return this.context.formatDateTime(value); }
  private severityWeight(value: string): number { return value === "critical" ? 0 : value === "attention" || value === "warning" ? 1 : 2; }
  private async connectRealtime(branchId: string): Promise<void> {
    if (this.destroyed || (this.realtimeBranch === branchId && this.socket && ([WebSocket.CONNECTING, WebSocket.OPEN] as number[]).includes(this.socket.readyState))) return;
    this.realtimeBranch = branchId; window.clearTimeout(this.reconnectTimer); this.socket?.close();
    try {
      const socket = new WebSocket(await this.owner.realtimeSocketTicketUrl(branchId));
      this.socket = socket;
      socket.onopen = () => this.realtimeConnected.set(true);
      socket.onmessage = (event) => {
        let frame: { type?: string } = {};
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (["staff:clocked_in", "staff:clocked_out", "staff:break_started", "staff:break_ended", "staff.status"].includes(frame.type || "")) this.refresh();
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => { this.realtimeConnected.set(false); if (!this.destroyed) this.reconnectTimer = window.setTimeout(() => void this.connectRealtime(this.realtimeBranch), 5000); };
    } catch { if (!this.destroyed) this.reconnectTimer = window.setTimeout(() => void this.connectRealtime(this.realtimeBranch), 5000); }
  }
}

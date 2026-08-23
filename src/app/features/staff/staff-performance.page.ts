import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

const DEFAULT_REPORT_ITEM = { days: 0, revenue: 0, services: 0, productivityScore: 0, rating: 0 };
const DEFAULT_ENTERPRISE_OS: StaffEnterpriseOs = {
  staff: { id: "", fullName: "Staff Member", firstName: "Staff", lastName: "Member", mobile: "", email: "", roleId: "staff", department: "", designation: "", status: "active" },
  home: {
    greeting: "Welcome",
    todayAppointments: 0,
    expectedRevenue: 0,
    tasks: 0,
    pendingPayments: 0,
    recentNotifications: 0,
    targetProgress: { label: "Target", targetValue: 100, achievedValue: 0, percentage: 0, remaining: 100 }
  },
  performance: { productivityScore: 0, completedServices: 0, avgUtilization: 0, avgRating: 0, revenue: 0, strengths: [], opportunities: [] },
  reports: {
    daily: { ...DEFAULT_REPORT_ITEM },
    weekly: { ...DEFAULT_REPORT_ITEM },
    monthly: { ...DEFAULT_REPORT_ITEM },
    yearly: { ...DEFAULT_REPORT_ITEM }
  },
  notifications: [],
  timeline: [],
  serviceTimers: [],
  leaderboard: [],
  gamification: { points: 0, level: 1, stars: 0, dailyStreak: 0, monthlyStreak: 0, badges: [] },
  tasks: [],
  calendar: []
};

@Component({
  standalone: true,
  imports: [PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page"><header class="page-head"><div><p class="eyebrow">Performance</p><h1>Performance intelligence</h1><p>Productivity, utilization, rating and improvement signals.</p></div></header>
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (os(); as data) {
        <section class="grid four"><article class="kpi"><span>Score</span><strong>{{ data.performance.productivityScore }}/100</strong></article><article class="kpi"><span>Services</span><strong>{{ data.performance.completedServices }}</strong></article><article class="kpi"><span>Utilization</span><strong>{{ data.performance.avgUtilization }}%</strong></article><article class="kpi"><span>Rating</span><strong>{{ data.performance.avgRating || '-' }}</strong></article></section>
        <section class="panel"><div class="panel-title"><h2>Trend board</h2><span>daily to yearly</span></div><div class="trend-grid">@for (key of reportKeys(); track key) { <article><span>{{ key }}</span><strong>{{ data.reports[key].productivityScore }}/100</strong><div class="timer-track"><span [style.width.%]="data.reports[key].productivityScore"></span></div><small>{{ data.reports[key].services }} services</small></article> }</div></section>
        <section class="grid two"><article class="panel"><div class="panel-title"><h2>Strengths</h2><span>{{ data.performance.strengths.length }}</span></div>@for (item of data.performance.strengths; track item) { <p class="insight">{{ item }}</p> } @empty { <p class="empty">No specific strengths recorded yet.</p> }</article><article class="panel"><div class="panel-title"><h2>Opportunities</h2><span>{{ data.performance.opportunities.length }}</span></div>@for (item of data.performance.opportunities; track item) { <p class="insight">{{ item }}</p> } @empty { <p class="empty">No active opportunities noted.</p> }</article></section>
        @if (canSeeRevenue()) { <section class="panel"><div class="panel-title"><h2>Revenue impact</h2><span>connected</span></div><h2>{{ data.performance.revenue | paiseInr }}</h2></section> }
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffPerformancePage implements OnInit {
  readonly os = signal<StaffEnterpriseOs>(this.staff.readStoredData<StaffEnterpriseOs>("enterprise-os") || DEFAULT_ENTERPRISE_OS);
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { void this.load(); }
  async load() {
    try {
      const data = await this.staff.enterpriseOs();
      this.os.set(data);
      this.staff.writeStoredData("enterprise-os", data);
    } catch {
      // Backend error signal handled by StaffAppService
    }
  }
  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["read:finance", "read:sales", "read:payments", "read:invoices"]); }
  reportKeys(): Array<"daily" | "weekly" | "monthly" | "yearly"> { return ["daily", "weekly", "monthly", "yearly"]; }
}

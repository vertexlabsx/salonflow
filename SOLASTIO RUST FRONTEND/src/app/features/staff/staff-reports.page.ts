import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffDashboard, StaffEnterpriseOs } from "../../core/staff-app.service";
import { businessDateOffset } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page reports-page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Reports</p>
          <h1>Staff reports</h1>
          <p>Filter your work, appointments, completed services and sales impact.</p>
        </div>
      </header>

      @if (!canReadReports()) { <section staffPageState class="notice">You do not have permission to view reports.</section> }
      @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (canReadReports()) {
        <section class="panel report-period">
          <div class="period-main">
            <div class="period-heading">
              <div>
                <p class="period-kicker">Report Period</p>
                <p class="period-range">{{ fromDate }} <span aria-hidden="true">→</span> {{ toDate }}</p>
              </div>
              <div class="period-chips" role="group" aria-label="Quick report period">
                <button type="button" class="period-chip" [class.active]="selectedPeriod === 'today'" [attr.aria-pressed]="selectedPeriod === 'today'" (click)="selectPeriod('today')">Today</button>
                <button type="button" class="period-chip" [class.active]="selectedPeriod === 'yesterday'" [attr.aria-pressed]="selectedPeriod === 'yesterday'" (click)="selectPeriod('yesterday')">Yesterday</button>
                <button type="button" class="period-chip" [class.active]="selectedPeriod === 'week'" [attr.aria-pressed]="selectedPeriod === 'week'" (click)="selectPeriod('week')">This Week</button>
                <button type="button" class="period-chip" [class.active]="selectedPeriod === 'month'" [attr.aria-pressed]="selectedPeriod === 'month'" (click)="selectPeriod('month')">This Month</button>
                <button type="button" class="period-chip" [class.active]="selectedPeriod === 'custom'" [attr.aria-pressed]="selectedPeriod === 'custom'" (click)="selectPeriod('custom')">Custom</button>
              </div>
            </div>

            @if (selectedPeriod === 'custom') {
              <div class="custom-dates">
                <label>From<input [(ngModel)]="fromDate" type="date" /></label>
                <label>To<input [(ngModel)]="toDate" type="date" /></label>
                <button class="button primary apply-period" type="button" (click)="load()">Apply period</button>
              </div>
            }
          </div>

          <div class="advanced-filters" [class.open]="advancedFiltersOpen">
            <button class="advanced-toggle" type="button" aria-controls="report-advanced-filters" [attr.aria-expanded]="advancedFiltersOpen" (click)="advancedFiltersOpen = !advancedFiltersOpen">
              <span>Advanced Filters</span>
              <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6 8 4 4 4-4" /></svg>
            </button>
            <div id="report-advanced-filters" class="advanced-content" [attr.aria-hidden]="!advancedFiltersOpen" [attr.inert]="advancedFiltersOpen ? null : ''">
              <div class="advanced-grid">
                <label class="search-control">Search
                  <input [(ngModel)]="reportSearch" type="search" placeholder="Search reports..." (focus)="showReportSuggestions = true" (blur)="closeReportSuggestions()" />
                  @if (showReportSuggestions && reportSuggestions.length) {
                    <div class="search-suggestions" role="listbox">
                      @for (suggestion of reportSuggestions; track suggestion) {
                        <button type="button" (mousedown)="$event.preventDefault(); selectReportSuggestion(suggestion)" (click)="selectReportSuggestion(suggestion)">
                          <span>🔍 {{ suggestion }}</span>
                          <small>Report</small>
                        </button>
                      }
                    </div>
                  }
                  <div class="search-chips-row">
                    @for (suggestion of reportSuggestions.slice(0, 4); track suggestion) {
                      <button type="button" class="suggestion-chip" (mousedown)="$event.preventDefault(); selectReportSuggestion(suggestion)" (click)="selectReportSuggestion(suggestion)">
                        <span>🏷️ {{ suggestion }}</span>
                      </button>
                    }
                  </div>
                </label>
                <label>Status<select [(ngModel)]="reportStatus"><option value="all">All statuses</option><option value="completed">Completed</option><option value="live">Live</option></select></label>
                <label>Sort<select [(ngModel)]="reportSort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
                <button class="button primary advanced-apply" type="button" (click)="load()">Apply filters</button>
              </div>
            </div>
          </div>
        </section>
      }

      @if (canReadReports() && dashboard(); as dash) {
        <section class="grid four kpi-grid kpi-grid--operations" aria-label="Appointment report summary">
          <article class="kpi kpi-card">
            <div class="kpi-card__head"><span class="kpi-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></svg></span><span>Appointments</span></div>
            <div class="kpi-card__value"><strong>{{ dash.summary.appointments }}</strong><span class="kpi-card__trend" aria-hidden="true"><i></i><i></i><i></i></span></div>
            <small>{{ dash.summary.todayAppointments }} in selected day</small>
          </article>
          <article class="kpi kpi-card">
            <div class="kpi-card__head"><span class="kpi-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 12 3 3 7-7M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" /></svg></span><span>Completed</span></div>
            <div class="kpi-card__value"><strong>{{ dash.summary.completedAppointments }}</strong><span class="kpi-card__trend" aria-hidden="true"><i></i><i></i><i></i></span></div>
            <small>finished services</small>
          </article>
          <article class="kpi kpi-card">
            <div class="kpi-card__head"><span class="kpi-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" /></svg></span><span>Live</span></div>
            <div class="kpi-card__value"><strong>{{ dash.summary.liveAppointments }}</strong><span class="kpi-card__trend" aria-hidden="true"><i></i><i></i><i></i></span></div>
            <small>active/current</small>
          </article>
          <article class="kpi kpi-card">
            <div class="kpi-card__head"><span class="kpi-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16v11H4zM16 11h4M7 7V5h10v2" /></svg></span><span>Value</span></div>
            <div class="kpi-card__value"><strong>{{ dash.summary.appointmentValue | paiseInr }}</strong><span class="kpi-card__trend" aria-hidden="true"><i></i><i></i><i></i></span></div>
            <small>appointment value</small>
          </article>
        </section>

        @if (canSeeRevenue()) {
          <section class="grid three kpi-grid kpi-grid--finance" aria-label="Sales report summary">
            <article class="kpi kpi-card">
              <div class="kpi-card__head"><span class="kpi-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 7h14l-1 12H6L5 7ZM9 9V6a3 3 0 0 1 6 0v3" /></svg></span><span>Sales</span></div>
              <div class="kpi-card__value"><strong>{{ dash.summary.salesCount }}</strong><span class="kpi-card__trend" aria-hidden="true"><i></i><i></i><i></i></span></div>
              <small>visible sales records</small>
            </article>
            <article class="kpi kpi-card kpi-card--revenue">
              <div class="kpi-card__head"><span class="kpi-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 5h10M7 9h10M8 5c5 0 5 7 0 7h1l7 7" /></svg></span><span>Revenue</span></div>
              <div class="kpi-card__value"><strong>{{ dash.summary.revenue | paiseInr }}</strong><span class="kpi-card__trend" aria-hidden="true"><i></i><i></i><i></i></span></div>
              <small>connected sales</small>
            </article>
            <article class="kpi kpi-card">
              <div class="kpi-card__head"><span class="kpi-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19 19 5M7.5 5.5h.01M16.5 18.5h.01M9 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM18 18.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" /></svg></span><span>Avg sale</span></div>
              <div class="kpi-card__value"><strong>{{ averageSale() | paiseInr }}</strong><span class="kpi-card__trend" aria-hidden="true"><i></i><i></i><i></i></span></div>
              <small>revenue per sale</small>
            </article>
          </section>
        }
      }

      @if (canReadReports() && os(); as data) {
        <section class="panel">
          <div class="panel-title"><h2>Performance trend</h2><span>daily to yearly</span></div>
          <div class="trend-grid">
            @for (key of reportKeys(); track key) {
              <article><span>{{ key }}</span><strong>{{ data.reports[key].productivityScore }}/100</strong><div class="timer-track"><span [style.width.%]="data.reports[key].productivityScore"></span></div><small>{{ data.reports[key].services }} services · {{ data.reports[key].rating || 0 }} rating</small></article>
            }
          </div>
        </section>
      }

      @if (canReadReports() && dashboard(); as dash) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Work report</h2><span>{{ dash.workReport.length }}</span></div>
            <div class="list">
              @for (item of dash.workReport.slice(0, 30); track item.id) {
                <div class="row"><div class="row-main"><strong>Assigned appointment</strong><small>{{ item.startAt | date:'medium' }} · {{ item.serviceNames.join(', ') || 'Service' }}</small></div><span class="badge">{{ item.status }}</span></div>
              } @empty { <p class="empty">No completed work in this report window.</p> }
            </div>
          </article>
          @if (canSeeRevenue()) {
            <article class="panel">
              <div class="panel-title"><h2>Sales</h2><span>{{ dash.sales.length }}</span></div>
              <div class="list">
                @for (sale of dash.sales.slice(0, 30); track sale.id) {
                  <div class="row"><div class="row-main"><strong>{{ sale.total | paiseInr }}</strong><small>{{ sale.createdAt | date:'short' }} · commission {{ sale.commissionTotal | paiseInr }}</small></div><span class="badge">{{ sale.status }}</span></div>
                } @empty { <p class="empty">No sales entries visible.</p> }
              </div>
            </article>
          }
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .report-period {
      padding: 0;
      overflow: hidden;
      border-color: rgba(255, 255, 255, .09);
      background: linear-gradient(145deg, rgba(27, 29, 34, .96), rgba(19, 20, 24, .98));
    }
    .grid.kpi-grid { gap: 12px; }
    .grid.kpi-grid--finance { grid-template-columns: minmax(0, .9fr) minmax(0, 1.35fr) minmax(0, .9fr); }
    .kpi-card {
      position: relative;
      display: flex;
      min-width: 0;
      min-height: 146px;
      flex-direction: column;
      justify-content: space-between;
      gap: 13px;
      padding: 17px 18px 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, .085);
      border-radius: 16px;
      background: #1b1c20;
      box-shadow: 0 14px 32px rgba(0, 0, 0, .12);
      transition: transform .42s ease-out, border-color .42s ease-out, background-color .42s ease-out, box-shadow .42s ease-out;
    }
    .kpi-card::after {
      position: absolute;
      inset: auto 18px 0;
      height: 1px;
      content: "";
      background: rgba(215, 180, 116, .28);
      transform: scaleX(.36);
      transform-origin: left;
      transition: transform .48s ease-out, background-color .48s ease-out;
    }
    .kpi-card:hover {
      border-color: rgba(215, 180, 116, .25);
      background: #1e1f23;
      box-shadow: 0 18px 38px rgba(0, 0, 0, .2);
      transform: translateY(-3px);
    }
    .kpi-card:hover::after { background: rgba(215, 180, 116, .6); transform: scaleX(1); }
    .kpi-card:active { transform: translateY(-1px) scale(.99); transition-duration: .16s; }
    .kpi-card__head { display: flex; align-items: center; gap: 9px; color: rgba(255, 255, 255, .62); font-size: .73rem; font-weight: 700; letter-spacing: .055em; text-transform: uppercase; }
    .kpi-card__icon { display: grid; width: 27px; height: 27px; flex: 0 0 auto; place-items: center; border: 1px solid rgba(215, 180, 116, .2); border-radius: 8px; color: #d7b474; background: rgba(215, 180, 116, .065); }
    .kpi-card__icon svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
    .kpi-card__value { display: flex; min-width: 0; align-items: flex-end; justify-content: space-between; gap: 10px; }
    .kpi-card__value strong { min-width: 0; color: #faf7f0; font-size: clamp(1.65rem, 2.4vw, 2.2rem); font-weight: 680; line-height: .98; letter-spacing: -.045em; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
    .kpi-card small { color: rgba(255, 255, 255, .46); font-size: .72rem; line-height: 1.35; }
    .kpi-card__trend { display: flex; height: 15px; flex: 0 0 auto; align-items: center; gap: 3px; padding: 0 5px; border: 1px solid rgba(255, 255, 255, .075); border-radius: 999px; }
    .kpi-card__trend i { width: 3px; height: 3px; border-radius: 50%; background: rgba(215, 180, 116, .64); }
    .kpi-card--revenue { min-height: 162px; padding: 20px 21px 18px; border-color: rgba(215, 180, 116, .3); background: #211f1b; box-shadow: 0 18px 42px rgba(0, 0, 0, .2); }
    .kpi-card--revenue::before { position: absolute; inset: 0 auto 0 0; width: 2px; content: ""; background: #d7b474; }
    .kpi-card--revenue .kpi-card__head { color: rgba(246, 229, 195, .78); }
    .kpi-card--revenue .kpi-card__icon { color: #f0cf91; border-color: rgba(240, 207, 145, .3); background: rgba(240, 207, 145, .09); }
    .kpi-card--revenue .kpi-card__value strong { color: #fffaf0; font-size: clamp(2rem, 3.2vw, 2.8rem); }
    .period-main { padding: 16px 18px 14px; }
    .period-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    .period-kicker { margin: 0; color: #f6f1e8; font-size: .82rem; font-weight: 700; letter-spacing: .04em; }
    .period-range { margin: 3px 0 0; color: rgba(255, 255, 255, .52); font-size: .75rem; font-variant-numeric: tabular-nums; }
    .period-range span { color: rgba(207, 169, 104, .78); padding: 0 3px; }
    .period-chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .period-chip {
      min-height: 44px;
      padding: 0 14px;
      border: 1px solid rgba(255, 255, 255, .09);
      border-radius: 999px;
      color: rgba(255, 255, 255, .68);
      background: rgba(255, 255, 255, .035);
      font: inherit;
      font-size: .8rem;
      font-weight: 650;
      cursor: pointer;
      transition: color .35s ease, border-color .35s ease, background-color .35s ease, transform .35s ease;
    }
    .period-chip:hover { color: #fff; border-color: rgba(207, 169, 104, .4); transform: translateY(-1px); }
    .period-chip.active { color: #18140d; border-color: #d7b474; background: #d7b474; box-shadow: 0 6px 18px rgba(191, 145, 67, .15); }
    .period-chip:focus-visible, .advanced-toggle:focus-visible { outline: 2px solid #e4c58d; outline-offset: 3px; }
    .custom-dates { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr) auto; align-items: end; gap: 10px; padding-top: 14px; animation: period-reveal .42s ease-out both; }
    .custom-dates label, .advanced-grid label { display: grid; gap: 6px; color: rgba(255, 255, 255, .58); font-size: .72rem; font-weight: 650; }
    .custom-dates input, .advanced-grid input, .advanced-grid select {
      box-sizing: border-box;
      width: 100%;
      min-height: 44px;
      padding: 0 12px;
      border: 1px solid rgba(255, 255, 255, .1);
      border-radius: 11px;
      color: #f7f2e9;
      background: rgba(255, 255, 255, .045);
      color-scheme: dark;
      font: inherit;
    }
    .custom-dates input:focus, .advanced-grid input:focus, .advanced-grid select:focus { outline: 2px solid rgba(228, 197, 141, .75); outline-offset: 1px; border-color: transparent; }
    .apply-period, .advanced-apply { min-height: 44px; white-space: nowrap; }
    .advanced-filters { border-top: 1px solid rgba(255, 255, 255, .075); background: rgba(0, 0, 0, .1); }
    .advanced-toggle {
      display: flex;
      width: 100%;
      min-height: 44px;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      border: 0;
      color: rgba(255, 255, 255, .65);
      background: transparent;
      font: inherit;
      font-size: .77rem;
      font-weight: 650;
      cursor: pointer;
    }
    .advanced-toggle:hover { color: #f6f1e8; }
    .advanced-toggle svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; transition: transform .35s ease-out; }
    .advanced-filters.open .advanced-toggle svg { transform: rotate(180deg); }
    .advanced-content { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .42s ease-out, opacity .3s ease-out; }
    .advanced-content > div { overflow: hidden; }
    .advanced-filters.open .advanced-content { grid-template-rows: 1fr; opacity: 1; }
    .advanced-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr auto; align-items: end; gap: 10px; padding: 2px 18px 16px; }
    @keyframes period-reveal { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 760px) {
      .grid.kpi-grid--finance { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .kpi-card--revenue { grid-column: 1 / -1; grid-row: 1; }
      .period-heading { align-items: flex-start; flex-direction: column; gap: 12px; }
      .period-chips { justify-content: flex-start; width: 100%; }
      .custom-dates, .advanced-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 480px) {
      .grid.kpi-grid, .grid.kpi-grid--finance { grid-template-columns: 1fr; }
      .kpi-card, .kpi-card--revenue { min-height: 132px; padding: 15px 16px 14px; }
      .kpi-card--revenue { grid-column: auto; }
      .kpi-card__value strong { font-size: clamp(1.75rem, 9vw, 2.2rem); }
      .kpi-card--revenue .kpi-card__value strong { font-size: clamp(2rem, 10vw, 2.55rem); }
      .custom-dates, .advanced-grid { grid-template-columns: 1fr; }
      .period-chip, .apply-period, .advanced-apply { width: 100%; }
      .period-chips { display:grid; grid-template-columns:1fr 1fr; }
      .period-main { padding-inline: 14px; }
      .period-chip { flex: 1 1 auto; padding-inline: 11px; }
      .custom-dates, .advanced-grid { grid-template-columns: 1fr; }
      .advanced-toggle { padding-inline: 14px; }
      .advanced-grid { padding-inline: 14px; }
      .apply-period, .advanced-apply { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .kpi-card, .kpi-card::after { transition: none; }
      .kpi-card:hover, .kpi-card:active { transform: none; }
      .period-chip, .advanced-toggle svg, .advanced-content { transition: none; }
      .custom-dates { animation: none; }
    }
  `]
})
export class StaffReportsPage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(this.staff.readStoredData<StaffEnterpriseOs>("enterprise-os") || null);
  readonly dashboard = signal<StaffDashboard | null>(this.staff.readStoredData<StaffDashboard>("dashboard") || null);
  readonly message = signal("");
  fromDate = this.dateOffset(6);
  toDate = this.dateOffset(0);
  selectedPeriod: "today" | "yesterday" | "week" | "month" | "custom" = "week";
  advancedFiltersOpen = false;
  reportSearch = "";
  reportStatus = "all";
  reportSort = "newest";
  showReportSuggestions = false;

  get reportSuggestions(): string[] {
    const q = this.reportSearch.trim().toLowerCase();
    const suggestions = ["Appointments", "Completed", "Live", "Revenue", "Services", "Staff Performance"];
    return suggestions.filter((s) => !q || s.toLowerCase().includes(q));
  }

  selectReportSuggestion(val: string) {
    this.reportSearch = val;
    this.showReportSuggestions = false;
    void this.load();
  }

  closeReportSuggestions() {
    setTimeout(() => (this.showReportSuggestions = false), 150);
  }
  private loadGeneration = 0;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadReports()) void this.load(); }

  async load() {
    const generation = ++this.loadGeneration;
    if (!this.canReadReports()) {
      this.os.set(null);
      this.dashboard.set(null);
      return;
    }
    this.message.set("");
    try {
      const params = { from: this.fromDate, to: this.toDate, date: this.toDate };
      const [os, dashboard] = await Promise.all([this.staff.enterpriseOs(params), this.staff.dashboard(params)]);
      if (generation !== this.loadGeneration) return;
      this.os.set(os);
      this.dashboard.set(dashboard);
      this.staff.writeStoredData("enterprise-os", os);
      this.staff.writeStoredData("dashboard", dashboard);
    } catch {
      // Backend error handled by StaffAppService
    }
  }

  reportKeys(): Array<"daily" | "weekly" | "monthly" | "yearly"> { return ["daily", "weekly", "monthly", "yearly"]; }

  canReadReports(): boolean {
    return this.staff.hasPermission("read:staff");
  }

  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["read:finance", "read:sales", "read:payments", "read:invoices"]); }

  averageSale(): number {
    const summary = this.dashboard()?.summary;
    return summary?.salesCount ? Number(summary.revenue || 0) / Number(summary.salesCount) : 0;
  }

  async quickRange(daysBack: number) {
    this.fromDate = this.dateOffset(daysBack);
    this.toDate = this.dateOffset(0);
    await this.load();
  }

  async selectPeriod(period: "today" | "yesterday" | "week" | "month" | "custom") {
    this.selectedPeriod = period;
    if (period === "custom") return;
    if (period === "yesterday") {
      this.fromDate = this.dateOffset(1);
      this.toDate = this.dateOffset(1);
      await this.load();
      return;
    }
    await this.quickRange(period === "today" ? 0 : period === "week" ? 6 : 29);
  }

  private dateOffset(daysBack: number): string {
    return businessDateOffset(-daysBack);
  }
}

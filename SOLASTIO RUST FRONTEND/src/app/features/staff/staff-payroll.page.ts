import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffPayrollItem } from "../../core/staff-app.service";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, DatePipe, StaffPageStateComponent],
  template: `
    <section class="page payroll-page">
      <header class="page-head"><div><p class="eyebrow">Payroll</p><h1>Payroll</h1><p>Your earnings, overtime, bonuses and deductions by pay period.</p></div></header>
      @if (!canSeePayroll()) { <section staffPageState class="notice">You do not have permission to view payroll.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading payroll...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (canSeePayroll()) {
        <section class="business-kpi-grid">
          <article class="kpi"><span>Total earned</span><strong>{{ totalNet() | paiseInr }}</strong><small>{{ payroll().length }} pay runs</small></article>
          <article class="kpi"><span>Overtime</span><strong>{{ totalOvertime() | paiseInr }}</strong><small>{{ formatMinutes(totalOvertimeMinutes()) }}</small></article>
          <article class="kpi"><span>Bonuses</span><strong>{{ totalBonus() | paiseInr }}</strong></article>
          <article class="kpi"><span>Deductions</span><strong>{{ totalDeductions() | paiseInr }}</strong></article>
        </section>
        <section class="panel">
          <div class="panel-title"><h2>Payroll entries</h2><span>{{ payroll().length }}</span></div>
          @if (!payroll().length) { <p class="empty">No payroll entries yet.</p> }
          <div class="list">
            @for (item of payroll(); track item.id) {
              <details class="payroll-entry">
                <summary>
                  <div class="row-main"><strong>{{ periodLabel(item) }}</strong><small>{{ payrollStatusLabel(item) }} · {{ item.createdAt | date:'mediumDate' }}</small></div>
                  <span class="badge" [class.green]="isPaid(item)">{{ item.status }}</span>
                  <i class="expand-chevron" aria-hidden="true"></i>
                </summary>
                <div class="payroll-breakdown">
                  <div class="payroll-line"><span>Gross</span><strong>{{ grossValue(item) | paiseInr }}</strong></div>
                  <div class="payroll-line"><span>Overtime</span><strong>{{ overtimeValue(item) | paiseInr }} @if (item.overtimeMinutes) { <small>({{ formatMinutes(item.overtimeMinutes) }})</small> }</strong></div>
                  <div class="payroll-line"><span>Bonus</span><strong>{{ bonusValue(item) | paiseInr }}</strong></div>
                  <div class="payroll-line negative"><span>Deductions</span><strong>{{ deductionValue(item) | paiseInr }}</strong></div>
                  <div class="payroll-line total"><span>Net pay</span><strong>{{ payrollAmount(item) | paiseInr }}</strong></div>
                </div>
              </details>
            }
          </div>
        </section>
        @if (!payroll().length) { <section staffPageState class="state">Once your first pay run is recorded, your earnings, overtime, bonuses, and deductions appear here.</section> }
      }
    </section>`,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    :host { display: block; }
    .payroll-page { max-width: 980px; gap: 18px; }
    .payroll-entry { overflow: hidden; border-top: 1px solid var(--staff-border); }
    .payroll-entry > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto 18px; align-items: center; gap: 12px; min-height: 62px; padding: 8px 0; cursor: pointer; list-style: none; }
    .payroll-entry > summary::-webkit-details-marker { display: none; }
    .payroll-entry > summary i { transition: transform var(--staff-motion-fast) var(--staff-motion-ease); }
    .payroll-entry[open] > summary i { transform: rotate(180deg); }
    .payroll-breakdown { display: grid; gap: 1px; padding: 1px; border-top: 1px solid var(--staff-border); border-radius: 12px; background: var(--staff-border); }
    .payroll-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; background: var(--staff-surface); }
    .payroll-line span { color: var(--staff-text-secondary); font-size: .72rem; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; }
    .payroll-line strong { color: var(--staff-text); font-size: .9rem; }
    .payroll-line strong small { color: var(--staff-text-secondary); font-size: .68rem; font-weight: 650; }
    .payroll-line.negative strong { color: var(--staff-error); }
    .payroll-line.total strong { color: var(--staff-primary-hover); font-size: 1.05rem; }
    .business-kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    @media (max-width: 700px) { .business-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `]
})
export class StaffPayrollPage implements OnInit {
  readonly payroll = signal<StaffPayrollItem[]>(this.staff.readStoredData<StaffPayrollItem[]>("payroll") || []);
  readonly loading = signal(false);

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canSeePayroll()) void this.load(); }

  async load() {
    try {
      this.loading.set(true);
      const data = await this.staff.payroll();
      this.payroll.set(data);
      this.staff.writeStoredData("payroll", data);
    } catch {
      // error handled by staff service
    } finally {
      this.loading.set(false);
    }
  }

  canSeePayroll(): boolean { return this.staff.hasAnyPermission(["read:payroll", "read:finance"]); }

  payrollAmount(item: StaffPayrollItem): number { return Number(item.netAmountPaise ?? item.grossAmountPaise ?? 0); }
  periodLabel(item: StaffPayrollItem): string {
    if (item.periodStart && item.periodEnd) {
      return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(item.periodStart))} – ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(item.periodEnd))}`;
    }
    return item.payrollRunId ? `Payroll run ${item.payrollRunId}` : "Payroll entry";
  }
  payrollStatusLabel(item: StaffPayrollItem): string {
    const status = String(item.status || "").replace(/_/g, " ");
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
  isPaid(item: StaffPayrollItem): boolean {
    return ["paid", "processed", "completed", "approved"].includes(String(item.status || "").toLowerCase());
  }
  totalNet(): number { return this.payroll().reduce((sum, item) => sum + this.payrollAmount(item), 0); }
  totalOvertime(): number { return this.payroll().reduce((sum, item) => sum + Number(item.overtimeAmountPaise ?? 0), 0); }
  totalBonus(): number { return this.payroll().reduce((sum, item) => sum + Number(item.bonusAmountPaise ?? 0), 0); }
  totalDeductions(): number { return this.payroll().reduce((sum, item) => sum + Number(item.deductionAmountPaise ?? 0), 0); }
  totalOvertimeMinutes(): number { return this.payroll().reduce((sum, item) => sum + Number(item.overtimeMinutes || 0), 0); }
  formatMinutes(value: number | null | undefined): string { const minutes = Math.max(0, Number(value || 0)); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
  grossValue(item: StaffPayrollItem): number { return Number(item.grossAmountPaise ?? 0); }
  overtimeValue(item: StaffPayrollItem): number { return Number(item.overtimeAmountPaise ?? 0); }
  bonusValue(item: StaffPayrollItem): number { return Number(item.bonusAmountPaise ?? 0); }
  deductionValue(item: StaffPayrollItem): number { return Number(item.deductionAmountPaise ?? 0); }
}

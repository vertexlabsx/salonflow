import { Component, computed, effect, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import { OwnerDrilldownType, OwnerFinanceMetricKey, OwnerFinanceOverview, OwnerReportCell, OwnerTypedColumn } from "./owner-finance-reports.models";

const METRICS: Array<{ key: OwnerFinanceMetricKey; label: string }> = [
  { key: "netRevenue", label: "Net revenue" }, { key: "grossSales", label: "Gross sales" }, { key: "cashCollected", label: "Cash collected" }, { key: "outstanding", label: "Outstanding" },
  { key: "refunds", label: "Refunds" }, { key: "expenses", label: "Expenses" }, { key: "taxes", label: "Taxes" }, { key: "discounts", label: "Discounts" }, { key: "profit", label: "Profit" }, { key: "tips", label: "Tips" }
];

@Component({
  standalone: true,
  imports: [FormsModule, PaiseInrPipe],
  template: `
    <article class="finance-page" [attr.aria-busy]="loading()">
      <header class="phase-header"><div><p>Financial performance</p><h1>Revenue</h1><span>Recorded sales, collections and liabilities—kept distinct.</span></div>@if (!blockingError()) { <button type="button" (click)="refresh()" [disabled]="loading()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button> }</header>
      @if (refreshError()) { <p class="state-banner error" role="alert">{{ refreshError() }}</p> }
      @if (data()?.partial) { <details class="state-banner warning"><summary>Some financial sources are unavailable</summary><ul>@for (warning of data()?.warnings; track warning.source) { <li><strong>{{ humanize(warning.source) }}:</strong> {{ warning.message }}</li> }</ul></details> }
      @if (loading() && !data()) { <div class="phase-skeleton" aria-label="Loading revenue"><i></i><i></i><i></i><i></i><b></b></div> }
      @else if (blockingError()) { <section class="blocking-state" role="alert"><h2>Revenue could not be loaded</h2><p>{{ blockingError() }}</p><button type="button" (click)="refresh()">Try again</button></section> }
      @else if (data(); as view) {
        <section class="finance-kpis" aria-label="Financial metrics">
          @for (definition of metrics; track definition.key) { @let metric = view.kpis[definition.key];
            <button type="button" [class.active]="selectedMetric() === definition.key" [disabled]="!view.drilldowns[definition.key]" (click)="openMetric(definition.key)">
              <span>{{ definition.label }}</span>
              @if (metric.availability.available && metric.currentPaise !== null) { <strong>{{ metric.currentPaise | paiseInr }}</strong> } @else { <strong class="unavailable">Unavailable</strong> }
              <small>@if (metric.deltaPercent !== null) { {{ metric.deltaPercent > 0 ? '+' : '' }}{{ metric.deltaPercent }}% vs previous } @else { {{ metric.availability.reason || 'Comparable prior value unavailable' }} }</small>
            </button>
          }
        </section>
        <div class="finance-grid">
          <section class="phase-panel trend-panel"><header><div><p>Net revenue</p><h2>Recorded trend</h2></div><span>{{ view.context.from }} – {{ view.context.to }}</span></header>
            @if (view.trend.length) { <svg class="trend-chart" viewBox="0 0 700 220" role="img" [attr.aria-label]="trendSummary()"><path class="chart-grid" d="M40 25H680M40 100H680M40 175H680"></path><polyline [attr.points]="trendPoints()"></polyline>@for (point of chartDots(); track point.label) { <circle [attr.cx]="point.x" [attr.cy]="point.y" r="4"><title>{{ point.label }}: {{ point.value | paiseInr }}</title></circle> }</svg><p class="chart-summary">{{ trendSummary() }}</p> } @else { <div class="inline-empty">No recorded sales in this period.</div> }
          </section>
          <section class="phase-panel"><header><div><p>Collections</p><h2>Payment methods</h2></div></header>
            <div class="method-list">@for (method of view.paymentMethods; track method.method) { <button type="button" (click)="paymentMethod.set(method.method); openDrilldown('payments')"><span>{{ humanize(method.method) }}</span><strong>{{ method.amountPaise | paiseInr }}</strong></button> } @empty { <div class="inline-empty">{{ view.availability['payments'].available ? 'No collections were recorded in this period.' : (view.availability['payments'].reason || 'Payment method data is unavailable.') }}</div> }</div>
          </section>
        </div>
        <div class="finance-grid">
          <section class="phase-panel"><header><div><p>Reconciliation</p><h2>Financial breakdown</h2></div></header><dl class="breakdown-list">
            @for (item of breakdown(view); track item.label) { <div><dt>{{ item.label }}</dt><dd>{{ item.value === null ? 'Unavailable' : (item.value | paiseInr) }}</dd></div> }
          </dl><p class="panel-note">Net revenue is sales.total. Cash collected is payment receipts. Neither is presented as profit.</p></section>
          <section class="phase-panel"><header><div><p>Portfolio</p><h2>Branch comparison</h2></div></header><div class="branch-list">@for (branch of view.branchComparison; track branch.branchId) { <article><div><strong>{{ branch.branchName }}</strong><span>{{ branch.invoiceCount }} sales</span></div><b>{{ branch.netRevenuePaise | paiseInr }}</b><small>Gross {{ branch.grossSalesPaise | paiseInr }}</small></article> } @empty { <div class="inline-empty">No comparable branch sales.</div> }</div></section>
        </div>
        <section class="phase-panel drill-panel"><header><div><p>Source records</p><h2>{{ drillTitle() }}</h2></div><span>{{ drill()?.pagination?.total || 0 }} records</span></header>
          <div class="phase-filters"><label><span>Search</span><input type="search" [(ngModel)]="search" (keyup.enter)="loadDrilldown(1)" /></label><label><span>Status</span><input [(ngModel)]="status" (keyup.enter)="loadDrilldown(1)" /></label><label><span>Payment method</span><input [(ngModel)]="paymentMethodValue" [disabled]="!supportsPaymentMethod()" (keyup.enter)="loadDrilldown(1)" /></label><button type="button" (click)="loadDrilldown(1)" [disabled]="drillLoading()">{{ drillError() ? 'Retry' : 'Apply' }}</button></div>
          @if (drillLoading() && !drill()) { <div class="table-loading" aria-label="Loading records"></div> }
          @else if (drillError()) { <p class="state-banner error" role="alert">{{ drillError() }}</p> }
          @else if (drill(); as records) { @if (!records.availability.available) { <p class="state-banner warning">{{ records.availability.reason || 'This source is unavailable.' }}</p> } @else if (records.rows.length) { <div class="responsive-table"><table><thead><tr>@for (column of records.columns; track column.key) { <th scope="col"><button type="button" (click)="sort(column)">{{ column.label }} @if (sortBy === column.key) { {{ sortDirection === 'asc' ? '↑' : '↓' }} }</button></th> }</tr></thead><tbody>@for (row of records.rows; track $index) { <tr>@for (column of records.columns; track column.key) { <td [attr.data-label]="column.label">{{ cell(row[column.key], column) }}</td> }</tr> }</tbody></table></div><nav class="pager" aria-label="Revenue records pages"><button type="button" [disabled]="records.pagination.page <= 1" (click)="loadDrilldown(records.pagination.page - 1)">Previous</button><span>Page {{ records.pagination.page }} of {{ records.pagination.pages }}</span><button type="button" [disabled]="records.pagination.page >= records.pagination.pages" (click)="loadDrilldown(records.pagination.page + 1)">Next</button></nav> } @else { <div class="inline-empty">No records match the selected filters.</div> } }
        </section>
      }
    </article>`,
  styleUrls: ["./owner-shell.styles.css", "./owner-finance-reports.css"]
})
export class OwnerRevenuePage {
  readonly metrics = METRICS; readonly data = signal<OwnerFinanceOverview | null>(null); readonly loading = signal(false); readonly blockingError = signal(""); readonly refreshError = signal("");
  readonly selectedMetric = signal<OwnerFinanceMetricKey>("netRevenue"); readonly drillType = signal<OwnerDrilldownType>("sales"); readonly drill = signal<Awaited<ReturnType<OwnerAppService["financeDrilldown"]>> | null>(null); readonly drillLoading = signal(false); readonly drillError = signal(""); readonly paymentMethod = signal("");
  search = ""; status = ""; paymentMethodValue = ""; sortBy = "businessDate"; sortDirection: "asc" | "desc" = "desc"; private request = 0; private drillRequest = 0;
  constructor(readonly context: OwnerContextService, private readonly api: OwnerAppService, route: ActivatedRoute) {
    const query = route.snapshot.queryParamMap;
    const requested = (query.get("metric") || (query.get("paymentState") === "outstanding" ? "outstanding" : "")) as OwnerFinanceMetricKey;
    if (requested && METRICS.some((item) => item.key === requested)) this.selectedMetric.set(requested);
    this.search = query.get("search") || query.get("invoiceId") || "";
    effect(() => { const branchId = context.selectedBranchId() || "all"; const range = context.periodRange(); untracked(() => void this.load(branchId, range.start, range.end)); });
  }
  refresh(): void { const range = this.context.periodRange(); void this.load(this.context.selectedBranchId() || "all", range.start, range.end); }
  openMetric(key: OwnerFinanceMetricKey): void { const type = this.data()?.drilldowns[key]; if (!type) return; this.selectedMetric.set(key); this.openDrilldown(type); }
  openDrilldown(type: OwnerDrilldownType): void { const changed = this.drillType() !== type; this.drillType.set(type); if (changed) { this.search = ""; this.status = ""; this.sortBy = "businessDate"; this.sortDirection = "desc"; } this.paymentMethodValue = this.supportsPaymentMethod() ? this.paymentMethod() : ""; if (!this.supportsPaymentMethod()) this.paymentMethod.set(""); void this.loadDrilldown(1); }
  async loadDrilldown(page: number): Promise<void> { const request = ++this.drillRequest; this.drillLoading.set(true); this.drillError.set(""); try { const range = this.context.periodRange(); const result = await this.api.financeDrilldown(this.drillType(), { branchId: this.context.selectedBranchId() || "all", from: range.start, to: range.end, page, pageSize: 25, search: this.search, status: this.status, paymentMethod: this.paymentMethodValue, sortBy: this.sortBy, sortDirection: this.sortDirection }); if (request === this.drillRequest) this.drill.set(result); } catch { if (request === this.drillRequest) this.drillError.set("These source records could not be loaded."); } finally { if (request === this.drillRequest) this.drillLoading.set(false); } }
  sort(column: OwnerTypedColumn): void { if (!column.sortable) return; this.sortDirection = this.sortBy === column.key && this.sortDirection === "desc" ? "asc" : "desc"; this.sortBy = column.key; void this.loadDrilldown(1); }
  cell(value: OwnerReportCell, column: OwnerTypedColumn): string { if (value === null) return "Unavailable"; if (column.type === "money") return this.context.formatCurrency(Number(value)); return String(value); }
  humanize(value: string): string { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
  supportsPaymentMethod(): boolean { return ["payments", "refunds", "expenses"].includes(this.drillType()); }
  drillTitle(): string { return `${this.humanize(this.drillType())} drill-down`; }
  breakdown(view: OwnerFinanceOverview): Array<{ label: string; value: number | null }> { return [{ label: "Gross sales", value: view.breakdown.grossSalesPaise }, { label: "Discounts", value: view.breakdown.discountsPaise }, { label: "Taxes", value: view.breakdown.taxesPaise }, { label: "Net revenue", value: view.breakdown.netRevenuePaise }, { label: "Cash collected", value: view.breakdown.cashCollectedPaise }, { label: "Outstanding", value: view.breakdown.outstandingPaise }, { label: "Refunds", value: view.breakdown.refundsPaise }, { label: "Expenses", value: view.breakdown.expensesPaise }, { label: "Credit notes", value: view.breakdown.creditNotesPaise }, { label: "Service revenue", value: view.breakdown.serviceRevenuePaise }, { label: "Product revenue", value: view.breakdown.productRevenuePaise }]; }
  chartDots(): Array<{ x: number; y: number; label: string; value: number }> { const rows = this.data()?.trend || [], max = Math.max(...rows.map((row) => row.netRevenuePaise), 1); return rows.map((row, index) => ({ x: 40 + (rows.length === 1 ? 320 : index * 640 / (rows.length - 1)), y: 190 - row.netRevenuePaise / max * 155, label: row.date, value: row.netRevenuePaise })); }
  trendPoints(): string { return this.chartDots().map((point) => `${point.x},${point.y}`).join(" "); }
  trendSummary(): string { const rows = this.data()?.trend || []; if (!rows.length) return "No recorded net revenue points."; const total = rows.reduce((sum, row) => sum + row.netRevenuePaise, 0); return `${rows.length} recorded periods with ${this.context.formatCurrency(total)} net revenue in total.`; }
  private async load(branchId: string, from: string, to: string): Promise<void> { const id = ++this.request; this.drillRequest++; this.loading.set(true); this.blockingError.set(""); this.refreshError.set(""); try { const response = await this.api.financeOverview({ branchId, from, to }); if (id !== this.request) return; this.data.set(response); this.drill.set(null); this.context.markSuccessfulRefresh(); const type = response.drilldowns[this.selectedMetric()] || "sales"; this.drillType.set(type); await this.loadDrilldown(1); } catch { if (id === this.request) (this.data() ? this.refreshError : this.blockingError).set("The scoped finance service is unavailable. Previously loaded data remains unchanged."); } finally { if (id === this.request) this.loading.set(false); } }
}

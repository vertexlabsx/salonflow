import { Component, computed, effect, ElementRef, OnDestroy, signal, untracked, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import { OwnerFinanceQuery, OwnerReportCatalogue, OwnerReportCatalogueItem, OwnerReportCell, OwnerReportData, OwnerTypedColumn } from "./owner-finance-reports.models";

const reportSessionCache = new Map<string, { catalogue: OwnerReportCatalogue; report: OwnerReportData | null; selectedKey: string }>();
const REPORT_CACHE_LIMIT = 8;

function cacheReport(key: string, value: { catalogue: OwnerReportCatalogue; report: OwnerReportData | null; selectedKey: string }): void {
  reportSessionCache.delete(key);
  reportSessionCache.set(key, value);
  while (reportSessionCache.size > REPORT_CACHE_LIMIT) reportSessionCache.delete(reportSessionCache.keys().next().value!);
}

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <article class="reports-page" [attr.aria-busy]="loading()">
      <header class="phase-header"><div><p>Decision records</p><h1>Reports</h1><span>Authoritative, filterable records from connected business sources.</span></div>@if (!blockingError()) { <button type="button" (click)="refresh()" [disabled]="loading()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button> }</header>
      <p class="sr-live" aria-live="polite">{{ liveMessage() }}</p>
      @if (refreshError()) { <p class="state-banner error" role="alert">{{ refreshError() }}</p> }
      @if (loading() && !catalogue()) { <div class="phase-skeleton"><i></i><i></i><i></i><i></i><b></b></div> }
      @else if (blockingError()) { <section class="blocking-state" role="alert"><h2>Reports could not be loaded</h2><p>{{ blockingError() }}</p><button type="button" (click)="refresh()">Try again</button></section> }
      @else {
        <div class="reports-layout">
          <aside class="catalogue-panel" aria-labelledby="catalogue-title">
            <header><div><p>Catalogue</p><h2 id="catalogue-title">Business reports</h2></div><span>{{ filteredReports().length }}</span></header>
            <label class="catalogue-search"><span>Search reports</span><input type="search" [ngModel]="catalogueSearch()" (ngModelChange)="catalogueSearch.set($event)" placeholder="Sales, clients, branch…" /></label><label class="catalogue-search"><span>Category</span><select [ngModel]="selectedCategory()" (ngModelChange)="selectedCategory.set($event)"><option value="">All categories</option>@for (category of categories(); track category) { <option [value]="category">{{ categoryLabel(category) }}</option> }</select></label>
            <nav aria-label="Report catalogue">@for (category of categories(); track category) { @if (reportsIn(category).length) { <h3>{{ categoryLabel(category) }}</h3>@for (item of reportsIn(category); track item.key) { <button type="button" [class.active]="selectedKey() === item.key" [class.unavailable]="!item.available" (click)="select(item)" [attr.aria-current]="selectedKey() === item.key ? 'page' : null"><span><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span><b>{{ item.available ? '→' : 'Unavailable' }}</b></button> } } }</nav>
          </aside>
          <main class="report-viewer" #viewer tabindex="-1">
            @if (selectedItem(); as item) {
              <header class="viewer-header"><div><p>{{ categoryLabel(item.category) }}</p><h2>{{ item.title }}</h2><span>{{ item.description }}</span></div>
                <details class="export-menu" #exportMenu><summary [attr.aria-disabled]="!item.available || exporting()">{{ exporting() ? 'Preparing…' : 'Export' }}</summary><div role="menu">@for (format of formats; track format) { <button type="button" role="menuitem" [disabled]="exporting() || !item.available" (click)="export(format)">{{ format.toUpperCase() }}</button> }</div></details>
              </header>
              @if (!item.available) { <section class="unavailable-report"><span>Unavailable</span><h3>This report cannot be produced truthfully</h3><p>{{ item.reason }}</p></section> }
              @else {
                <section class="report-actions" aria-label="Report filters"><label><span>Search rows</span><input type="search" [(ngModel)]="rowSearch" (keyup.enter)="applyFilters()" /></label>@if(supportsStatus()){<label><span>Status</span><input [(ngModel)]="status" (keyup.enter)="applyFilters()" /></label>}<button type="button" (click)="applyFilters()" [disabled]="reportLoading()">{{ reportError() ? 'Retry' : 'Apply filters' }}</button></section>
                @if (reportLoading() && !report()) { <div class="table-loading" aria-label="Loading report"></div> }
                @else if (reportError()) { <p class="state-banner error" role="alert">{{ reportError() }}</p> }
                @else if (report(); as data) {
                  @if (data.partial) { <p class="state-banner warning" role="status">This report is available, but unrelated catalogue sources may be unavailable.</p> }
                  <section class="report-totals" aria-label="Report totals">@for (total of totalEntries(); track total.key) { <article><span>{{ humanize(total.key) }}</span><strong>{{ total.value === null ? 'Unavailable' : formatTotal(total.key, total.value) }}</strong></article> } @empty { <p>No aggregate totals are defined for this report.</p> }</section>
                  @if (data.series.length) { <figure class="report-chart"><figcaption><strong>Recorded series</strong><span>{{ chartSummary() }}</span></figcaption><div class="bar-chart" aria-hidden="true">@for (point of data.series; track point.label) { <i [style.height.%]="barHeight(point.value)" [title]="point.label"></i> }</div></figure> }
                  @if (data.rows.length) { <div class="responsive-table"><table><thead><tr>@for (column of data.columns; track column.key) { <th scope="col"><button type="button" (click)="sort(column)">{{ column.label }} @if (sortBy === column.key) { {{ sortDirection === 'asc' ? '↑' : '↓' }} }</button></th> }</tr></thead><tbody>@for (row of data.rows; track $index) { <tr>@for (column of data.columns; track column.key) { <td [attr.data-label]="column.label">{{ cell(row[column.key], column) }}</td> }</tr> }</tbody></table></div><nav class="pager sticky-actions" aria-label="Report pages"><button type="button" [disabled]="data.pagination.page <= 1" (click)="loadReport(data.pagination.page - 1)">Previous</button><span>Page {{ data.pagination.page }} of {{ data.pagination.pages }} · {{ data.pagination.total }} rows</span><button type="button" [disabled]="data.pagination.page >= data.pagination.pages" (click)="loadReport(data.pagination.page + 1)">Next</button></nav> }
                  @else { <div class="inline-empty"><strong>No matching records</strong><span>Change the current filters or date context.</span></div> }
                }
              }
            } @else { <div class="inline-empty">Choose a report from the catalogue.</div> }
          </main>
        </div>
      }
    </article>`,
  styleUrls: ["./owner-shell.styles.css", "./owner-finance-reports.css"]
})
export class OwnerReportsPage implements OnDestroy {
  @ViewChild("viewer") viewer?: ElementRef<HTMLElement>; @ViewChild("exportMenu") exportMenu?: ElementRef<HTMLDetailsElement>;
  readonly formats: Array<"pdf" | "xlsx" | "csv"> = ["pdf", "xlsx", "csv"]; readonly catalogue = signal<OwnerReportCatalogue | null>(null); readonly report = signal<OwnerReportData | null>(null); readonly selectedKey = signal(""); readonly loading = signal(false); readonly reportLoading = signal(false); readonly exporting = signal(false); readonly blockingError = signal(""); readonly refreshError = signal(""); readonly reportError = signal(""); readonly liveMessage = signal("");
  readonly catalogueSearch = signal(""); readonly selectedCategory = signal(""); rowSearch = ""; status = ""; sortBy = ""; sortDirection: "asc" | "desc" = "desc"; private request = 0; private reportRequest = 0; private cacheKey = "";
  readonly selectedItem = computed(() => this.catalogue()?.reports.find((item) => item.key === this.selectedKey()) || null);
  readonly filteredReports = computed(() => { const query = this.catalogueSearch().trim().toLowerCase(); const category = this.selectedCategory(); return (this.catalogue()?.reports || []).filter((item) => (!category || item.category === category) && (!query || `${item.title} ${item.description} ${item.category}`.toLowerCase().includes(query))); });
  readonly categories = computed(() => this.catalogue()?.categories || []);
  constructor(readonly context: OwnerContextService, private readonly api: OwnerAppService) { effect(() => { const settingsLoaded = context.settingsLoaded(); const refreshOnOpen = context.settings().defaults.refreshReportsOnOpen; const branchId = context.selectedBranchId() || "all"; const range = context.periodRange(); untracked(() => { if (!settingsLoaded) return; this.request++; this.reportRequest++; this.cacheKey = `${branchId}:${range.start}:${range.end}`; const cached = reportSessionCache.get(this.cacheKey); if (!refreshOnOpen && cached) { cacheReport(this.cacheKey, { ...cached, report: null }); this.catalogue.set(cached.catalogue); this.selectedKey.set(cached.selectedKey); this.report.set(null); this.blockingError.set(""); this.refreshError.set(""); this.reportError.set(""); this.loading.set(false); this.reportLoading.set(false); if (cached.catalogue.reports.find((item) => item.key === cached.selectedKey)?.available) void this.loadReport(1); return; } void this.loadCatalogue(branchId, range.start, range.end); }); }); }
  ngOnDestroy(): void { this.request++; this.reportRequest++; }
  reportsIn(category: string): OwnerReportCatalogueItem[] { return this.filteredReports().filter((item) => item.category === category); }
  categoryLabel(category: string): string { return category === "sales" ? "Sales & revenue" : this.humanize(category); }
  supportsStatus(): boolean { return this.selectedKey() === "sales-summary" || this.selectedKey() === "appointments"; }
  refresh(): void { const range = this.context.periodRange(); void this.loadCatalogue(this.context.selectedBranchId() || "all", range.start, range.end); }
  select(item: OwnerReportCatalogueItem): void { this.reportRequest++; this.selectedKey.set(item.key); this.report.set(null); this.rowSearch = ""; this.status = ""; this.sortBy = ""; this.sortDirection = "desc"; if (item.available) void this.loadReport(1); setTimeout(() => this.viewer?.nativeElement.focus()); }
  applyFilters(): void { void this.loadReport(1); }
  async loadReport(page: number): Promise<void> { const item = this.selectedItem(); if (!item?.available) return; const request = ++this.reportRequest, scope = this.cacheKey, key = item.key; this.reportLoading.set(true); this.reportError.set(""); try { const response = await this.api.ownerReport(key, this.query({ page, pageSize: 25, search: this.rowSearch, status: this.status, sortBy: this.sortBy, sortDirection: this.sortDirection })); if (request !== this.reportRequest || scope !== this.cacheKey || key !== this.selectedKey()) return; this.report.set(response); const catalogue = this.catalogue(); if (catalogue && scope) cacheReport(scope, { catalogue, report: null, selectedKey: key }); this.liveMessage.set(`${item.title} loaded with ${response.pagination.total} rows.`); } catch { if (request === this.reportRequest && scope === this.cacheKey && key === this.selectedKey()) { this.reportError.set("The selected report could not be loaded."); this.liveMessage.set("Report loading failed."); } } finally { if (request === this.reportRequest && scope === this.cacheKey && key === this.selectedKey()) this.reportLoading.set(false); } }
  sort(column: OwnerTypedColumn): void { if (!column.sortable) return; this.sortDirection = this.sortBy === column.key && this.sortDirection === "desc" ? "asc" : "desc"; this.sortBy = column.key; void this.loadReport(1); }
  async export(format: "pdf" | "xlsx" | "csv"): Promise<void> { const item = this.selectedItem(); if (!item?.available || this.exporting()) return; this.exporting.set(true); this.liveMessage.set(`Preparing ${format.toUpperCase()} export.`); if (this.exportMenu) this.exportMenu.nativeElement.open = false; try { const file = await this.api.exportOwnerReport(item.key, format, this.query({ search: this.rowSearch, status: this.status, sortBy: this.sortBy, sortDirection: this.sortDirection })); const url = URL.createObjectURL(file.blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); this.liveMessage.set(`${format.toUpperCase()} export downloaded.`); } catch { this.liveMessage.set(`${format.toUpperCase()} export failed. Try again.`); } finally { this.exporting.set(false); } }
  totalEntries(): Array<{ key: string; value: number | null }> { return Object.entries(this.report()?.totals || {}).map(([key, value]) => ({ key, value })); }
  formatTotal(key: string, value: number): string { return key.endsWith("Paise") ? this.context.formatCurrency(value) : this.context.formatNumber(value); }
  cell(value: OwnerReportCell, column: OwnerTypedColumn): string { if (value === null) return "Unavailable"; if (column.type === "money") return this.context.formatCurrency(Number(value)); if (column.type === "date" && String(value).length >= 10) { const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`); return new Intl.DateTimeFormat(this.context.effectiveLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date); } return String(value); }
  humanize(value: string): string { return value.replace(/Paise$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
  chartSummary(): string { const series = this.report()?.series || []; const total = series.reduce((sum, point) => sum + point.value, 0); const value = this.selectedKey() === "sales-summary" ? this.formatTotal("valuePaise", total) : this.context.formatNumber(total); return `${series.length} recorded data points; combined value ${value}.`; }
  barHeight(value: number): number { const max = Math.max(...(this.report()?.series || []).map((point) => point.value), 1); return Math.max(3, value / max * 100); }
  private query(extra: Partial<OwnerFinanceQuery> = {}): OwnerFinanceQuery { const range = this.context.periodRange(); return { ...extra, branchId: this.context.selectedBranchId() || "all", from: range.start, to: range.end }; }
  private async loadCatalogue(branchId: string, from: string, to: string): Promise<void> { const id = ++this.request, scope = `${branchId}:${from}:${to}`; this.reportRequest++; this.loading.set(true); this.blockingError.set(""); this.refreshError.set(""); try { const response = await this.api.reportsCatalogue({ branchId, from, to }); if (id !== this.request || scope !== this.cacheKey) return; this.catalogue.set(response); this.context.markSuccessfulRefresh(); const current = response.reports.find((item) => item.key === this.selectedKey()) || response.reports.find((item) => item.available) || response.reports[0]; if (current) { this.selectedKey.set(current.key); this.report.set(null); cacheReport(scope, { catalogue: response, report: null, selectedKey: current.key }); if (current.available && id === this.request && scope === this.cacheKey) await this.loadReport(1); } } catch { if (id === this.request && scope === this.cacheKey) (this.catalogue() ? this.refreshError : this.blockingError).set("The scoped report catalogue is unavailable. Previously loaded data remains unchanged."); } finally { if (id === this.request && scope === this.cacheKey) this.loading.set(false); } }
}

import { Component, ElementRef, HostListener, OnDestroy, ViewChild, effect, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { OwnerAppService } from "./owner-app.service";
import { OwnerBillingDetail, OwnerBillingInvoice, OwnerBillingList } from "./owner-billing.models";
import { OwnerContextService } from "./owner-context.service";

@Component({
  standalone: true,
  imports: [FormsModule, PaiseInrPipe],
  template: `
    <article class="ops-page" [attr.aria-busy]="loading()">
      <header class="ops-header"><div><p class="ops-eyebrow">Operations · Read only</p><h1>Billing Access</h1><p>Review scoped invoices, balances and recorded payment history without changing POS records.</p></div><div class="ops-actions"><button class="ops-button" type="button" [disabled]="loading()" (click)="load()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button></div></header>
      <p class="ops-notice"><strong>Operational control:</strong> Payments, refunds, voids and invoice changes remain in authorized POS and finance workflows.</p>
      @if (error()) { <p class="ops-notice error" role="alert">{{ error() }}</p> }
      @if (data(); as view) {
        <section class="ops-metrics" aria-label="Billing summary">
          <article class="ops-metric"><span>Invoices</span><strong>{{ view.summary.invoiceCount }}</strong><small>Selected period</small></article>
          <article class="ops-metric"><span>Billed</span><strong>{{ view.summary.billedPaise | paiseInr }}</strong><small>Invoice total</small></article>
          <article class="ops-metric"><span>Paid</span><strong>{{ view.summary.paidPaise | paiseInr }}</strong><small>Recorded collection</small></article>
          <article class="ops-metric"><span>Outstanding</span><strong>{{ view.summary.outstandingPaise | paiseInr }}</strong><small>Remaining due</small></article>
          <article class="ops-metric"><span>Overdue</span><strong>{{ view.summary.overduePaise | paiseInr }}</strong><small>Past due date</small></article>
        </section>
      }
      <section class="ops-toolbar" aria-label="Billing filters">
        <label class="ops-field ops-search"><span>Search invoices</span><input type="search" [(ngModel)]="search" placeholder="Invoice, client or ID" (keyup.enter)="applyFilters()" /></label>
        <label class="ops-field"><span>Invoice status</span><select [(ngModel)]="status" (ngModelChange)="applyFilters()"><option value="">All statuses</option><option value="draft">Draft</option><option value="finalized">Finalized</option><option value="void">Void</option><option value="cancelled">Cancelled</option></select></label>
        <label class="ops-field"><span>Payment status</span><select [(ngModel)]="paymentStatus" (ngModelChange)="applyFilters()"><option value="">Any payment state</option><option value="unpaid">Unpaid</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option></select></label>
        <button class="ops-button" type="button" (click)="applyFilters()">Apply</button>
      </section>
      <section class="ops-panel"><header class="ops-panel-head"><h2>Invoices</h2><span>{{ data()?.page?.total || 0 }} records</span></header>
        @if (loading() && !data()) { <div class="ops-skeleton"><i></i><i></i><i></i><i></i></div> }
        @else if (!data()?.items?.length) { <div class="ops-state"><span>—</span><h2>No matching invoices</h2><p>No invoices match the branch, period and filters.</p></div> }
        @else {
          <table class="ops-table"><thead><tr><th>Invoice</th><th>Client</th><th>Branch</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead><tbody>@for (invoice of data()!.items; track invoice.id) { <tr tabindex="0" (click)="open(invoice, $event)" (keydown.enter)="open(invoice, $event)"><td><strong>{{ invoice.invoiceNumber || invoice.id }}</strong><small>{{ date(invoice.createdAt) }}</small></td><td><strong>{{ invoice.customerName || 'Walk-in client' }}</strong><small>{{ invoice.customerId }}</small></td><td>{{ invoice.branchName || invoice.branchId }}</td><td>{{ invoice.grandTotalPaise | paiseInr }}</td><td>{{ invoice.paidAmountPaise | paiseInr }}</td><td>{{ invoice.dueAmountPaise | paiseInr }}</td><td><span class="ops-status" [attr.data-tone]="invoice.dueAmountPaise > 0 ? 'warning' : 'success'">{{ label(invoice.paymentStatus || invoice.status) }}</span></td></tr> }</tbody></table>
          <div class="ops-cards">@for (invoice of data()!.items; track invoice.id) { <button class="ops-card" type="button" (click)="open(invoice, $event)"><div><h3>{{ invoice.invoiceNumber || invoice.id }}</h3><span class="ops-status">{{ label(invoice.paymentStatus || invoice.status) }}</span></div><p>{{ invoice.customerName || 'Walk-in client' }} · {{ invoice.branchName }}</p><small>{{ invoice.grandTotalPaise | paiseInr }} total · {{ invoice.dueAmountPaise | paiseInr }} due</small></button> }</div>
          <footer class="ops-pagination"><span>Page {{ data()!.page.page }} of {{ data()!.page.pages }}</span><button type="button" [disabled]="data()!.page.page <= 1 || loading()" (click)="go(-1)">←</button><button type="button" [disabled]="!data()!.page.hasMore || loading()" (click)="go(1)">→</button></footer>
        }
      </section>
    </article>
    @if (selected()) { <button class="ops-backdrop" type="button" (click)="close()" aria-label="Close invoice detail"></button><aside class="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="billing-detail-title" #drawer tabindex="-1"><header><div><p class="ops-eyebrow">Invoice detail</p><h2 id="billing-detail-title">{{ selected()?.invoiceNumber || selected()?.id }}</h2></div><button class="ops-close" type="button" (click)="close()" aria-label="Close">×</button></header><div class="ops-drawer-body">
      @if (detailLoading()) { <div class="ops-skeleton"><i></i><i></i></div> }
      @else if (detail(); as view) {
        <section class="ops-detail-hero"><strong>{{ view.invoice.dueAmountPaise | paiseInr }} due</strong><p>{{ view.invoice.customerName || 'Walk-in client' }} · {{ view.invoice.branchName }}</p></section>
        <section class="ops-detail-section"><h3>Invoice totals</h3><dl class="ops-detail-grid"><div><dt>Total</dt><dd>{{ view.invoice.grandTotalPaise | paiseInr }}</dd></div><div><dt>Paid</dt><dd>{{ view.invoice.paidAmountPaise | paiseInr }}</dd></div><div><dt>Due</dt><dd>{{ view.invoice.dueAmountPaise | paiseInr }}</dd></div><div><dt>Status</dt><dd>{{ label(view.invoice.status) }}</dd></div></dl></section>
        <section class="ops-detail-section"><h3>Line items</h3><div class="ops-timeline">@for (item of view.items; track item.id) { <article><strong>{{ item.name }} · {{ item.quantity }}</strong><p>{{ item.totalAmountPaise | paiseInr }} · Tax {{ item.taxAmountPaise | paiseInr }}</p></article> } @empty { <p>No invoice items were returned.</p> }</div></section>
        <section class="ops-detail-section"><h3>Payment history</h3><div class="ops-timeline">@for (payment of view.payments; track payment.id) { <article><strong>{{ label(payment.method) }} · {{ payment.amountPaise | paiseInr }}</strong><p>{{ label(payment.status) }}{{ payment.reference ? ' · ' + payment.reference : '' }}</p><small>{{ date(payment.paidAt || payment.createdAt) }}</small></article> } @empty { <p>No recorded payments.</p> }</div></section>
      }
    </div></aside> }
  `,
  styleUrls: ["./owner-shell.styles.css", "./owner-operations.css"]
})
export class OwnerBillingPage implements OnDestroy {
  @ViewChild("drawer") drawer?: ElementRef<HTMLElement>;
  readonly data = signal<OwnerBillingList | null>(null); readonly loading = signal(true); readonly error = signal("");
  readonly selected = signal<OwnerBillingInvoice | null>(null); readonly detail = signal<OwnerBillingDetail | null>(null); readonly detailLoading = signal(false);
  search = ""; status = ""; paymentStatus = ""; private page = 1; private request = 0; private detailRequest = 0; private trigger: HTMLElement | null = null;
  constructor(private readonly api: OwnerAppService, readonly context: OwnerContextService) { effect(() => { const branchId = context.selectedBranchId() || "all"; const range = context.periodRange(); untracked(() => { this.page = 1; void this.load(branchId, range.start, range.end); }); }); }
  ngOnDestroy(): void { this.request++; this.detailRequest++; document.documentElement.classList.remove("staff-overlay-open"); }
  applyFilters(): void { this.page = 1; void this.load(); }
  go(delta: number): void { this.page += delta; void this.load(); }
  async load(branchId = this.context.selectedBranchId() || "all", from = this.context.periodRange().start, to = this.context.periodRange().end): Promise<void> { const id = ++this.request; this.loading.set(true); this.error.set(""); try { const data = await this.api.ownerBillingInvoices({ branchId, from, to, page: this.page, pageSize: 25, search: this.search, status: this.status, paymentStatus: this.paymentStatus }); if (id === this.request) { this.data.set(data); this.context.markSuccessfulRefresh(); } } catch { if (id === this.request) this.error.set("Billing records could not be loaded for this owner scope."); } finally { if (id === this.request) this.loading.set(false); } }
  async open(invoice: OwnerBillingInvoice, event: Event): Promise<void> { this.trigger = event.currentTarget as HTMLElement; this.selected.set(invoice); this.detail.set(null); this.detailLoading.set(true); document.documentElement.classList.add("staff-overlay-open"); setTimeout(() => this.drawer?.nativeElement.focus()); const id = ++this.detailRequest; try { const detail = await this.api.ownerBillingInvoice(invoice.id); if (id === this.detailRequest) this.detail.set(detail); } catch { if (id === this.detailRequest) this.error.set("Invoice detail could not be loaded."); } finally { if (id === this.detailRequest) this.detailLoading.set(false); } }
  close(): void { this.detailRequest++; this.selected.set(null); this.detail.set(null); document.documentElement.classList.remove("staff-overlay-open"); setTimeout(() => this.trigger?.focus()); }
  label(value: string): string { return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
  date(value: string): string { if (!value) return "Date unavailable"; return this.context.formatDate(value); }
  @HostListener("window:keydown", ["$event"]) keydown(event: KeyboardEvent): void { if (event.key === "Escape" && this.selected()) this.close(); }
}

import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  effect,
  signal,
  untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import { OwnerPageInfo, OwnerPayroll, OwnerPayrollDetail } from "./owner-people.models";
@Component({
  standalone: true,
  imports: [FormsModule, PaiseInrPipe],
  template: `<article class="people-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">Operations · Backend calculated</p>
        <h1>Payroll</h1>
        <p>
          Generate, review and transition payroll runs without recreating salary
          calculations in the browser.
        </p>
      </div>
      <button
        class="button primary"
        [disabled]="!context.selectedBranchId()"
        (click)="generateOpen.set(true)"
      >
        Generate payroll
      </button>
    </header>
    @if (!context.selectedBranchId()) {
      <p class="notice">
        Select one branch to generate payroll. Portfolio review remains
        available.
      </p>
    }
    <section class="filters">
      <label
        >Search<input
          type="search"
          [ngModel]="search"
          (ngModelChange)="searchChanged($event)"
          placeholder="Run ID or period" /></label
      ><label
        >From<input
          type="date"
          [ngModel]="from()"
          (ngModelChange)="from.set($event); filtersChanged()" /></label
      ><label
        >To<input
          type="date"
          [ngModel]="to()"
          (ngModelChange)="to.set($event); filtersChanged()" /></label
      ><label
        >Status<select
          [ngModel]="status()"
          (ngModelChange)="status.set($event); filtersChanged()"
        >
          <option value="">All statuses</option>
          <option>draft</option>
          <option>approved</option>
          <option>paid</option>
        </select></label
      >
    </section>
    @if (message()) {
      <p class="notice" [class.error]="isError()" role="status">
        {{ message() }}
      </p>
    }
    <section class="metrics">
      <article class="metric">
        <span>Runs loaded</span><strong>{{ items().length }} of {{ page()?.total || 0 }}</strong>
      </article>
      <article class="metric">
        <span>Gross loaded</span
        ><strong>{{ total("grossAmountPaise") | paiseInr }}</strong>
      </article>
      <article class="metric">
        <span>Deductions loaded</span
        ><strong>{{ total("deductionsAmountPaise") | paiseInr }}</strong>
      </article>
      <article class="metric">
        <span>Net loaded</span
        ><strong>{{ total("netAmountPaise") | paiseInr }}</strong>
      </article>
    </section>
    <section class="data-panel">
      <div class="panel-head">
        <h2>Payroll runs</h2>
         <span>Loaded {{ items().length }} of {{ page()?.total || 0 }} matching runs</span>
      </div>
      @if (loading() && !items().length) {
        <div class="loading"><i class="skeleton"></i></div>
      } @else if (!filtered().length) {
        <div class="empty">
          <h2>No payroll runs</h2>
          <p>No backend-generated run matches the selected filters.</p>
        </div>
      } @else {
        <div class="table-head">
          <span>Period</span><span>Gross</span><span>Deductions</span
          ><span>Net / status</span><i></i>
        </div>
        @for (row of filtered(); track row.id) {
          <button class="data-row" (click)="open(row, $event)">
            <span
              ><strong>{{ row.periodStart }} – {{ row.periodEnd }}</strong
              ><small>{{ branch(row.branchId) }} · {{ row.id }}</small></span
            ><span
              ><strong>{{ row.grossAmountPaise | paiseInr }}</strong></span
            ><span
              ><strong>{{ row.deductionsAmountPaise | paiseInr }}</strong></span
            ><span
              ><strong>{{ row.netAmountPaise | paiseInr }}</strong
              ><small
                class="badge"
                [attr.data-tone]="
                  row.status === 'paid'
                    ? 'good'
                    : row.status === 'draft'
                      ? 'warn'
                      : ''
                "
                >{{ row.status }}</small
              ></span
            ><i>›</i>
          </button>
        }
      }
      @if (page(); as pagination) { @if (pagination.total > pagination.limit) { <footer class="page-actions" aria-label="Payroll pages"><span>{{ pageLabel() }}</span><button class="button" type="button" [disabled]="loading() || pagination.offset === 0" (click)="go(-1)" aria-label="Previous payroll page">Previous</button><button class="button" type="button" [disabled]="loading() || !pagination.hasMore" (click)="go(1)" aria-label="Next payroll page">Next</button></footer> } }
    </section>
    @if (detail()) {
      <button class="backdrop" (click)="close()"></button>
      <aside
        class="drawer"
        role="dialog"
        aria-modal="true"
        #drawer
        tabindex="-1"
      >
        <header>
          <div>
            <p class="eyebrow">Payroll review</p>
            <h2>
              {{ detail()?.run?.periodStart }} – {{ detail()?.run?.periodEnd }}
            </h2>
          </div>
          <button class="close" (click)="close()">×</button>
        </header>
        <div class="drawer-body">
          @if (detailLoading()) {
            <i class="skeleton"></i>
          } @else if (detailError()) {
            <p class="notice error" role="alert">{{ detailError() }}</p>
          } @else {
            <section class="detail-card">
              <h3>Run totals</h3>
              <dl>
                <div>
                  <dt>Gross</dt>
                  <dd>{{ detail()!.run.grossAmountPaise | paiseInr }}</dd>
                </div>
                <div>
                  <dt>Deductions</dt>
                  <dd>{{ detail()!.run.deductionsAmountPaise | paiseInr }}</dd>
                </div>
                <div>
                  <dt>Net</dt>
                  <dd>{{ detail()!.run.netAmountPaise | paiseInr }}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{{ detail()!.run.status }}</dd>
                </div>
              </dl>
            </section>
            <section class="detail-card">
              <h3>Individual breakdown</h3>
              <div class="detail-list">
                @for (item of detail()!.items; track item.id) {
                  <article>
                    <span
                      ><strong>{{ item.staffId }}</strong
                      ><br /><small
                        >Gross {{ item.grossAmountPaise | paiseInr }} · OT
                        {{ item.overtimeAmountPaise | paiseInr }} · Bonus
                        {{ item.bonusAmountPaise | paiseInr }}</small
                      ><br /><small
                        >Deductions {{ item.deductionsAmountPaise | paiseInr }} · PF
                        {{ item.pfAmountPaise | paiseInr }} · ESIC
                        {{ item.esicAmountPaise | paiseInr }} · TDS
                        {{ item.tdsAmountPaise | paiseInr }} · PT
                        {{ item.ptAmountPaise | paiseInr }}</small
                      ></span
                    ><strong>{{ item.netAmountPaise | paiseInr }}</strong>
                  </article>
                } @empty {
                  <p class="notice">
                    No persisted payroll items are available.
                  </p>
                }
              </div>
            </section>
            <p class="notice">
              Compliance values appear only when stored by the payroll backend.
              No amounts are calculated in this page.
            </p>
          }
        </div>
        <footer class="actions">
          @if (detail()?.capabilities?.actions?.includes("approve")) {
            <button
              class="button primary"
              [disabled]="submitting()"
              (click)="requestTransition('approve')"
            >
              Approve run
            </button>
          }
          @if (detail()?.capabilities?.actions?.includes("markPaid")) {
            <button
              class="button primary"
              [disabled]="submitting()"
              (click)="requestTransition('paid')"
            >
              Mark paid
            </button>
          }
        </footer>
      </aside>
    }
    @if (generateOpen()) {
      <button class="backdrop" (click)="generateOpen.set(false)"></button>
      <section class="modal" role="dialog" aria-modal="true">
        <header>
          <h2>Generate payroll</h2>
          <button class="close" (click)="generateOpen.set(false)">×</button>
        </header>
        <form class="form" (ngSubmit)="generate()">
          <label
            >Branch<input
              [value]="branch(context.selectedBranchId())"
              disabled /></label
          ><label
            >Period start<input
              type="date"
              name="genStart"
              [(ngModel)]="genStart"
              required /></label
          ><label
            >Period end<input
              type="date"
              name="genEnd"
              [(ngModel)]="genEnd"
              required
          /></label>
          <p class="notice full">
            The backend owns attendance, overtime, statutory deduction and
            net-pay calculation.
          </p>
          <footer class="full">
            <button
              class="button"
              type="button"
              (click)="generateOpen.set(false)"
            >
              Cancel</button
            ><button class="button primary" [disabled]="submitting()">
              Generate
            </button>
          </footer>
        </form>
      </section>
    }
    @if (confirmation(); as kind) {
      <button
        class="backdrop"
        type="button"
        (click)="confirmation.set(null)"
        aria-label="Cancel payroll confirmation"
      ></button>
      <section
        class="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="payroll-confirm-title"
      >
        <header>
          <h2 id="payroll-confirm-title">
            {{ kind === "approve" ? "Approve payroll?" : "Mark payroll paid?" }}
          </h2>
          <button class="close" type="button" (click)="confirmation.set(null)">
            ×
          </button>
        </header>
        <div class="form">
          <p class="notice full">
            @if (kind === "approve") {
              This confirms the reviewed payroll run and enables its payment
              transition.
            } @else {
              This records the approved payroll run as paid. Confirm only after
              payment has been completed.
            }
          </p>
          <footer class="full">
            <button
              class="button"
              type="button"
              (click)="confirmation.set(null)"
            >
              Cancel
            </button>
            <button
              class="button primary"
              type="button"
              [disabled]="submitting()"
              (click)="confirmTransition()"
            >
              {{ kind === "approve" ? "Approve run" : "Mark paid" }}
            </button>
          </footer>
        </div>
      </section>
    }
  </article>`,
  styleUrls: ["./owner-shell.styles.css", "./owner-people.pages.css"],
})
export class OwnerPayrollPage implements OnDestroy {
  @ViewChild("drawer") drawer?: ElementRef<HTMLElement>;
  readonly items = signal<OwnerPayroll[]>([]);
  readonly loading = signal(true);
  readonly from = signal("");
  readonly to = signal("");
  readonly status = signal("");
  readonly page = signal<OwnerPageInfo | null>(null);
  readonly detail = signal<OwnerPayrollDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal("");
  readonly submitting = signal(false);
  readonly message = signal("");
  readonly isError = signal(false);
  readonly generateOpen = signal(false);
  readonly confirmation = signal<"approve" | "paid" | null>(null);
  search = "";
  genStart = "";
  genEnd = "";
  private request = 0;
  private detailRequest = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  readonly pageSize = 50;
  private trigger: HTMLElement | null = null;
  private generationKey = "";
  private generationSignature = "";
  constructor(
    readonly context: OwnerContextService,
    private api: OwnerAppService,
    route: ActivatedRoute,
  ) {
    const query = route.snapshot.queryParamMap;
    this.search = query.get("search") || query.get("id") || "";
    const status = query.get("status");
    if (status) this.status.set(status);
    effect(() => {
      const b = this.context.selectedBranchId() || "all",
        r = this.context.periodRange();
      untracked(() => {
        this.from.set(r.start);
        this.to.set(r.end);
        this.genStart = r.start;
        this.genEnd = r.end;
        this.items.set([]);
        this.page.set(null);
        this.close(false);
        void this.load(b);
      });
    });
  }
  ngOnDestroy() {
    this.request++;
    this.detailRequest++;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    document.documentElement.classList.remove("staff-overlay-open");
  }
  async load(branchId = this.context.selectedBranchId() || "all") {
    const id = ++this.request;
    this.loading.set(true);
    try {
      const r = await this.api.ownerPayroll({
        branchId,
        from: this.from(),
        to: this.to(),
        status: this.status(),
        search: this.search,
        limit: this.pageSize,
        offset: this.page()?.offset || 0,
      });
      if (id === this.request) {
        this.items.set(r.items);
        this.page.set(r.page || { total: r.items.length, limit: this.pageSize, offset: 0, hasMore: false });
        this.context.markSuccessfulRefresh();
      }
    } catch {
      if (id === this.request) {
        this.message.set("Payroll runs could not be loaded.");
        this.isError.set(true);
      }
    } finally {
      if (id === this.request) this.loading.set(false);
    }
  }
  filtered() {
    return this.items();
  }
  searchChanged(value: string) { this.search = value; if (this.searchTimer) clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => { this.items.set([]); this.filtersChanged(); }, 300); }
  filtersChanged() { this.items.set([]); this.page.set(null); void this.load(); }
  go(direction: number) { const current = this.page(); if (!current) return; this.items.set([]); this.page.set({ ...current, offset: Math.max(0, current.offset + direction * current.limit) }); void this.load(); }
  pageLabel() { const current = this.page(); return !current?.total ? "" : `${current.offset + 1}–${Math.min(current.offset + current.limit, current.total)} of ${current.total}`; }
  total(key: "grossAmountPaise" | "deductionsAmountPaise" | "netAmountPaise") {
    return this.filtered().reduce((s, x) => s + Number(x[key] || 0), 0);
  }
  async open(row: OwnerPayroll, e: Event) {
    const request = ++this.detailRequest;
    this.trigger = e.currentTarget as HTMLElement;
    this.detailLoading.set(true);
    this.detail.set({
      run: row,
      items: [],
      availability: {},
      capabilities: { actions: [] },
    });
    document.documentElement.classList.add("staff-overlay-open");
    setTimeout(() => this.drawer?.nativeElement.focus());
    try {
      const detail = await this.api.ownerPayrollDetail(row.id);
      if (request === this.detailRequest) {
        this.detail.set(detail);
        this.detailError.set("");
      }
    } catch {
      if (request === this.detailRequest) {
        this.detailError.set("Payroll detail could not be loaded. Please try again.");
      }
    } finally {
      if (request === this.detailRequest) this.detailLoading.set(false);
    }
  }
  close(restoreFocus = true) {
    this.detailRequest++;
    this.detail.set(null);
    this.detailError.set("");
    document.documentElement.classList.remove("staff-overlay-open");
    if (restoreFocus) setTimeout(() => this.trigger?.focus());
  }
  async generate() {
    const b = this.context.selectedBranchId();
    if (!b || this.submitting()) return;
    const payload = { branchId: b, periodStart: this.genStart, periodEnd: this.genEnd };
    const signature = JSON.stringify(payload);
    if (signature !== this.generationSignature) {
      this.generationSignature = signature;
      this.generationKey = crypto.randomUUID();
    }
    this.submitting.set(true);
    try {
      await this.api.generateOwnerPayroll(payload, this.generationKey);
      this.generationKey = "";
      this.generationSignature = "";
      this.generateOpen.set(false);
      this.items.set([]);
      this.message.set("Payroll run generated for review.");
      this.isError.set(false);
      await this.load();
    } catch {
      this.message.set("Payroll generation could not be completed.");
      this.isError.set(true);
    } finally {
      this.submitting.set(false);
    }
  }
  requestTransition(kind: "approve" | "paid") {
    if (!this.submitting()) this.confirmation.set(kind);
  }
  confirmTransition() {
    const kind = this.confirmation();
    if (kind) void this.transition(kind);
  }
  private async transition(kind: "approve" | "paid") {
    const run = this.detail()?.run;
    if (!run || this.submitting()) return;
    this.confirmation.set(null);
    this.submitting.set(true);
    try {
      if (kind === "approve") await this.api.approveOwnerPayroll(run.id);
      else await this.api.markOwnerPayrollPaid(run.id);
      this.close();
      this.items.set([]);
      this.message.set(
        kind === "approve" ? "Payroll approved." : "Payroll marked paid.",
      );
      this.isError.set(false);
      await this.load();
    } catch {
      this.message.set(
        "The payroll status changed or this transition is unavailable.",
      );
      this.isError.set(true);
    } finally {
      this.submitting.set(false);
    }
  }
  @HostListener("window:keydown", ["$event"]) key(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (this.confirmation()) this.confirmation.set(null);
      else if (this.generateOpen()) this.generateOpen.set(false);
      else if (this.detail()) this.close();
    }
  }
  branch(id: string) {
    return (
      this.context.branches().find((b) => b.id === id)?.name || id || "Branch"
    );
  }
}

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
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import { OwnerLeave, OwnerLeaveDetail, OwnerPageInfo } from "./owner-people.models";
@Component({
  standalone: true,
  imports: [FormsModule],
  template: `<article class="people-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">People · Requests</p>
        <h1>Leave requests</h1>
        <p>
          Review saved requests, balances and real date conflicts before
          deciding.
        </p>
      </div>
      <button class="button" (click)="load()">Refresh</button>
    </header>
    <nav class="view-tabs">
      @for (v of views; track v) {
        <button [attr.aria-pressed]="view() === v" (click)="view.set(v); filtersChanged()">
          {{ v }}
        </button>
      }
    </nav>
    <section class="filters">
      <label
        >Search<input
          type="search"
          [ngModel]="search"
          (ngModelChange)="searchChanged($event)"
          placeholder="Staff, type or reason" /></label
      ><label
        >From<input
          type="date"
          [ngModel]="from()"
          (ngModelChange)="from.set($event); filtersChanged()" /></label
      ><label
        >To<input
          type="date"
          [ngModel]="to()"
          (ngModelChange)="to.set($event); filtersChanged()"
      /></label>
    </section>
    @if (message()) {
      <p class="notice" [class.error]="isError()" role="status">
        {{ message() }}
      </p>
    }
    <section class="data-panel">
      <div class="panel-head">
        <h2>{{ view() }} requests</h2>
        <span>Loaded {{ items().length }} of {{ page()?.total || 0 }} matching requests</span>
      </div>
      @if (loading() && !items().length) {
        <div class="loading"><i class="skeleton"></i></div>
      } @else if (!filtered().length) {
        <div class="empty">
          <h2>No matching requests</h2>
          <p>No leave requests match this branch, period and state.</p>
        </div>
      } @else {
        <div class="table-head">
          <span>Staff</span><span>Dates</span><span>Type</span
          ><span>Status</span><i></i>
        </div>
        @for (row of filtered(); track row.id) {
          <button class="data-row" (click)="open(row, $event)">
            <span
              ><strong>{{ row.staffName }}</strong
              ><small>{{ row.reason || "No reason recorded" }}</small></span
            ><span
              ><strong>{{ row.startDate }} – {{ row.endDate }}</strong
              ><small
                >{{ row.days }} {{ row.days === 1 ? "day" : "days" }}</small
              ></span
            ><span
              ><strong>{{ label(row.leaveType) }}</strong
              ><small>{{
                row.documentAvailable
                  ? "Document attached"
                  : "No document source"
              }}</small></span
            ><span
              ><span
                class="badge"
                [attr.data-tone]="
                  row.status === 'approved'
                    ? 'good'
                    : row.status === 'pending'
                      ? 'warn'
                      : ''
                "
                >{{ row.status }}</span
              ></span
            ><i>›</i>
          </button>
        }
      }
      @if (page(); as pagination) { @if (pagination.total > pagination.limit) { <footer class="page-actions" aria-label="Leave request pages"><span>{{ pageLabel() }}</span><button class="button" type="button" [disabled]="loading() || pagination.offset === 0" (click)="go(-1)" aria-label="Previous leave request page">Previous</button><button class="button" type="button" [disabled]="loading() || !pagination.hasMore" (click)="go(1)" aria-label="Next leave request page">Next</button></footer> } }
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
            <p class="eyebrow">Leave detail</p>
            <h2>{{ detail()?.leave?.staffName }}</h2>
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
              <h3>Request</h3>
              <dl>
                <div>
                  <dt>Dates</dt>
                  <dd>
                    {{ detail()!.leave.startDate }} –
                    {{ detail()!.leave.endDate }}
                  </dd>
                </div>
                <div>
                  <dt>Days</dt>
                  <dd>{{ detail()!.leave.days }}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{{ label(detail()!.leave.leaveType) }}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{{ detail()!.leave.status }}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{{ detail()!.leave.reason || "Not provided" }}</dd>
                </div>
                <div>
                  <dt>Documents</dt>
                  <dd>{{ detail()!.availability["documents"].reason }}</dd>
                </div>
              </dl>
            </section>
            <section class="detail-card">
              <h3>Balance</h3>
              <div class="detail-list">
                @for (b of detail()!.balances; track $index) {
                  <article>
                    <span>{{ b["leaveType"] }}</span
                    ><strong>{{ b["balance"] }} remaining</strong>
                  </article>
                } @empty {
                  <p class="notice">No saved balance is available.</p>
                }
              </div>
            </section>
            <section class="detail-card">
              <h3>Date conflicts</h3>
              <p class="notice">
                {{
                  detail()!.conflicts.length
                    ? detail()!.conflicts.length +
                      " approved requests overlap this period."
                    : "No approved overlapping leave was found."
                }}
              </p>
            </section>
            @if (detail()!.leave.status === "pending") {
              <label
                >Decision note<textarea
                  [(ngModel)]="reason"
                  placeholder="Required for rejection"
                ></textarea>
              </label>
            }
          }
        </div>
        @if (detail()?.leave?.status === "pending") {
          <footer class="actions">
            <button
              class="button primary"
              [disabled]="submitting()"
              (click)="decide('approve')"
            >
              Approve</button
            ><button
              class="button danger"
              [disabled]="submitting() || !reason.trim()"
              (click)="decide('reject')"
            >
              Reject
            </button>
          </footer>
        }
      </aside>
    }
  </article>`,
  styleUrls: ["./owner-shell.styles.css", "./owner-people.pages.css"],
})
export class OwnerLeavePage implements OnDestroy {
  @ViewChild("drawer") drawer?: ElementRef<HTMLElement>;
  readonly items = signal<OwnerLeave[]>([]);
  readonly loading = signal(true);
  readonly detailLoading = signal(false);
  readonly detailError = signal("");
  readonly detail = signal<OwnerLeaveDetail | null>(null);
  readonly view = signal("pending");
  readonly from = signal("");
  readonly to = signal("");
  readonly message = signal("");
  readonly isError = signal(false);
  readonly submitting = signal(false);
  readonly page = signal<OwnerPageInfo | null>(null);
  readonly views = ["pending", "approved", "rejected", "upcoming", "past"];
  search = "";
  reason = "";
  private request = 0;
  private detailRequest = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  readonly pageSize = 50;
  private trigger: HTMLElement | null = null;
  constructor(
    readonly context: OwnerContextService,
    private api: OwnerAppService,
    route: ActivatedRoute,
  ) {
    const query = route.snapshot.queryParamMap;
    this.search = query.get("search") || query.get("id") || "";
    const status = query.get("status");
    if (status && this.views.includes(status)) this.view.set(status);
    effect(() => {
      const b = this.context.selectedBranchId() || "all",
        r = this.context.periodRange();
      untracked(() => {
        this.from.set(r.start);
        this.to.set(r.end);
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
  async load(branch = this.context.selectedBranchId() || "all") {
    const id = ++this.request;
    this.loading.set(true);
    try {
      const r = await this.api.ownerLeaves({
        branchId: branch,
        from: this.from(),
        to: this.to(),
        view: this.view(),
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
        this.message.set("Leave requests could not be loaded.");
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
  async open(row: OwnerLeave, e: Event) {
    const request = ++this.detailRequest;
    this.trigger = e.currentTarget as HTMLElement;
    this.detailLoading.set(true);
    this.detail.set({
      leave: row,
      balances: [],
      conflicts: [],
      history: [],
      availability: { documents: { available: false, reason: "Loading" } },
      capabilities: { actions: [] },
    });
    document.documentElement.classList.add("staff-overlay-open");
    setTimeout(() => this.drawer?.nativeElement.focus());
    try {
      const detail = await this.api.ownerLeaveDetail(row.id);
      if (request === this.detailRequest) {
        this.detail.set(detail);
        this.detailError.set("");
      }
    } catch {
      if (request === this.detailRequest) {
        this.detailError.set("Leave detail could not be loaded. Please try again.");
      }
    } finally {
      if (request === this.detailRequest) this.detailLoading.set(false);
    }
  }
  close(restoreFocus = true) {
    this.detailRequest++;
    this.detail.set(null);
    this.detailError.set("");
    this.reason = "";
    document.documentElement.classList.remove("staff-overlay-open");
    if (restoreFocus) setTimeout(() => this.trigger?.focus());
  }
  async decide(d: "approve" | "reject") {
    const row = this.detail()?.leave;
    if (!row || this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.api.decideOwnerLeave(row.id, d, {
        version: row.version,
        reason: d === "reject" ? this.reason : undefined,
      });
      this.message.set(`Leave ${d === "approve" ? "approved" : "rejected"}.`);
      this.isError.set(false);
      this.close();
      this.items.set([]);
      await this.load();
    } catch {
      this.message.set(
        "This request changed or the decision could not be saved. Refresh and review it again.",
      );
      this.isError.set(true);
    } finally {
      this.submitting.set(false);
    }
  }
  @HostListener("window:keydown", ["$event"]) key(e: KeyboardEvent) {
    if (e.key === "Escape" && this.detail()) this.close();
  }
  label(v: string) {
    return v.replaceAll("_", " ");
  }
}

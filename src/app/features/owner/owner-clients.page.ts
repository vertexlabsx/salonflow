import { Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, effect, signal, untracked } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import { ClientForm, clientFormFromDetail, clientPayloadFromForm, emptyClientForm } from "./owner-clients.form";
import { OwnerClient, OwnerClientDetail, OwnerOperationsMetadata, OwnerOperationsPage } from "./owner-operations.models";

type ClientMode = "view" | "edit" | "create";

@Component({
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, PaiseInrPipe],
  template: `
<article class="ops-page" [attr.aria-busy]="loading()">
  <header class="ops-header">
    <div>
      <p class="ops-eyebrow">Client relationships</p>
      <h1>Clients</h1>
      <p>Search authoritative client records, visit history and financial relationship across your assigned branches.</p>
    </div>
    @if (!blockingError()) {
      <div class="ops-actions">
        <button class="ops-button primary" type="button" (click)="newClient()">New client</button>
        <button class="ops-button" type="button" [disabled]="loading()" (click)="load()">{{ loading() ? 'Refreshing...' : 'Refresh' }}</button>
      </div>
    }
  </header>

  @if (metadata()?.partial) { <p class="ops-notice" role="status">Some profile sources are unavailable. Saved client, appointment, purchase and membership data remains visible.</p> }
  @if (refreshError()) { <p class="ops-notice error" role="alert">{{ refreshError() }}</p> }

  <section class="ops-toolbar" aria-label="Client filters">
    <label class="ops-field ops-search"><span>Search clients</span><input type="search" [ngModel]="search()" (ngModelChange)="searchChanged($event)" placeholder="Name, phone, email or client ID" autocomplete="off" />@if(search()){<button type="button" (click)="clearSearch()" aria-label="Clear client search">x</button>}</label>
    <label class="ops-field"><span>Relationship</span><select [ngModel]="relationship()" (ngModelChange)="relationship.set($event); filtersChanged()"><option value="">All clients</option><option value="new">New</option><option value="returning">Returning</option></select></label>
    <label class="ops-field"><span>Status</span><select [ngModel]="status()" (ngModelChange)="status.set($event); filtersChanged()"><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    <label class="ops-field"><span>Balance</span><select [ngModel]="outstanding()" (ngModelChange)="outstanding.set($event); filtersChanged()"><option value="">Any balance</option><option value="yes">Outstanding only</option></select></label>
    <label class="ops-field"><span>Last visit</span><select [ngModel]="lastVisit()" (ngModelChange)="lastVisit.set($event); filtersChanged()"><option value="">Any time</option><option value="range">Current period</option><option value="never">Never visited</option></select></label>
  </section>

  <section class="ops-panel" aria-labelledby="client-results-title">
    <header class="ops-panel-head"><h2 id="client-results-title">Client directory</h2><span>{{ page()?.total || 0 }} clients</span></header>
    @if (loading() && !items().length) { <div class="ops-skeleton" aria-label="Loading clients"><i></i><i></i><i></i><i></i></div> }
    @else if (blockingError()) { <div class="ops-state" role="alert"><span>!</span><h2>Clients unavailable</h2><p>{{ blockingError() }}</p><button class="ops-button" type="button" (click)="load()">Try again</button></div> }
    @else if (!items().length) { <div class="ops-state"><span>-</span><h2>No matching clients</h2><p>Clear or change the current filters to broaden the directory.</p><button class="ops-button" type="button" (click)="resetFilters()">Clear filters</button></div> }
    @else {
      <table class="ops-table"><thead><tr><th style="width:26%">Client</th><th>Branch</th><th>Relationship</th><th>Spend</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>@for(client of items();track client.id){<tr tabindex="0" (click)="open(client,$event)" (keydown.enter)="open(client,$event)" [class.selected]="detail()?.client?.id===client.id"><td><strong>{{ client.name }}</strong><small>{{ maskedContact(client) }}</small></td><td><strong>{{ client.branchName }}</strong><small>{{ client.id }}</small></td><td><strong>{{ client.visitCount }} visits</strong><small>{{ client.lastVisitAt ? date(client.lastVisitAt) : 'No recorded visit' }}</small></td><td><strong>{{ client.totalSpendPaise | paiseInr }}</strong><small>Recorded total</small></td><td><strong>{{ client.outstandingPaise | paiseInr }}</strong><small>Open invoices</small></td><td><span class="ops-status" [attr.data-tone]="client.status==='active'?'success':'neutral'">{{ client.status }}</span></td></tr>}</tbody></table>
      <div class="ops-cards">@for(client of items();track client.id){<button class="ops-card" type="button" (click)="open(client,$event)"><div><h3>{{ client.name }}</h3><span class="ops-status">{{ client.status }}</span></div><p>{{ maskedContact(client) }} · {{ client.branchName }}</p><small>{{ client.visitCount }} visits · {{ client.totalSpendPaise | paiseInr }} spend</small></button>}</div>
      <footer class="ops-pagination"><span>Page {{ page()?.page }} of {{ page()?.totalPages }}</span><button type="button" [disabled]="page()?.page===1||loading()" (click)="go(-1)" aria-label="Previous page">←</button><button type="button" [disabled]="!page()?.hasMore||loading()" (click)="go(1)" aria-label="Next page">→</button></footer>
    }
  </section>
</article>

@if (selected() || mode() === 'create') {
  <button class="ops-backdrop" type="button" (click)="close()" aria-label="Close client profile"></button>
  <aside class="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="client-detail-title" #drawer tabindex="-1">
    <header>
      <div><p class="ops-eyebrow">{{ mode() === 'create' ? 'New client' : 'Client 360' }}</p><h2 id="client-detail-title">{{ drawerTitle() }}</h2></div>
      <button class="ops-close" type="button" (click)="close()" aria-label="Close profile">x</button>
    </header>
    <div class="ops-drawer-body">
      @if (formError()) { <p class="ops-notice error" role="alert">{{ formError() }}</p> }
      @if (mode() === 'create' || mode() === 'edit') { <ng-container *ngTemplateOutlet="clientForm"></ng-container> }
      @else if(detailLoading()){<div class="ops-skeleton"><i></i><i></i></div>}
      @else if(detailError()){<div class="ops-state"><span>!</span><h2>Profile unavailable</h2><p>{{detailError()}}</p></div>}
      @else if(detail();as data){
        <section class="client-360-hero">
          <div class="client-avatar">{{ initials(data.client.name) }}</div>
          <div class="client-hero-copy">
            <span>{{ data.client.branchName }}</span>
            <strong>{{data.client.name}}</strong>
            <p>{{maskedContact(data.client)}}</p>
          </div>
          <button class="ops-button primary" type="button" (click)="editClient(data)">Edit</button>
        </section>
        <section class="client-signal-grid" aria-label="Client relationship signals">
          <article><span>Lifetime spend</span><strong>{{data.client.totalSpendPaise|paiseInr}}</strong><small>{{ data.client.visitCount }} recorded visits</small></article>
          <article [class.warning]="data.client.outstandingPaise > 0"><span>Outstanding</span><strong>{{data.client.outstandingPaise|paiseInr}}</strong><small>{{ data.client.outstandingPaise > 0 ? 'Needs follow-up' : 'Clear balance' }}</small></article>
          <article><span>Last visit</span><strong>{{data.client.lastVisitAt?date(data.client.lastVisitAt):'Never'}}</strong><small>{{data.membership?.planName||'No membership'}}</small></article>
        </section>
        <section class="client-quick-actions" aria-label="Client quick actions"><a [href]="phoneLink(data.client.phone)">Call</a><a [href]="whatsappLink(data.client.phone)" target="_blank" rel="noreferrer">WhatsApp</a><a [href]="emailLink(data.client.email)">Email</a></section>
        <section class="ops-detail-section"><h3>Relationship</h3><dl class="ops-detail-grid"><div><dt>Wallet</dt><dd>{{data.client.walletBalancePaise|paiseInr}}</dd></div><div><dt>Rewards</dt><dd>{{data.client.loyaltyPoints}} points</dd></div><div><dt>Membership</dt><dd>{{data.membership?.planName||'None recorded'}}</dd></div><div><dt>Package</dt><dd>{{data.client.packageName || 'None'}} · {{data.client.packageCreditsRemaining || 0}} credits</dd></div><div><dt>Subscription</dt><dd>{{data.client.subscriptionName || 'None'}} · {{data.client.subscriptionStatus || 'inactive'}}</dd></div><div><dt>Status</dt><dd>{{data.client.status}}</dd></div></dl></section>
        <section class="ops-detail-section"><h3>Profile</h3><dl class="ops-detail-grid"><div><dt>Gender</dt><dd>{{data.client.gender || 'Not set'}}</dd></div><div><dt>Birthday</dt><dd>{{data.client.birthday ? date(data.client.birthday) : 'Not set'}}</dd></div><div><dt>Anniversary</dt><dd>{{data.client.anniversary ? date(data.client.anniversary) : 'Not set'}}</dd></div><div><dt>Address</dt><dd>{{data.client.address || 'Not set'}}</dd></div></dl></section>
        @if(data.client.notes){<section class="ops-detail-section"><h3>Notes</h3><p>{{data.client.notes}}</p></section>}
        <section class="ops-detail-section"><h3>Appointments</h3><div class="client-timeline">@for(item of data.appointments;track item.id){<article><time>{{dateTime(item.startAt)}}</time><strong>{{item.notes || 'Service visit'}}</strong><p>{{item.staffName || 'Unassigned'}} · {{item.branchName}}</p><span>{{item.status}}</span></article>}@empty{<p>No saved appointments in the accessible branch scope.</p>}</div></section>
        <section class="ops-detail-section"><h3>Purchases</h3><div class="client-timeline">@for(item of data.purchases;track item.id){<article><time>{{dateTime(item.createdAt)}}</time><strong>{{item.invoiceNumber||'Sale'}} · {{item.totalPaise|paiseInr}}</strong><p>{{item.branchName}} · Balance {{item.balancePaise|paiseInr}}</p><span>{{item.status}}</span></article>}@empty{<p>No saved purchases in the accessible branch scope.</p>}</div></section>
      }
    </div>
  </aside>
}

<ng-template #clientForm>
  <form class="client-form" (ngSubmit)="saveClient()">
    <div class="client-form-intro"><span>{{ mode() === 'create' ? 'Capture once, reuse everywhere' : 'Profile intelligence' }}</span><strong>{{ mode() === 'create' ? 'Create a clean client record' : 'Keep salon preferences current' }}</strong><p>Use tags and notes for formulas, allergies, VIP handling and retention follow-ups.</p></div>
    <label class="ops-field"><span>Name</span><input name="name" required [(ngModel)]="form.name" autocomplete="name" /></label>
    @if (mode() === 'create') { <label class="ops-field"><span>Phone</span><input name="phone" required [(ngModel)]="form.phone" autocomplete="tel" /></label> }
    <label class="ops-field"><span>Email</span><input name="email" type="email" [(ngModel)]="form.email" autocomplete="email" /></label>
    <label class="ops-field"><span>Gender</span><input name="gender" [(ngModel)]="form.gender" placeholder="Optional" /></label>
    <label class="ops-field"><span>Birthday</span><input name="birthday" type="date" [(ngModel)]="form.birthday" /></label>
    <label class="ops-field"><span>Anniversary</span><input name="anniversary" type="date" [(ngModel)]="form.anniversary" /></label>
    <label class="ops-field client-form-wide"><span>Tags</span><input name="tags" [(ngModel)]="form.tags" placeholder="VIP, keratin, bridal" /></label>
    <label class="ops-field client-form-wide"><span>Address</span><input name="address" [(ngModel)]="form.address" /></label>
    <label class="ops-field"><span>Wallet balance</span><input name="walletBalancePaise" type="number" min="0" step="100" [(ngModel)]="form.walletBalancePaise" /></label>
    <label class="ops-field"><span>Loyalty points</span><input name="loyaltyPoints" type="number" min="0" step="1" [(ngModel)]="form.loyaltyPoints" /></label>
    <label class="ops-field"><span>Membership plan</span><input name="membershipPlanName" [(ngModel)]="form.membershipPlanName" placeholder="Gold bridal care" /></label>
    <label class="ops-field"><span>Membership status</span><input name="membershipStatus" [(ngModel)]="form.membershipStatus" placeholder="active" /></label>
    <label class="ops-field"><span>Plan credits</span><input name="membershipCredits" type="number" min="0" step="1" [(ngModel)]="form.membershipCredits" /></label>
    <label class="ops-field"><span>Credits left</span><input name="membershipCreditsRemaining" type="number" min="0" step="1" [(ngModel)]="form.membershipCreditsRemaining" /></label>
    <label class="ops-field"><span>Valid until</span><input name="membershipValidUntil" type="date" [(ngModel)]="form.membershipValidUntil" /></label>
    <label class="ops-field"><span>Package</span><input name="packageName" [(ngModel)]="form.packageName" placeholder="Hair spa bundle" /></label>
    <label class="ops-field"><span>Package credits</span><input name="packageCreditsRemaining" type="number" min="0" step="1" [(ngModel)]="form.packageCreditsRemaining" /></label>
    <label class="ops-field"><span>Subscription</span><input name="subscriptionName" [(ngModel)]="form.subscriptionName" placeholder="Monthly grooming" /></label>
    <label class="ops-field"><span>Subscription status</span><input name="subscriptionStatus" [(ngModel)]="form.subscriptionStatus" placeholder="active" /></label>
    <label class="ops-field client-form-wide"><span>Notes</span><textarea name="notes" [(ngModel)]="form.notes" rows="4" placeholder="Preferences, sensitivities, formula notes"></textarea></label>
    <footer class="client-form-actions"><button class="ops-button" type="button" (click)="cancelForm()">Cancel</button><button class="ops-button primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save client' }}</button></footer>
  </form>
</ng-template>
`,
  styleUrls: ["./owner-shell.styles.css", "./owner-operations.css"],
  styles: [`
    .client-360-hero{position:relative;display:grid;grid-template-columns:68px minmax(0,1fr) auto;align-items:center;gap:14px;overflow:hidden;border:1px solid color-mix(in srgb,var(--owner-accent) 34%,var(--owner-line));border-radius:20px;padding:18px;background:radial-gradient(circle at 12% 0,color-mix(in srgb,var(--owner-accent) 26%,transparent),transparent 34%),linear-gradient(135deg,var(--owner-panel-2),var(--owner-panel));box-shadow:var(--owner-shadow)}
    .client-360-hero:after{content:"";position:absolute;right:-42px;bottom:-52px;width:150px;height:150px;border:1px solid color-mix(in srgb,var(--owner-accent) 22%,transparent);border-radius:50%}
    .client-avatar{display:grid;place-items:center;width:68px;height:68px;border:1px solid color-mix(in srgb,var(--owner-accent) 40%,var(--owner-line));border-radius:20px;background:linear-gradient(145deg,var(--owner-accent),var(--owner-accent-strong));color:#fff;font-family:Georgia,serif;font-size:1.28rem;font-weight:600;letter-spacing:.02em;box-shadow:0 14px 30px color-mix(in srgb,var(--owner-accent) 24%,transparent)}
    .client-hero-copy{display:grid;min-width:0;gap:3px}.client-hero-copy span{color:var(--owner-accent-strong);font-size:.57rem;font-weight:850;letter-spacing:.11em;text-transform:uppercase}.client-hero-copy strong{overflow:hidden;color:var(--owner-text);font-family:Georgia,serif;font-size:1.55rem;font-weight:500;letter-spacing:-.03em;text-overflow:ellipsis;white-space:nowrap}.client-hero-copy p{margin:0;color:var(--owner-muted);font-size:.64rem}
    .client-signal-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.client-signal-grid article{display:grid;gap:5px;min-height:104px;border:1px solid var(--owner-line);border-radius:16px;padding:13px;background:var(--owner-panel)}.client-signal-grid article.warning{border-color:color-mix(in srgb,var(--owner-warning) 38%,var(--owner-line));background:color-mix(in srgb,var(--owner-warning) 9%,var(--owner-panel))}.client-signal-grid span{color:var(--owner-faint);font-size:.54rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.client-signal-grid strong{color:var(--owner-text);font-family:Inter,system-ui,sans-serif;font-size:1.05rem;font-weight:800;letter-spacing:-.03em}.client-signal-grid small{color:var(--owner-muted);font-size:.56rem;line-height:1.35}
    .client-quick-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.client-quick-actions a{display:grid;place-items:center;min-height:42px;border:1px solid var(--owner-line);border-radius:13px;background:var(--owner-panel);color:var(--owner-accent-strong);font-size:.62rem;font-weight:850;text-decoration:none}.client-quick-actions a:hover{border-color:var(--owner-accent);background:var(--owner-accent-soft)}
    .client-tag-row{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.client-tag-row span{border:1px solid var(--owner-line);border-radius:999px;padding:4px 8px;background:var(--owner-panel);color:var(--owner-muted);font-size:.55rem;font-weight:750}
    .client-timeline{display:grid;gap:9px}.client-timeline article{position:relative;display:grid;gap:4px;border:1px solid var(--owner-line);border-radius:15px;padding:12px 12px 12px 16px;background:linear-gradient(90deg,var(--owner-panel-2),var(--owner-panel))}.client-timeline article:before{content:"";position:absolute;left:0;top:13px;bottom:13px;width:3px;border-radius:999px;background:var(--owner-accent)}.client-timeline time{color:var(--owner-faint);font-size:.52rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.client-timeline strong{color:var(--owner-text);font-size:.7rem}.client-timeline p{margin:0;color:var(--owner-muted);font-size:.6rem;line-height:1.4}.client-timeline span{justify-self:start;border:1px solid var(--owner-line);border-radius:999px;padding:3px 7px;color:var(--owner-muted);font-size:.5rem;font-weight:800;text-transform:capitalize}
    .client-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.client-form-intro{grid-column:1/-1;border:1px solid color-mix(in srgb,var(--owner-accent) 28%,var(--owner-line));border-radius:18px;padding:15px;background:linear-gradient(135deg,var(--owner-accent-soft),var(--owner-panel))}.client-form-intro span{color:var(--owner-accent-strong);font-size:.55rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.client-form-intro strong{display:block;margin-top:5px;font-family:Georgia,serif;font-size:1.25rem;font-weight:500}.client-form-intro p{margin:5px 0 0;color:var(--owner-muted);font-size:.62rem;line-height:1.45}.client-form textarea{min-height:110px;padding:12px;resize:vertical}.client-form-wide,.client-form-actions{grid-column:1/-1}.client-form-actions{display:flex;justify-content:flex-end;gap:9px;position:sticky;bottom:-90px;margin-top:4px;border-top:1px solid var(--owner-line);padding-top:12px;background:var(--owner-panel)}
    @media(max-width:600px){.client-360-hero{grid-template-columns:54px minmax(0,1fr);padding:14px}.client-360-hero .ops-button{grid-column:1/-1}.client-avatar{width:54px;height:54px;border-radius:16px;font-size:1rem}.client-signal-grid{grid-template-columns:1fr}.client-form{grid-template-columns:1fr}.client-form-actions{bottom:-90px}}
  `]
})
export class OwnerClientsPage implements OnDestroy {
  @ViewChild("drawer") drawer?: ElementRef<HTMLElement>;

  readonly items = signal<OwnerClient[]>([]);
  readonly page = signal<OwnerOperationsPage | null>(null);
  readonly metadata = signal<OwnerOperationsMetadata | null>(null);
  readonly loading = signal(true);
  readonly blockingError = signal("");
  readonly refreshError = signal("");
  readonly search = signal("");
  readonly debouncedSearch = signal("");
  readonly relationship = signal("");
  readonly status = signal("");
  readonly outstanding = signal("");
  readonly lastVisit = signal("");
  readonly selected = signal<OwnerClient | null>(null);
  readonly detail = signal<OwnerClientDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal("");
  readonly mode = signal<ClientMode>("view");
  readonly saving = signal(false);
  readonly formError = signal("");
  readonly drawerTitle = computed(() => this.mode() === "create" ? "Create client" : this.detail()?.client.name || this.selected()?.name || "Client profile");

form = emptyClientForm();
  private requestId = 0;
  private detailRequestId = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private trigger: HTMLElement | null = null;

  constructor(private owner: OwnerAppService, readonly context: OwnerContextService, route: ActivatedRoute) {
    const query = route.snapshot.queryParamMap;
    const relationship = query.get("relationship") || query.get("clientState");
    if (relationship === "new" || relationship === "returning") this.relationship.set(relationship);
    const search = query.get("search") || query.get("id") || "";
    this.search.set(search);
    this.debouncedSearch.set(search);
    effect(() => {
      const branch = this.context.selectedBranchId();
      const range = this.context.periodRange();
      untracked(() => { void branch; void range; this.items.set([]); this.page.set(null); this.metadata.set(null); this.close(false); void this.load(); });
    });
  }

  ngOnDestroy() { if (this.timer) clearTimeout(this.timer); this.requestId++; this.detailRequestId++; document.documentElement.classList.remove("staff-overlay-open"); }
  searchChanged(value: string) { this.search.set(value); if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.debouncedSearch.set(value.trim()); this.items.set([]); this.page.set(null); void this.load(); }, 350); }
  clearSearch() { this.search.set(""); this.debouncedSearch.set(""); this.items.set([]); this.page.set(null); void this.load(); }
  filtersChanged() { this.items.set([]); this.page.set(null); void this.load(); }

  async load() {
    const request = ++this.requestId;
    this.loading.set(true);
    this.refreshError.set("");
    const had = this.items().length > 0;
    try {
      const range = this.context.periodRange();
      const result = await this.owner.ownerClients({ branchId: this.context.selectedBranchId() || "all", page: this.page()?.page || 1, pageSize: 30, search: this.debouncedSearch(), relationship: this.relationship(), status: this.status(), outstanding: this.outstanding(), lastVisit: this.lastVisit(), from: range.start, to: range.end });
      if (request !== this.requestId) return;
      this.items.set(result.items);
      this.page.set(result.page);
      this.metadata.set(result.metadata);
      this.blockingError.set("");
      this.context.markSuccessfulRefresh();
    } catch {
      if (request !== this.requestId) return;
      if (had) this.refreshError.set("Refresh failed. Previously loaded clients remain visible.");
      else this.blockingError.set("Solastio could not load clients for this owner scope.");
    } finally { if (request === this.requestId) this.loading.set(false); }
  }

  go(delta: number) { const p = this.page(); if (!p) return; this.items.set([]); this.page.set({ ...p, page: p.page + delta }); void this.load(); }
  resetFilters() { this.relationship.set(""); this.status.set(""); this.outstanding.set(""); this.lastVisit.set(""); this.clearSearch(); }

  async open(client: OwnerClient, event: Event) {
    this.trigger = event.currentTarget as HTMLElement;
    this.selected.set(client);
    this.mode.set("view");
    this.formError.set("");
    this.detail.set(null);
    this.detailError.set("");
    this.detailLoading.set(true);
    document.documentElement.classList.add("staff-overlay-open");
    setTimeout(() => this.drawer?.nativeElement.focus());
    const request = ++this.detailRequestId;
    try {
      const result = await this.owner.ownerClient(client.id, this.context.selectedBranchId() || "all");
      if (request === this.detailRequestId) this.detail.set(result);
    } catch { if (request === this.detailRequestId) this.detailError.set("The saved profile could not be loaded. Try again."); }
    finally { if (request === this.detailRequestId) this.detailLoading.set(false); }
  }

  newClient() { this.trigger = document.activeElement as HTMLElement; this.selected.set(null); this.detail.set(null); this.mode.set("create"); this.form = emptyClientForm(); this.formError.set(""); document.documentElement.classList.add("staff-overlay-open"); setTimeout(() => this.drawer?.nativeElement.focus()); }
  editClient(data: OwnerClientDetail) { this.mode.set("edit"); this.formError.set(""); this.form = clientFormFromDetail(data); }
  cancelForm() { if (this.mode() === "create") this.close(); else this.mode.set("view"); }

  async saveClient() {
    const name = this.form.name.trim();
    const phone = this.form.phone.trim();
    if (!name || (this.mode() === "create" && !phone)) { this.formError.set("Name and phone are required for a new client."); return; }
    this.saving.set(true);
    this.formError.set("");
    const payload = clientPayloadFromForm(this.form);
    try {
      if (this.mode() === "create") {
        const branchId = this.context.selectedBranchId();
        if (!branchId || branchId === "all") throw new Error("Select one branch before creating a client.");
        const created = await this.owner.createOwnerClient({ branchId, phone, ...payload });
        this.search.set(name);
        this.debouncedSearch.set(name);
        await this.load();
        const client = this.items().find((item) => item.id === created.id) || this.items()[0];
        if (client) await this.open(client, { currentTarget: this.trigger || document.body } as unknown as Event);
      } else {
        const id = this.detail()?.client.id || this.selected()?.id;
        if (!id) throw new Error("Client profile is not loaded.");
        await this.owner.updateOwnerClient(id, payload);
        const client = this.selected();
        if (client) await this.open(client, { currentTarget: this.trigger || document.body } as unknown as Event);
        await this.load();
      }
    } catch (error) { this.formError.set(error instanceof Error ? error.message : "Client could not be saved. Try again."); }
    finally { this.saving.set(false); }
  }

  close(restoreFocus = true) { this.detailRequestId++; this.selected.set(null); this.detail.set(null); this.mode.set("view"); this.formError.set(""); document.documentElement.classList.remove("staff-overlay-open"); if (restoreFocus) setTimeout(() => this.trigger?.focus()); }
  @HostListener("window:keydown", ["$event"]) keydown(event: KeyboardEvent) { if (!this.selected() && this.mode() !== "create") return; if (event.key === "Escape") { event.preventDefault(); this.close(); return; } if (event.key !== "Tab") return; const nodes = this.drawer?.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'); if (!nodes?.length) return; const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  maskedContact(client: Pick<OwnerClient, "phone" | "email">) { const phone = client.phone ? `•••• ${client.phone.replace(/\D/g, "").slice(-4)}` : "No phone"; return client.email ? `${phone} · ${client.email.replace(/^(.).+(@.*)$/, "$1•••$2")}` : phone; }
  date(value: string) { return this.context.formatDate(value); }
  dateTime(value: string) { return this.context.formatDateTime(value); }
  initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CL"; }
  phoneLink(phone: string) { const normalized = phone.replace(/\D/g, ""); return normalized ? `tel:+${normalized}` : "#"; }
  whatsappLink(phone: string) { const normalized = phone.replace(/\D/g, ""); return normalized ? `https://wa.me/${normalized}` : "#"; }
  emailLink(email: string) { return email ? `mailto:${email}` : "#"; }
}

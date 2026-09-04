import { Component, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import {
  StaffAppService,
  StaffClientDetail,
  StaffClientDirectoryItem,
  StaffClientWrite
} from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

type ClientForm = {
  name: string; phone: string; email: string; gender: string; birthday: string; anniversary: string; tags: string; notes: string; address: string; walletBalancePaise: number; loyaltyPoints: number; membershipPlanName: string; membershipCredits: number; membershipCreditsRemaining: number; membershipValidUntil: string; membershipStatus: string; packageName: string; packageCreditsRemaining: number; subscriptionName: string; subscriptionStatus: string;
};

type FormMode = "create" | "edit" | "view";

const emptyForm = (): ClientForm => ({
  name: "", phone: "", email: "", gender: "", birthday: "", anniversary: "", tags: "", notes: "", address: "",
  walletBalancePaise: 0, loyaltyPoints: 0, membershipPlanName: "", membershipCredits: 0, membershipCreditsRemaining: 0,
  membershipValidUntil: "", membershipStatus: "", packageName: "", packageCreditsRemaining: 0, subscriptionName: "", subscriptionStatus: ""
});

const safeNumber = (value: number): number => Math.max(0, Number(value || 0));
const splitTags = (raw: string): string[] => raw.split(",").map((t) => t.trim()).filter(Boolean);
const shortDate = (value: string): string => (value ? value.slice(0, 10) : "");

const payloadFromForm = (form: ClientForm): StaffClientWrite => ({
  name: form.name.trim(), email: form.email.trim(), gender: form.gender.trim(), birthday: form.birthday,
  anniversary: form.anniversary, tags: splitTags(form.tags), notes: form.notes.trim(), address: form.address.trim(),
  walletBalancePaise: safeNumber(form.walletBalancePaise), loyaltyPoints: safeNumber(form.loyaltyPoints),
  membershipPlanName: form.membershipPlanName.trim(), membershipCredits: safeNumber(form.membershipCredits),
  membershipCreditsRemaining: safeNumber(form.membershipCreditsRemaining), membershipValidUntil: form.membershipValidUntil,
  membershipStatus: form.membershipStatus.trim(), packageName: form.packageName.trim(),
  packageCreditsRemaining: safeNumber(form.packageCreditsRemaining), subscriptionName: form.subscriptionName.trim(),
  subscriptionStatus: form.subscriptionStatus.trim()
});

const formFromDetail = (d: StaffClientDetail): ClientForm => ({
  ...emptyForm(),
  name: d.client.name || "", phone: d.client.phone || "", email: d.client.email || "", gender: d.client.gender || "",
  birthday: shortDate(d.client.birthday), anniversary: shortDate(d.client.anniversary),
  tags: (d.client.tags || []).join(", "), notes: d.client.notes || "", address: d.client.address || "",
  walletBalancePaise: d.client.walletBalancePaise || 0, loyaltyPoints: d.client.loyaltyPoints || 0,
  membershipPlanName: d.client.membershipPlanName || d.membership?.planName || "",
  membershipCredits: d.membership?.planCredits || 0, membershipCreditsRemaining: d.membership?.creditsRemaining || 0,
  membershipValidUntil: shortDate(d.membership?.validityDate || ""), membershipStatus: d.membership?.status || "",
  packageName: d.client.packageName || "", packageCreditsRemaining: d.client.packageCreditsRemaining || 0,
  subscriptionName: d.client.subscriptionName || "", subscriptionStatus: d.client.subscriptionStatus || ""
});

@Component({
  standalone: true,
  imports: [FormsModule, PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page clients-page">
      <header class="page-head">
        <div><p class="eyebrow">Client 360</p><h1>Client management</h1><p>Search the client directory, view history, and add or update clients your owner has given you access to.</p></div>
        @if (staff.hasPermission('create:clients')) {
          <button type="button" class="button primary" (click)="newClient(false)">＋ New client</button>
        }
      </header>

      <form class="panel client-search" (submit)="search(); $event.preventDefault()">
        <label><span>Search</span><input name="query" [(ngModel)]="query" placeholder="Name or phone" autocomplete="off" /></label>
        @if (branchOptions().length > 1) {
          <label><span>Branch</span><select [ngModel]="branchId()" (ngModelChange)="branchId.set($event); search()"><option value="">All assigned branches</option>@for (b of branchOptions(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }</select></label>
        }
        <button type="submit" class="button primary" [disabled]="loading()">{{ loading() ? 'Loading...' : 'Search' }}</button>
      </form>

      @if (error()) { <section staffPageState class="notice error" role="alert">{{ error() }}</section> }

      <section class="panel">
        <div class="panel-title"><h2>Client directory</h2><span>{{ directory()?.page?.total || 0 }} clients</span></div>
        @if (loading() && !directory()?.items?.length) { <p class="empty">Loading directory…</p> }
        @else if (directory()?.items?.length) {
          <div class="list">
            @for (item of directory()!.items; track item.id) {
              <button type="button" class="row directory-row" (click)="open($event, item.id)">
                <div class="row-main"><strong>{{ item.name }}</strong><small>{{ masked(item.phone) }} · {{ item.branchName }}</small></div>
                <span class="badge">{{ item.visitCount }} visits</span>
              </button>
            }
          </div>
        } @else if (!loading()) { <p class="empty">{{ query.trim() ? 'No clients match that search.' : 'Search by name or phone to find a client.' }}</p> }
      </section>

      @if (detail(); as data) {
        <article class="panel dark client-hero">
          <div><p class="eyebrow">{{ data.client.branchName }}</p><h2>{{ data.client.name }}</h2><p>{{ masked(data.client.phone) }}{{ data.client.email ? ' · ' + data.client.email : '' }}</p></div>
          <div class="grid three client-kpis"><article class="kpi"><span>Visits</span><strong>{{ data.client.visitCount }}</strong></article><article class="kpi"><span>Spend</span><strong>{{ data.client.totalSpendPaise | paiseInr }}</strong></article><article class="kpi"><span>Due</span><strong>{{ data.client.outstandingPaise | paiseInr }}</strong></article></div>
          @if (staff.hasPermission('update:clients')) { <button type="button" class="button primary" (click)="edit(data)">Edit client</button> }
        </article>
        @if (data.client.notes || data.client.tags.length) { <article class="panel"><div class="panel-title"><h2>Profile notes</h2></div>@if(data.client.tags.length){<p class="tags">@for(tag of data.client.tags; track tag){<span class="badge">{{ tag }}</span>}</p>}@if(data.client.notes){<p>{{ data.client.notes }}</p>}</article> }
        <section class="panel"><div class="panel-title"><h2>Visit history</h2><span>{{ data.appointments.length }}</span></div><div class="list">@for(item of data.appointments; track item.id){<article class="row"><div class="row-main"><strong>{{ dateTime(item.startAt) }} · {{ item.status }}</strong><small>{{ item.serviceNames.join(', ') || 'Service not recorded' }} · {{ item.staffName }}</small></div><span class="badge">{{ item.spendPaise | paiseInr }}</span></article>}@empty{<p class="empty">No visits in your assigned branch scope.</p>}</div></section>
        <section class="panel"><div class="panel-title"><h2>Purchases & balances</h2><span>{{ data.purchases.length }}</span></div><div class="list">@for(item of data.purchases; track item.id){<article class="row"><div class="row-main"><strong>{{ item.invoiceNumber }} · {{ item.totalPaise | paiseInr }}</strong><small>{{ item.status }} · Balance {{ item.balancePaise | paiseInr }} · {{ dateTime(item.createdAt) }}</small></div></article>}@empty{<p class="empty">No invoices in your assigned branch scope.</p>}</div></section>
      }

      @if (mode() === 'create' || mode() === 'edit') {
        <section class="panel" role="dialog" aria-modal="false" aria-labelledby="client-form-title">
          <div class="panel-title"><h2 id="client-form-title">{{ mode() === 'create' ? 'New client' : 'Edit client' }}</h2><button type="button" class="button" (click)="cancelForm()">Cancel</button></div>
          @if (formError()) { <p class="notice error" role="alert">{{ formError() }}</p> }
          @if (mode() === 'create') {
            <p class="form-intro">Capture a walk-in or new client. A phone number is required so the salon can recognise returning guests.</p>
          } @else {
            <p class="form-intro">Editing a client notifies the owner. Changes are branch-scoped to your access.</p>
          }
          <form (ngSubmit)="save($event)">
            <div class="client-form-grid">
              <label><span>Name <b>*</b></span><input name="name" required [(ngModel)]="form.name" autocomplete="name" /></label>
              @if (mode() === 'create') { <label><span>Phone <b>*</b></span><input name="phone" required [(ngModel)]="form.phone" autocomplete="tel" /></label> }
              <label><span>Email</span><input name="email" type="email" [(ngModel)]="form.email" autocomplete="email" /></label>
              <label><span>Gender</span><input name="gender" [(ngModel)]="form.gender" /></label>
              <label><span>Birthday</span><input name="birthday" type="date" [(ngModel)]="form.birthday" /></label>
              <label><span>Anniversary</span><input name="anniversary" type="date" [(ngModel)]="form.anniversary" /></label>
              <label><span>Tags</span><input name="tags" [(ngModel)]="form.tags" placeholder="VIP, bridal" /></label>
              <label class="wide"><span>Address</span><input name="address" [(ngModel)]="form.address" /></label>
              <label><span>Wallet (₹)</span><input name="wallet" type="number" min="0" step="1" [(ngModel)]="form.walletBalancePaise" /></label>
              <label><span>Loyalty points</span><input name="points" type="number" min="0" step="1" [(ngModel)]="form.loyaltyPoints" /></label>
              <label class="wide"><span>Notes</span><textarea name="notes" [(ngModel)]="form.notes" rows="3"></textarea></label>
            </div>
            <footer class="client-form-actions"><button type="button" class="button" (click)="cancelForm()">Cancel</button><button type="submit" class="button primary" [disabled]="saving()">{{ saving() ? 'Saving…' : mode() === 'create' ? 'Create client' : 'Save changes' }}</button></footer>
          </form>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .clients-page { display:grid; gap:18px; }
    .panel h2,.panel p { margin:0; }
    .page-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    .client-search { display:grid; grid-template-columns:1fr minmax(160px,220px) auto; gap:12px; align-items:end; }
    .client-search label { display:grid; gap:5px; }
    .client-search label span { color:var(--staff-text-secondary); font-weight:750; }
    .client-hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,480px) auto; gap:18px; align-items:center; }
    .client-hero h2 { margin:0; color:var(--staff-text); font-family:Georgia,"Times New Roman",serif; font-size:clamp(1.8rem,4vw,3rem); font-weight:500; letter-spacing:-.045em; }
    .client-hero p { color:var(--staff-text-secondary); font-weight:650; }
    .client-kpis { gap:10px; }
    .client-kpis .kpi { box-shadow:none; }
    .directory-row { width:100%; text-align:left; cursor:pointer; }
    .directory-row:hover strong { color:var(--staff-primary-hover); }
    .tags { display:flex; flex-wrap:wrap; gap:8px; }
    .form-intro { margin-bottom:12px; color:var(--staff-text-secondary); font-size:.82rem; line-height:1.5; }
    .client-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .client-form-grid label { display:grid; gap:5px; }
    .client-form-grid label span { color:var(--staff-text-secondary); font-weight:750; }
    .client-form-grid label b { color:var(--staff-danger, #c0392b); }
    .client-form-grid .wide { grid-column:1 / -1; }
    .client-form-grid textarea { resize: vertical; }
    .client-form-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
    .client-form-actions .button { min-height:44px; }
    @media (max-width:860px){.client-search{grid-template-columns:1fr}.client-search button{width:100%;}.client-hero{grid-template-columns:1fr;}.client-form-grid{grid-template-columns:1fr;}.client-form-grid .wide{grid-column:auto;}}
    @media (max-width:700px){.clients-page{gap:12px;padding-inline:14px}.clients-page .page-head{display:grid;align-items:start;gap:10px;padding:16px}.client-search{gap:10px}.client-search label span,.client-form-grid label span{font-size:.76rem}.client-hero{gap:12px}.client-hero h2{font-size:1.55rem;line-height:1.08}.client-hero p{font-size:.84rem;line-height:1.35}.client-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.directory-row{padding-block:12px}.tags{gap:6px}.client-form-actions{display:grid;grid-template-columns:1fr 1fr;position:sticky;bottom:calc(var(--staff-bottom-clearance) - 6px);z-index:3;padding:8px;border:1px solid var(--staff-border);border-radius:18px;background:var(--staff-surface-glass);backdrop-filter:blur(14px)}}
    @media (max-width:420px){.client-kpis{grid-template-columns:1fr}.client-form-actions{grid-template-columns:1fr}.client-form-actions .button{width:100%}}
  `]
})
export class StaffClientsPage {
  query = "";
  readonly branchId = signal("");
  readonly directory = signal<{ items: StaffClientDirectoryItem[]; page: { total: number } } | null>(null);
  readonly detail = signal<StaffClientDetail | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal("");
  readonly formError = signal("");
  readonly mode = signal<FormMode>("view");
  form: ClientForm = emptyForm();
  private currentId = "";

  constructor(readonly staff: StaffAppService) {}

  branchOptions(): { id: string; name: string }[] {
    const user = this.staff.user();
    if (!user?.branchIds?.length) return [];
    const names = user.branchName ? new Map([[user.branchId, user.branchName]]) : new Map<string, string>();
    return user.branchIds.map((id: string) => ({ id, name: names.get(id) || "Branch" }));
  }

  async search() {
    this.loading.set(true); this.error.set(""); this.detail.set(null); this.mode.set("view");
    try {
      const result = await this.staff.clientDirectory({ branchId: this.branchId() || "all", search: this.query.trim(), page: 1, pageSize: 50 });
      this.directory.set({ items: result.items, page: result.page });
    } catch {
      this.error.set(this.staff.error() || "Client directory could not be loaded.");
      this.directory.set(null);
    } finally { this.loading.set(false); }
  }

  async open(event: Event, id: string) {
    event.preventDefault();
    this.currentId = id;
    this.loading.set(true); this.error.set(""); this.mode.set("view");
    try {
      this.detail.set(await this.staff.clientDetail(id, this.branchId() || "all"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      this.error.set(this.staff.error() || "Client detail could not be loaded.");
    } finally { this.loading.set(false); }
  }

  newClient(_walkIn: boolean) {
    this.mode.set("create"); this.form = emptyForm(); this.formError.set(""); this.error.set("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  edit(data: StaffClientDetail) {
    this.mode.set("edit"); this.formError.set(""); this.error.set("");
    this.form = formFromDetail(data);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelForm() { this.mode.set("view"); this.formError.set(""); }

  async save(event: Event) {
    event.preventDefault(); event.stopPropagation();
    if (this.saving()) return;
    if (!this.form.name.trim()) { this.formError.set("Enter the client name."); return; }
    if (this.mode() === "create" && this.form.phone.replace(/\D/g, "").length < 5) { this.formError.set("Enter a valid phone number."); return; }
    this.saving.set(true); this.formError.set("");
    try {
      const payload = { ...payloadFromForm(this.form) } as StaffClientWrite & { branchId?: string; phone?: string };
      if (this.mode() === "create") {
        const branchId = this.branchId() || this.branchOptions()[0]?.id || "";
        await this.staff.createClient({ ...payload, branchId, phone: this.form.phone });
        this.formError.set("");
        this.mode.set("view");
        await this.search();
      } else {
        await this.staff.updateClient(this.currentId, payload);
        this.formError.set("");
        this.mode.set("view");
        await this.open(event, this.currentId);
        await this.search();
      }
    } catch {
      this.formError.set(this.staff.error() || "Client could not be saved.");
    } finally { this.saving.set(false); }
  }

  masked(phone: string): string { return phone ? `**** ${phone.replace(/\D/g, "").slice(-4)}` : "No phone"; }
  dateTime(value: string): string { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not recorded"; }
}

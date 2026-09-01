import { CommonModule } from "@angular/common";
import { Component, ElementRef, HostListener, ViewChild, computed, effect, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { OwnerAppService, OwnerPromo, OwnerPromoRedemption } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";

type PromoDialog = "create" | "detail" | "redeem" | null;

interface PromoForm {
  kind: "coupon" | "referral";
  code: string;
  label: string;
  description: string;
  discountType: "percent" | "flat";
  discountPercent: number;
  discountPaise: number;
  minimumSpendPaise: number;
  maxRedemptions: number | null;
  expiresAt: string;
  branchScope: "all" | "current";
  referrerRewardType: "percent" | "flat";
  referrerRewardPercent: number;
  referrerRewardPaise: number;
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <article class="adm-page" [attr.aria-busy]="loading()">
    <header class="adm-hero"><div><p class="adm-eyebrow">Growth · Coupons & referrals</p><h1>Create offers you can share from your phone.</h1><p>Coupon codes apply a discount to a client's bill. Referral codes reward referring clients. Manage, pause and review every redemption here.</p></div><div class="adm-actions">@if(!error()||items().length){<button class="adm-button" type="button" [disabled]="loading()" (click)="load(true)">⇄ Refresh</button>}<button class="adm-button primary" type="button" (click)="openCreate($event)">＋ New offer</button></div></header>
    @if(message()){<p class="adm-message" [class.error]="messageError()" [attr.role]="messageError()?'alert':'status'">{{message()}}</p>}
    <section class="adm-toolbar" aria-label="Promo filters"><label class="adm-field grow" for="promo-search">Search code or label<input id="promo-search" type="search" [ngModel]="search()" (ngModelChange)="search.set($event)" placeholder="e.g. WELCOME20, Refer a friend"></label><label class="adm-field" for="promo-kind">Type<select id="promo-kind" [ngModel]="kind()" (ngModelChange)="kind.set($event)"><option value="">All types</option><option value="coupon">Coupon</option><option value="referral">Referral</option></select></label><label class="adm-field" for="promo-status">Status<select id="promo-status" [ngModel]="status()" (ngModelChange)="status.set($event)"><option value="">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="expired">Expired</option><option value="exhausted">Exhausted</option></select></label></section>

    <section class="adm-panel"><header class="adm-panel-head"><h2>Your offers</h2><span>{{filtered().length}} shown</span></header>
      @if(loading()&&!items().length){<div class="adm-skeleton" aria-label="Loading offers"><i></i><i></i><i></i></div>}@else if(error()&&!items().length){<section class="adm-state" role="alert"><span>!</span><h2>Offers unavailable</h2><p>{{error()}}</p><button class="adm-button" (click)="load()">Try again</button></section>}@else if(!filtered().length){<div class="adm-state"><span>—</span><h2>No matching offers</h2><p>{{items().length?'Adjust the search or filters.':'Create your first coupon or referral offer to get started.'}}</p></div>}@else{
        <div class="adm-list">
        @for(promo of filtered();track promo._id??promo.id){
          <button type="button" (click)="openDetail(promo,$event)"><span class="adm-avatar">{{promo.kind==='referral'?'↗':'%'}}</span>
            <span class="promo-row-main"><strong>{{promo.label}}</strong><small class="promo-code">{{promo.code}} · {{promo.kind}}</small><small class="promo-meta">{{discountLabel(promo)}} · {{promo.redemptionCount}} used · {{(promo.totalDiscountPaise/100)|number:'1.0-0'}} saved</small></span>
            <span class="adm-status" [attr.data-active]="promo.status==='active'">{{promo.status}}</span>
          </button>
        }
        </div>
        <footer class="adm-pagination"><span>Page {{page()?.page||1}} of {{page()?.totalPages||1}} · {{page()?.total||0}} offers</span>@if(page()?.hasMore){<button class="adm-button" (click)="go(1)">Next →</button>}</footer>
      }
    </section>
  </article>

  @if(dialog()==='create'){
    <button class="adm-backdrop" type="button" (click)="closeDialog()" aria-label="Close"></button>
    <section class="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="promo-form-title" #modal tabindex="-1">
      <header><div><p class="adm-eyebrow">New offer</p><h2 id="promo-form-title">{{form.kind==='referral'?'Referral offer':'Coupon code'}}</h2></div><button class="adm-close" type="button" (click)="closeDialog()" aria-label="Close">×</button></header>
      <form id="promo-form" class="adm-form" (ngSubmit)="savePromo()">
        <div class="adm-seg"><button type="button" [class.on]="form.kind==='coupon'" (click)="form.kind='coupon'">Coupon</button><button type="button" [class.on]="form.kind==='referral'" (click)="form.kind='referral'">Referral</button></div>
        <label class="adm-field">Label / campaign name<input name="label" [(ngModel)]="form.label" required maxlength="120" placeholder="e.g. Welcome discount" [attr.aria-invalid]="submitted()&&!form.label.trim()"><span class="adm-error" *ngIf="submitted()&&!form.label.trim()">A label is required.</span></label>
        <label class="adm-field">Code<input name="code" [(ngModel)]="form.code" maxlength="32" placeholder="{{form.kind==='referral'?'Leave blank to auto-generate':'e.g. WELCOME20'}}"><small class="adm-hint">Letters & numbers only · codes are saved in capitals.</small></label>
        <label class="adm-field full">Description<textarea name="description" [(ngModel)]="form.description" rows="2" maxlength="400" placeholder="Visible to staff who apply this offer (optional)"></textarea></label>
        <div class="adm-seg"><span class="adm-seg-label">Discount</span><button type="button" [class.on]="form.discountType==='percent'" (click)="form.discountType='percent'">%</button><button type="button" [class.on]="form.discountType==='flat'" (click)="form.discountType='flat'">₹</button></div>
        <label class="adm-field" *ngIf="form.discountType==='percent'">Discount %<input name="discountPercent" type="number" [(ngModel)]="form.discountPercent" min="1" max="100" [attr.aria-invalid]="submitted()&&(form.discountPercent<=0||form.discountPercent>100)"><span class="adm-error" *ngIf="submitted()&&(form.discountPercent<=0||form.discountPercent>100)">Between 1 and 100.</span></label>
        <label class="adm-field" *ngIf="form.discountType==='flat'">Discount ₹<input name="discountPaise" type="number" [(ngModel)]="form.discountPaise" min="1" [attr.aria-invalid]="submitted()&&(form.discountPaise<=0)"><span class="adm-error" *ngIf="submitted()&&form.discountPaise<=0">Enter an amount.</span></label>
        <label class="adm-field">Minimum bill ₹<input name="minimumSpend" type="number" [(ngModel)]="form.minimumSpendPaise" min="0" placeholder="0 = no minimum"></label>
        <label class="adm-field">Usage limit<input name="maxRedemptions" type="number" [(ngModel)]="form.maxRedemptions" min="1" placeholder="Leave blank = unlimited"></label>
        <label class="adm-field">Valid until<input name="expiresAt" type="date" [(ngModel)]="form.expiresAt"></label>
        <div class="adm-seg"><span class="adm-seg-label">Branches</span><button type="button" [class.on]="form.branchScope==='all'" (click)="form.branchScope='all'">All</button><button type="button" [class.on]="form.branchScope==='current'" (click)="form.branchScope='current'">Current</button></div>
        @if(form.kind==='referral'){
          <section class="adm-note full"><strong>Referrer reward</strong>Choose a reward the referring client earns in addition to the referred client's discount.</section>
          <div class="adm-seg"><span class="adm-seg-label">Reward type</span><button type="button" [class.on]="form.referrerRewardType==='percent'" (click)="form.referrerRewardType='percent'">%</button><button type="button" [class.on]="form.referrerRewardType==='flat'" (click)="form.referrerRewardType='flat'">₹</button></div>
          <label class="adm-field" *ngIf="form.referrerRewardType==='percent'">Referrer reward %<input name="rrp" type="number" [(ngModel)]="form.referrerRewardPercent" min="0" max="100"></label>
          <label class="adm-field" *ngIf="form.referrerRewardType==='flat'">Referrer reward ₹<input name="rrf" type="number" [(ngModel)]="form.referrerRewardPaise" min="0"></label>
        }
      </form>
      <footer><button class="adm-button" type="button" (click)="closeDialog()">Cancel</button><button class="adm-button primary" type="submit" form="promo-form" [disabled]="submitting()">{{submitting()?'Saving…':'Create offer'}}</button></footer>
    </section>
  }

  @if(dialog()==='detail' && selected();as promo){
    <button class="adm-backdrop" type="button" (click)="closeDialog()" aria-label="Close"></button>
    <section class="adm-dialog adm-dialog-wide" role="dialog" aria-modal="true" [attr.aria-labelledby]="'promo-'+(promo._id??promo.id)" #modal tabindex="-1">
      <header><div><p class="adm-eyebrow">Offer detail</p><h2 [id]="'promo-'+(promo._id??promo.id)">{{promo.label}}</h2></div><button class="adm-close" type="button" (click)="closeDialog()" aria-label="Close">×</button></header>
      <div class="adm-detail">
        <div class="adm-detail-hero"><div><p class="adm-eyebrow">{{promo.kind}} code</p><h2>{{promo.code}} <span class="promo-copy" (click)="copyCode(promo)">copy</span></h2><p>{{discountLabel(promo)}} · {{promo.redemptionCount}} used · ₹{{(promo.totalDiscountPaise/100)|number:'1.0-0'}} discounted</p></div><div class="adm-actions">@if(promo.status==='active'){<button class="adm-button" (click)="setStatus(promo,'paused',true,$event)">Pause</button>}@else if(promo.status==='paused'){<button class="adm-button primary" (click)="setStatus(promo,'active',true,$event)">Activate</button>}<button class="adm-button" (click)="openRedeem(promo,$event)">Apply code</button></div></div>
        <dl class="adm-facts">
          <div><dt>Type</dt><dd>{{promo.kind}}</dd></div>
          <div><dt>Discount</dt><dd>{{discountLabel(promo)}}</dd></div>
          <div><dt>Minimum bill</dt><dd>₹{{(promo.minimumSpendPaise||0)/100|number:'1.0-0'}}</dd></div>
          <div><dt>Usage limit</dt><dd>{{promo.maxRedemptions?promo.maxRedemptions+' uses':'Unlimited'}}</dd></div>
          <div><dt>Used</dt><dd>{{promo.redemptionCount}} time{{promo.redemptionCount===1?'':(promo.redemptionCount===0?'s':'s')}}</dd></div>
          <div><dt>Branches</dt><dd>{{promo.anyBranch?'All branches':promo.branchIds.length+' branches'}}</dd></div>
          <div><dt>Expires</dt><dd>{{promo.expiresAt?promo.expiresAt.split('T')[0]:'Never'}}</dd></div>
          @if(promo.kind==='referral'){<div><dt>Referrer reward</dt><dd>{{promo.referrerRewardType==='flat'?'₹'+(promo.referrerRewardPaise||0)/100:promo.referrerRewardPercent+'%'}}</dd></div>}
        </dl>
        @if(promo.description){<p class="adm-note">{{promo.description}}</p>}
      </div>
      <section class="adm-panel"><header class="adm-panel-head"><h3>Redemptions</h3><span>{{redemptions().length}}</span></header>
        @if(redemptionsLoading()){<div class="adm-skeleton"><i></i><i></i></div>}@else if(!redemptions().length){<div class="adm-state"><span>—</span><h2>No redemptions yet</h2><p>Staff will see this code when they apply it to a client's bill.</p></div>}@else{
          <div class="adm-list compact">@for(r of redemptions();track r._id??r.id){<div class="promo-redeem-row"><span><strong>{{r.customerName||'Guest'}}</strong><small class="promo-meta">{{dateTime(r.appliedAt)}} · branch {{branchName(r.branchId)}}</small></span><b>−₹{{(r.discountPaise/100)|number:'1.0-0'}}</b></div>}</div>
        }
      </section>
      <footer><button class="adm-button" type="button" (click)="closeDialog()">Close</button></footer>
    </section>
  }

  @if(dialog()==='redeem' && selected();as promo){
    <button class="adm-backdrop" type="button" (click)="closeDialog()" aria-label="Close"></button>
    <section class="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="promo-redeem-title" #modal tabindex="-1">
      <header><div><p class="adm-eyebrow">Apply code</p><h2 id="promo-redeem-title">{{promo.code}}</h2></div><button class="adm-close" type="button" (click)="closeDialog()" aria-label="Close">×</button></header>
      <form id="promo-redeem-form" class="adm-form" (ngSubmit)="redeem()">
        <label class="adm-field">Client name<input name="cname" [(ngModel)]="redeemForm.customerName" placeholder="Optional"></label>
        <label class="adm-field">Client phone<input name="cphone" [(ngModel)]="redeemForm.customerPhone" inputmode="tel" placeholder="Optional"></label>
        <label class="adm-field">Bill amount ₹<input name="value" type="number" [(ngModel)]="redeemForm.valuePaise" required min="0" [attr.aria-invalid]="submitted()&&redeemForm.valuePaise<=0"><span class="adm-error" *ngIf="submitted()&&redeemForm.valuePaise<=0">Enter the bill amount.</span></label>
        <p class="adm-note full">This applies {{promo.code}} to a client's bill and records the discount in this offer's history.</p>
      </form>
      <footer><button class="adm-button" type="button" (click)="closeDialog()">Cancel</button><button class="adm-button primary" type="submit" form="promo-redeem-form" [disabled]="submitting()">{{submitting()?'Applying…':'Apply '+discountLabel(promo)}}</button></footer>
    </section>
  }
  `,
  styleUrls: ["./owner-shell.styles.css", "./owner-administration.css", "./owner-promos.css"]
})
export class OwnerPromosPage {
  @ViewChild("modal") modal?: ElementRef<HTMLElement>;
  readonly items = signal<OwnerPromo[]>([]);
  readonly page = signal<{ page: number; totalPages: number; total: number; hasMore: boolean } | null>(null);
  readonly redemptions = signal<OwnerPromoRedemption[]>([]);
  readonly redemptionsLoading = signal(false);
  readonly loading = signal(true);
  readonly error = signal("");
  readonly message = signal("");
  readonly messageError = signal(false);
  readonly search = signal("");
  readonly kind = signal("");
  readonly status = signal("");
  readonly dialog = signal<PromoDialog>(null);
  readonly selected = signal<OwnerPromo | null>(null);
  readonly submitting = signal(false);
  readonly submitted = signal(false);
  form: PromoForm = this.emptyForm();
  redeemForm = { customerName: "", customerPhone: "", valuePaise: 0 };
  private requestPage = 1;
  private trigger: HTMLElement | null = null;
  private branches = signal<Array<{ id: string; name: string }>>([]);

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.items().filter((p) =>
      (!this.kind() || p.kind === this.kind()) &&
      (!this.status() || p.status === this.status()) &&
      (!q || `${p.label} ${p.code} ${p.kind}`.toLowerCase().includes(q))
    );
  });

  constructor(readonly api: OwnerAppService, readonly context: OwnerContextService) {
    effect(() => {
      const branch = this.context.selectedBranchId();
      untracked(() => { void branch; this.requestPage = 1; this.page.set(null); void this.load(); });
    });
  }

  discountLabel(promo: OwnerPromo): string {
    return promo.discountType === "flat" ? `₹${((promo.discountPaise || 0) / 100).toFixed(0)} off` : `${promo.discountPercent}% off`;
  }

  dateTime(value?: string): string {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString(this.context.effectiveLocale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch {
      return value;
    }
  }

  branchName(id: string): string {
    return this.branches().find((b) => b.id === id)?.name || id;
  }

  async load(background = false): Promise<void> {
    if (!background) this.loading.set(true);
    this.error.set("");
    try {
      const result = await this.api.ownerPromos({ branchId: "all", page: this.requestPage, pageSize: 50, search: "", kind: "" });
      this.items.set(result.items);
      this.page.set(result.page);
      if (!this.branches().length) this.branches.set(this.context.branches().map((b) => ({ id: b.id, name: b.name })));
      if (background) this.messageError.set(false);
      return;
    } catch {
      this.error.set("Solastio could not load your offers.");
    } finally {
      this.loading.set(false);
    }
  }

  go(direction: number): void {
    this.requestPage = Math.max(1, this.requestPage + direction);
    void this.load();
  }

  openCreate(event: Event): void {
    this.trigger = event.currentTarget as HTMLElement;
    this.form = this.emptyForm();
    this.form.branchScope = this.context.selectedBranchId() ? "current" : "all";
    this.submitted.set(false);
    this.open("create");
  }

  openDetail(promo: OwnerPromo, event: Event): void {
    this.trigger = event.currentTarget as HTMLElement;
    this.selected.set(promo);
    this.redemptions.set([]);
    void this.loadRedemptions(promo);
    this.open("detail");
  }

  openRedeem(promo: OwnerPromo, event: Event): void {
    this.trigger = event.currentTarget as HTMLElement;
    this.selected.set(promo);
    this.redeemForm = { customerName: "", customerPhone: "", valuePaise: 0 };
    this.submitted.set(false);
    this.open("redeem");
  }

  private async loadRedemptions(promo: OwnerPromo): Promise<void> {
    this.redemptionsLoading.set(true);
    try {
      const id = promo._id ?? promo.id;
      if (!id) return;
      const result = await this.api.ownerPromoRedemptions(id, { page: 1, pageSize: 50 });
      this.redemptions.set(result.items);
    } catch {
      this.redemptions.set([]);
    } finally {
      this.redemptionsLoading.set(false);
    }
  }

  async savePromo(): Promise<void> {
    this.submitted.set(true);
    if (!this.form.label.trim() || this.submitting()) return;
    if ((this.form.discountType === "percent" && (this.form.discountPercent <= 0 || this.form.discountPercent > 100)) ||
        (this.form.discountType === "flat" && this.form.discountPaise <= 0)) return;
    this.submitting.set(true);
    this.message.set("");
    try {
      const payload = {
        kind: this.form.kind,
        code: this.form.code || undefined,
        label: this.form.label,
        description: this.form.description || undefined,
        discountType: this.form.discountType,
        discountPercent: this.form.discountType === "percent" ? this.form.discountPercent : undefined,
        discountPaise: this.form.discountType === "flat" ? Math.round(this.form.discountPaise * 100) / 100 : undefined,
        minimumSpendPaise: this.form.minimumSpendPaise,
        maxRedemptions: this.form.maxRedemptions ?? undefined,
        expiresAt: this.form.expiresAt || undefined,
        branchId: this.form.branchScope === "all" ? "all" : this.context.selectedBranchId() || "all",
        referrerRewardType: this.form.kind === "referral" ? this.form.referrerRewardType : undefined,
        referrerRewardPercent: this.form.kind === "referral" && this.form.referrerRewardType === "percent" ? this.form.referrerRewardPercent : undefined,
        referrerRewardPaise: this.form.kind === "referral" && this.form.referrerRewardType === "flat" ? this.form.referrerRewardPaise : undefined
      };
      await this.api.createOwnerPromo(payload);
      this.closeDialog();
      await this.load();
      await this.context.markSuccessfulRefresh();
      this.messageError.set(false);
      this.message.set("Offer created. Share the code with your team.");
    } catch {
      this.messageError.set(true);
      this.message.set("The offer was not saved. Check the code is not already in use and try again.");
    } finally {
      this.submitting.set(false);
    }
  }

  async setStatus(promo: OwnerPromo, status: "active" | "paused", background: boolean, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.submitting()) return;
    const id = promo._id ?? promo.id;
    if (!id) return;
    this.submitting.set(true);
    try {
      await this.api.setOwnerPromoStatus(id, status);
      this.selected.set({ ...promo, status });
      this.items.update((list) => list.map((p) => (p._id ?? p.id) === id ? { ...p, status } : p));
      if (background) {
        this.messageError.set(false);
        this.message.set(`Offer ${status === "active" ? "activated" : "paused"}.`);
      }
    } catch {
      this.messageError.set(true);
      this.message.set("The change was not saved.");
    } finally {
      this.submitting.set(false);
    }
  }

  async redeem(): Promise<void> {
    this.submitted.set(true);
    const promo = this.selected();
    if (!promo || this.redeemForm.valuePaise <= 0 || this.submitting()) return;
    this.submitting.set(true);
    this.message.set("");
    try {
      const result = await this.api.redeemOwnerPromo({
        code: promo.code,
        customerPhone: this.redeemForm.customerPhone || undefined,
        valuePaise: this.redeemForm.valuePaise,
        branchId: this.context.selectedBranchId() || undefined
      });
      this.closeDialog();
      await this.load();
      if (this.selected()) await this.loadRedemptions(this.selected()!);
      this.messageError.set(false);
      this.message.set(`Applied ${promo.code}: ₹${(result.discountPaise / 100).toFixed(0)} off.`);
    } catch {
      this.messageError.set(true);
      this.message.set("This code could not be applied. It may be inactive, expired, exhausted, below minimum spend, or limited to another branch.");
    } finally {
      this.submitting.set(false);
    }
  }

  copyCode(promo: OwnerPromo): void {
    try {
      void navigator.clipboard.writeText(promo.code);
      this.messageError.set(false);
      this.message.set(`${promo.code} copied.`);
    } catch {
      /* Clipboard unavailable. */
    }
  }

  private open(kind: PromoDialog): void {
    this.dialog.set(kind);
    document.documentElement.classList.add("staff-overlay-open");
    setTimeout(() => this.modal?.nativeElement.focus());
  }

  closeDialog(): void {
    this.dialog.set(null);
    document.documentElement.classList.remove("staff-overlay-open");
    setTimeout(() => this.trigger?.focus());
  }

  private emptyForm(): PromoForm {
    return {
      kind: "coupon",
      code: "",
      label: "",
      description: "",
      discountType: "percent",
      discountPercent: 10,
      discountPaise: 500,
      minimumSpendPaise: 0,
      maxRedemptions: null,
      expiresAt: "",
      branchScope: "all",
      referrerRewardType: "percent",
      referrerRewardPercent: 10,
      referrerRewardPaise: 500
    };
  }

  @HostListener("window:keydown", ["$event"])
  key(event: KeyboardEvent): void {
    if (!this.dialog()) return;
    if (event.key === "Escape") { event.preventDefault(); this.closeDialog(); return; }
  }
}

import { Component, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffAppService, StaffClientHistory } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [FormsModule, PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page clients-page">
      <header class="page-head"><div><p class="eyebrow">Client 360</p><h1>Client history</h1><p>Look up a saved client record and review branch-scoped visits, notes, spend, and open balances.</p></div></header>
      <form class="panel client-search" (submit)="lookup(); $event.preventDefault()">
        <label><span>Client ID</span><input name="clientId" [(ngModel)]="clientId" placeholder="Paste client ID from an appointment or owner record" autocomplete="off" /></label>
        <button type="submit" class="button primary" [disabled]="loading()">{{ loading() ? 'Loading...' : 'Open client' }}</button>
      </form>
      @if (error()) { <section staffPageState class="notice error" role="alert">{{ error() }}</section> }
      @if (history(); as data) {
        <article class="panel dark client-hero"><div><p class="eyebrow">{{ data.client.branchName }}</p><h2>{{ data.client.name }}</h2><p>{{ masked(data.client.phone) }}{{ data.client.email ? ' · ' + data.client.email : '' }}</p></div><div class="grid three client-kpis"><article class="kpi"><span>Visits</span><strong>{{ data.client.visitCount }}</strong></article><article class="kpi"><span>Spend</span><strong>{{ data.client.totalSpendPaise | paiseInr }}</strong></article><article class="kpi"><span>Due</span><strong>{{ data.client.outstandingPaise | paiseInr }}</strong></article></div></article>
        @if (data.client.notes || data.client.tags.length) { <article class="panel"><div class="panel-title"><h2>Profile notes</h2></div>@if(data.client.tags.length){<p class="tags">@for(tag of data.client.tags; track tag){<span class="badge">{{ tag }}</span>}</p>}@if(data.client.notes){<p>{{ data.client.notes }}</p>}</article> }
        <section class="panel"><div class="panel-title"><h2>Visit history</h2><span>{{ data.appointments.length }}</span></div><div class="list">@for(item of data.appointments; track item.id){<article class="row"><div class="row-main"><strong>{{ dateTime(item.startAt) }} · {{ item.status }}</strong><small>{{ item.serviceNames.join(', ') || 'Service not recorded' }} · {{ item.staffName }}</small></div><span class="badge">{{ item.spendPaise | paiseInr }}</span></article>}@empty{<p class="empty">No visits in your assigned branch scope.</p>}</div></section>
        <section class="panel"><div class="panel-title"><h2>Purchases & balances</h2><span>{{ data.purchases.length }}</span></div><div class="list">@for(item of data.purchases; track item.id){<article class="row"><div class="row-main"><strong>{{ item.invoiceNumber }} · {{ item.totalPaise | paiseInr }}</strong><small>{{ item.status }} · Balance {{ item.balancePaise | paiseInr }} · {{ dateTime(item.createdAt) }}</small></div></article>}@empty{<p class="empty">No invoices in your assigned branch scope.</p>}</div></section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .clients-page { display:grid; gap:18px; }
    .panel h2,.panel p { margin:0; }
    .client-search { display:grid; grid-template-columns:1fr auto; gap:12px; align-items:end; }
    .client-hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,480px); gap:18px; align-items:center; }
    .client-hero h2 { margin:0; color:var(--staff-text); font-family:Georgia,"Times New Roman",serif; font-size:clamp(1.8rem,4vw,3rem); font-weight:500; letter-spacing:-.045em; }
    .client-hero p { color:var(--staff-text-secondary); font-weight:650; }
    .client-kpis { gap:10px; }
    .client-kpis .kpi { box-shadow:none; }
    .tags { display:flex; flex-wrap:wrap; gap:8px; }
    @media (max-width:860px){.client-search,.client-hero{grid-template-columns:1fr}.client-search button{width:100%;}.client-kpis{grid-template-columns:repeat(3,minmax(0,1fr));}}
    @media (max-width:420px){.client-kpis{grid-template-columns:1fr;}}
  `]
})
export class StaffClientsPage {
  clientId = "";
  readonly history = signal<StaffClientHistory | null>(null);
  readonly loading = signal(false);
  readonly error = signal("");
  constructor(private readonly staff: StaffAppService) {}
  async lookup() {
    const id = this.clientId.trim();
    if (!id) { this.error.set("Enter a client ID to open history."); return; }
    this.loading.set(true); this.error.set(""); this.history.set(null);
    try { this.history.set(await this.staff.clientHistory(id)); }
    catch { this.error.set(this.staff.error() || "Client history could not be loaded."); }
    finally { this.loading.set(false); }
  }
  masked(phone: string): string { return phone ? `**** ${phone.replace(/\D/g, "").slice(-4)}` : "No phone"; }
  dateTime(value: string): string { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not recorded"; }
}

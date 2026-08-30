import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { HttpErrorResponse } from "@angular/common/http";
import { ShopfiyAdminService } from "../../core/shopify-admin.service";
import { DateTextPipe, JsonTextPipe } from "./shopify-admin.pipes";
import type { Overview, Flow, Template, Customer, Campaign, LogRow } from "./shopify-admin.types";

@Component({
  standalone: true,
  imports: [FormsModule, DateTextPipe, JsonTextPipe],
  template: `
    <section class="shopify-auto-page">
      <header class="hero">
        <div><p class="eyebrow">Shopify Automation</p><h1>WhatsApp flows for Shopify orders, carts and campaigns</h1><p>Internal Solastio staff module using the existing WhatsApp and staff session infrastructure.</p></div>
        <div class="hero-actions"><button type="button" (click)="refresh()">Refresh</button><button type="button" (click)="seedFlows()">Install ready-made flows</button></div>
      </header>

      @if (message()) { <p class="notice">{{ message() }}</p> }

      <nav class="tabs" aria-label="Shopify Automation sections">
        @for (tab of tabs; track tab) { <button type="button" [class.active]="activeTab() === tab" (click)="activeTab.set(tab)">{{ tab }}</button> }
      </nav>

      @if (activeTab() === 'Overview') {
        <section class="grid two">
          <article class="card"><span>Connected Shopify Store</span><strong>{{ overview()?.store?.storeName || overview()?.store?.shop || 'Not connected' }}</strong><small>{{ overview()?.store?.status || 'Connect with Shopify OAuth from Settings' }}</small></article>
          <article class="card"><span>WhatsApp Status</span><strong>{{ overview()?.whatsapp?.status || 'Solastio WhatsApp' }}</strong><small>Messages reuse existing WhatsApp outbound logs.</small></article>
        </section>
        <section class="kpis">
          @for (metric of metricCards(); track metric.label) { <article><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong></article> }
        </section>
        <section class="card"><h2>Recent activity</h2><div class="activity">@for (item of overview()?.recentActivity || []; track $index) { <p><b>{{ item.time | dateText }}</b><span>{{ item.title }}</span><small>{{ item.detail }}</small></p> } @empty { <p>No Shopify events received yet.</p> }</div></section>
      }

      @if (activeTab() === 'Flows') {
        <section class="split">
          <article class="card"><h2>Flow builder</h2><input [(ngModel)]="draftFlow.name" placeholder="Flow name" /><select [(ngModel)]="draftFlow.trigger"><option value="orders/create">Order Created</option><option value="orders/paid">Order Paid</option><option value="orders/fulfilled">Order Fulfilled</option><option value="orders/cancelled">Order Cancelled</option><option value="checkouts/create">Checkout Created</option></select><textarea [(ngModel)]="draftFlow.description" placeholder="Description"></textarea><button type="button" (click)="createFlow()">Create draft flow</button></article>
          <article class="card flow-canvas"><h2>Selected flow</h2>@if (selectedFlow()) { @for (node of selectedFlow()!.nodes; track node.id) { <div class="node" [attr.data-type]="node.type"><span>{{ node.type }}</span><strong>{{ node.label }}</strong><small>{{ node.config | jsonText }}</small>@if (node.type === 'whatsapp_template') { <button type="button" (click)="sendTest(selectedFlow()!, node.id); $event.stopPropagation()">Send Test</button> }</div> } } @else { <p>Select a flow to preview nodes.</p> }</article>
        </section>
        <section class="list">@for (flow of flows(); track flow._id) { <article (click)="selectedFlow.set(flow)"><div><strong>{{ flow.name }}</strong><small>{{ flow.description || flow.trigger }}</small></div><select [ngModel]="flow.status" (ngModelChange)="updateFlow(flow, $event)"><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select></article> } @empty { <p>No flows yet. Install ready-made flows or create one.</p> }</section>
      }

      @if (activeTab() === 'Customers') {
        <section class="card"><h2>CSV import preview</h2><p>Paste CSV rows with Name, Phone, Email, OrderCount, TotalSpend, Tags, MarketingConsent. Marketing sends only include valid, consented, non-opted-out contacts.</p><textarea [(ngModel)]="csvText" placeholder="Name,Phone,Email,MarketingConsent"></textarea><button type="button" (click)="importCsv()">Import customers</button></section>
        <section class="list">@for (customer of customers(); track customer.normalizedPhone) { <article><div><strong>{{ customer.name || customer.normalizedPhone }}</strong><small>{{ customer.email }} · {{ customer.tags.join(', ') }}</small></div><span [class.warn]="!customer.marketingConsent || customer.marketingOptOut">{{ customer.marketingOptOut ? 'Opted out' : customer.marketingConsent ? 'Eligible' : 'No consent' }}</span></article> }</section>
      }

      @if (activeTab() === 'Campaigns') {
        <section class="grid two"><article class="card"><h2>Campaign safety</h2><strong>{{ preview()?.eligibleContacts || 0 }} eligible contacts</strong><small>{{ preview()?.excludedContacts || 0 }} excluded for missing consent, invalid data or opt-out.</small></article><article class="card"><h2>Create campaign</h2><input [(ngModel)]="campaignDraft.name" placeholder="Campaign name" /><input [(ngModel)]="campaignDraft.templateName" placeholder="Approved template name" /><button type="button" (click)="createCampaign()">Save draft</button></article></section>
        <section class="list">@for (campaign of campaigns(); track $index) { <article><div><strong>{{ campaign.name }}</strong><small>{{ campaign.templateName }}</small></div><span>{{ campaign.status }}</span><button type="button" [disabled]="campaign.status === 'completed' || campaign.status === 'running'" (click)="confirmCampaign(campaign); $event.stopPropagation()">Confirm Send</button></article> }</section>
      }

      @if (activeTab() === 'Templates') { <section class="list">@for (template of templates(); track template.name + template.language) { <article><div><strong>{{ template.name }}</strong><small>{{ template.category }} · {{ template.language }}</small></div><span>{{ template.status }}</span></article> } @empty { <p>No synced Meta templates found in Solastio.</p> }</section> }
      @if (activeTab() === 'Logs') { <section class="list">@for (log of logs(); track $index) { <article><div><strong>{{ log.toPhone }} · {{ log.type }}</strong><small>{{ log.body }}</small></div><span [class.warn]="log.status === 'failed'">{{ log.status }}</span></article> }</section> }
      @if (activeTab() === 'Settings') { <section class="card"><h2>Shopify connection</h2><p>Use Shopify OAuth/app installation. Tokens are exchanged and stored server-side; staff never enters a Shopify password.</p><input [(ngModel)]="connect.shop" placeholder="client-store.myshopify.com" /><input [(ngModel)]="connect.code" placeholder="OAuth code fallback" /><div class="hero-actions"><button type="button" (click)="beginShopifyInstall()">Connect Shopify OAuth</button><button type="button" (click)="connectShopify()">Exchange code manually</button><button type="button" (click)="testShopify()">Test connection</button><button type="button" (click)="disconnectShopify()">Disconnect</button></div></section> }
    </section>
  `,
  styles: [`
    .shopify-auto-page { display:grid; gap:18px; color:var(--staff-text); }
    .hero,.card,.list article { border:1px solid var(--staff-border); border-radius:24px; background:var(--staff-surface); box-shadow:var(--staff-shadow-card); }
    .hero { display:flex; justify-content:space-between; gap:16px; padding:22px; background:linear-gradient(135deg,var(--staff-primary-light),var(--staff-surface)); }
    .eyebrow,.card span,.kpis span { color:var(--staff-primary-hover); font-size:.72rem; font-weight:850; letter-spacing:.12em; text-transform:uppercase; }
    h1,h2,p { margin:0; } h1 { max-width:760px; font-size:clamp(1.6rem,3vw,2.7rem); line-height:1.05; } h2 { margin-bottom:10px; font-size:1rem; }
    .hero p,.card small,.list small,.activity small { color:var(--staff-text-secondary); font-weight:650; }
    .hero-actions,.tabs { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    button, input, select, textarea { min-height:44px; border:1px solid var(--staff-border); border-radius:14px; padding:9px 12px; background:var(--staff-surface-secondary); color:var(--staff-text); font-weight:700; }
    button { cursor:pointer; background:var(--staff-primary); color:var(--staff-on-primary); border-color:transparent; }
    .tabs button { background:var(--staff-surface); color:var(--staff-text-secondary); border-color:var(--staff-border); } .tabs button.active { background:var(--staff-primary); color:var(--staff-on-primary); }
    .notice { padding:10px 12px; border:1px solid var(--staff-border-accent); border-radius:14px; background:var(--staff-primary-light); color:var(--staff-primary-hover); font-weight:750; }
    .grid,.kpis,.split { display:grid; gap:12px; } .two { grid-template-columns:repeat(2,minmax(0,1fr)); } .split { grid-template-columns:minmax(280px,380px) 1fr; }
    .card { display:grid; gap:10px; padding:18px; } .card strong { font-size:1.35rem; }
    .kpis { grid-template-columns:repeat(4,minmax(0,1fr)); } .kpis article { padding:16px; border:1px solid var(--staff-border); border-radius:20px; background:var(--staff-surface-secondary); } .kpis strong { display:block; margin-top:6px; font-size:1.6rem; }
    .activity { display:grid; gap:8px; } .activity p,.list article { display:flex; align-items:center; justify-content:space-between; gap:12px; } .activity b,.activity span,.activity small { display:block; }
    .list { display:grid; gap:10px; } .list article { padding:14px; cursor:pointer; } .list span { padding:6px 10px; border-radius:999px; background:var(--staff-primary-light); color:var(--staff-primary-hover); font-weight:800; text-transform:capitalize; } .list span.warn { background:var(--staff-error-surface); color:var(--staff-error-text); }
    textarea { width:100%; min-height:96px; resize:vertical; } input, select { width:100%; box-sizing:border-box; }
    .flow-canvas { align-content:start; } .node { position:relative; max-width:360px; margin:0 auto 22px; padding:14px; border:1px solid var(--staff-border-accent); border-radius:18px; background:var(--staff-surface-secondary); text-align:center; } .node:not(:last-child)::after { content:'↓'; position:absolute; left:50%; bottom:-24px; transform:translateX(-50%); color:var(--staff-primary-hover); font-weight:900; }
    .node span,.node small,.node strong { display:block; } .node span { color:var(--staff-primary-hover); font-size:.68rem; font-weight:850; text-transform:uppercase; }
    @media (max-width:900px) { .hero,.activity p,.list article { display:grid; } .two,.kpis,.split { grid-template-columns:1fr; } }
  `]
})
export class ShopifyAdminPage implements OnInit {
  readonly admin = inject(ShopfiyAdminService);
  readonly tabs = ["Overview", "Flows", "Customers", "Campaigns", "Templates", "Logs", "Settings"] as const;
  readonly activeTab = signal<(typeof this.tabs)[number]>("Overview");
  readonly overview = signal<Overview | null>(null);
  readonly flows = signal<Flow[]>([]);
  readonly selectedFlow = signal<Flow | null>(null);
  readonly templates = signal<Template[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly campaigns = signal<Campaign[]>([]);
  readonly logs = signal<LogRow[]>([]);
  readonly preview = signal<{ audienceSize: number; eligibleContacts: number; excludedContacts: number; estimatedMessages: number } | null>(null);
  readonly message = signal("");
  readonly metricCards = computed(() => {
    const data = this.overview();
    return ["activeFlows", "sentToday", "delivered", "read", "failed", "abandonedCarts", "recoveredCarts", "ordersProcessed", "marketingMessagesSent"].map((key) => ({ label: key.replace(/([A-Z])/g, " $1"), value: key in (data?.metrics || {}) ? data!.metrics[key] : (data?.whatsapp as any)?.[key] || 0 }));
  });
  connect = { shop: "", code: "" };
  testPhone = "";
  draftFlow = { name: "", description: "", trigger: "orders/create" };
  campaignDraft = { name: "", templateName: "", audienceId: "all" };
  csvText = "";

  ngOnInit() { void this.refresh(); }

  async refresh() {
    const [overview, flows, templates, customers, campaigns, logs, preview] = await Promise.all([this.get<Overview>("/overview"), this.get<Flow[]>("/flows"), this.get<Template[]>("/templates"), this.get<Customer[]>("/customers"), this.get<Campaign[]>("/campaigns"), this.get<LogRow[]>("/logs"), this.get<any>("/campaigns/preview")]);
    this.overview.set(overview); this.flows.set(flows); this.templates.set(templates); this.customers.set(customers); this.campaigns.set(campaigns); this.logs.set(logs); this.preview.set(preview); this.selectedFlow.set(this.selectedFlow() || flows[0] || null);
  }
  async seedFlows() { this.flows.set(await this.post<Flow[]>("/flows/seed", {})); this.message.set("Ready-made editable flows installed."); }
  async createFlow() { await this.post<Flow>("/flows", { ...this.draftFlow, nodes: [{ id: "trigger", type: "trigger", label: this.draftFlow.trigger, config: {}, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }] }); this.draftFlow.name = ""; await this.refresh(); }
  async updateFlow(flow: Flow, status: Flow["status"]) { await this.patch<Flow>(`/flows/${flow._id}`, { status }); await this.refresh(); }
  async sendTest(flow: Flow, nodeId: string) { const phone = this.testPhone || window.prompt("Test WhatsApp phone number") || ""; if (!phone) return; this.testPhone = phone; const result = await this.post<{ status: string; error?: string }>(`/flows/${flow._id}/test-message`, { nodeId, phone }); this.message.set(result.error ? `Test failed: ${result.error}` : `Test message ${result.status}.`); await this.refresh(); }
  async beginShopifyInstall() {
    this.message.set("Opening Shopify install page...");
    try {
      const result = await this.post<{ installUrl: string }>("/shopify/install-url", { shop: this.connect.shop });
      window.location.assign(result.installUrl);
    } catch (error) {
      this.message.set(`Shopify install failed: ${this.installErrorMessage(error)}`);
    }
  }
  async connectShopify() { await this.post("/shopify/connect", this.connect); this.message.set("Shopify connected server-side."); await this.refresh(); }
  async testShopify() { await this.post("/shopify/test", {}); this.message.set("Shopify connection test passed."); await this.refresh(); }
  async disconnectShopify() { await this.post("/shopify/disconnect", {}); this.message.set("Shopify disconnected."); await this.refresh(); }
  async importCsv() { const rows = this.csvText.trim().split(/\r?\n/).filter(Boolean); const header = rows.shift()?.split(",").map((x) => x.trim()) || []; await this.post("/customers/import", { rows: rows.map((line) => Object.fromEntries(line.split(",").map((value, i) => [header[i] || `col${i}`, value.trim()]))) }); await this.refresh(); }
  async createCampaign() { await this.post("/campaigns", this.campaignDraft); this.message.set(`Draft saved. Confirm eligibility before sending to ${this.preview()?.eligibleContacts || 0} contacts.`); await this.refresh(); }
  async confirmCampaign(campaign: Campaign) { if (!window.confirm(`You are about to send this campaign to ${this.preview()?.eligibleContacts || 0} eligible contacts. Continue?`)) return; await this.post(`/campaigns/${campaign._id}/send`, {}); this.message.set("Campaign send completed through approved WhatsApp templates."); await this.refresh(); }

  private get<T>(path: string): Promise<T> { return this.admin.get<T>(path); }
  private post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> { return this.admin.post<T>(path, body); }
  private patch<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> { return this.admin.patch<T>(path, body); }

  private installErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { error?: { message?: string } | string; message?: string } | string | undefined;
      const bodyMessage = typeof body === "string" ? body : typeof body?.error === "string" ? body.error : body?.error?.message || body?.message;
      return bodyMessage || `HTTP ${error.status || 0}: ${error.message || "request failed"}`;
    }
    if (error && typeof error === "object") {
      const maybeMessage = (error as { message?: unknown }).message;
      if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
      try { return JSON.stringify(error); } catch { /* ignore */ }
    }
    return String(error || "unknown error");
  }
}

import { DatePipe } from "@angular/common";
import { Component, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { OwnerAppService } from "./owner-app.service";
import { OwnerWhatsAppBotSettings, OwnerWhatsAppConversation, OwnerWhatsAppIntelligence, OwnerWhatsAppMessage, OwnerWhatsAppMessageList } from "./owner-administration.models";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <section class="owner-whatsapp-page">
      <header class="whatsapp-hero">
        <div><p class="owner-kicker">Smart WhatsApp</p><h1>Inbox + bot command centre</h1><p>Monitor deterministic bot behaviour, template readiness, hot leads and every stored conversation.</p></div>
        <button class="owner-button" type="button" [disabled]="loadingConversations() || loadingIntelligence()" (click)="refreshAll()">{{ loadingConversations() || loadingIntelligence() ? 'Refreshing...' : 'Refresh all' }}</button>
      </header>

      @if (intelligence(); as intel) {
        <section class="insight-grid">
          <article><span>Inbound</span><strong>{{ intel.analytics.inboundCount }}</strong><small>Last 30 days</small></article>
          <article><span>Bot replies</span><strong>{{ intel.analytics.outboundCount }}</strong><small>{{ actionLabels().length }} tracked actions</small></article>
          <article [class.warn]="intel.health.failedSends"><span>Failed sends</span><strong>{{ intel.health.failedSends }}</strong><small>Delivery health</small></article>
          <article [class.warn]="intel.health.repeatedMisunderstandings"><span>Needs tuning</span><strong>{{ intel.health.repeatedMisunderstandings }}</strong><small>Repeated misunderstandings</small></article>
        </section>

        <section class="bot-console">
          <article class="panel settings-panel">
            <header><div><p class="owner-kicker">Bot settings</p><h2>Personality & answers</h2></div><button class="owner-button" type="button" [disabled]="savingSettings()" (click)="saveSettings()">{{ savingSettings() ? 'Saving...' : 'Save bot' }}</button></header>
            @if (settingsMessage()) { <div class="state success">{{ settingsMessage() }}</div> }
            @if (settingsError()) { <div class="state error">{{ settingsError() }}</div> }
            <div class="settings-grid">
              <label>Personality<select [(ngModel)]="botSettings.personality"><option value="friendly">Friendly</option><option value="quick">Quick</option><option value="luxury">Luxury</option><option value="hinglish">Hinglish</option></select></label>
              <label>Contact<input [(ngModel)]="botSettings.contact" placeholder="Phone or helpdesk" /></label>
              <label>Instagram<input [(ngModel)]="botSettings.instagram" placeholder="@salon" /></label>
              <label>Payment modes<input [(ngModel)]="paymentModesText" placeholder="UPI, card, cash" /></label>
              <label class="wide">Address<textarea [(ngModel)]="botSettings.address" rows="2" placeholder="Used for location FAQs"></textarea></label>
              <label class="wide">Parking<textarea [(ngModel)]="botSettings.parking" rows="2" placeholder="Parking or landmark answer"></textarea></label>
            </div>
            <div class="feature-row">
              @for (feature of featureOptions; track feature.key) { <label><input type="checkbox" [ngModel]="featureEnabled(feature.key)" (ngModelChange)="setFeature(feature.key, $event)" />{{ feature.label }}</label> }
            </div>
            <div class="qa-editor">
              <header><div><p class="owner-kicker">Custom Q&A</p><small>These answers are matched deterministically from question/keyword text.</small></div><button type="button" class="mini-button" (click)="addCustomAnswer()">Add answer</button></header>
              @for (answer of customAnswersDraft; track $index) {
                <div class="qa-row">
                  <label>Question<input [(ngModel)]="answer.question" placeholder="Do you have bridal packages?" /></label>
                  <label>Answer<textarea [(ngModel)]="answer.answer" rows="2" placeholder="Yes, bridal packages start from..."></textarea></label>
                  <label>Keywords<input [(ngModel)]="answer.keywordText" placeholder="bridal, makeup, wedding" /></label>
                  <button type="button" class="mini-button ghost" (click)="removeCustomAnswer($index)">Remove</button>
                </div>
              } @empty { <div class="state">No custom answers yet. Add high-frequency salon questions here.</div> }
            </div>
          </article>

          <article class="panel"><p class="owner-kicker">Template readiness</p><h2>Approved campaigns</h2><div class="template-list">@for (template of intel.templateReadiness; track template.name) { <div><strong>{{ template.name }}</strong><span [class.ready]="template.ready">{{ template.ready ? 'Ready' : 'Needs approval' }}</span></div> }</div></article>
          <article class="panel"><p class="owner-kicker">Top demand</p><h2>Asked services</h2><div class="chip-list">@for (service of intel.analytics.topServices; track service.name) { <span>{{ service.name }} · {{ service.count }}</span> } @empty { <small>No service demand detected yet.</small> }</div></article>
          <article class="panel"><p class="owner-kicker">Smart leads</p><h2>Tagged customers</h2><div class="lead-list">@for (customer of leadCustomers(); track customer.id) { <div><strong>{{ customer.name }}</strong><small>{{ customer.phone }} · {{ customer.tags.slice(0, 4).join(', ') }}</small></div> } @empty { <small>No tagged WhatsApp leads yet.</small> }</div></article>
          <article class="panel"><p class="owner-kicker">Waitlist</p><h2>Live demand</h2><div class="lead-list">@for (entry of intel.waitlist.slice(0, 6); track entry.id) { <div><strong>{{ entry.serviceNames.join(', ') || 'Service' }}</strong><small>{{ entry.customerPhone }} · {{ entry.date }} {{ entry.preferredTime }} · {{ entry.status }}</small></div> } @empty { <small>No active waitlist entries.</small> }</div></article>
          <article class="panel"><p class="owner-kicker">Quality queue</p><h2>Manual review</h2><div class="lead-list">@for (item of intel.qualityQueue.slice(0, 6); track item.id) { <div><strong>{{ item.name }}</strong><small>{{ item.phone }} · {{ item.text }} · {{ item.receivedAt | date:'short' }}</small></div> } @empty { <small>No manual-review messages.</small> }</div></article>
          <article class="panel"><p class="owner-kicker">Campaign segments</p><h2>Ready audiences</h2><div class="chip-list">@for (segment of intel.campaignSegments; track segment.key) { <span>{{ segment.key }} · {{ segment.count }}</span> }</div></article>
        </section>
      } @else if (intelligenceError()) { <div class="state error">{{ intelligenceError() }}</div> }

      <section class="whatsapp-shell">
        <aside class="conversation-panel">
          <label class="search-box" for="wa-search"><span>Search customers or phone</span><input id="wa-search" type="search" [(ngModel)]="search" (keyup.enter)="loadConversations(true)" placeholder="Name or phone" /><button type="button" (click)="loadConversations(true)">Search</button></label>
          @if (conversationError()) { <div class="state error">{{ conversationError() }}</div> }
          @if (loadingConversations() && !conversations().length) { <div class="state">Loading conversations...</div> }
          <nav class="conversation-list" aria-label="WhatsApp conversations">
            @for (conversation of conversations(); track conversation.phone) {
              <button type="button" [class.active]="conversation.phone === selectedPhone()" (click)="openConversation(conversation.phone)"><span class="avatar">{{ initials(conversation) }}</span><span class="summary"><strong>{{ conversation.customerName }}</strong><small>{{ conversation.phone }}</small><em>{{ conversation.lastBody || 'No message body stored' }}</em></span><span class="meta"><time [attr.datetime]="conversation.lastMessageAt || ''">{{ conversation.lastMessageAt | date:'short' }}</time><small [class.outbound]="conversation.lastDirection === 'outbound'">{{ conversation.lastDirection || 'customer' }} {{ conversation.lastStatus }}</small></span></button>
            } @empty { <div class="state">No WhatsApp conversations found.</div> }
          </nav>
          @if (conversationPage()?.hasMore) { <button class="load-more" type="button" [disabled]="loadingConversations()" (click)="loadMoreConversations()">Load more</button> }
        </aside>

        <main class="thread-panel">
          @if (selected(); as selectedThread) {
            <header class="thread-head"><div><p class="owner-kicker">{{ selectedThread.customer.marketingOptOut ? 'Opted out of marketing' : 'Active customer' }}</p><h2>{{ selectedThread.customer.name }}</h2><span>{{ selectedThread.customer.phone }} · {{ selectedThread.customer.interactionStatus }}</span></div><div class="thread-count">{{ messagePage()?.total || messages().length }} messages</div></header>
            @if (messageError()) { <div class="state error">{{ messageError() }}</div> }
            <div class="message-list">@for (message of orderedMessages(); track message.id) { <article class="message" [class.outbound]="message.direction === 'outbound'"><div class="bubble"><p>{{ message.body || '(empty message)' }}</p><footer><span>{{ message.type }} · {{ message.status }}</span><time [attr.datetime]="message.at || ''">{{ message.at | date:'medium' }}</time></footer>@if (message.error) { <small class="failure">{{ message.error }}</small> }</div></article> } @empty { <div class="state">No stored messages for this phone.</div> }</div>
            @if (messagePage()?.hasMore) { <button class="load-more" type="button" [disabled]="loadingMessages()" (click)="loadMoreMessages()">Load older messages</button> }
          } @else { <div class="empty-thread"><strong>Select a WhatsApp conversation</strong><p>Open a customer to inspect the stored inbound/outbound history and delivery statuses.</p></div> }
        </main>
      </section>
    </section>
  `,
  styles: [`
    .owner-whatsapp-page{display:grid;gap:18px}.whatsapp-hero,.panel{border:1px solid rgba(17,24,39,.1);border-radius:24px;background:rgba(255,255,255,.9);box-shadow:0 22px 60px rgba(15,23,42,.07)}.whatsapp-hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;padding:22px;background:linear-gradient(135deg,#fff8ef,#f3fff8)}.whatsapp-hero h1{margin:4px 0;font-size:clamp(1.8rem,4vw,3.2rem);letter-spacing:-.05em}.whatsapp-hero p{max-width:760px;margin:0;color:#6d6258}.owner-button,.load-more,.search-box button,.mini-button{min-height:42px;border:0;border-radius:999px;padding:0 16px;background:#111827;color:white;font-weight:800;cursor:pointer}.mini-button{min-height:34px;background:#047857}.mini-button.ghost{background:#f3f4f6;color:#374151}.owner-button:disabled,.load-more:disabled{opacity:.55;cursor:wait}.insight-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.insight-grid article{padding:16px;border-radius:20px;background:#0f172a;color:white}.insight-grid article.warn{background:#7c2d12}.insight-grid span,.owner-kicker{font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#6b7280}.insight-grid span{color:#cbd5e1}.insight-grid strong{display:block;margin:6px 0;font-size:2rem}.insight-grid small{color:#d1d5db}.bot-console{display:grid;grid-template-columns:minmax(0,2fr) repeat(3,minmax(220px,1fr));gap:14px}.panel{padding:18px;min-width:0}.settings-panel{grid-row:span 2}.panel header,.qa-editor header{display:flex;align-items:center;justify-content:space-between;gap:12px}.panel h2{margin:3px 0 12px}.settings-grid,.qa-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.settings-grid label,.qa-row label{display:grid;gap:6px;color:#374151;font-weight:800}.settings-grid input,.settings-grid select,.settings-grid textarea,.qa-row input,.qa-row textarea{width:100%;border:1px solid rgba(17,24,39,.14);border-radius:14px;padding:10px 12px;font:inherit}.wide,.qa-row label:nth-child(2){grid-column:1/-1}.qa-editor{display:grid;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(17,24,39,.08)}.qa-row{padding:12px;border-radius:18px;background:#f8fafc}.feature-row,.chip-list,.template-list,.lead-list{display:grid;gap:9px}.feature-row{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:14px}.feature-row label{display:flex;gap:8px;align-items:center;font-weight:700}.template-list div,.lead-list div{display:flex;justify-content:space-between;gap:10px;padding:10px;border-radius:14px;background:#f8fafc}.template-list span{font-weight:900;color:#b45309}.template-list span.ready{color:#047857}.chip-list span{display:inline-flex;width:max-content;border-radius:999px;background:#ecfdf5;color:#047857;padding:6px 10px;font-weight:800}.lead-list div{display:grid}.lead-list small{color:#6b7280}.whatsapp-shell{display:grid;grid-template-columns:minmax(280px,380px) minmax(0,1fr);gap:16px;min-height:620px}.conversation-panel,.thread-panel{min-width:0;border:1px solid rgba(17,24,39,.1);border-radius:24px;background:rgba(255,255,255,.86);box-shadow:0 22px 60px rgba(15,23,42,.07);overflow:hidden}.search-box{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:16px;border-bottom:1px solid rgba(17,24,39,.08)}.search-box span{grid-column:1/-1}.search-box input{min-width:0;height:42px;border:1px solid rgba(17,24,39,.13);border-radius:14px;padding:0 12px;font:inherit}.conversation-list{display:grid;max-height:650px;overflow:auto}.conversation-list button{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:11px;width:100%;padding:14px 16px;border:0;border-bottom:1px solid rgba(17,24,39,.07);background:transparent;text-align:left;cursor:pointer}.conversation-list button.active{background:#eafff2}.avatar{width:42px;height:42px;display:grid;place-items:center;border-radius:15px;background:#0f172a;color:white;font-weight:900}.summary{min-width:0;display:grid;gap:2px}.summary strong,.summary small,.summary em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.summary small,.meta,.summary em{color:#6b7280;font-size:.76rem}.meta{display:grid;text-align:right;gap:4px}.meta .outbound{color:#047857}.thread-head{display:flex;justify-content:space-between;gap:16px;padding:18px;border-bottom:1px solid rgba(17,24,39,.08)}.thread-head h2{margin:2px 0}.thread-head span{color:#6b7280}.thread-count{align-self:center;border-radius:999px;background:#f3f4f6;padding:8px 12px;font-weight:800}.message-list{display:grid;gap:12px;padding:18px;max-height:660px;overflow:auto}.message{display:flex}.message.outbound{justify-content:flex-end}.bubble{max-width:min(620px,86%);padding:12px 14px;border-radius:18px;background:#f3f4f6}.message.outbound .bubble{background:#dcfce7}.bubble p{margin:0 0 8px;white-space:pre-wrap}.bubble footer{display:flex;gap:10px;justify-content:space-between;color:#6b7280;font-size:.75rem}.failure,.state.error{color:#b91c1c}.state{padding:14px;color:#6b7280}.state.success{color:#047857}.empty-thread{display:grid;place-items:center;align-content:center;min-height:420px;text-align:center;color:#6b7280}.load-more{margin:14px}@media (max-width:1100px){.insight-grid,.bot-console{grid-template-columns:repeat(2,minmax(0,1fr))}.whatsapp-shell{grid-template-columns:1fr}}@media (max-width:700px){.whatsapp-hero,.thread-head,.panel header,.qa-editor header{display:grid}.insight-grid,.bot-console,.settings-grid,.feature-row,.qa-row{grid-template-columns:1fr}.conversation-list button{grid-template-columns:42px minmax(0,1fr)}.meta{grid-column:2;text-align:left}}
  `]
})
export class OwnerWhatsAppPage implements OnInit {
  search = "";
  paymentModesText = "";
  customAnswersDraft: Array<{ question: string; answer: string; keywordText: string }> = [];
  botSettings: OwnerWhatsAppBotSettings = { personality: "friendly", features: {} };
  readonly featureOptions: Array<{ key: keyof NonNullable<OwnerWhatsAppBotSettings["features"]>; label: string }> = [
    { key: "upsells", label: "Related-service upsells" },
    { key: "hinglishReplies", label: "Hinglish replies" },
    { key: "groupBooking", label: "Group booking signals" },
    { key: "abandonedRecovery", label: "Abandoned recovery" },
    { key: "reviewPrompts", label: "Review prompts" }
  ];
  readonly conversations = signal<OwnerWhatsAppConversation[]>([]);
  readonly selectedPhone = signal("");
  readonly selected = signal<OwnerWhatsAppMessageList | null>(null);
  readonly messages = signal<OwnerWhatsAppMessage[]>([]);
  readonly intelligence = signal<OwnerWhatsAppIntelligence | null>(null);
  readonly conversationPage = signal<{ limit: number; offset: number; total: number; hasMore: boolean } | null>(null);
  readonly messagePage = signal<{ limit: number; offset: number; total: number; hasMore: boolean } | null>(null);
  readonly loadingConversations = signal(false);
  readonly loadingMessages = signal(false);
  readonly loadingIntelligence = signal(false);
  readonly savingSettings = signal(false);
  readonly conversationError = signal("");
  readonly messageError = signal("");
  readonly intelligenceError = signal("");
  readonly settingsError = signal("");
  readonly settingsMessage = signal("");
  readonly orderedMessages = computed(() => this.messages());
  readonly actionLabels = computed(() => Object.keys(this.intelligence()?.analytics.actionCounts || {}));
  readonly leadCustomers = computed(() => (this.intelligence()?.customers || []).filter((customer) => customer.tags.length).slice(0, 8));

  constructor(private readonly owner: OwnerAppService) {}

  ngOnInit(): void { void this.refreshAll(); }

  refreshAll(): void {
    void this.loadIntelligence();
    void this.loadBotSettings();
    void this.loadConversations(true);
  }

  async loadIntelligence(): Promise<void> {
    this.loadingIntelligence.set(true);
    this.intelligenceError.set("");
    try { this.intelligence.set(await this.owner.whatsappIntelligence(30)); }
    catch (error) { this.intelligenceError.set(error instanceof Error ? error.message : "WhatsApp intelligence could not be loaded."); }
    finally { this.loadingIntelligence.set(false); }
  }

  async loadBotSettings(): Promise<void> {
    try {
      const response = await this.owner.whatsappBotSettings();
      this.botSettings = { personality: "friendly", ...response.settings, features: { ...(response.settings.features || {}) } };
      this.paymentModesText = (this.botSettings.paymentModes || []).join(", ");
      this.customAnswersDraft = (this.botSettings.customAnswers || []).map((item) => ({ question: item.question, answer: item.answer, keywordText: (item.keywords || []).join(", ") }));
    } catch (error) { this.settingsError.set(error instanceof Error ? error.message : "Bot settings could not be loaded."); }
  }

  async saveSettings(): Promise<void> {
    this.savingSettings.set(true);
    this.settingsError.set("");
    this.settingsMessage.set("");
    try {
      this.botSettings.paymentModes = this.paymentModesText.split(",").map((item) => item.trim()).filter(Boolean);
      this.botSettings.customAnswers = this.customAnswersDraft.map((item) => ({ question: item.question.trim(), answer: item.answer.trim(), keywords: item.keywordText.split(",").map((keyword) => keyword.trim()).filter(Boolean), enabled: true })).filter((item) => item.question && item.answer);
      const response = await this.owner.saveWhatsAppBotSettings("", this.botSettings);
      this.botSettings = { ...response.settings, features: { ...(response.settings.features || {}) } };
      this.settingsMessage.set("Bot settings saved.");
    } catch (error) { this.settingsError.set(error instanceof Error ? error.message : "Bot settings could not be saved."); }
    finally { this.savingSettings.set(false); }
  }

  featureEnabled(key: keyof NonNullable<OwnerWhatsAppBotSettings["features"]>): boolean { return Boolean(this.botSettings.features?.[key]); }
  setFeature(key: keyof NonNullable<OwnerWhatsAppBotSettings["features"]>, enabled: boolean): void { this.botSettings.features = { ...(this.botSettings.features || {}), [key]: enabled }; }
  addCustomAnswer(): void { this.customAnswersDraft = [...this.customAnswersDraft, { question: "", answer: "", keywordText: "" }]; }
  removeCustomAnswer(index: number): void { this.customAnswersDraft = this.customAnswersDraft.filter((_, i) => i !== index); }

  async loadConversations(reset = false): Promise<void> {
    if (this.loadingConversations()) return;
    this.loadingConversations.set(true);
    this.conversationError.set("");
    try {
      const offset = reset ? 0 : this.conversations().length;
      const response = await this.owner.whatsappConversations({ search: this.search.trim(), limit: 40, offset });
      this.conversations.set(reset ? response.items : [...this.conversations(), ...response.items]);
      this.conversationPage.set(response.page);
      if (!this.selectedPhone() && response.items[0]) await this.openConversation(response.items[0].phone);
    } catch (error) { this.conversationError.set(error instanceof Error ? error.message : "WhatsApp conversations could not be loaded."); }
    finally { this.loadingConversations.set(false); }
  }

  loadMoreConversations(): void { void this.loadConversations(false); }

  async openConversation(phone: string): Promise<void> {
    if (!phone || this.loadingMessages()) return;
    this.selectedPhone.set(phone);
    this.loadingMessages.set(true);
    this.messageError.set("");
    try {
      const response = await this.owner.whatsappMessages(phone, { limit: 60, offset: 0 });
      this.selected.set(response);
      this.messages.set(response.items);
      this.messagePage.set(response.page);
    } catch (error) { this.messageError.set(error instanceof Error ? error.message : "WhatsApp messages could not be loaded."); }
    finally { this.loadingMessages.set(false); }
  }

  async loadMoreMessages(): Promise<void> {
    const phone = this.selectedPhone();
    if (!phone || this.loadingMessages()) return;
    this.loadingMessages.set(true);
    try {
      const response = await this.owner.whatsappMessages(phone, { limit: 60, offset: this.messages().length });
      this.messages.set([...this.messages(), ...response.items]);
      this.messagePage.set(response.page);
    } catch (error) { this.messageError.set(error instanceof Error ? error.message : "Older WhatsApp messages could not be loaded."); }
    finally { this.loadingMessages.set(false); }
  }

  initials(conversation: OwnerWhatsAppConversation): string {
    return (conversation.customerName || conversation.phone).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WA";
  }
}

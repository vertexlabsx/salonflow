import { DatePipe } from "@angular/common";
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffChatConversation, StaffChatSearchResponse, StaffChatSearchResult, StaffConversationMessage, StaffMessageReceiptUpdate } from "../../core/staff-app.service";

type RealtimeState = "connecting" | "live" | "polling" | "offline";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <section class="page chat-page" aria-labelledby="chat-title">
      <header class="page-head chat-page-head">
        <div><p class="eyebrow">Workspace</p><h1 id="chat-title">Chat</h1><p>Keep branch conversations together, with a private line to the owner.</p></div>
        <div class="chat-connection" [attr.data-state]="connectionState()" role="status" aria-live="polite">
          <span aria-hidden="true"></span>{{ connectionLabel() }}
        </div>
      </header>

      @if (!canReadChat()) {
        <section class="notice chat-access-state" role="alert"><div><strong>Chat is unavailable</strong><p>You do not have permission to view branch conversations.</p></div></section>
      } @else if (initialLoading()) {
        <section class="chat-shell chat-shell-loading" aria-label="Loading chat">
          <aside class="chat-sidebar"><div class="chat-skeleton wide"></div><div class="chat-skeleton"></div><div class="chat-skeleton"></div></aside>
          <div class="chat-main"><div class="chat-skeleton heading"></div><div class="chat-skeleton bubble"></div><div class="chat-skeleton bubble mine"></div></div>
        </section>
      } @else if (loadError()) {
        <section class="notice chat-access-state" role="alert"><div><strong>Conversations could not be loaded</strong><p>{{ loadError() }}</p></div><button class="link-button" type="button" (click)="loadConversations()">Try again</button></section>
      } @else {
        <section class="chat-shell">
          <aside class="chat-sidebar" aria-label="Conversations">
            <div class="chat-sidebar-head"><div><p class="eyebrow">Conversations</p><h2>Inbox</h2></div><span>{{ conversations().length }}</span></div>
            <div class="chat-local-search">
              <label for="conversation-search">Search this conversation list</label>
              <div class="chat-search-control"><span aria-hidden="true">⌕</span><input id="conversation-search" type="search" autocomplete="off" [ngModel]="conversationSearch()" (ngModelChange)="setConversationSearch($event)" (focus)="showConvSuggestions.set(true)" (blur)="closeConvSuggestions()" placeholder="Search titles or type"><small>On this device</small></div>
              @if (showConvSuggestions() && convSuggestions().length) {
                <div class="search-suggestions" role="listbox">
                  @for (s of convSuggestions(); track s) {
                    <button type="button" (mousedown)="$event.preventDefault(); selectConvSuggestion(s)" (click)="selectConvSuggestion(s)">
                      <span>🔍 {{ s }}</span>
                      <small>Chat</small>
                    </button>
                  }
                </div>
              }
              <div class="search-chips-row">
                @for (s of convSuggestions().slice(0, 3); track s) {
                  <button type="button" class="suggestion-chip" (mousedown)="$event.preventDefault(); selectConvSuggestion(s)" (click)="selectConvSuggestion(s)">
                    <span>🏷️ {{ s }}</span>
                  </button>
                }
              </div>
            </div>
            <nav class="chat-conversation-list" aria-label="Choose a conversation">
              @for (conversation of filteredConversations(); track conversation.id) {
                <button type="button" class="chat-conversation" [class.active]="conversation.id === activeConversationId()" [class.private]="conversation.type === 'private-owner'" [attr.aria-current]="conversation.id === activeConversationId() ? 'page' : null" (click)="openConversation(conversation.id)">
                  <span class="conversation-mark" aria-hidden="true">{{ conversation.type === 'private-owner' ? 'O' : 'T' }}</span>
                  <span class="conversation-copy"><strong>{{ conversation.title }}</strong><small>{{ conversation.type === 'private-owner' ? 'Private · only participants' : 'Branch team' }}</small><time class="conversation-active" [attr.datetime]="conversation.lastMessageAt">{{ lastActiveLabel(conversation.lastMessageAt) }}</time></span>
                  <span class="conversation-meta">{{ conversation.messageCount }}</span>
                </button>
              } @empty {
                <p class="chat-list-empty">{{ conversationSearch().trim() ? 'No matches in this conversation list.' : 'No conversations are available for this branch.' }}</p>
              }
            </nav>
            @if (canStartPrivateChat()) {
              <div class="start-private-card">
                <span aria-hidden="true">↗</span><div><strong>Private owner chat</strong><p>Need to discuss something privately? Start a secure chat with the owner.</p></div>
                <button class="button" type="button" [disabled]="startingPrivate() || !online()" (click)="startPrivateChat()">{{ startingPrivate() ? 'Starting…' : 'Start private owner chat' }}</button>
              </div>
            }
          </aside>

          <section class="chat-main" [class.private-chat]="activeConversation()?.type === 'private-owner'" aria-label="Active conversation">
            @if (activeConversation(); as active) {
              <header class="chat-thread-head">
                <div class="thread-identity"><span class="conversation-mark" aria-hidden="true">{{ active.type === 'private-owner' ? 'O' : 'T' }}</span><div><h2>{{ active.title }}</h2><p>{{ active.type === 'private-owner' ? 'Private conversation · visible only to persisted participants' : 'Shared with your branch team' }}</p></div></div>
                <span class="chat-mode-pill" [class.private]="active.type === 'private-owner'">{{ active.type === 'private-owner' ? 'Private' : 'Team' }}</span>
              </header>

              @if (actionError()) { <div class="chat-inline-error" role="alert"><span>{{ actionError() }}</span><button type="button" (click)="clearActionError()" aria-label="Dismiss error">Dismiss</button></div> }
              @if (!online()) { <div class="chat-offline-note" role="status">You’re offline. Messages stay readable, but sending will resume when you reconnect.</div> }
              @if (!canSendChat()) { <div class="chat-offline-note" role="note">Read-only access. You can follow this conversation but cannot send messages.</div> }

              <div class="chat-local-search message-search">
                <label for="message-search">Search all messages in {{ active.title }}</label>
                <div class="chat-search-control"><span aria-hidden="true">⌕</span><input id="message-search" type="search" autocomplete="off" [ngModel]="messageSearch()" (ngModelChange)="setMessageSearch($event)" (focus)="showMsgSuggestions.set(true)" (blur)="closeMsgSuggestions()" placeholder="Search sender or message"><small>{{ messageSearchHint() }}</small></div>
                @if (showMsgSuggestions() && messageSuggestions().length) {
                  <div class="search-suggestions" role="listbox">
                    @for (s of messageSuggestions(); track s) {
                      <button type="button" (mousedown)="$event.preventDefault(); selectMsgSuggestion(s)" (click)="selectMsgSuggestion(s)">
                        <span>🔍 {{ s }}</span>
                        <small>Message</small>
                      </button>
                    }
                  </div>
                }
                <div class="search-chips-row">
                  @for (s of messageSuggestions().slice(0, 3); track s) {
                    <button type="button" class="suggestion-chip" (mousedown)="$event.preventDefault(); selectMsgSuggestion(s)" (click)="selectMsgSuggestion(s)">
                      <span>🏷️ {{ s }}</span>
                    </button>
                  }
                </div>
              </div>

              <div class="chat-message-viewport" [attr.aria-busy]="messagesLoading()" aria-live="polite" aria-relevant="additions text">
                @if (messagesLoading()) {
                  <div class="chat-message-loading"><div class="chat-skeleton bubble"></div><div class="chat-skeleton bubble mine"></div></div>
                } @else if (messagesError()) {
                  <div class="chat-thread-state" role="alert"><strong>Messages could not be loaded</strong><p>{{ messagesError() }}</p><button class="link-button" type="button" (click)="refreshMessages(true)">Retry</button></div>
                } @else {
                  <div class="chat-message-list">
                    @for (item of filteredMessages(); track item.id; let index = $index) {
                      @if (showDateSeparator(item, index)) { <div class="message-date-separator"><span>{{ messageDateLabel(item.createdAt) }}</span></div> }
                      <article class="chat-message" [class.mine]="item.senderUserId === staff.user()?.id" [class.grouped]="isGroupedMessage(item, index)">
                        @if (!isGroupedMessage(item, index)) { <span class="message-avatar" aria-hidden="true">{{ senderInitials(item) }}</span> }
                        <div class="message-byline"><strong>{{ item.senderUserId === staff.user()?.id ? 'You' : (item.senderName || 'Team member') }}</strong><time [attr.datetime]="item.createdAt">{{ item.createdAt | date:'shortTime' }}</time></div>
                        <p>{{ item.body }}</p>
                        @if (item.senderUserId === staff.user()?.id) { <span class="message-sent" [attr.aria-label]="receiptLabel(item)">{{ receiptMark(item) }} {{ receiptLabel(item) }}</span> }
                      </article>
                    } @empty {
                      @if (messageSearch().trim()) {
                        <div class="chat-thread-state"><span class="empty-chat-mark" aria-hidden="true">⌕</span><strong>{{ messageSearchState().title }}</strong><p>{{ messageSearchState().detail }}</p></div>
                      } @else {
                        <div class="chat-thread-state"><span class="empty-chat-mark" aria-hidden="true">•••</span><strong>Start the conversation</strong><p>{{ active.type === 'private-owner' ? 'Need to discuss something privately? Start a secure chat with the owner.' : 'Share the first update with your branch team.' }}</p></div>
                      }
                    }
                  </div>
                }
              </div>

              @if (unseenMessageCount()) { <button class="new-message-button" type="button" (click)="scrollToLatest(true)">{{ unseenMessageCount() }} new {{ unseenMessageCount() === 1 ? 'message' : 'messages' }} ↓</button> }

              @if (typingLabel()) { <p class="chat-typing" role="status" aria-live="polite">{{ typingLabel() }}</p> }

              <form class="chat-composer" (submit)="send($event)">
                <label class="sr-only" for="chat-draft">Message {{ active.title }}</label>
                <textarea id="chat-draft" name="chatDraft" [(ngModel)]="draft" maxlength="4000" rows="1" [disabled]="!canSendChat() || !online() || sending()" [attr.aria-describedby]="'chat-compose-help chat-character-count'" [placeholder]="canSendChat() ? (online() ? 'Write a message…' : 'Reconnect to send a message') : 'Read-only conversation'" (input)="onDraftInput()" (blur)="stopTyping()" (keydown)="onComposerKeydown($event)"></textarea>
                <div class="composer-footer"><span id="chat-compose-help">Enter to send · Shift+Enter for a new line</span><span id="chat-character-count" [class.near-limit]="draft.length > 3600">{{ draft.length }}/4000</span><button class="button primary chat-send" type="submit" [disabled]="!canSubmit()">{{ sending() ? 'Sending…' : 'Send' }} <span aria-hidden="true">↗</span></button></div>
              </form>
            } @else {
              <div class="chat-thread-state"><strong>No conversation selected</strong><p>Choose an available conversation to begin.</p></div>
            }
          </section>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .chat-local-search { padding: 0 16px 14px; }
    .chat-local-search > label { display: block; margin-bottom: 7px; color: #a8a3b7; font-size: .72rem; font-weight: 700; letter-spacing: .045em; }
    .chat-search-control { min-height: 44px; display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid rgba(221, 214, 238, .16); border-radius: 12px; background: rgba(9, 8, 13, .52); color: #aaa4b8; transition: border-color .4s ease-out, background-color .4s ease-out, box-shadow .4s ease-out; }
    .chat-search-control:focus-within { border-color: rgba(203, 170, 255, .7); background: rgba(18, 15, 25, .82); box-shadow: 0 0 0 3px rgba(174, 126, 255, .16); }
    .chat-search-control input { width: 100%; min-width: 0; height: 42px; padding: 0; border: 0; outline: 0; background: transparent; color: #f5f1fa; font: inherit; }
    .chat-search-control input::placeholder { color: #817b8d; }
    .chat-search-control small { color: #817b8d; font-size: .68rem; white-space: nowrap; }
    .message-search { padding: 12px clamp(12px, 3vw, 22px) 8px; border-top: 1px solid rgba(255, 255, 255, .055); }
    .conversation-copy { min-width: 0; }
    .conversation-active { display: block; margin-top: 5px; color: #c7bed4; font-size: .7rem; font-weight: 650; letter-spacing: .015em; }
    .chat-conversation.active .conversation-active { color: #eadcff; }
    .chat-message-list { gap: 11px; }
    .message-date-separator { display: flex; align-items: center; gap: 10px; margin: 17px 0 7px; color: #918a9d; font-size: .68rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .message-date-separator::before, .message-date-separator::after { content: ''; height: 1px; flex: 1; background: rgba(230, 222, 241, .1); }
    .chat-message { position: relative; margin-top: 3px; }
    .chat-message.grouped { margin-top: 6px; }
    .message-avatar { position: absolute; left: -34px; top: 1px; width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid rgba(220, 206, 239, .18); border-radius: 9px; background: #27222f; color: #ded3e9; font-size: .62rem; font-weight: 800; letter-spacing: .04em; }
    .chat-message.mine .message-avatar { right: -34px; left: auto; background: #493866; color: #f3eaff; }
    .chat-message.grouped .message-byline strong { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
    .message-sent { display: block; margin-top: 5px; color: #aea5bd; font-size: .67rem; font-weight: 650; text-align: right; }
    .chat-message.mine .message-sent { color: #d7c3ed; }
    .chat-typing { min-height: 18px; margin: 0 clamp(14px, 3vw, 24px) 7px; color: #cbb7df; font-size: .75rem; font-weight: 650; }
    @media (max-width: 680px) {
      .chat-local-search { padding-inline: 12px; }
      .message-search { padding-top: 10px; }
      .chat-search-control small { display: none; }
      .message-avatar { position: static; float: left; margin: 0 7px 4px 0; }
      .chat-message.mine .message-avatar { float: right; margin: 0 0 4px 7px; }
    }
    @media (max-width: 380px) {
      .chat-local-search > label { font-size: .68rem; }
      .chat-search-control { border-radius: 10px; }
      .conversation-active { font-size: .67rem; }
      .message-date-separator { margin-top: 14px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .chat-search-control { transition: none; }
    }
  `]
})
export class StaffChatPage implements OnInit, AfterViewInit, OnDestroy {
  readonly conversations = signal<StaffChatConversation[]>([]);
  readonly messages = signal<StaffConversationMessage[]>([]);
  readonly activeConversationId = signal("");
  readonly initialLoading = signal(false);
  readonly messagesLoading = signal(false);
  readonly startingPrivate = signal(false);
  readonly sending = signal(false);
  readonly loadError = signal("");
  readonly messagesError = signal("");
  readonly actionError = signal("");
  readonly online = signal(typeof navigator === "undefined" || navigator.onLine);
  readonly connectionState = signal<RealtimeState>(this.online() ? "connecting" : "offline");
  readonly unseenMessageCount = signal(0);
  readonly conversationSearch = signal("");
  readonly messageSearch = signal("");
  readonly messageSearching = signal(false);
  readonly searchedMessages = signal<StaffChatSearchResponse | null>(null);
  readonly typingUsers = signal<Record<string, string>>({});
  readonly activeConversation = computed(() => this.conversations().find((item) => item.id === this.activeConversationId()) || null);
  readonly filteredConversations = computed(() => {
    const query = this.normalizeSearch(this.conversationSearch());
    if (!query) return this.conversations();
    return this.conversations().filter((item) => this.normalizeSearch(`${item.title} ${item.type} ${item.type === "private-owner" ? "private owner" : "branch team"}`).includes(query));
  });
  readonly filteredMessages = computed(() => {
    const query = this.normalizeSearch(this.messageSearch());
    const results = this.searchedMessages();
    if (query && results) return results.items.map((item) => this.searchResultToMessage(item));
    if (!query) return this.messages();
    return this.messages().filter((item) => this.normalizeSearch(`${item.senderName || "Team member"} ${item.senderUserId === this.staff.user()?.id ? "You" : ""} ${item.body}`).includes(query));
  });
  readonly showConvSuggestions = signal(false);
  readonly showMsgSuggestions = signal(false);

  readonly convSuggestions = computed(() => {
    const q = this.normalizeSearch(this.conversationSearch());
    const titles = this.conversations().map((c) => c.title);
    const types = ["Branch team", "Private owner chat", "Inbox"];
    const all = [...new Set([...titles, ...types])];
    return all.filter((s) => !q || this.normalizeSearch(s).includes(q));
  });

  readonly messageSuggestions = computed(() => {
    const q = this.normalizeSearch(this.messageSearch());
    const senders = this.messages().map((m) => m.senderName || "Team member");
    const phrases = ["Hello", "Appointment", "Shift", "Attendance", "Ready", "Client"];
    const all = [...new Set([...senders, ...phrases])];
    return all.filter((s) => !q || this.normalizeSearch(s).includes(q));
  });

  selectConvSuggestion(val: string): void {
    this.conversationSearch.set(val);
    this.showConvSuggestions.set(false);
  }
  closeConvSuggestions(): void {
    setTimeout(() => this.showConvSuggestions.set(false), 150);
  }

  selectMsgSuggestion(val: string): void {
    this.setMessageSearch(val);
    this.showMsgSuggestions.set(false);
  }
  closeMsgSuggestions(): void {
    setTimeout(() => this.showMsgSuggestions.set(false), 150);
  }
  readonly connectionLabel = computed(() => ({ connecting: "Connecting", live: "Live", polling: "Syncing", offline: "Offline" })[this.connectionState()]);
  readonly messageSearchHint = computed(() => {
    const term = this.messageSearch().trim();
    if (!term) return "All history";
    if (this.messageSearching()) return "Searching all messages…";
    const result = this.searchedMessages();
    if (result) return `${result.total} ${result.total === 1 ? "match" : "matches"} across all history`;
    return "Loaded matches only";
  });
  readonly messageSearchState = computed(() => {
    if (this.messageSearching()) return { title: "Searching messages…", detail: "Looking across this conversation's full message history." };
    if (this.searchedMessages()) return { title: "No matching messages", detail: "Try another sender name or phrase. Search covers the full conversation history." };
    return { title: "No matching loaded messages", detail: "Try another sender name or phrase. Search is limited to the loaded messages." };
  });
  readonly typingLabel = computed(() => {
    const names = Object.values(this.typingUsers());
    if (!names.length) return "";
    return names.length === 1 ? `${names[0]} is typing…` : `${names.slice(0, 2).join(" and ")} are typing…`;
  });
  draft = "";

  private socket: WebSocket | null = null;
  private pollTimer = 0;
  private reconnectTimer = 0;
  private reconnectAttempts = 0;
  private conversationGeneration = 0;
  private messageGeneration = 0;
  private messageSearchTimer = 0;
  private messageSearchGeneration = 0;
  private nearBottom = true;
  private destroyed = false;
  private typingStopTimer = 0;
  private typingHeartbeatAt = 0;
  private readonly typingExpiryTimers = new Map<string, number>();
  private readonly deliveredMessageIds = new Set<string>();
  private readonly readMessageIds = new Set<string>();

  constructor(readonly staff: StaffAppService, private readonly hostRef: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    if (!this.canReadChat()) return;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    void this.loadConversations();
    void this.connectRealtime();
    this.pollTimer = window.setInterval(() => {
      if (this.online() && document.visibilityState === "visible" && this.connectionState() !== "live") void this.poll();
    }, 15000);
  }

  ngAfterViewInit(): void {
    const scroller = this.pageScroller();
    scroller.addEventListener("scroll", this.scrollerScrollListener, { passive: true });
    this.attachedScroller = scroller;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.attachedScroller?.removeEventListener("scroll", this.scrollerScrollListener);
    this.attachedScroller = null;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.typingStopTimer);
    window.clearTimeout(this.messageSearchTimer);
    this.sendTyping(false);
    this.clearTypingUsers();
    this.socket?.close();
  }

  canReadChat(): boolean { return this.staff.hasPermission("read:staff"); }
  canSendChat(): boolean { return this.staff.hasPermission("write:appointments"); }
  isOwner(): boolean { return ["owner", "admin", "superadmin"].includes(String(this.staff.user()?.role || "").trim().toLowerCase()); }
  canStartPrivateChat(): boolean { return this.canSendChat() && !this.isOwner() && !this.conversations().some((item) => item.type === "private-owner"); }
  canSubmit(): boolean { return this.canSendChat() && this.online() && !this.sending() && !!this.draft.trim() && this.draft.length <= 4000 && !!this.activeConversationId(); }
  clearActionError(): void { this.actionError.set(""); }
  setConversationSearch(value: string): void { this.conversationSearch.set(value || ""); }
  setMessageSearch(value: string): void {
    const term = value || "";
    this.messageSearch.set(term);
    window.clearTimeout(this.messageSearchTimer);
    const conversationId = this.activeConversationId();
    if (!term.trim() || !conversationId) {
      this.messageSearching.set(false);
      this.searchedMessages.set(null);
      return;
    }
    this.messageSearching.set(true);
    this.messageSearchTimer = window.setTimeout(() => void this.runServerSearch(conversationId, term), 260);
  }

  private async runServerSearch(conversationId: string, term: string): Promise<void> {
    const generation = ++this.messageSearchGeneration;
    try {
      const result = await this.staff.staffMessageSearch(conversationId, term);
      if (generation === this.messageSearchGeneration && conversationId === this.activeConversationId() && this.messageSearch() === term) {
        this.searchedMessages.set(result);
      }
    } catch {
      if (generation === this.messageSearchGeneration) this.searchedMessages.set(null);
    } finally {
      if (generation === this.messageSearchGeneration) this.messageSearching.set(false);
    }
  }

  private searchResultToMessage(item: StaffChatSearchResult): StaffConversationMessage {
    return {
      id: item.id,
      conversationId: item.conversationId,
      type: item.conversationType,
      senderUserId: item.senderUserId,
      senderName: item.senderName,
      body: item.body,
      createdAt: item.createdAt,
      receipt: { deliveredCount: 0, readCount: 0 }
    };
  }

  lastActiveLabel(value: string | null | undefined): string {
    const date = this.validDate(value);
    if (!date) return "No activity yet";
    const day = this.relativeDayLabel(date);
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    return `Last active ${day} · ${time}`;
  }

  messageDateLabel(value: string): string {
    const date = this.validDate(value);
    if (!date) return "Date unavailable";
    const relative = this.relativeDayLabel(date);
    if (relative === "Today" || relative === "Yesterday") return relative;
    const daysAgo = Math.floor((this.startOfToday().getTime() - this.startOfDay(date).getTime()) / 86400000);
    return daysAgo >= 0 && daysAgo < 7
      ? new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)
      : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" }).format(date);
  }

  showDateSeparator(item: StaffConversationMessage, index: number): boolean {
    const previous = this.filteredMessages()[index - 1];
    return !previous || this.dayKey(previous.createdAt) !== this.dayKey(item.createdAt);
  }

  isGroupedMessage(item: StaffConversationMessage, index: number): boolean {
    const previous = this.filteredMessages()[index - 1];
    if (!previous || previous.senderUserId !== item.senderUserId || this.dayKey(previous.createdAt) !== this.dayKey(item.createdAt)) return false;
    const previousDate = this.validDate(previous.createdAt);
    const itemDate = this.validDate(item.createdAt);
    return !!previousDate && !!itemDate && itemDate.getTime() - previousDate.getTime() <= 300000;
  }

  senderInitials(item: StaffConversationMessage): string {
    const name = item.senderUserId === this.staff.user()?.id ? (item.senderName || "You") : (item.senderName || "Team member");
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
  }

  receiptLabel(item: StaffConversationMessage): "Sent" | "Delivered" | "Read" {
    if (item.receipt?.readCount > 0) return "Read";
    if (item.receipt?.deliveredCount > 0) return "Delivered";
    return "Sent";
  }

  receiptMark(item: StaffConversationMessage): string {
    return this.receiptLabel(item) === "Sent" ? "✓" : "✓✓";
  }

  async loadConversations(silent = false): Promise<void> {
    if (!this.canReadChat()) return;
    const generation = ++this.conversationGeneration;
    const cached = this.staff.readStoredData<StaffChatConversation[]>("chat-conversations");
    if (cached) {
      this.conversations.set(this.sortConversations(cached));
      const defaultConversation = cached.find((item) => item.type === "team") || cached[0];
      if (defaultConversation && !this.activeConversationId()) void this.openConversation(defaultConversation.id);
      this.initialLoading.set(false);
    } else if (!silent) {
      this.initialLoading.set(true);
    }
    this.loadError.set("");
    try {
      const conversations = await this.staff.staffChatConversations();
      if (generation !== this.conversationGeneration) return;
      this.conversations.set(this.sortConversations(conversations));
      this.staff.writeStoredData("chat-conversations", conversations);
      const currentExists = conversations.some((item) => item.id === this.activeConversationId());
      const defaultConversation = conversations.find((item) => item.type === "team") || conversations[0];
      if (!currentExists && defaultConversation) await this.openConversation(defaultConversation.id);
    } catch {
      if (generation === this.conversationGeneration && !silent && !cached) this.loadError.set(this.staff.error() || "Check your connection and try again.");
    } finally {
      if (generation === this.conversationGeneration) this.initialLoading.set(false);
    }
  }

  async openConversation(conversationId: string): Promise<void> {
    if (conversationId === this.activeConversationId() && !this.messagesError()) return;
    this.stopTyping();
    this.clearTypingUsers();
    window.clearTimeout(this.messageSearchTimer);
    this.messageSearch.set("");
    this.messageSearching.set(false);
    this.searchedMessages.set(null);
    this.activeConversationId.set(conversationId);
    this.messages.set([]);
    this.messagesError.set("");
    this.unseenMessageCount.set(0);
    this.nearBottom = true;
    await this.refreshMessages(true);
  }

  async refreshMessages(showLoading = false): Promise<void> {
    const conversationId = this.activeConversationId();
    if (!conversationId || !this.online()) return;
    const generation = ++this.messageGeneration;
    if (showLoading) this.messagesLoading.set(true);
    this.messagesError.set("");
    try {
      const items = await this.staff.staffConversationMessages(conversationId);
      if (generation !== this.messageGeneration || conversationId !== this.activeConversationId()) return;
      const hadMessages = this.messages().length > 0;
      const existing = new Map(this.messages().map((message) => [message.id, message]));
      this.messages.set(this.dedupeMessages(items.map((message) => this.withLatestReceipt(message, existing.get(message.id)))));
      void this.markLoadedReceipts("delivered");
      if (document.visibilityState === "visible") void this.markLoadedReceipts("read");
      if (!hadMessages || this.nearBottom) this.scrollToLatest(false);
    } catch {
      if (generation === this.messageGeneration && showLoading) this.messagesError.set(this.staff.error() || "Check your connection and retry.");
    } finally {
      if (generation === this.messageGeneration) this.messagesLoading.set(false);
    }
  }

  async startPrivateChat(): Promise<void> {
    if (!this.canStartPrivateChat() || !this.online()) return;
    this.startingPrivate.set(true);
    this.actionError.set("");
    try {
      const conversation = await this.staff.startPrivateOwnerChat(crypto.randomUUID());
      this.conversations.update((items) => this.sortConversations([conversation, ...items.filter((item) => item.id !== conversation.id)]));
      await this.openConversation(conversation.id);
    } catch { this.actionError.set(this.staff.error() || "Private owner chat could not be started."); }
    finally { this.startingPrivate.set(false); }
  }

  async send(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.canSubmit()) return;
    const conversationId = this.activeConversationId();
    const body = this.draft.trim();
    this.sending.set(true);
    this.actionError.set("");
    try {
      const message = await this.staff.sendStaffConversationMessage(conversationId, body, crypto.randomUUID());
      this.messages.update((items) => this.dedupeMessages([...items, message]));
      this.stopTyping();
      this.draft = "";
      this.nearBottom = true;
      this.scrollToLatest(true);
      void this.loadConversations(true);
    } catch { this.actionError.set(this.staff.error() || "Message could not be sent. Your draft has been kept."); }
    finally { this.sending.set(false); }
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void this.send();
  }

  onDraftInput(): void {
    window.clearTimeout(this.typingStopTimer);
    if (!this.draft.trim()) { this.stopTyping(); return; }
    if (Date.now() - this.typingHeartbeatAt > 2000) this.sendTyping(true);
    this.typingStopTimer = window.setTimeout(() => this.stopTyping(), 1400);
  }

  stopTyping(): void {
    window.clearTimeout(this.typingStopTimer);
    if (this.typingHeartbeatAt) this.sendTyping(false);
  }

  onMessageScroll(): void {
    const scroller = this.pageScroller();
    this.nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    if (this.nearBottom) this.unseenMessageCount.set(0);
  }

  scrollToLatest(smooth: boolean): void {
    this.nearBottom = true;
    this.unseenMessageCount.set(0);
    window.setTimeout(() => {
      const scroller = this.pageScroller();
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }

  private attachedScroller: HTMLElement | null = null;

  private readonly scrollerScrollListener = (): void => this.onMessageScroll();

  /** The scroll container that actually moves the whole chat page (staff-content on desktop, staff-main-shell on mobile). */
  private pageScroller(): HTMLElement {
    let el: HTMLElement | null = this.hostRef.nativeElement.parentElement;
    while (el) {
      const style = window.getComputedStyle(el);
      if (style.overflowY === "auto" || style.overflowY === "scroll") return el;
      el = el.parentElement;
    }
    return (document.scrollingElement as HTMLElement) || document.body;
  }

  private readonly handleOnline = (): void => {
    this.online.set(true);
    this.connectionState.set("connecting");
    this.reconnectAttempts = 0;
    void this.poll();
    void this.connectRealtime();
  };

  private readonly handleOffline = (): void => {
    this.online.set(false);
    this.connectionState.set("offline");
    this.socket?.close();
    this.typingHeartbeatAt = 0;
    this.clearTypingUsers();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") void this.markLoadedReceipts("read");
    else this.stopTyping();
  };

  private async poll(): Promise<void> {
    if (!this.online()) return;
    if (this.connectionState() !== "live") this.connectionState.set("polling");
    await Promise.all([this.loadConversations(true), this.refreshMessages(false)]);
  }

  private async connectRealtime(): Promise<void> {
    if (this.destroyed || !this.online() || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.connectionState.set("connecting");
    try {
      const url = await this.staff.realtimeSocketTicketUrl();
      if (!url || this.destroyed) { this.connectionState.set("polling"); return; }
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => { this.reconnectAttempts = 0; this.connectionState.set("live"); };
      socket.onmessage = (event) => this.handleRealtimeMessage(event.data);
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        this.typingHeartbeatAt = 0;
        this.clearTypingUsers();
        if (!this.destroyed && this.online()) { this.connectionState.set("polling"); this.scheduleReconnect(); }
      };
    } catch {
      this.connectionState.set("polling");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.reconnectAttempts++, 4));
    this.reconnectTimer = window.setTimeout(() => void this.connectRealtime(), delay);
  }

  private handleRealtimeMessage(raw: unknown): void {
    let frame: { type?: string; payload?: { message?: StaffConversationMessage; conversationId?: string; receipts?: StaffMessageReceiptUpdate[]; userId?: string; name?: string; typing?: boolean } } = {};
    try { frame = JSON.parse(String(raw)); } catch { return; }
    if (frame.type === "team-chat.receipt-updated" && frame.payload?.conversationId === this.activeConversationId()) {
      this.mergeReceiptUpdates(frame.payload.receipts || []);
      return;
    }
    if (frame.type === "team-chat.typing" && frame.payload?.conversationId === this.activeConversationId()) {
      this.updateTypingUser(frame.payload.userId || "", frame.payload.name || "Team member", frame.payload.typing === true);
      return;
    }
    if (!["staff-self.chat_message", "team-chat.private-message"].includes(frame.type || "") || !frame.payload?.message) return;
    const message = frame.payload.message;
    if (message.senderUserId !== this.staff.user()?.id) void this.markReceipts(message.conversationId, [message.id], "delivered");
    if (message.conversationId === this.activeConversationId()) {
      const isNew = !this.messages().some((item) => item.id === message.id);
      this.messages.update((items) => this.dedupeMessages([...items, message]));
      if (isNew) {
        if (this.nearBottom) this.scrollToLatest(false);
        else this.unseenMessageCount.update((count) => count + 1);
      }
      if (document.visibilityState === "visible") void this.markReceipts(message.conversationId, [message.id], "read");
    }
    void this.loadConversations(true);
  }

  private sendTyping(typing: boolean): void {
    const conversationId = this.activeConversationId();
    if (!conversationId || !this.canSendChat() || this.socket?.readyState !== WebSocket.OPEN) {
      if (!typing) this.typingHeartbeatAt = 0;
      return;
    }
    this.socket.send(JSON.stringify({ type: "team-chat.typing", payload: { conversationId, typing } }));
    this.typingHeartbeatAt = typing ? Date.now() : 0;
  }

  private updateTypingUser(userId: string, name: string, typing: boolean): void {
    if (!userId || userId === this.staff.user()?.id) return;
    window.clearTimeout(this.typingExpiryTimers.get(userId));
    this.typingExpiryTimers.delete(userId);
    this.typingUsers.update((users) => {
      const next = { ...users };
      if (typing) next[userId] = name;
      else delete next[userId];
      return next;
    });
    if (typing) this.typingExpiryTimers.set(userId, window.setTimeout(() => this.updateTypingUser(userId, name, false), 5000));
  }

  private clearTypingUsers(): void {
    for (const timer of this.typingExpiryTimers.values()) window.clearTimeout(timer);
    this.typingExpiryTimers.clear();
    this.typingUsers.set({});
  }

  private async markLoadedReceipts(status: "delivered" | "read"): Promise<void> {
    const conversationId = this.activeConversationId();
    const ids = this.messages().filter((message) => message.senderUserId !== this.staff.user()?.id).map((message) => message.id);
    await this.markReceipts(conversationId, ids, status);
  }

  private async markReceipts(conversationId: string, messageIds: string[], status: "delivered" | "read"): Promise<void> {
    if (!conversationId || !messageIds.length || !this.online()) return;
    const marked = status === "read" ? this.readMessageIds : this.deliveredMessageIds;
    const pending = messageIds.filter((id) => !marked.has(id));
    if (!pending.length) return;
    try {
      const result = await this.staff.markStaffMessageReceipts(conversationId, pending, status);
      for (const receipt of result.receipts) {
        marked.add(receipt.messageId);
        if (status === "read") this.deliveredMessageIds.add(receipt.messageId);
      }
      if (conversationId === this.activeConversationId()) this.mergeReceiptUpdates(result.receipts);
    } catch {
      // Polling or the next realtime delivery retries idempotent receipt writes.
    }
  }

  private mergeReceiptUpdates(receipts: StaffMessageReceiptUpdate[]): void {
    const updates = new Map(receipts.map((receipt) => [receipt.messageId, receipt]));
    if (!updates.size) return;
    this.messages.update((messages) => messages.map((message) => {
      const receipt = updates.get(message.id);
      return receipt ? this.withLatestReceipt({ ...message, receipt }, message) : message;
    }));
  }

  private withLatestReceipt(message: StaffConversationMessage, existing?: StaffConversationMessage): StaffConversationMessage {
    return {
      ...message,
      receipt: {
        deliveredCount: Math.max(message.receipt?.deliveredCount || 0, existing?.receipt?.deliveredCount || 0),
        readCount: Math.max(message.receipt?.readCount || 0, existing?.receipt?.readCount || 0)
      }
    };
  }

  private normalizeSearch(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  private validDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private startOfToday(): Date {
    return this.startOfDay(new Date());
  }

  private dayKey(value: string): string {
    const date = this.validDate(value);
    return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : value;
  }

  private relativeDayLabel(date: Date): string {
    const daysAgo = Math.floor((this.startOfToday().getTime() - this.startOfDay(date).getTime()) / 86400000);
    if (daysAgo === 0) return "Today";
    if (daysAgo === 1) return "Yesterday";
    if (daysAgo > 1 && daysAgo < 7) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date);
  }

  private dedupeMessages(items: StaffConversationMessage[]): StaffConversationMessage[] {
    const byId = new Map<string, StaffConversationMessage>();
    for (const item of items) byId.set(item.id, this.withLatestReceipt(item, byId.get(item.id)));
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private sortConversations(items: StaffChatConversation[]): StaffChatConversation[] {
    return [...items].sort((a, b) => {
      if (a.type === "team" && b.type !== "team") return -1;
      if (b.type === "team" && a.type !== "team") return 1;
      return String(b.lastMessageAt || b.updatedAt).localeCompare(String(a.lastMessageAt || a.updatedAt));
    });
  }
}

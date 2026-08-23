import { Component, OnDestroy, computed, effect, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import { OwnerNotification, OwnerNotificationCategory, OwnerOperationsMetadata, OwnerOperationsPage } from "./owner-operations.models";

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <article class="ops-page notifications-page" [attr.aria-busy]="loading()">
      <header class="ops-header notifications-header">
        <div><p class="ops-eyebrow">Owner inbox</p><h1>Notifications</h1><p class="notifications-intro">Business updates and owner-only read receipts, all in one place.</p></div>
        <div class="ops-actions notifications-actions">
          @if (!blockingError()) { <button class="ops-button icon-button" type="button" [disabled]="loading()" (click)="load()" [attr.aria-label]="loading() ? 'Refreshing notifications' : 'Refresh notifications'"><span aria-hidden="true">↻</span><b>{{ loading() ? 'Refreshing' : 'Refresh' }}</b></button> }
          <button class="ops-button primary" type="button" [disabled]="markingAll() || !items().length" (click)="markAll()">{{ markingAll() ? 'Saving…' : 'Mark all read' }}</button>
        </div>
      </header>
      @if (message()) { <p class="ops-notice" [class.error]="messageError()" role="status">{{ message() }}</p> }
      <details class="ops-context-note"><summary>About this inbox <span aria-hidden="true">＋</span></summary><p>Generic notifications without an authoritative branch or navigation target are labeled Tenant-wide. Read receipts are private to this owner account.</p></details>
      <details class="ops-filter-panel">
        <summary><span><strong>Search & filters</strong><small>{{ activeFilterCount() ? activeFilterCount() + ' active' : 'All notifications' }}</small></span><span aria-hidden="true">⌄</span></summary>
        <section class="ops-toolbar" aria-label="Notification filters">
          <label class="ops-field ops-search"><span>Search notifications</span><input type="search" [ngModel]="search()" (ngModelChange)="searchChanged($event)" placeholder="Message, type or channel" />@if(search()){<button type="button" (click)="clearSearch()" aria-label="Clear notification search">×</button>}</label>
          <label class="ops-field"><span>Category</span><select [ngModel]="category()" (ngModelChange)="category.set($event); filterChanged()"><option value="">All categories</option>@for(item of categories; track item.value){<option [value]="item.value">{{ item.label }}</option>}</select></label>
          <label class="ops-field"><span>Read state</span><select [ngModel]="readState()" (ngModelChange)="readState.set($event); filterChanged()"><option value="">Read and unread</option><option value="unread">Unread</option><option value="read">Read</option></select></label>
          <label class="ops-field"><span>Status</span><select [ngModel]="status()" (ngModelChange)="status.set($event); filterChanged()"><option value="">All statuses</option>@for(value of statuses(); track value){<option [value]="value">{{ statusLabel(value) }}</option>}</select></label>
        </section>
      </details>
      <section class="ops-panel notifications-panel">
        <header class="ops-panel-head notifications-panel-head"><div><h2>Inbox</h2><span>{{ page()?.total || items().length }} notifications</span></div><span class="unread-count"><i aria-hidden="true"></i>{{ unreadCount() }} unread</span></header>
        @if (loading() && !items().length) { <div class="ops-skeleton" aria-label="Loading notifications"><i></i><i></i><i></i><i></i></div>
        } @else if (blockingError()) { <div class="ops-state" role="alert"><span>!</span><h2>Notifications unavailable</h2><p>{{ blockingError() }}</p><button class="ops-button" type="button" (click)="load()">Try again</button></div>
        } @else if (!items().length) { <div class="ops-state"><span>✓</span><h2>No matching notifications</h2><p>There are no saved notifications for this filter.</p><button class="ops-button" type="button" (click)="reset()">Clear filters</button></div>
        } @else {
          <table class="ops-table"><thead><tr><th style="width:40%">Notification</th><th>Category</th><th>Scope</th><th>Time</th><th>Status</th><th>Read</th></tr></thead><tbody>@for(item of items(); track item.id){<tr [class.selected]="!item.isRead"><td><strong>{{ item.message }}</strong><small>{{ item.type || 'No type' }} · {{ item.channel }}</small></td><td><span class="ops-status">{{ categoryLabel(item.category) }}</span></td><td><strong>{{ item.branchName }}</strong><small>{{ item.scope === 'tenant-wide' ? 'Branch unavailable' : 'Client-linked branch' }}</small></td><td><strong>{{ dateTime(item.createdAt) }}</strong></td><td><span class="ops-status" [attr.data-tone]="tone(item.status)">{{ statusLabel(item.status) }}</span></td><td><button class="ops-button" type="button" [disabled]="savingId() === item.id" (click)="toggle(item)">{{ savingId() === item.id ? 'Saving…' : item.isRead ? 'Mark unread' : 'Mark read' }}</button></td></tr>}</tbody></table>
          <div class="ops-cards">@for(item of items(); track item.id){<article class="ops-card notification-card" [class.unread]="!item.isRead"><header><span class="notification-category"><i aria-hidden="true"></i>{{ categoryLabel(item.category) }}</span><span class="notification-read-state">{{ item.isRead ? 'Read' : 'New' }}</span></header><p class="notification-message">{{ item.message }}</p><div class="notification-meta"><span>{{ dateTime(item.createdAt) }}</span><span>{{ item.branchName }}</span></div><footer><span class="ops-status" [attr.data-tone]="tone(item.status)">{{ statusLabel(item.status) }}</span><button class="notification-read-action" type="button" [disabled]="savingId() === item.id" (click)="toggle(item)">{{ savingId() === item.id ? 'Saving…' : item.isRead ? 'Mark unread' : 'Mark read' }}</button></footer></article>}</div>
          <footer class="ops-pagination" aria-label="Notification pages"><span>Page {{ page()?.page }} of {{ page()?.totalPages }}</span><button type="button" [disabled]="page()?.page === 1 || loading()" (click)="go(-1)" aria-label="Previous notification page">←</button><button type="button" [disabled]="!page()?.hasMore || loading()" (click)="go(1)" aria-label="Next notification page">→</button></footer>
        }
      </section>
    </article>
  `,
  styleUrls: ["./owner-shell.styles.css", "./owner-operations.css"]
})
export class OwnerNotificationsPage implements OnDestroy {
  readonly categories: Array<{ value: OwnerNotificationCategory; label: string }> = [{ value: "action-required", label: "Action required" }, { value: "business", label: "Business" }, { value: "staff", label: "Staff" }, { value: "financial", label: "Financial" }, { value: "inventory", label: "Inventory" }, { value: "system", label: "System" }];
  readonly items = signal<OwnerNotification[]>([]); readonly page = signal<OwnerOperationsPage | null>(null); readonly metadata = signal<OwnerOperationsMetadata | null>(null); readonly loading = signal(true); readonly blockingError = signal(""); readonly search = signal(""); readonly debouncedSearch = signal(""); readonly category = signal(""); readonly readState = signal(""); readonly status = signal(""); readonly statuses = signal<string[]>([]); readonly savingId = signal(""); readonly markingAll = signal(false); readonly message = signal(""); readonly messageError = signal(false);
  readonly unreadCount = computed(() => this.metadata()?.unreadTotal ?? this.items().filter((item) => !item.isRead).length);
  readonly activeFilterCount = computed(() => [this.debouncedSearch(), this.category(), this.readState(), this.status()].filter(Boolean).length);
  private requestId = 0; private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly owner: OwnerAppService, readonly context: OwnerContextService) { effect(() => { const branch = this.context.selectedBranchId(); untracked(() => { void branch; this.items.set([]); this.page.set(null); this.statuses.set([]); void this.load(); }); }); }
  ngOnDestroy(): void { if (this.timer) clearTimeout(this.timer); this.requestId++; }
  searchChanged(value: string): void { this.search.set(value); if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.debouncedSearch.set(value.trim()); this.items.set([]); this.filterChanged(); }, 350); }
  clearSearch(): void { this.search.set(""); this.debouncedSearch.set(""); this.items.set([]); this.filterChanged(); }
  filterChanged(): void { this.items.set([]); this.page.set(null); void this.load(); }
  async load(): Promise<void> { const request = ++this.requestId, hadItems = this.items().length > 0; this.loading.set(true); this.message.set(""); this.messageError.set(false); try { const result = await this.owner.ownerNotifications({ branchId: this.context.selectedBranchId() || "all", page: this.page()?.page || 1, pageSize: 30, search: this.debouncedSearch(), category: this.category(), read: this.readState(), status: this.status() }); if (request !== this.requestId) return; this.items.set(result.items); this.page.set(result.page); this.metadata.set(result.metadata); this.statuses.set([...new Set([...this.statuses(), ...result.items.map((item) => item.status)].filter(Boolean))].sort()); this.blockingError.set(""); this.context.markSuccessfulRefresh(); } catch { if (request !== this.requestId) return; if (hadItems) { this.messageError.set(true); this.message.set("Refresh failed. Previously loaded notifications remain visible."); } else this.blockingError.set("Aura could not load owner notifications."); } finally { if (request === this.requestId) this.loading.set(false); } }
  async toggle(item: OwnerNotification): Promise<void> { if (this.savingId()) return; this.savingId.set(item.id); this.message.set(""); this.messageError.set(false); try { await this.owner.setOwnerNotificationRead(item.id, !item.isRead); await this.reloadAfterMutation(); } catch { this.messageError.set(true); this.message.set("The owner receipt could not be saved."); } finally { this.savingId.set(""); } }
  async markAll(): Promise<void> { if (!this.items().length || this.markingAll()) return; this.markingAll.set(true); this.message.set(""); this.messageError.set(false); try { const result = await this.owner.markAllOwnerNotificationsRead(this.context.selectedBranchId() || "all", { category: this.category(), search: this.debouncedSearch(), read: this.readState(), status: this.status() }); await this.reloadAfterMutation(); this.message.set(`${result.updated} notifications marked read.`); } catch { this.messageError.set(true); this.message.set("Owner receipts could not be saved. Refresh to confirm their state."); } finally { this.markingAll.set(false); } }
  reset(): void { this.search.set(""); this.debouncedSearch.set(""); this.category.set(""); this.readState.set(""); this.status.set(""); this.items.set([]); this.filterChanged(); }
  go(direction: number): void { const current = this.page()?.page || 1; this.items.set([]); this.page.update((page) => page ? { ...page, page: Math.max(1, current + direction) } : page); void this.load(); }
  private async reloadAfterMutation(): Promise<void> { await this.load(); const current = this.page(); if (!this.items().length && current && current.page > 1) { this.page.set({ ...current, page: current.page - 1 }); this.items.set([]); await this.load(); } }
  categoryLabel(value: OwnerNotificationCategory): string { return this.categories.find((item) => item.value === value)?.label || value; }
  statusLabel(value: string): string { return value.trim().split(/[-_\s]+/).filter(Boolean).map((part) => part.toLowerCase() === "whatsapp" ? "WhatsApp" : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" · ") || "Recorded"; }
  tone(value: string): string { const status = value.toLowerCase(); return /failed|error|rejected|cancel/.test(status) ? "danger" : /queued|pending|scheduled|waiting/.test(status) ? "warning" : /sent|delivered|complete|success/.test(status) ? "success" : "neutral"; }
  dateTime(value: string): string { return this.context.formatDateTime(value); }
}

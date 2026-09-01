import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, effect, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { AuraPullRefresh } from "../../core/aura-pull-refresh.directive";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService, OwnerPeriod } from "./owner-context.service";

type OwnerModule = "dashboard" | "appointments" | "clients" | "staff" | "attendance" | "leave-requests" | "chats" | "whatsapp" | "revenue" | "reports" | "gst" | "busy-hours" | "payroll" | "inventory" | "purchase-orders" | "billing-access" | "commerce" | "marketing" | "promos" | "notifications" | "roles-permissions" | "branches" | "settings";
type OwnerNavItem = { module: OwnerModule; group: "Overview" | "People" | "Operations" | "Growth" | "Administration"; label: string; path: string | null; icon: string; unavailable?: boolean };
type OwnerOverlay = "navigation" | "more" | "branch" | "period" | "profile" | null;

const NAV: OwnerNavItem[] = [
  { module: "dashboard" as const, group: "Overview", label: "Dashboard", path: "/owner/dashboard", icon: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" },
  { module: "appointments" as const, group: "Overview", label: "Appointments", path: "/owner/appointments", icon: "M7 3v2H5v16h14V5h-2V3h-2v2H9V3H7Zm10 7H7v8h10v-8Z" },
  { module: "revenue" as const, group: "Overview", label: "Revenue", path: "/owner/revenue", icon: "M4 6h16v12H4V6Zm2 2v8h12V8H6Zm6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" },
  { module: "clients" as const, group: "People", label: "Clients", path: "/owner/clients", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5Z" },
  { module: "staff" as const, group: "People", label: "Staff", path: "/owner/staff", icon: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 1 0 0-6v6ZM8 13c-4 0-7 2-7 5v2h14v-2c0-3-3-5-7-5Zm8 1c3 .7 5 2.3 5 4v2h-4v-2c0-1.5-.4-2.8-1-4Z" },
  { module: "attendance" as const, group: "People", label: "Attendance", path: "/owner/attendance", icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5v5.6l3.5 2.1-1 1.7-4.5-2.8V7h2Z" },
  { module: "leave-requests" as const, group: "People", label: "Leaves", path: "/owner/leave-requests", icon: "M6 3h12v18H6V3Zm3 4v2h6V7H9Zm0 4v2h6v-2H9Z" },
  { module: "chats" as const, group: "People", label: "Team Chat", path: "/owner/chats", icon: "M4 4h16v13H8l-4 4V4Zm4 5h8V7H8v2Zm0 4h6v-2H8v2Z" },
  { module: "whatsapp" as const, group: "People", label: "WhatsApp", path: "/owner/whatsapp", icon: "M12 2a10 10 0 0 0-8.7 14.9L2 22l5.3-1.2A10 10 0 1 0 12 2Zm4.4 13.2c-.2.6-1.2 1.1-1.7 1.2-.5.1-1.1.1-1.8-.1-1-.3-2.2-.9-3.4-2.1-1.3-1.3-2.1-2.8-2.3-3.8-.2-.7 0-1.3.2-1.7.2-.4.5-.6.8-.6h.6c.2 0 .4 0 .6.5l.7 1.7c.1.2.1.4 0 .6l-.4.5c-.1.2-.2.3 0 .6.2.4.7 1.1 1.3 1.6.8.7 1.4 1 1.8 1.1.3.1.4.1.6-.1l.7-.8c.2-.2.4-.2.7-.1l1.6.8c.3.2.4.4.3.7Z" },
  { module: "inventory" as const, group: "Operations", label: "Inventory", path: "/owner/inventory", icon: "M3 6 12 2l9 4-9 4-9-4Zm2 4 7 3 7-3v7l-7 4-7-4v-7Z" },
  { module: "purchase-orders" as const, group: "Operations", label: "Purchase Orders", path: "/owner/purchase-orders", icon: "M5 3h14v18H5V3Zm3 4h8V5H8v2Zm0 4h8V9H8v2Zm0 4h5v-2H8v2Z" },
  { module: "billing-access", group: "Operations", label: "Billing Access", path: "/owner/billing", icon: "M4 5h16v14H4V5Zm2 3h12V7H6v1Zm0 4h5v-2H6v2Z" },
  { module: "payroll" as const, group: "Operations", label: "Payroll", path: "/owner/payroll", icon: "M3 5h18v14H3V5Zm3 3v8h12V8H6Zm6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" },
  { module: "reports" as const, group: "Operations", label: "Reports", path: "/owner/reports", icon: "M5 3h10l4 4v14H5V3Zm3 9v5h2v-5H8Zm4-3v8h2V9h-2Z" },
  { module: "gst" as const, group: "Operations", label: "GST & Expenses", path: "/owner/gst", icon: "M5 4h14v16H5V4Zm3 4h8V6H8v2Zm0 4h3v-2H8v2Zm5 0h3v-2h-3v2Zm-5 4h3v-2H8v2Zm5 0h3v-2h-3v2Z" },
  { module: "busy-hours" as const, group: "Operations", label: "Busy Hours", path: "/owner/busy-hours", icon: "M4 19h16v2H4v-2Zm1-4h3V7H5v8Zm5 0h3V3h-3v12Zm5 0h3v-6h-3v6Z" },
  { module: "marketing" as const, group: "Growth", label: "Marketing", path: "/owner/marketing", icon: "M3 10v4h3l4 4h2l-2-4 9 3V7l-13 3H3Z" },
  { module: "promos" as const, group: "Growth", label: "Coupons & Referrals", path: "/owner/promos", icon: "M7 3h10v4h2v6h-2v4H7v-4H5V7h2V3Zm2 2v2h6V5H9Zm0 8v2h6v-2H9Z" },
  { module: "commerce" as const, group: "Growth", label: "Gift Cards & Bundles", path: "/owner/commerce", icon: "M4 8h16v4H4V8Zm1 5h14v7H5v-7Zm2-9h4l1 4H7L7 4Zm6 0h4v4h-5l1-4Z" },
  { module: "notifications" as const, group: "Growth", label: "Notifications", path: "/owner/notifications", icon: "M18 15v-4a6 6 0 0 0-5-5.9V3h-2v2.1A6 6 0 0 0 6 11v4l-2 3h16l-2-3Zm-8 4a2 2 0 0 0 4 0h-4Z" },
  { module: "branches" as const, group: "Administration", label: "Branches", path: "/owner/branches", icon: "M4 21V4h10v4h6v13h-6v-4h-4v4H4Zm3-13h2V6H7v2Zm0 4h2v-2H7v2Z" },
  { module: "roles-permissions" as const, group: "Administration", label: "Roles & Permissions", path: "/owner/roles-permissions", icon: "m12 2 8 3v6c0 5-3 9-8 11-5-2-8-6-8-11V5l8-3Z" },
  { module: "settings" as const, group: "Administration", label: "Settings", path: "/owner/settings", icon: "M19 13a7 7 0 0 0 0-2l2-1-2-4-2 1-2-1-1-3h-4L9 6 7 7 5 6l-2 4 2 1a7 7 0 0 0 0 2l-2 1 2 4 2-1 2 1 1 3h4l1-3 2-1 2 1 2-4-2-1Zm-7 2a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" }
];

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="owner-login">
      <section class="owner-login-story" aria-labelledby="owner-login-heading">
        <a class="owner-mark" href="/owner/login" aria-label="Solastio Owner home"><span>S</span><strong>Solastio</strong></a>
        <div><p class="owner-kicker">Private owner workspace</p><h1 id="owner-login-heading">See the whole business.<br><em>Act on what matters.</em></h1><p>Owner-only access to existing operational, people, financial and governance intelligence.</p></div>
        <small>Protected by Solastio role controls</small>
      </section>
      <section class="owner-login-panel">
        <form (ngSubmit)="login()" aria-label="Owner sign in">
          <div class="owner-login-heading"><p class="owner-kicker">Welcome back</p><h2>Owner sign in</h2><p>Use the owner account issued for your salon.</p></div>
          @if (owner.error()) { <p class="owner-alert error" role="alert">{{ owner.error() }}</p> }
          <label for="owner-tenant">Tenant ID</label><input id="owner-tenant" name="tenant" [(ngModel)]="tenantId" autocomplete="organization" required />
          <label for="owner-login-id">Email or login ID</label><input id="owner-login-id" name="loginId" [(ngModel)]="loginId" autocomplete="username" required />
          <label for="owner-password">Password</label>
          <div class="owner-password"><input id="owner-password" name="password" [(ngModel)]="password" [type]="showPassword() ? 'text' : 'password'" autocomplete="current-password" required /><button type="button" (click)="showPassword.set(!showPassword())" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'">{{ showPassword() ? 'Hide' : 'Show' }}</button></div>
          @if (owner.requiresTotp()) { <label for="owner-totp">Authenticator or recovery code</label><input id="owner-totp" name="totpToken" [(ngModel)]="totpToken" autocomplete="one-time-code" required autofocus /> }
          <button class="owner-primary" type="submit" [disabled]="owner.loading() || !tenantId.trim() || !loginId.trim() || !password || (owner.requiresTotp() && !totpToken.trim())">{{ owner.loading() ? 'Verifying…' : owner.requiresTotp() ? 'Verify and continue' : 'Enter owner workspace' }}</button>
          <p class="owner-login-note">Manager, staff, receptionist and client accounts cannot access this section.</p>
        </form>
      </section>
    </main>
  `,
  styleUrls: ["./owner-app.styles.css", "./owner-shell.styles.css"]
})
export class OwnerLoginPage implements OnInit {
  tenantId = "";
  loginId = "";
  password = "";
  totpToken = "";
  readonly showPassword = signal(false);
  constructor(readonly owner: OwnerAppService, private readonly router: Router, private readonly context: OwnerContextService) {}
  ngOnInit(): void { this.context.initializeTheme(); }
  async login(): Promise<void> {
    if (this.owner.loading()) return;
    try { await this.owner.login({ tenantId: this.tenantId, loginId: this.loginId, password: this.password, totpToken: this.totpToken }); await this.context.initialize(); await this.router.navigateByUrl(this.context.defaultLandingRoute()); } catch { /* The service exposes an accessible error. */ }
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet, AuraPullRefresh],
  template: `
    <section class="owner-shell" [class.owner-compact]="context.compactMode()">
      <aside class="owner-sidebar owner-desktop-sidebar" [class.is-collapsed]="sidebarCollapsed()" [attr.inert]="overlay() ? '' : null" aria-label="Owner navigation">
        <div class="owner-brand"><span>S</span><div><strong>{{ context.workspaceName() }}</strong><small>Owner office</small></div></div>
        <button class="owner-collapse" type="button" (click)="toggleSidebar()" [attr.aria-label]="sidebarCollapsed() ? 'Expand owner sidebar' : 'Collapse owner sidebar'" [attr.aria-expanded]="!sidebarCollapsed()"></button>
        <nav aria-label="Owner sections">
          @for (group of navGroups(); track group) {
            <p>{{ group }}</p>
            @for (item of navByGroup(group); track item.module) {
              <a [routerLink]="item.path" routerLinkActive="active" [attr.title]="sidebarCollapsed() ? item.label : null"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon"></path></svg><span>{{ item.label }}</span></a>
            }
          }
        </nav>
        <div class="owner-side-footer"><span><i></i> Owner access</span><small>{{ context.workspaceName() }}</small></div>
      </aside>
      <div class="owner-main owner-shell-frame" #ownerMain [attr.inert]="overlay() ? '' : null" [auraPullRefresh]="refreshChildPage.bind(this)">
        <header class="owner-topbar">
          <button type="button" class="owner-menu" (click)="openOverlay('navigation', $event)" aria-label="Open owner navigation"><span></span><span></span><span></span></button>
          <div class="owner-location"><span>Owner workspace</span><strong>{{ currentLabel() }}</strong></div>
          <div class="owner-global-context" aria-label="Owner workspace context">
            @if (branchApplies()) { <button type="button" class="owner-context-control" [disabled]="!context.allowBranchSwitch()" (click)="openOverlay('branch', $event)" aria-haspopup="dialog"><span>Branch</span><strong>{{ context.branchLabel() }}</strong><small>{{ context.allowBranchSwitch() ? (context.selectedBranch() ? (context.selectedBranch()?.city || context.selectedBranch()?.status) : context.branches().length + ' accessible') : 'Switching disabled' }}</small></button> }
            @else { <button type="button" class="owner-context-control" disabled aria-label="Marketing uses tenant-wide campaign records; branch is not applied"><span>Scope</span><strong>Tenant-wide</strong><small>Branch not applied</small></button> }
            @if (periodApplies()) { <button type="button" class="owner-context-control" (click)="openOverlay('period', $event)" aria-haspopup="dialog"><span>Period</span><strong>{{ context.periodName() }}</strong><small>{{ context.periodRangeLabel() }}</small></button> }
            @else { <button type="button" class="owner-context-control" disabled [attr.aria-label]="currentLabel() + ' uses current data; period is not applied'"><span>Range</span><strong>Current data</strong><small>Period not applied</small></button> }
          </div>
          @if (context.lastRefreshLabel()) { <span class="owner-last-refresh" role="status">{{ context.lastRefreshLabel() }}</span> }
          <a class="owner-icon-button owner-mobile-utility" routerLink="/owner/notifications" routerLinkActive="active" aria-label="Open notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 15v-4a6 6 0 0 0-5-5.9V3h-2v2.1A6 6 0 0 0 6 11v4l-2 3h16l-2-3Zm-8 4a2 2 0 0 0 4 0h-4Z"></path></svg></a>
          <a class="owner-icon-button owner-mobile-utility" routerLink="/owner/chats" routerLinkActive="active" aria-label="Open team chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v13H8l-4 4V4Zm4 5h8V7H8v2Zm0 4h6v-2H8v2Z"></path></svg></a>
        </header>
        <div class="owner-mobile-context" aria-label="Owner workspace context">
          @if (branchApplies()) { <button type="button" [disabled]="!context.allowBranchSwitch()" (click)="openOverlay('branch', $event)"><span>Branch</span><strong>{{ context.branchLabel() }}</strong></button> }
          @else { <button type="button" disabled aria-label="Marketing uses tenant-wide campaign records; branch is not applied"><span>Tenant-wide</span><strong>Branch not applied</strong></button> }
          @if (periodApplies()) { <button type="button" (click)="openOverlay('period', $event)"><span>{{ context.periodName() }}</span><strong>{{ context.periodRangeLabel() }}</strong></button> }
          @else { <button type="button" disabled [attr.aria-label]="currentLabel() + ' uses current data; period is not applied'"><span>Current data</span><strong>Period not applied</strong></button> }
        </div>
        <main class="owner-content"><router-outlet /></main>
        <nav class="owner-mobile-nav" aria-label="Owner quick navigation">
          @for (item of mobileNav; track item.path) { <a [routerLink]="item.path" routerLinkActive="active"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon"></path></svg><span>{{ item.label }}</span></a> }
          <button type="button" (click)="openOverlay('more', $event)" aria-label="Open more owner modules"><span aria-hidden="true">•••</span><small>More</small></button>
        </nav>
      </div>

      @if (overlay()) {
        <button class="owner-modal-backdrop" type="button" (click)="closeOverlay()" aria-label="Close menu"></button>
        <section class="owner-overlay-panel" [class.owner-overlay-navigation]="overlay() === 'navigation'" [class.owner-overlay-more]="overlay() === 'more'" [class.owner-overlay-compact]="overlay() === 'profile'" role="dialog" aria-modal="true" [attr.aria-labelledby]="overlayTitleId()" #overlayPanel tabindex="-1">
          <header><div><p class="owner-kicker">Owner workspace</p><h2 [id]="overlayTitleId()">{{ overlayTitle() }}</h2></div><button type="button" (click)="closeOverlay()" aria-label="Close">×</button></header>

          @if (overlay() === 'navigation' || overlay() === 'more') {
            <nav class="owner-sheet-nav" aria-label="Owner modules">
              @if(context.commandSearchEnabled()){<label class="owner-search-field"><span>Find a module</span><input type="search" [ngModel]="navQuery()" (ngModelChange)="navQuery.set($event)" placeholder="Search owner modules" autocomplete="off" /></label>}
              @for (group of navGroups(); track group) {
                @if (overlay() === 'navigation' || mobileMoreByGroup(group).length) {
                  <p>{{ group }}</p>
                   @for (item of overlay() === 'more' ? mobileMoreByGroup(group) : overlayNavByGroup(group); track item.module) {
                    <a [routerLink]="item.path" routerLinkActive="active" (click)="closeOverlay()"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon"></path></svg><span>{{ item.label }}</span><b aria-hidden="true">→</b></a>
                  }
                }
              }
              <p>Appearance</p>
              <button type="button" (click)="context.toggleTheme()" [attr.aria-label]="context.theme() === 'dark' ? 'Turn off dark mode' : 'Turn on dark mode'">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10c0-.46-.03-.9-.09-1.34A8 8 0 0 1 12 2Zm0 18a8 8 0 0 1-2.9-15.46A10 10 0 0 0 19.46 14.9 8 8 0 0 1 12 20Z"></path></svg>
                <span>Dark mode</span><b>{{ context.theme() === 'dark' ? 'On' : 'Off' }}</b>
              </button>
              <p>Account</p>
              <button type="button" (click)="showProfile()">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6Z"></path></svg>
                <span>Profile</span><b aria-hidden="true">→</b>
              </button>
            </nav>
          }

          @if (overlay() === 'branch') {
            <div class="owner-selector-intro"><p>Choose a viewing context. Server authorization continues to control data access.</p><span>{{ context.branches().length }} accessible {{ context.branches().length === 1 ? 'branch' : 'branches' }}</span></div>
            <label class="owner-search-field" for="owner-branch-search"><span>Search branches</span><input id="owner-branch-search" type="search" [ngModel]="branchQuery()" (ngModelChange)="branchQuery.set($event)" placeholder="Name, city or location" autocomplete="off" /></label>
            @if (context.branchesError()) { <p class="owner-alert error" role="alert">{{ context.branchesError() }} <button type="button" (click)="context.loadBranches()">Try again</button></p> }
            @if (context.branchesLoading()) {
              <div class="owner-selector-skeleton" aria-label="Loading branches"><i></i><i></i><i></i></div>
            } @else {
              <div class="owner-option-list" role="group" aria-label="Accessible branches">
                <button type="button" [attr.aria-pressed]="!context.selectedBranchId()" (click)="chooseBranch('')"><span class="owner-option-mark" aria-hidden="true">∞</span><span><strong>All Branches</strong><small>Portfolio context across accessible locations</small></span><b>{{ !context.selectedBranchId() ? 'Current' : '' }}</b></button>
                @for (branch of filteredBranches(); track branch.id) {
                  <button type="button" [attr.aria-pressed]="context.selectedBranchId() === branch.id" (click)="chooseBranch(branch.id)"><span class="owner-option-mark" aria-hidden="true">{{ branch.name.charAt(0) }}</span><span><strong>{{ branch.name }}</strong><small>{{ branch.city || branch.location || 'Location not provided' }} · <i [attr.data-status]="branch.status.toLowerCase()">{{ branch.status }}</i></small></span><b>{{ context.selectedBranchId() === branch.id ? 'Current' : context.recentBranchId() === branch.id ? 'Recent' : '' }}</b></button>
                } @empty { <div class="owner-inline-empty"><strong>No matching branches</strong><span>Try a different search.</span></div> }
              </div>
            }
          }

          @if (overlay() === 'period') {
            <div class="owner-selector-intro"><p>This period filters date-aware Owner pages. Current-state pages identify when the period does not apply.</p><span>IST calendar</span></div>
            <div class="owner-period-grid" role="group" aria-label="Date period">
              @for (period of periods; track period.value) { <button type="button" [attr.aria-pressed]="periodDraft() === period.value" (click)="choosePeriod(period.value)"><span>{{ period.label }}</span><small>{{ period.value === 'custom' ? 'Choose dates' : rangeFor(period.value) }}</small></button> }
            </div>
            @if (periodDraft() === 'custom') {
              <div class="owner-custom-range"><label for="owner-period-start"><span>Start date</span><input id="owner-period-start" type="date" [ngModel]="customStart()" (ngModelChange)="customStart.set($event)" /></label><label for="owner-period-end"><span>End date</span><input id="owner-period-end" type="date" [ngModel]="customEnd()" (ngModelChange)="customEnd.set($event)" /></label></div>
              @if (periodError()) { <p class="owner-field-error" role="alert">{{ periodError() }}</p> }
              <button type="button" class="owner-primary compact" (click)="applyCustomPeriod()">Apply custom period</button>
            }
          }

          @if (overlay() === 'profile') {
            <div class="owner-profile-card"><span>{{ initials() }}</span><div><strong>{{ owner.user()?.name || 'Owner' }}</strong><small>{{ owner.user()?.email || 'Owner account' }}</small></div></div>
            <dl class="owner-profile-context"><div><dt>Workspace</dt><dd>{{ context.workspaceName() }}</dd></div><div><dt>Branch context</dt><dd>{{ context.branchLabel() }}</dd></div></dl>
            <button type="button" class="owner-signout" (click)="logout()">Sign out <span aria-hidden="true">→</span></button>
          }
        </section>
      }
    </section>
  `,
  styleUrls: ["./owner-app.styles.css", "./owner-shell.styles.css"]
})
export class OwnerLayoutPage implements OnInit, OnDestroy {
  @ViewChild("overlayPanel") overlayPanel?: ElementRef<HTMLElement>;
  @ViewChild("ownerMain") ownerMain?: ElementRef<HTMLElement>;
  readonly nav = NAV;
  readonly mobileNav = ["dashboard", "appointments", "staff", "revenue"].map((module) => NAV.find((item) => item.module === module)).filter((item): item is OwnerNavItem & { path: string } => !!item?.path);
  readonly periods: Array<{ value: OwnerPeriod; label: string }> = [{ value: "today", label: "Today" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }, { value: "year", label: "Year" }, { value: "custom", label: "Custom" }];
  readonly overlay = signal<OwnerOverlay>(null);
  readonly sidebarCollapsed = signal(false);
  readonly branchQuery = signal("");
  readonly navQuery = signal("");
  readonly periodDraft = signal<OwnerPeriod>("today");
  readonly customStart = signal("");
  readonly customEnd = signal("");
  readonly periodError = signal("");
  readonly filteredBranches = computed(() => {
    const query = this.branchQuery().trim().toLowerCase();
    return this.context.branches().filter((branch) => !query || `${branch.name} ${branch.city} ${branch.location} ${branch.status}`.toLowerCase().includes(query));
  });
  private triggerElement: HTMLElement | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private routerSubscription?: { unsubscribe(): void };
  private readonly mobileSwipeRoutes = ["/owner/dashboard", "/owner/appointments", "/owner/staff", "/owner/revenue"];

  constructor(readonly owner: OwnerAppService, readonly context: OwnerContextService, private readonly router: Router) {
    effect(() => { if (owner.sessionExpired()) void router.navigateByUrl("/owner/login"); });
  }
  ngOnInit(): void {
    try { this.sidebarCollapsed.set(localStorage.getItem("auraOwner:sidebarCollapsed") === "true"); } catch { /* Default expanded. */ }
    void this.context.initialize();
    this.routerSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd && this.ownerMain) this.ownerMain.nativeElement.scrollTop = 0;
    });
  }
  ngOnDestroy(): void { this.closeOverlay(false); this.context.leaveOwnerSurface(); this.routerSubscription?.unsubscribe(); }
  @HostListener("window:keydown", ["$event"])
  onKeydown(event: KeyboardEvent): void {
    if (!this.overlay()) return;
    if (event.key === "Escape") { event.preventDefault(); this.closeOverlay(); return; }
    if (event.key !== "Tab") return;
    const focusable = this.overlayPanel?.nativeElement.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable?.length) { event.preventDefault(); this.overlayPanel?.nativeElement.focus(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  @HostListener("window:touchstart", ["$event"])
  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.touches[0]?.clientX || 0;
    this.touchStartY = event.touches[0]?.clientY || 0;
  }
  @HostListener("window:touchend", ["$event"])
  onTouchEnd(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    const endX = touch?.clientX || 0;
    const endY = touch?.clientY || 0;
    const deltaX = endX - this.touchStartX;
    const deltaY = endY - this.touchStartY;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input,textarea,select,button,a,.calendar-scroll,.responsive-table,.branch-table,.view-tabs,.adm-section-nav,.owner-period-grid,.owner-option-list")) return;
    const activeOverlay = this.overlay();
    if (activeOverlay && deltaY > 80 && Math.abs(deltaY) > Math.abs(deltaX)) { this.closeOverlay(); return; }
    if (activeOverlay === "navigation" && deltaX < -70 && Math.abs(deltaX) > Math.abs(deltaY)) { this.closeOverlay(); return; }
    if (!activeOverlay && this.touchStartX < 24 && deltaX > 70 && Math.abs(deltaX) > Math.abs(deltaY)) { this.openOverlay("navigation"); return; }
    if (window.matchMedia("(max-width: 900px)").matches && !activeOverlay && Math.abs(deltaX) > 70 && Math.abs(deltaX) > Math.abs(deltaY)) this.navigateMobileSwipe(deltaX < 0 ? 1 : -1);
  }
  openOverlay(kind: Exclude<OwnerOverlay, null>, event?: Event): void {
    if (kind === "branch" && !this.context.allowBranchSwitch()) return;
    this.triggerElement = event?.currentTarget as HTMLElement || null;
    this.overlay.set(kind);
    if (kind === "branch") this.branchQuery.set("");
    if (kind === "navigation" || kind === "more") this.navQuery.set("");
    if (kind === "period") {
      this.periodDraft.set(this.context.period());
      this.customStart.set(this.context.periodRange().start);
      this.customEnd.set(this.context.periodRange().end);
      this.periodError.set("");
    }
    document.documentElement.classList.add("staff-overlay-open");
    setTimeout(() => this.overlayPanel?.nativeElement.focus(), 0);
  }
  closeOverlay(restoreFocus = true): void {
    if (!this.overlay()) return;
    this.overlay.set(null);
    document.documentElement.classList.remove("staff-overlay-open");
    if (restoreFocus) setTimeout(() => this.triggerElement?.focus(), 0);
  }
  showProfile(): void { this.overlay.set("profile"); setTimeout(() => this.overlayPanel?.nativeElement.focus(), 0); }
  toggleSidebar(): void {
    const next = !this.sidebarCollapsed(); this.sidebarCollapsed.set(next);
    try { localStorage.setItem("auraOwner:sidebarCollapsed", String(next)); } catch { /* Current layout state is retained in memory. */ }
  }
  navGroups(): string[] { return [...new Set(this.nav.map((item) => item.group))]; }
  navByGroup(group: string) { return this.nav.filter((item) => item.group === group); }
  overlayNavByGroup(group: string): OwnerNavItem[] { const query = this.navQuery().trim().toLowerCase(); return this.navByGroup(group).filter((item) => !query || item.label.toLowerCase().includes(query)); }
  mobileMoreByGroup(group: string): OwnerNavItem[] { return this.navByGroup(group).filter((item) => !["dashboard", "appointments", "staff", "revenue"].includes(item.module)); }
  currentLabel(): string { return NAV.find((item) => item.path && this.router.url.startsWith(item.path))?.label || "Dashboard"; }
  branchApplies(): boolean { return this.activeRouteData("ownerBranch") !== false; }
  periodApplies(): boolean { return this.activeRouteData("ownerPeriod") !== false; }
  initials(): string { return String(this.owner.user()?.name || "Owner").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "O"; }
  overlayTitle(): string { return this.overlay() === "navigation" ? "Navigation" : this.overlay() === "more" ? "More modules" : this.overlay() === "branch" ? "Branch context" : this.overlay() === "period" ? "Period context" : "Owner profile"; }
  overlayTitleId(): string { return `owner-${this.overlay() || "menu"}-title`; }
  chooseBranch(branchId: string): void { this.context.selectBranch(branchId); this.closeOverlay(); }
  choosePeriod(period: OwnerPeriod): void { this.periodDraft.set(period); this.periodError.set(""); if (period !== "custom") { this.context.selectPeriod(period); this.closeOverlay(); } }
  applyCustomPeriod(): void { if (!this.context.applyCustomPeriod(this.customStart(), this.customEnd())) { this.periodError.set("Choose a valid start and end date. The end date cannot be before the start date."); return; } this.closeOverlay(); }
  rangeFor(period: OwnerPeriod): string { return this.context.rangeLabelFor(period); }
  private activeRouteData(key: string): unknown {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return route.data[key];
  }
  private navigateMobileSwipe(direction: number): void {
    const current = this.router.url.split("?")[0];
    const index = this.mobileSwipeRoutes.indexOf(current);
    const next = this.mobileSwipeRoutes[index + direction];
    if (index >= 0 && next) void this.router.navigateByUrl(next);
  }
  async logout(): Promise<void> { this.closeOverlay(false); await this.owner.logout(); await this.router.navigateByUrl("/owner/login"); }

  async refreshChildPage(): Promise<void> {
    try {
      let route = this.router.routerState.snapshot.root;
      while (route.firstChild) route = route.firstChild;
      const componentType = route.component;
      if (componentType && (this.router as any).injector) {
        const instance = (this.router as any).injector.get(componentType, null);
        if (instance && typeof instance.load === "function") await instance.load();
      }
    } catch { /* component not injectable */ }
    this.context.markSuccessfulRefresh();
  }
}

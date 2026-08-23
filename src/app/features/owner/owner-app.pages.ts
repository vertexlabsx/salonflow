import { DecimalPipe } from "@angular/common";
import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, effect, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { Subscription } from "rxjs";
import { AuraPullRefresh } from "../../core/aura-pull-refresh.directive";
import { OwnerAppService, OwnerRecord } from "./owner-app.service";
import { OwnerContextService, OwnerPeriod } from "./owner-context.service";

type OwnerModule = "dashboard" | "appointments" | "clients" | "staff" | "attendance" | "leave-requests" | "chats" | "revenue" | "reports" | "payroll" | "inventory" | "billing-access" | "marketing" | "notifications" | "roles-permissions" | "branches" | "settings";
type Metric = { label: string; value: unknown; kind?: "currency" | "number" | "percent"; note: string };
type OwnerPageConfig = { group: string; title: string; description: string; sectionTitle: string; empty: string };
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
  { module: "inventory" as const, group: "Operations", label: "Inventory", path: "/owner/inventory", icon: "M3 6 12 2l9 4-9 4-9-4Zm2 4 7 3 7-3v7l-7 4-7-4v-7Z" },
  { module: "billing-access", group: "Operations", label: "Billing Access", path: "/owner/billing", icon: "M4 5h16v14H4V5Zm2 3h12V7H6v1Zm0 4h5v-2H6v2Z" },
  { module: "payroll" as const, group: "Operations", label: "Payroll", path: "/owner/payroll", icon: "M3 5h18v14H3V5Zm3 3v8h12V8H6Zm6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" },
  { module: "reports" as const, group: "Operations", label: "Reports", path: "/owner/reports", icon: "M5 3h10l4 4v14H5V3Zm3 9v5h2v-5H8Zm4-3v8h2V9h-2Z" },
  { module: "marketing" as const, group: "Growth", label: "Marketing", path: "/owner/marketing", icon: "M3 10v4h3l4 4h2l-2-4 9 3V7l-13 3H3Z" },
  { module: "notifications" as const, group: "Growth", label: "Notifications", path: "/owner/notifications", icon: "M18 15v-4a6 6 0 0 0-5-5.9V3h-2v2.1A6 6 0 0 0 6 11v4l-2 3h16l-2-3Zm-8 4a2 2 0 0 0 4 0h-4Z" },
  { module: "branches" as const, group: "Administration", label: "Branches", path: "/owner/branches", icon: "M4 21V4h10v4h6v13h-6v-4h-4v4H4Zm3-13h2V6H7v2Zm0 4h2v-2H7v2Z" },
  { module: "roles-permissions" as const, group: "Administration", label: "Roles & Permissions", path: "/owner/roles-permissions", icon: "m12 2 8 3v6c0 5-3 9-8 11-5-2-8-6-8-11V5l8-3Z" },
  { module: "settings" as const, group: "Administration", label: "Settings", path: "/owner/settings", icon: "M19 13a7 7 0 0 0 0-2l2-1-2-4-2 1-2-1-1-3h-4L9 6 7 7 5 6l-2 4 2 1a7 7 0 0 0 0 2l-2 1 2 4 2-1 2 1 1 3h4l1-3 2-1 2 1 2-4-2-1Zm-7 2a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" }
];

const PAGE_CONFIG: Record<OwnerModule, OwnerPageConfig> = {
  dashboard:{group:"Owner overview",title:"Good decisions start here.",description:"Live summaries from appointments, clients, staff, finance, inventory and leave records.",sectionTitle:"Today’s attention",empty:"No actionable records are available from the connected modules."},
  appointments:{group:"Business",title:"Appointments",description:"Search and review saved bookings across the owner’s accessible branches.",sectionTitle:"Appointment book",empty:"No appointments match the current filters."},
  clients:{group:"Business",title:"Clients",description:"A searchable owner view of existing client records and contact context.",sectionTitle:"Client directory",empty:"No clients match the current filters."},
  staff:{group:"People",title:"Staff directory",description:"Search staff, inspect profiles and review role, branch and employment status.",sectionTitle:"Team directory",empty:"No staff members match the current filters."},
  attendance:{group:"People",title:"Attendance & overtime",description:"Recorded punches, worked time, breaks and overtime summaries.",sectionTitle:"Attendance records",empty:"No attendance records match the current filters."},
  "leave-requests":{group:"People",title:"Leave requests",description:"Review request details and make supported approve or reject decisions.",sectionTitle:"Leave queue",empty:"No leave requests match the current filters."},
  chats:{group:"People",title:"Team chats",description:"Open existing team and private-owner conversations.",sectionTitle:"Conversations",empty:"No chat conversations are available."},
  revenue:{group:"Performance",title:"Revenue",description:"Current revenue, payment mix, expenses, refunds and outstanding balances.",sectionTitle:"Financial activity",empty:"No financial activity is available for the current business date."},
  reports:{group:"Performance",title:"Reports",description:"Operational report totals and saved drill-down rows from Reports.",sectionTitle:"Report summary",empty:"No report rows are available."},
  payroll:{group:"Performance",title:"Payroll",description:"Generated payroll records and compliance summary from Staff OS.",sectionTitle:"Payroll runs",empty:"No payroll runs are available."},
  inventory:{group:"Growth",title:"Inventory",description:"Current stock records, low-stock context and inventory summary.",sectionTitle:"Stock records",empty:"No inventory records match the current filters."},
  "billing-access":{group:"Operations",title:"Billing Access",description:"Read-only invoices, balances and payment history across assigned branches.",sectionTitle:"Invoices",empty:"No billing records match the current filters."},
  marketing:{group:"Growth",title:"Marketing",description:"Existing campaigns and persisted marketing summary data.",sectionTitle:"Campaign activity",empty:"No campaign records are available."},
  notifications:{group:"Growth",title:"Notifications",description:"Search persisted notifications by channel, type and status.",sectionTitle:"Notification center",empty:"No notifications match the current filters."},
  "roles-permissions":{group:"Administration",title:"Roles & permissions",description:"Inspect users, role assignments and the effective permission catalog.",sectionTitle:"User access",empty:"No tenant users are available."},
  branches:{group:"Administration",title:"Branches",description:"Review existing salon locations and their operational status.",sectionTitle:"Branch directory",empty:"No branches are available for this tenant."},
  settings:{group:"Administration",title:"Settings",description:"Read the current general workspace configuration. Editing is unavailable here.",sectionTitle:"General configuration",empty:"General settings are unavailable."}
};

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="owner-login">
      <section class="owner-login-story" aria-labelledby="owner-login-heading">
        <a class="owner-mark" href="/owner/login" aria-label="Aura Owner home"><span>A</span><strong>Aura</strong></a>
        <div><p class="owner-kicker">Private owner workspace</p><h1 id="owner-login-heading">See the whole business.<br><em>Act on what matters.</em></h1><p>Owner-only access to existing operational, people, financial and governance intelligence.</p></div>
        <small>Protected by Aura role controls</small>
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
        <div class="owner-brand"><span>A</span><div><strong>{{ context.workspaceName() }}</strong><small>Owner office</small></div></div>
        <button class="owner-collapse" type="button" (click)="toggleSidebar()" [attr.aria-label]="sidebarCollapsed() ? 'Expand owner sidebar' : 'Collapse owner sidebar'" [attr.aria-expanded]="!sidebarCollapsed()"></button>
        <nav aria-label="Owner sections">
          @for (group of navGroups(); track group) {
            <p>{{ group }}</p>
            @for (item of navByGroup(group); track item.module) {
              @if (item.path) {
                <a [routerLink]="item.path" routerLinkActive="active" [attr.title]="sidebarCollapsed() ? item.label : null"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon"></path></svg><span>{{ item.label }}</span></a>
              } @else {
                <button class="owner-nav-unavailable" type="button" disabled title="Billing Access — coming in Phase 3" aria-label="Billing Access unavailable, coming in Phase 3"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon"></path></svg><span>{{ item.label }}</span>@if(context.showModuleBadges()){<small>Phase 3</small>}</button>
              }
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
                    @if (item.path) {
                      <a [routerLink]="item.path" routerLinkActive="active" (click)="closeOverlay()"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon"></path></svg><span>{{ item.label }}</span><b aria-hidden="true">→</b></a>
                    } @else {
                      <button type="button" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon"></path></svg><span>{{ item.label }}</span>@if(context.showModuleBadges()){<small>Coming in Phase 3</small>}</button>
                    }
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

@Component({
  standalone: true,
  imports: [DecimalPipe, FormsModule, RouterLink],
  template: `
    <article class="owner-page" [attr.aria-busy]="loading()">
      <header class="owner-page-hero"><div><p class="owner-kicker">{{ config().group }}</p><h1>{{ config().title }}</h1><p>{{ config().description }}</p></div>@if (!blockingError()) { <button type="button" class="owner-refresh" [disabled]="loading()" (click)="load()"><span aria-hidden="true">↻</span>{{ loading() ? 'Refreshing' : 'Refresh data' }}</button> }</header>
      @if (partialMessage()) { <p class="owner-alert" role="status">{{ partialMessage() }}</p> }
      @if (loading() && !hasData()) {
        <section class="owner-skeleton-grid" aria-label="Loading owner data"><i></i><i></i><i></i><i></i></section><section class="owner-skeleton-panel"><i></i><i></i><i></i></section>
      } @else if (blockingError()) {
        <section class="owner-empty error" role="alert"><span>!</span><h2>Owner data is unavailable</h2><p>{{ blockingError() }}</p><button type="button" class="owner-primary compact" (click)="load()">Try again</button></section>
      } @else {
        <section class="owner-metrics" aria-label="Key owner metrics">
          @for (metric of metrics(); track metric.label) {
            <article><span>{{ metric.label }}</span>
              @if (metric.value === null || metric.value === undefined) { <strong class="unavailable">Unavailable</strong> }
              @else if (metric.kind === 'currency') { <strong>{{ formatMetricCurrency(metricNumber(metric.value)) }}</strong> }
              @else if (metric.kind === 'percent') { <strong>{{ metricNumber(metric.value) | number:'1.0-1' }}%</strong> }
              @else { <strong>{{ metricNumber(metric.value) | number:'1.0-0' }}</strong> }
              <small>{{ metric.note }}</small>
            </article>
          }
        </section>
        @if (module() !== 'dashboard') {
          <section class="owner-filters" aria-label="Record filters"><label><span>Search</span><input type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search loaded records" /></label><label><span>Status</span><select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)"><option value="">All statuses</option>@for (status of statuses(); track status) { <option [value]="status">{{ status }}</option> }</select></label></section>
        }
        <section class="owner-data-panel">
          <div class="owner-section-head"><div><p class="owner-kicker">Live records</p><h2>{{ config().sectionTitle }}</h2></div><span>{{ rows().length }} {{ rows().length === 1 ? 'record' : 'records' }}</span></div>
          @if (rows().length) {
            <div class="owner-record-list" [class.with-detail]="selected()">
              @for (row of rows(); track rowKey(row, $index)) {
                <button type="button" [class.selected]="selected() === row" (click)="selectRow(row)"><div class="owner-record-icon" aria-hidden="true">{{ rowInitial(row) }}</div><div><strong>{{ rowTitle(row) }}</strong><p>{{ rowDescription(row) }}</p><small>{{ rowMeta(row) }}</small></div><span class="owner-status" [attr.data-tone]="statusTone(row)">{{ rowStatus(row) }}</span></button>
              }
            </div>
          } @else {
            <div class="owner-empty"><span>—</span><h2>No saved records yet</h2><p>{{ emptyMessage() }}</p></div>
          }
        </section>
        @if (selected(); as record) {
          <aside class="owner-detail" aria-labelledby="owner-detail-title"><div class="owner-section-head"><div><p class="owner-kicker">Record detail</p><h2 id="owner-detail-title">{{ rowTitle(record) }}</h2></div><button type="button" (click)="selected.set(null)" aria-label="Close record detail">×</button></div>
            @if (detailLoading()) { <p class="owner-detail-state">Loading supported detail…</p> }
            <dl>@for (field of detailFields(); track field.label) { <div><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div> }</dl>
            @if (module() === 'chats') { <section class="owner-messages" aria-label="Conversation messages">@for (message of detailRows(); track rowKey(message,$index)) { <article><strong>{{ message['senderName'] || 'Team member' }}</strong><p>{{ message['body'] || message['message'] }}</p><small>{{ message['createdAt'] ? shortDate(message['createdAt']) : '' }}</small></article> } @empty { @if (!detailLoading()) { <p>No saved messages in this conversation.</p> } }</section> }
            @if (module() === 'leave-requests' && rowStatus(record).toLowerCase() === 'pending') { <div class="owner-decision"><label for="owner-leave-note">Owner note</label><textarea id="owner-leave-note" [ngModel]="ownerNote()" (ngModelChange)="ownerNote.set($event)" placeholder="Required when rejecting"></textarea><small>Backend stores this note as the rejection reason. Approval notes are not supported by the existing contract.</small><div><button type="button" class="owner-primary compact" [disabled]="decisionBusy()" (click)="decideLeave('approve')">Approve</button><button type="button" class="owner-danger-button" [disabled]="decisionBusy() || !ownerNote().trim()" (click)="decideLeave('reject')">Reject</button></div></div> }
          </aside>
        }
        @if (['settings','branches','roles-permissions'].includes(module())) { <section class="owner-capability-note"><div><strong>Review-only in Owner Mobile</strong><p>{{ module() === 'settings' ? 'The general settings read contract is available, but this isolated owner section does not have a validated save form for every nested setting.' : module() === 'branches' ? 'Branch records are available here; branch creation and editing remain unavailable in this owner surface.' : 'Effective users and permissions are visible. Role and user mutations remain unavailable in this owner surface.' }}</p></div><button type="button" disabled>Editing unavailable</button></section> }
        @if (module() === 'dashboard') {
          <section class="owner-paths" aria-label="Owner quick actions"><div class="owner-section-head"><div><p class="owner-kicker">Quick actions</p><h2>Open an owner module</h2></div></div><div>@for (item of navLinks; track item.path) { <a [routerLink]="item.path"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon"></path></svg><span><strong>{{ item.label }}</strong><small>View live records</small></span></a> }</div></section>
        }
      }
    </article>
  `,
  styleUrls: ["./owner-app.styles.css", "./owner-shell.styles.css"]
})
export class OwnerWorkspacePage implements OnInit, OnDestroy {
  readonly module = signal<OwnerModule>("dashboard");
  readonly config = computed(() => PAGE_CONFIG[this.module()]);
  readonly loading = signal(true);
  readonly blockingError = signal("");
  readonly partialMessage = signal("");
  readonly data = signal<Record<string, unknown>>({});
  readonly query = signal("");
  readonly statusFilter = signal("");
  readonly selected = signal<OwnerRecord | null>(null);
  readonly detail = signal<OwnerRecord>({});
  readonly detailRows = signal<OwnerRecord[]>([]);
  readonly detailLoading = signal(false);
  readonly ownerNote = signal("");
  readonly decisionBusy = signal(false);
  readonly hasData = computed(() => Object.keys(this.data()).length > 0);
  readonly navLinks = NAV.filter((item): item is OwnerNavItem & { path: string } => !!item.path).slice(1);
  private routeSubscription?: Subscription;

  readonly metrics = computed<Metric[]>(() => this.moduleMetrics(this.module(), this.data()));
  readonly rawRows = computed<OwnerRecord[]>(() => this.moduleRows(this.module(), this.data()));
  readonly statuses = computed(() => [...new Set(this.rawRows().map((row) => this.rowStatus(row)).filter(Boolean))].sort());
  readonly rows = computed(() => { const query = this.query().trim().toLowerCase(); const status = this.statusFilter(); return this.rawRows().filter((row) => (!status || this.rowStatus(row) === status) && (!query || JSON.stringify(row).toLowerCase().includes(query))); });
  readonly detailFields = computed(() => Object.entries({ ...(this.selected() || {}), ...this.detail() }).filter(([,value]) => value !== null && value !== undefined && value !== "").slice(0,24).map(([key,value]) => ({ label: key.replace(/([A-Z])/g," $1").replace(/^./, (letter) => letter.toUpperCase()), value: this.formatDetail(value, key) })));

  constructor(private readonly route: ActivatedRoute, private readonly owner: OwnerAppService, private readonly context: OwnerContextService) {}
  ngOnInit(): void { this.routeSubscription = this.route.data.subscribe((data) => { this.module.set((data["ownerModule"] as OwnerModule) || "dashboard"); this.query.set(""); this.statusFilter.set(""); this.selected.set(null); void this.load(); }); }
  ngOnDestroy(): void { this.routeSubscription?.unsubscribe(); }

  async load(): Promise<void> {
    this.loading.set(true); this.blockingError.set(""); this.partialMessage.set("");
    const requests = this.requestsFor(this.module());
    const results = await Promise.allSettled(requests.map((item) => item.request()));
    const next: Record<string, unknown> = {}; const failures: string[] = [];
    results.forEach((result, index) => result.status === "fulfilled" ? next[requests[index].key] = result.value : failures.push(requests[index].label));
    if (Object.keys(next).length) {
      this.data.set(next);
      this.context.markSuccessfulRefresh();
      if (failures.length) this.partialMessage.set(`${failures.join(", ")} ${failures.length === 1 ? "is" : "are"} temporarily unavailable. Available owner data remains visible.`);
    } else {
      this.data.set({}); this.blockingError.set("Aura could not load this owner workspace. Check the connection and try again.");
    }
    this.loading.set(false);
  }

  emptyMessage(): string { return this.config().empty; }

  async selectRow(row: OwnerRecord): Promise<void> {
    this.selected.set(row); this.detail.set({}); this.detailRows.set([]); this.ownerNote.set("");
    const id = String(row["id"] || row["staffId"] || ""); if (!id) return;
    this.detailLoading.set(true);
    try {
      if (this.module() === "staff") this.detail.set(await this.owner.read(`staff-management/profile/${encodeURIComponent(id)}`));
      if (this.module() === "chats") this.detailRows.set(await this.owner.list(`team-chat/conversations/${encodeURIComponent(id)}/messages`));
    } catch { this.partialMessage.set("The selected record’s extended detail is unavailable; its loaded summary remains visible."); }
    finally { this.detailLoading.set(false); }
  }

  async decideLeave(decision: "approve" | "reject"): Promise<void> {
    const leave = this.selected(); const id = String(leave?.["id"] || ""); if (!id || this.decisionBusy()) return;
    const version = typeof leave?.["version"] === "number" ? Number(leave?.["version"]) : undefined;
    this.decisionBusy.set(true);
    try { const updated = await this.owner.leaveDecision(id, decision, { version, reason: decision === "reject" ? this.ownerNote().trim() : undefined }); this.selected.set(updated); await this.load(); }
    catch { this.partialMessage.set("The leave decision could not be saved. Refresh and try again."); }
    finally { this.decisionBusy.set(false); }
  }

  rowKey(row: OwnerRecord, index: number): string { return String(row["id"] || row["userId"] || row["staffId"] || index); }
  rowInitial(row: OwnerRecord): string { return this.rowTitle(row).trim().charAt(0).toUpperCase() || "A"; }
  rowTitle(row: OwnerRecord): string { return String(row["title"] || row["name"] || row["staffName"] || row["fullName"] || row["clientName"] || row["invoiceNumber"] || row["conversationTitle"] || row["email"] || row["mobile"] || row["id"] || "Aura record"); }
  rowDescription(row: OwnerRecord): string { return String(row["description"] || row["reason"] || row["message"] || row["serviceName"] || (Array.isArray(row["serviceNames"]) ? row["serviceNames"].join(", ") : "") || row["department"] || row["designation"] || row["role"] || row["type"] || row["channel"] || "Saved Aura record"); }
  rowMeta(row: OwnerRecord): string { const date = row["createdAt"] || row["updatedAt"] || row["businessDate"] || row["periodEnd"]; const branch = row["branchName"] || row["branchId"]; return [branch, date ? this.shortDate(date) : ""].filter(Boolean).join(" · ") || "Current tenant scope"; }
  rowStatus(row: OwnerRecord): string { return String(row["status"] || row["severity"] || row["riskLevel"] || row["role"] || "recorded").replaceAll("_", " "); }
  statusTone(row: OwnerRecord): string { const status = this.rowStatus(row).toLowerCase(); return /critical|high|denied|failed|locked|overdue/.test(status) ? "danger" : /pending|warning|review|open/.test(status) ? "warning" : "neutral"; }
  metricNumber(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) ? number : null; }

  private requestsFor(module: OwnerModule): Array<{ key: string; label: string; request: () => Promise<unknown> }> {
    const req = (key:string,label:string,request:()=>Promise<unknown>) => ({key,label,request});
    const map: Record<OwnerModule, Array<{key:string;label:string;request:()=>Promise<unknown>}>> = {
      dashboard:[req("finance","Finance",()=>this.owner.financeSummary()),req("appointments","Appointments",()=>this.owner.list("appointments",{limit:200})),req("clients","Clients",()=>this.owner.list("clients",{limit:200})),req("staff","Staff",()=>this.owner.list("staff-os/staff",{limit:200})),req("leaves","Leave requests",()=>this.owner.list("staff-os/leaves",{limit:100})),req("inventory","Inventory",()=>this.owner.read("inventory-intelligence/summary"))],
      appointments:[req("rows","Appointments",()=>this.owner.list("appointments",{limit:1000}))],clients:[req("rows","Clients",()=>this.owner.list("clients",{limit:1000}))],staff:[req("rows","Staff",()=>this.owner.list("staff-os/staff",{limit:1000}))],
      attendance:[req("rows","Attendance",()=>this.owner.list("staff-os/attendance",{limit:1000})),req("summary","Overtime summary",()=>this.owner.read("staff-os/attendance/overtime-summary"))],
      "leave-requests":[req("rows","Leave requests",()=>this.owner.list("staff-os/leaves",{limit:500}))],chats:[req("rows","Chats",()=>this.owner.list("team-chat/conversations"))],revenue:[req("summary","Finance",()=>this.owner.financeSummary())],reports:[req("summary","Reports",()=>this.owner.reportSummary())],payroll:[req("rows","Payroll",()=>this.owner.list("staff-os/payroll",{limit:500})),req("summary","Payroll compliance",()=>this.owner.read("staff-os/payroll-compliance/summary"))],inventory:[req("rows","Inventory",()=>this.owner.list("inventory",{limit:1000})),req("summary","Inventory summary",()=>this.owner.read("inventory-intelligence/summary"))],"billing-access":[],marketing:[req("rows","Campaigns",()=>this.owner.list("campaigns",{limit:500})),req("summary","Marketing summary",()=>this.owner.read("ai-marketing/summary"))],notifications:[req("rows","Notifications",()=>this.owner.list("notifications",{limit:500}))],"roles-permissions":[req("summary","User management",()=>this.owner.userManagement())],branches:[req("rows","Branches",()=>this.owner.list("branches",{limit:500}))],settings:[req("summary","General settings",()=>this.owner.read("settings/general"))]
    }; return map[module];
  }

  private moduleRows(module: OwnerModule, data: Record<string,unknown>): OwnerRecord[] {
    if (data["rows"]) return this.array(data["rows"]);
    const summary=this.record(data["summary"]);
    if(module==="dashboard") return [...this.array(data["appointments"]).filter(row=>/booked|confirmed|arrived|pending/i.test(String(row["status"]||""))).slice(0,5),...this.array(data["leaves"]).filter(row=>String(row["status"])==="pending").slice(0,5)];
    if(module==="revenue") return [...this.array(summary["outstanding"]),...this.array(summary["expenses"]),...this.array(summary["refunds"])];
    if(module==="reports") return [...this.array(summary["topServices"]),...this.array(summary["staffPerformance"]),...this.array(summary["lowStock"])];
    if(module==="roles-permissions") return this.array(summary["users"]);
    if(module==="settings") return Object.entries(this.record(summary["settings"]||summary)).map(([key,value])=>({id:key,name:key,value:typeof value==="object"?JSON.stringify(value):value,status:"configured"}));
    return [];
  }

  private moduleMetrics(module: OwnerModule,data:Record<string,unknown>):Metric[] {
    const finance=this.record(data["finance"]||data["summary"]); const fm=this.record(finance["metrics"]); const summary=this.record(data["summary"]); const inventory=this.record(data["inventory"]); const im=this.record(inventory["metrics"]||inventory);
    if(module==="dashboard") return [{label:"Revenue",value:fm["revenue"],kind:"currency",note:String(finance["businessDate"]||"Current business date")},{label:"Appointments",value:this.array(data["appointments"]).length,note:"Loaded records"},{label:"Clients",value:this.array(data["clients"]).length,note:"Loaded records"},{label:"Active staff",value:this.array(data["staff"]).filter(row=>!row["status"]||row["status"]==="active").length,note:"Staff OS"},{label:"Pending leave",value:this.array(data["leaves"]).filter(row=>row["status"]==="pending").length,note:"Needs review"},{label:"Low stock",value:im["lowStock"]??im["lowStockCount"],note:"Inventory summary"}];
    if(module==="revenue") return [{label:"Revenue",value:fm["revenue"],kind:"currency",note:"Finance engine"},{label:"Outstanding",value:fm["outstanding"],kind:"currency",note:"Open invoices"},{label:"Expenses",value:fm["expenses"],kind:"currency",note:"Business date"},{label:"Refunds",value:fm["refunds"],kind:"currency",note:"Business date"}];
    if(module==="attendance") return [{label:"Attendance rows",value:this.array(data["rows"]).length,note:"Loaded punches"},{label:"Today overtime",value:summary["todayMinutes"],note:"Minutes"},{label:"Week overtime",value:summary["weekMinutes"],note:"Minutes"},{label:"30-day overtime",value:summary["last30DaysMinutes"],note:"Minutes"}];
    if(module==="inventory") { const metrics=this.record(summary["metrics"]||summary); return [{label:"Products",value:this.array(data["rows"]).length,note:"Loaded stock records"},{label:"Low stock",value:metrics["lowStock"]??metrics["lowStockCount"],note:"Inventory summary"},{label:"Out of stock",value:metrics["outOfStock"]??metrics["outOfStockCount"],note:"Inventory summary"},{label:"Stock value",value:metrics["stockValue"]??metrics["inventoryValue"],kind:"currency",note:"When supplied"}]; }
    if(module==="payroll") { const metrics=this.record(summary["metrics"]||summary); const gross=typeof metrics["grossPay"]==="number"?metrics["grossPay"]:typeof metrics["grossPaise"]==="number"?Number(metrics["grossPaise"])/100:null; const net=typeof metrics["netPay"]==="number"?metrics["netPay"]:typeof metrics["netPaise"]==="number"?Number(metrics["netPaise"])/100:null; return [{label:"Payroll runs",value:this.array(data["rows"]).length,note:"Generated records"},{label:"Gross pay",value:gross,kind:"currency",note:"Compliance summary"},{label:"Net pay",value:net,kind:"currency",note:"Compliance summary"},{label:"Pending",value:this.array(data["rows"]).filter(row=>/pending|draft/i.test(this.rowStatus(row))).length,note:"Needs review"}]; }
    const rows=this.moduleRows(module,data); const pending=rows.filter(row=>/pending|open/i.test(this.rowStatus(row))).length; const active=rows.filter(row=>/active|confirmed|approved|paid|completed/i.test(this.rowStatus(row))).length;
    return [{label:"Total records",value:rows.length,note:"Loaded from existing API"},{label:"Active / complete",value:active,note:"Status-based count"},{label:"Pending / open",value:pending,note:"Status-based count"},{label:"Unavailable fields",value:null,note:"No values are fabricated"}];
  }
  private record(value: unknown): OwnerRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as OwnerRecord : {}; }
  private array(value: unknown): OwnerRecord[] { return Array.isArray(value) ? value.filter((item): item is OwnerRecord => !!item && typeof item === "object") : []; }
  shortDate(value: unknown): string { return this.context.formatDate(String(value || "")); }
  formatMetricCurrency(amount: number | null): string { if (amount === null) return "Unavailable"; return new Intl.NumberFormat(this.context.effectiveLocale(), { style: "currency", currency: this.context.effectiveCurrency(), maximumFractionDigits: 0 }).format(amount); }
  private formatDetail(value: unknown, key: string): string { if (typeof value === "object") return JSON.stringify(value); if (/amount|revenue|total|pay|price|balance/i.test(key) && typeof value === "number") return new Intl.NumberFormat(this.context.effectiveLocale(), { style: "currency", currency: this.context.effectiveCurrency(), maximumFractionDigits: 0 }).format(value); if (/date|at$/i.test(key)) return this.context.formatDate(String(value)); return String(value).replaceAll("_", " "); }
}

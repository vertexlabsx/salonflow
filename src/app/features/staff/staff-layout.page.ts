import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { Subscription } from "rxjs";
import { AuraPullRefresh } from "../../core/aura-pull-refresh.directive";
import { StaffAppService, StaffEnterpriseOs, StaffWorkspacePreferences } from "../../core/staff-app.service";
import { StaffPushService } from "../../core/staff-push.service";
import { resolveStaffIdentity } from "./staff-role-label";

type StaffNavItem = { label: string; path: string; iconPath: string; group: string; permission?: string; anyPermissions?: readonly string[] };
type StaffRecentItem = { label: string; path: string };
const STAFF_HINT_SESSION_KEY = "auraStaffHintSeen";

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet, AuraPullRefresh],
  template: `
    <section class="staff-app-shell" [class.staff-compact]="preferences().interface.compactMode">
      <button type="button" class="drawer-backdrop" [class.open]="menuOpen()" (click)="closeMenu()" aria-label="Close menu"></button>
      <aside class="staff-sidebar" [class.open]="menuOpen()" [attr.role]="menuOpen() ? 'dialog' : null" [attr.aria-modal]="menuOpen() ? 'true' : null" [attr.aria-label]="menuOpen() ? 'Staff navigation' : null" [attr.inert]="notificationsOpen() || commandOpen() ? '' : null" tabindex="-1" #menuDialog (keydown)="menuOpen() && trapFocus($event, menuDialog)">
        <button type="button" class="drawer-close" (click)="closeMenu()" aria-label="Close menu">Close</button>
        <div class="brand-card">
          <span class="brand-kicker">Solastio</span>
          <strong>{{ preferences().workspace.workspaceName }}</strong>
          <small>{{ roleLabel() }} workspace</small>
        </div>
        <a class="user-card" routerLink="/staff/profile" (click)="closeMenu()" aria-label="Open my profile">
          <b>{{ initials() }}</b>
          <div><strong>{{ firstName() }}</strong><small [title]="identitySubtitle()" [attr.aria-label]="identitySubtitle()">{{ identitySubtitle() }}</small></div>
        </a>
        <button type="button" class="theme-button" [attr.aria-label]="theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'" [attr.aria-pressed]="theme() === 'dark'" (click)="toggleTheme()">
          @if (theme() === 'dark') { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4V2h1v2h-1zm0 18v-2h1v2h-1zM4 13H2v-1h2v1zm18 0h-2v-1h2v1zM5.6 6.3 4.2 4.9l.7-.7 1.4 1.4-.7.7zm13.5 13.5-1.4-1.4.7-.7 1.4 1.4-.7.7zm0-14.2-.7.7-1.4-1.4.7-.7 1.4 1.4-.7.7zM6.3 18.4l-1.4 1.4-.7-.7 1.4-1.4.7.7zM12.5 7a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"></path></svg><span>Light mode</span> }
          @else { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3z"></path></svg><span>Dark mode</span> }
        </button>
        @if (recent().length) {
          <section class="recent-card">
            <span>Recent</span>
            @for (item of recent(); track item.path) { <a [routerLink]="item.path" (click)="activateRecent(item)">{{ item.label }}</a> }
          </section>
        }
        <nav>
          @for (group of navGroups(); track group) {
            <p class="nav-group">{{ group }}</p>
            @for (item of navByGroup(group); track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.path === '/staff/dashboard' }" (click)="activateNav(item)"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.iconPath"></path></svg></span>{{ item.label }}</a>
            }
          }
        </nav>
        <button type="button" class="nav-logout" (click)="logout()">Logout</button>
      </aside>

       <div class="staff-main-shell" #mainShell [attr.inert]="menuOpen() || notificationsOpen() || commandOpen() ? '' : null" [auraPullRefresh]="refreshChildPage.bind(this)">
        <header class="staff-topbar">
           <button type="button" class="menu-button" (click)="openMenu()" aria-label="Open menu" [attr.aria-expanded]="menuOpen()" #menuButton><span></span><span></span><span></span></button>
           <a class="staff-identity" routerLink="/staff/profile" [attr.aria-label]="'Open my profile — ' + identitySubtitle()"><b class="profile-avatar">{{ initials() }}</b><div><span>{{ greetingLabel() }}</span><strong>{{ firstName() }}</strong><small [title]="identitySubtitle()" [attr.aria-label]="identitySubtitle()">{{ identitySubtitle() }}</small></div></a>
          <div class="topbar-actions">
             @if (visibleNav().length) { <button type="button" class="search-button" (click)="openCommand()" aria-label="Search permitted staff tools" [attr.aria-expanded]="commandOpen()" #commandButton><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 19.6-5.1-5.1a7 7 0 1 0-1.4 1.4l5.1 5.1 1.4-1.4zM5 10a5 5 0 1 1 10 0A5 5 0 0 1 5 10z"></path></svg><span>Search workspace</span><kbd>Ctrl K</kbd></button> }
             @if (staff.hasPermission('read:staff')) { <a class="chat-button" routerLink="/staff/chat" routerLinkActive="active" aria-label="Open chat" title="Chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v10h2v1.8L8.3 16H20V6H4zm3 3h10v2H7V9zm0 4h7v2H7v-2z"></path></svg></a> }
             @if (staff.hasPermission('read:appointments')) { <button type="button" class="bell-button" [class.has-unread]="unreadCount() > 0" (click)="toggleNotifications()" aria-label="Open notifications" [attr.aria-expanded]="notificationsOpen()" #notificationButton>
              <svg class="bell-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 10.8c0-3.5-2.1-6.1-5-6.7V3a1 1 0 0 0-2 0v1.1c-2.9.6-5 3.2-5 6.7V15l-1.6 2.4A1 1 0 0 0 5.2 19h13.6a1 1 0 0 0 .8-1.6L18 15v-4.2zM9.7 20a2.4 2.4 0 0 0 4.6 0H9.7z"></path>
              </svg>
              @if (unreadCount() > 0) { <span class="bell-badge">{{ unreadCount() }}</span> }
             </button> }
            <span class="net-status network-status" [class.offline]="!online()" aria-live="polite">{{ online() ? 'Online' : 'Offline' }}</span>
            @if (offlinePending()) { <span class="queue-status">{{ offlinePending() }} queued</span> }
          </div>
        </header>
         <main class="staff-content">
          @if (preferences().defaults.staffHints && staffHintVisible() && !isDashboard()) { <p class="staff-policy-hint"><span>Tip: use search to quickly open permitted staff tools and appointments.</span><button type="button" aria-label="Dismiss tip" (click)="dismissStaffHint()">×</button></p> }
           <router-outlet />
        </main>
      </div>

       <nav class="mobile-bottom-nav" aria-label="Primary staff navigation" [attr.inert]="menuOpen() || notificationsOpen() || commandOpen() ? '' : null">
          @if (staff.hasPermission('read:appointments')) {
            <a routerLink="/staff/dashboard" [class.active]="isRouteActive('/staff/dashboard')"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Dashboard')"></path></svg><span>Home</span></a>
            <a routerLink="/staff/appointments" [class.active]="isRouteActive('/staff/appointments')"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Appointments')"></path></svg><span>Appointments</span></a>
            <a routerLink="/staff/business" [class.active]="isRouteActive('/staff/business')"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Business')"></path></svg><span>Business</span></a>
          }
          @if (staff.hasPermission('read:clients')) { <a routerLink="/staff/clients" [class.active]="isRouteActive('/staff/clients')"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Clients')"></path></svg><span>Clients</span></a> }
          @if (staff.hasAnyPermission(['allow:staff-checkin-checkout', 'read:staff', 'write:staff'])) { <a routerLink="/staff/attendance" [class.active]="isRouteActive('/staff/attendance')"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Attendance')"></path></svg><span>Attendance</span></a> }
          @if (staff.hasPermission('read:staff')) { <a routerLink="/staff/tasks" [class.active]="isRouteActive('/staff/tasks')"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor('Tasks')"></path></svg><span>Tasks</span></a> }
       </nav>

      @if (commandOpen()) {
        <section class="command-backdrop" (click)="closeCommand()">
          <div class="command-palette" role="dialog" aria-modal="true" aria-labelledby="staff-command-title" tabindex="-1" #commandDialog (keydown)="trapFocus($event, commandDialog)" (click)="$event.stopPropagation()">
            <div class="command-head"><strong id="staff-command-title">Command palette</strong><button type="button" (click)="closeCommand()">Close</button></div>
            <input [ngModel]="query()" (ngModelChange)="query.set($event)" (keydown)="onCommandKeydown($event)" aria-label="Search staff pages and business" placeholder="Search staff pages and business..." #commandInput autofocus />
            <div class="command-suggestions">
              <small>Suggestions:</small>
              @for (chip of quickSuggestions(); track chip) {
                <button type="button" class="suggestion-chip" (click)="applyCommandSuggestion(chip)">{{ chip }}</button>
              }
            </div>
            @if (query().trim()) { <small class="search-hint">{{ commandResults().length }} matches · Press Enter to open the first result</small> }
            <div class="command-list">
              @for (item of commandResults(); track $index) {
                <button type="button" (click)="go(item)"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.iconPath"></path></svg></span><div><strong>{{ item.label }}</strong><small>{{ item.group }}</small></div></button>
              } @empty {
                <p>No matching staff command.</p>
              }
            </div>
          </div>
        </section>
      }

      @if (notificationsOpen() && staff.hasPermission('read:appointments')) {
        <button type="button" class="drawer-backdrop open" (click)="closeNotifications()" aria-label="Close notifications"></button>
        <aside class="notification-drawer open" role="dialog" aria-modal="true" aria-labelledby="staff-notifications-title" tabindex="-1" #notificationDialog (keydown)="trapFocus($event, notificationDialog)">
          <div class="drawer-title"><strong id="staff-notifications-title">Notifications</strong><button type="button" (click)="closeNotifications()">Close</button></div>
          <section class="push-permission-card" [attr.data-state]="push.state()">
            <div><strong>Mobile notifications</strong><small>{{ push.label() }}</small></div>
            @if (push.state() === 'available' || push.state() === 'unconfigured') {
              <button type="button" [disabled]="push.busy()" (click)="enableMobileNotifications()">{{ push.busy() ? 'Enabling...' : 'Enable' }}</button>
            }
            @if (push.state() === 'enabled') { <span>On</span> }
          </section>
          @if (push.message()) { <p class="push-message" role="status">{{ push.message() }}</p> }
          <div class="notice-list">
            @for (note of os()?.notifications || []; track note.id) {
              <article><strong>{{ note.title }}</strong><small>{{ note.body || note.status }}</small><span>{{ note.status }}</span><button type="button" [disabled]="!canUpdateOwnNotifications()" (click)="markNotification(note.id, note.status === 'read' ? 'unread' : 'read')">{{ note.status === 'read' ? 'Mark unread' : 'Mark read' }}</button></article>
            } @empty {
              <p>No notifications yet.</p>
            }
          </div>
        </aside>
      }

      @if (toastMessage()) { <section class="staff-toast" role="status">{{ toastMessage() }}</section> }
    </section>
  `,
  styles: [`
    .staff-app-shell { min-height: 100vh; display: grid; grid-template-columns: 286px minmax(0, 1fr); background: radial-gradient(circle at 0 0,color-mix(in srgb,var(--staff-primary) 10%,transparent),transparent 26%), var(--staff-background); color: var(--staff-text); }
    .staff-sidebar { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 18px; border-right: 1px solid var(--staff-border); background: linear-gradient(180deg,var(--staff-surface-glass),color-mix(in srgb,var(--staff-surface-secondary) 72%,transparent)); backdrop-filter: blur(22px); box-shadow: 18px 0 44px rgba(42,20,51,.06); }
    .brand-card { position:relative;overflow:hidden;padding: 16px; border: 1px solid color-mix(in srgb,var(--staff-primary) 24%,var(--staff-border)); border-radius: 22px; color: var(--staff-text); background: radial-gradient(circle at 90% 0,color-mix(in srgb,var(--staff-border-accent) 36%,transparent),transparent 36%),linear-gradient(135deg,var(--staff-primary-light),var(--staff-surface)); box-shadow:var(--staff-shadow); }
    .brand-card span { display: block; color: var(--staff-primary-hover); font-size: .55rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .brand-card strong { display: block; margin-top: 4px; font-family:Georgia,"Times New Roman",serif;font-size: 1.35rem; font-weight:500;line-height: 1.05;letter-spacing:-.03em; }
    .brand-card small { display: block; margin-top: 2px; color: var(--staff-text-secondary); font-size: .6rem; font-weight: 650; line-height: 1.15; text-transform: capitalize; }
    .menu-button, .drawer-close { display: none; }
    .drawer-backdrop { display: block; position: fixed; inset: 0; z-index: 29; border: 0; opacity: 0; pointer-events: none; background: var(--staff-overlay); backdrop-filter: blur(2px); transition: opacity .18s ease; }
    .drawer-backdrop.open { opacity: 1; pointer-events: auto; }
    .menu-button span { display: block; width: 18px; height: 2px; border-radius: 999px; background: var(--staff-text); }
    .user-card { display: grid; grid-template-columns: 44px 1fr; gap: 10px; align-items: center; margin-top: 14px; padding: 11px; border: 1px solid color-mix(in srgb,var(--staff-primary) 12%,var(--staff-border)); border-radius: 20px; background: linear-gradient(180deg,var(--staff-surface),var(--staff-surface-secondary)); color: var(--staff-text); text-decoration: none; cursor: pointer; box-shadow:var(--staff-shadow); }
    .user-card:hover, .user-card:focus-visible { border-color: var(--staff-primary); background: var(--staff-primary-light); }
    .user-card b, .profile-avatar { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 15px; background: linear-gradient(135deg,var(--staff-primary),var(--staff-primary-hover)); color: var(--staff-on-primary); box-shadow:0 10px 22px color-mix(in srgb,var(--staff-primary) 24%,transparent); }
    .user-card strong, .user-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-card small { color: var(--staff-text-secondary); font-weight: 600; }
    .recent-card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 6px; margin-top: 8px; padding: 6px 8px; border: 1px solid var(--staff-border); border-radius: 12px; background: var(--staff-surface-secondary); }
    .recent-card span { grid-column: 1 / -1; margin: 1px 0 2px; color: var(--staff-text-secondary); font-size: .56rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .nav-group { margin: 12px 2px 4px; color: var(--staff-text-secondary); font-size: .66rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .recent-card a { display:block;min-width:0;min-height:26px;overflow:hidden;padding:5px 2px;color:var(--staff-text);font-size:.68rem;font-weight:650;text-decoration:none;text-overflow:ellipsis;white-space:nowrap; }
    nav { display: grid; gap: 5px; margin-top: 14px; }
    nav a { display: grid; grid-template-columns: 34px 1fr; gap: 10px; align-items: center; min-height:48px;padding: 8px 10px; border: 1px solid transparent; border-radius: 17px; color: var(--staff-text-secondary); font-weight: 760; text-decoration: none; }
    nav a span { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 12px; background: var(--staff-surface-secondary); color: var(--staff-text-secondary); font-size: .7rem; font-weight: 800; }
    svg { width: 17px; height: 17px; fill: currentColor; }
    nav a.active, nav a:hover { border-color: color-mix(in srgb,var(--staff-primary) 28%,var(--staff-border)); background: linear-gradient(135deg,var(--staff-primary-light),color-mix(in srgb,var(--staff-border-accent) 18%,var(--staff-primary-light))); color: var(--staff-primary-hover); box-shadow:0 10px 22px rgba(42,20,51,.07); }
    nav a.active span { background: var(--staff-primary); color: var(--staff-on-primary); }
    .nav-logout { width: 100%; min-height:46px;margin-top: 12px; padding: 11px 13px; border: 1px solid var(--staff-error-border); border-radius: 16px; background: var(--staff-error-surface); color: var(--staff-error-text); font-weight: 750; text-align: left; }
    .staff-main-shell { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100vh; overflow: hidden; }
    .staff-topbar { position: relative; display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height:var(--staff-header-height);padding: 8px 18px; border-bottom: 1px solid color-mix(in srgb,var(--staff-primary) 12%,var(--staff-border)); background: color-mix(in srgb,var(--staff-surface-glass) 94%,transparent); backdrop-filter: blur(22px); box-shadow:0 10px 28px rgba(42,20,51,.05); }
    .staff-identity { display: flex; align-items:center; min-width: 0; max-width:min(420px,48vw); gap: 10px; color:inherit; text-decoration:none; }
    .staff-identity>div { display:grid;gap:1px;min-width:0; }
    .staff-identity span { overflow: hidden; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 650; letter-spacing: 0; text-overflow: ellipsis; white-space: nowrap; }
    .staff-identity strong { overflow: hidden; color: var(--staff-text); font-size: .92rem; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .staff-identity small { overflow:hidden;color:var(--staff-text-secondary);font-size:.72rem;font-weight:650;text-overflow:ellipsis;white-space:nowrap; }
    .staff-topbar strong { color: var(--staff-text); }
    .topbar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; flex-wrap: wrap; }
    .topbar-actions span { color: var(--staff-text-secondary); font-weight: 650; }
    .search-button, .chat-button, .bell-button { border: 1px solid color-mix(in srgb,var(--staff-primary) 14%,var(--staff-border)); background:var(--staff-surface);color:var(--staff-text-secondary);font-weight:750;box-shadow:0 8px 18px rgba(42,20,51,.05); }
    .search-button { display: grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;width:min(330px,28vw);height:44px;padding:0 12px;border-radius:16px;text-align:left; }
    .search-button span { overflow:hidden;font-size:.78rem;text-overflow:ellipsis;white-space:nowrap; }
    .search-button kbd { padding:3px 6px;border:1px solid var(--staff-border);border-radius:7px;background:var(--staff-surface);color:var(--staff-text-secondary);font-size:.64rem; }
    .search-button svg { width: 18px; height: 18px; fill: currentColor; }
    .theme-button { display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;min-height:46px;margin-top:12px;padding:0 13px;border:1px solid var(--staff-border);border-radius:16px;background:var(--staff-surface-secondary);color:var(--staff-text);font-weight:700;text-align:left; }
    .theme-button svg { width:18px;height:18px;fill:currentColor; }
    .theme-button span { font-size:.76rem; }
    .search-button:hover, .search-button:focus-visible, .chat-button:focus-visible, .theme-button:focus-visible, .bell-button:focus-visible, .menu-button:focus-visible, nav a:focus-visible, .nav-logout:focus-visible { outline: 3px solid var(--staff-focus-ring); outline-offset: 2px; }
    .search-button small { margin-left: 6px; opacity: .72; }
    .bell-button { position: relative; overflow: visible; display: inline-grid; place-items: center; width: 44px; height: 44px; min-width: 44px; padding: 0; border-radius: 16px; }
    .chat-button { display:inline-grid;place-items:center;width:44px;height:44px;min-width:44px;border-radius:16px;text-decoration:none; }
    .chat-button svg { width:20px;height:20px; }
    .chat-button:hover, .chat-button.active, .bell-button:hover, .bell-button.has-unread, .theme-button:hover { border-color: var(--staff-border-accent); color: var(--staff-primary-hover); background:var(--staff-primary-light); }
    .bell-icon { width: 20px; height: 20px; fill: currentColor; }
    .bell-badge { position: absolute; right: -6px; top: -7px; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border: 2px solid var(--staff-surface); border-radius: 999px; background: var(--staff-primary); color: var(--staff-on-primary) !important; font-size: .66rem; font-weight: 800; line-height: 1; }
    .bell-button:not(.has-unread) .bell-badge { background: var(--staff-disabled); color: var(--staff-text-inverse) !important; }
    .net-status, .queue-status { padding: 7px 10px; border-radius: 999px; background: var(--staff-success-surface); color: var(--staff-success-text) !important; }
    .net-status.offline { background: var(--staff-error-surface); color: var(--staff-error-text) !important; }
    .queue-status { background: var(--staff-primary-light); color: var(--staff-primary-hover) !important; }
    .staff-content { min-width: 0; overflow: auto; padding: 28px; background: transparent; }
    .staff-policy-hint { display:flex;align-items:center;justify-content:space-between;gap:8px;margin: 0 0 12px; padding: 9px 12px; border: 1px solid var(--staff-border-accent); border-radius: 12px; background: var(--staff-primary-light); color: var(--staff-primary-hover); font-size: .8rem; font-weight: 650; }
    .staff-policy-hint span{min-width:0}.staff-policy-hint button{display:grid;place-items:center;flex:0 0 26px;width:26px;height:26px;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;font-size:1rem;line-height:1;cursor:pointer}.staff-policy-hint button:hover{background:color-mix(in srgb,var(--staff-primary) 12%,transparent)}
    .staff-app-shell.staff-compact .staff-content { padding: 12px; }
    .staff-app-shell.staff-compact :is(article, .settings-card, .metric-card) { padding: 10px; }
    .staff-app-shell.staff-compact button { min-height: 44px; }
    .staff-app-shell.staff-compact :is(input, select, textarea) { min-height: var(--staff-input-height); }
    .command-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: start center; padding-top: 8vh; background: var(--staff-overlay); backdrop-filter: blur(4px); }
    .command-palette { width: min(720px, calc(100vw - 24px)); max-height: 78vh; overflow: auto; border: 1px solid var(--staff-border); border-radius: 24px; background: var(--staff-surface); box-shadow: var(--staff-shadow-elevated); }
    .command-head, .drawer-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid var(--staff-border); }
    .command-head strong, .drawer-title strong { color: var(--staff-text); }
    .command-head button, .drawer-title button { min-height:44px;border:1px solid var(--staff-border-accent);border-radius:14px;background:var(--staff-surface);color:var(--staff-primary-hover);font-weight:750;padding:7px 12px; }
    .command-palette input { width: calc(100% - 28px); min-height: var(--staff-input-height); margin: 14px 14px 8px; border: 1px solid var(--staff-input-border); border-radius: var(--staff-input-radius); padding: 14px 18px; color: var(--staff-input-text); background: var(--staff-input-background); font-size: 16px; font-weight: 500; caret-color: var(--staff-input-focus); transition: border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease, transform 180ms ease; }
    .command-palette input::placeholder { color: var(--staff-input-placeholder); font-size: 15px; font-weight: 400; opacity: 1; }
    .command-palette input:hover { border-color: #b9d5c2; }
    .command-palette input:focus { border: 2px solid var(--staff-input-focus); outline: 0; box-shadow: 0 0 0 4px var(--staff-input-focus-ring); background: #fff; }
    .command-palette input:active { transform: scale(.995); }
    .search-hint { display: block; margin: 0 16px 8px; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 650; }
    .command-list { display: grid; gap: 6px; padding: 0 14px 14px; }
    .command-list button { display: grid; grid-template-columns: 36px 1fr; gap: 10px; align-items: center; min-height:56px;border:1px solid transparent;border-radius:16px;padding:10px;background:var(--staff-surface);text-align:left; }
    .command-list button span { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 12px; background: var(--staff-primary-light); color: var(--staff-primary-hover); font-size: .72rem; font-weight: 800; }
    .command-list strong, .command-list small { display: block; color: var(--staff-text); }
    .command-list small { color: var(--staff-text-secondary); }
     .notification-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 31; width: min(420px, 92vw); box-sizing: border-box; overflow: auto; padding: 14px; background: var(--staff-background); box-shadow: var(--staff-shadow-elevated); overscroll-behavior: contain; animation: shell-drawer-enter var(--staff-motion-standard) var(--staff-motion-ease) both; }
    .push-permission-card { display:flex;align-items:center;gap:12px;margin:10px 0;padding:13px;border:1px solid var(--staff-border);border-radius:14px;background:var(--staff-surface-secondary); }
    .push-permission-card div { min-width:0;flex:1; }
    .push-permission-card strong,.push-permission-card small { display:block; }
    .push-permission-card small { margin-top:4px;color:var(--staff-text-secondary);line-height:1.35; }
    .push-permission-card button { min-height:38px;padding:8px 12px;border:0;border-radius:10px;color:var(--staff-text-inverse);background:var(--staff-primary);font-weight:800; }
    .push-permission-card span { padding:6px 9px;border-radius:999px;color:var(--staff-primary-hover);background:var(--staff-primary-light);font-size:12px;font-weight:800; }
    .push-message { margin:8px 2px;color:var(--staff-text-secondary);font-size:12px; }
    .notice-list { display: grid; gap: 8px; }
    .notice-list article { padding: 12px; border: 1px solid var(--staff-border); border-radius: 16px; background: var(--staff-surface); }
    .notice-list strong, .notice-list small, .notice-list span { display: block; }
    .notice-list strong { color: var(--staff-text); }
    .notice-list small { margin-top: 4px; color: var(--staff-text-secondary); font-weight: 600; }
    .notice-list span { margin-top: 6px; color: var(--staff-primary-hover); font-size: .76rem; font-weight: 750; text-transform: capitalize; }
    .notice-list button { min-height:44px;margin-top:8px;border:1px solid var(--staff-border-accent);border-radius:14px;background:var(--staff-surface);color:var(--staff-primary-hover);font-weight:750;padding:7px 10px; }
     .staff-toast { position: fixed; left: 50%; bottom: 18px; z-index: 80; transform: translateX(-50%); max-width: min(420px, calc(100vw - 24px)); padding: 11px 14px; border-radius: 16px; background: var(--staff-text); color: var(--staff-text-inverse); font-weight: 750; box-shadow: var(--staff-shadow-elevated); animation: shell-toast-enter var(--staff-motion-fast) var(--staff-motion-ease) both; }
     .command-backdrop { animation: shell-fade-in var(--staff-motion-fast) var(--staff-motion-ease) both; }
     .command-palette { animation: shell-dialog-enter var(--staff-motion-standard) var(--staff-motion-ease) both; overscroll-behavior: contain; }
     @keyframes shell-fade-in { from { opacity: 0; } }
     @keyframes shell-dialog-enter { from { opacity: 0; transform: translateY(10px) scale(.985); } }
     @keyframes shell-drawer-enter { from { opacity: 0; transform: translateX(20px); } }
     @keyframes shell-toast-enter { from { opacity: 0; transform: translate(-50%, 8px); } }
    .mobile-bottom-nav { display: none; }
     @media (max-width: 900px) {
       .staff-app-shell { --staff-header-height: calc(54px + env(safe-area-inset-top)); display: block; min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom); }
       .staff-main-shell { display: block; height: 100dvh; min-height: 100dvh; overflow-y: auto; overflow-x: hidden; scroll-padding-top: var(--staff-header-height); -webkit-overflow-scrolling: touch; }
        .staff-topbar { position: sticky; top: 0; z-index: 20; min-height: var(--staff-header-height); padding: calc(7px + env(safe-area-inset-top)) 8px 7px 12px; gap: 4px; }
      .menu-button { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; flex: 0 0 auto; width: 46px; height: 46px; margin: 0 2px 0 -8px; padding: 0; border: 1px solid color-mix(in srgb,var(--staff-primary) 12%,var(--staff-border)); border-radius: 16px; background: var(--staff-surface); color: var(--staff-text); font-size: .78rem; font-weight: 750; box-shadow: 0 8px 18px rgba(42,20,51,.05); }
      .staff-topbar > div:nth-child(2) { min-width: 0; flex: 1 1 auto; }
       .staff-identity { flex: 1 1 auto; width:0; max-width:none; gap: 10px; overflow: hidden; }
      .profile-avatar { width: 38px; height: 38px; background: color-mix(in srgb, var(--staff-primary) 76%, transparent); }
        .staff-identity span { max-width: 100%; font-size: .7rem; }
        .staff-identity strong { max-width: 100%; font-size: .88rem; }
        .staff-identity small { max-width:100%;font-size:.7rem; }
      .staff-topbar p { font-size: .66rem; }
       .topbar-actions { gap: 0; flex: 0 0 auto; flex-wrap: nowrap; margin-left: auto; justify-content: flex-end; }
      .search-button span,.search-button kbd,.topbar-actions > span:not(.queue-status) { display: none; }
      .search-button { display:inline-grid;grid-template-columns:1fr;place-items:center;width:32px;height:44px;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none; }
       .topbar-actions span { max-width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .68rem; }
      .topbar-actions button { padding:0; }
       .topbar-actions :is(.chat-button,.bell-button) { width:32px;height:44px;min-width:32px;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none; }
       .topbar-actions :is(.search-button,.chat-button,.bell-button):hover { border:0;background:transparent; }
      .bell-icon { width: 19px; height: 19px; }
       .staff-content { overflow: visible; padding: 10px 0 var(--staff-bottom-clearance); }
       .staff-policy-hint { margin: 0 10px 8px; padding: 7px 10px; font-size: .72rem; line-height: 1.3; }
       .notification-drawer { top: 0; right: 0; bottom: 0; left: auto; width: 72vw; min-width: 280px; max-width: 360px; height: 100dvh; padding: calc(14px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) calc(14px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left)); border-left: 1px solid var(--staff-border); border-radius: 26px 0 0 26px; box-shadow: -22px 0 54px rgba(42,20,51,.2); }
      .notification-drawer .drawer-title { position: sticky; top: 0; z-index: 2; border: 1px solid var(--staff-border); border-radius: 16px; background: var(--staff-surface-secondary); box-shadow: 0 6px 16px rgba(31, 41, 55, .08); }
        .mobile-bottom-nav { position: fixed; left: 50%; bottom: calc(var(--staff-mobile-nav-offset) + env(safe-area-inset-bottom)); z-index: 27; display: grid; grid-template-columns: repeat(auto-fit, minmax(56px, 1fr)); width: min(calc(100vw - 20px), 430px); min-height: var(--staff-mobile-nav-height); padding: 7px; gap: 3px; transform: translateX(-50%); border: 1px solid color-mix(in srgb,var(--staff-primary) 18%,var(--staff-border)); border-radius: 26px; background: linear-gradient(135deg,color-mix(in srgb,var(--staff-surface-glass) 96%,transparent),color-mix(in srgb,var(--staff-surface-secondary) 88%,transparent)); box-shadow: var(--staff-shadow-elevated); backdrop-filter: blur(22px); }
       .mobile-bottom-nav:has(> a:nth-child(5)) { grid-template-columns: .85fr 1.2fr 1fr 1.15fr .8fr; gap: 1px; }
        .mobile-bottom-nav a { position:relative;display: grid; grid-template-columns: 1fr; grid-template-rows: 23px auto; place-items: center; align-content: center; gap: 2px; min-width: 0; padding: 6px 3px; border: 0; border-radius: 16px; color: var(--staff-text-secondary); font-size: .62rem; font-weight: 700; line-height: 1; text-decoration: none; transition:transform var(--staff-motion-fast) var(--staff-motion-ease),opacity var(--staff-motion-fast) var(--staff-motion-ease); } .mobile-bottom-nav a span, .mobile-bottom-nav a.active span { display: block; max-width: 100%; width: auto; height: auto; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font-size: inherit; font-weight: inherit; letter-spacing: 0; text-transform: none; white-space: nowrap; }
       .mobile-bottom-nav:has(> a:nth-child(5)) a:nth-child(2) span { font-size: .57rem; letter-spacing: -.015em; }
       .mobile-bottom-nav a.active::after { position:absolute;top:2px;width:16px;height:2px;border-radius:999px;background:var(--staff-primary);content:""; }
      .mobile-bottom-nav a svg { display: block; width: 20px; height: 20px; margin: 0; fill: currentColor; }
        .mobile-bottom-nav a.active { color: var(--staff-primary-hover); background: var(--staff-primary-light); }
        .mobile-bottom-nav a.active svg { box-sizing:content-box;padding:2px;border-radius:9px;background:linear-gradient(135deg,var(--staff-primary),var(--staff-primary-hover));color:var(--staff-on-primary); }
        .mobile-bottom-nav a:focus-visible { outline: 3px solid var(--staff-focus-ring); outline-offset: 2px; border-radius: 14px; }
      .drawer-backdrop { display: block; position: fixed; inset: 0; z-index: 29; border: 0; opacity: 0; pointer-events: none; background: var(--staff-overlay); backdrop-filter: blur(3px); transition: opacity .18s ease; }
      .drawer-backdrop.open { opacity: 1; pointer-events: auto; }
      .staff-sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 30; width: 68vw; min-width: 250px; max-width: 320px; box-sizing: border-box; height: 100dvh; overflow: auto; padding: calc(14px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) calc(14px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left)); border-right: 1px solid var(--staff-border); border-radius: 0 28px 28px 0; transform: translateX(-104%); transition: transform .2s ease; box-shadow: 22px 0 54px rgba(42,20,51,.2); }
      .staff-sidebar.open { transform: translateX(0); }
      .drawer-close { position: sticky; top: 0; z-index: 3; display: block; width: 100%; min-height: 48px; margin-bottom: 10px; padding: 9px 12px; border: 1px solid var(--staff-border); border-radius: 16px; background: var(--staff-surface-secondary); color: var(--staff-text); font-weight: 750; text-align: left; box-shadow: 0 6px 16px rgba(31, 41, 55, .08); }
      .brand-card { display: block; }
      nav { display: grid; gap: 6px; margin-top: 14px; overflow: visible; }
      nav a { min-width: 0; padding: 12px 13px; border-radius: 16px; text-align: left; font-size: .92rem; white-space: normal; background: transparent; }
      nav a.active { background: var(--staff-primary-light); color: var(--staff-primary-hover); border-color: var(--staff-border-accent); }
    }
     @media (max-width: 560px) {
      .staff-topbar { align-items: center; display: flex; }
      .staff-topbar strong { display: block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .network-status { display: none; }

      nav a { padding: 12px 13px; }
     }
      @media (max-width: 380px) {
        .profile-avatar { display:none; }
        .staff-identity { gap:4px; }
        .staff-identity small { max-width:100%; }
      }
      @media (max-width: 900px) and (any-pointer: coarse) {
        @supports selector(.staff-app-shell:has(input:focus)) {
          .staff-app-shell:has(input:focus,textarea:focus,select:focus) .mobile-bottom-nav { opacity:0;pointer-events:none;transform:translate(-50%,calc(100% + var(--staff-mobile-nav-offset) + env(safe-area-inset-bottom))); }
        }
      }
     @media (prefers-reduced-motion: reduce) { .notification-drawer, .command-backdrop, .command-palette, .staff-toast { animation: none; } .command-palette input:active { transform: none; } }
  `]
})
export class StaffLayoutPage implements OnInit, OnDestroy {
  @ViewChild("commandInput") private commandInput?: ElementRef<HTMLInputElement>;
  @ViewChild("menuDialog") private menuDialog?: ElementRef<HTMLElement>;
  @ViewChild("menuButton") private menuButton?: ElementRef<HTMLButtonElement>;
  @ViewChild("commandButton") private commandButton?: ElementRef<HTMLButtonElement>;
  @ViewChild("notificationButton") private notificationButton?: ElementRef<HTMLButtonElement>;
  @ViewChild("mainShell") private mainShell?: ElementRef<HTMLElement>;
  readonly menuOpen = signal(false);
  readonly commandOpen = signal(false);
  readonly notificationsOpen = signal(false);
  readonly online = signal(typeof navigator === "undefined" ? true : navigator.onLine);
  readonly realtimeConnected = signal(false);
  readonly offlinePending = signal(0);
  readonly toastMessage = signal("");
  readonly staffHintVisible = signal(false);
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly preferences = signal<StaffWorkspacePreferences>({
    workspace: { workspaceName: "Solastio Staff Portal" },
    localization: { timezone: "Asia/Kolkata", locale: "en-IN" },
    dateTime: { dateFormat: "DD/MM/YYYY", timeFormat: "12h", businessDayStartHour: 0, weekStartsOn: "Monday" },
    interface: { compactMode: false },
    defaults: { staffHints: true }
  });
  readonly recent = signal<StaffRecentItem[]>(this.readRecent());
  readonly query = signal("");
  readonly theme = signal<"light" | "dark">(document.documentElement.dataset["staffTheme"] === "dark" ? "dark" : "light");
  private pollTimer = 0;
  private reconnectTimer = 0;
  private toastTimer = 0;
  private staffHintTimer = 0;
  private routerSubscription?: Subscription;
  private socket: WebSocket | null = null;
  private destroyed = false;

  private readonly nav: StaffNavItem[] = [
    { label: "Dashboard", path: "/staff/dashboard", iconPath: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z", group: "Home", permission: "read:appointments" },
    { label: "Roster", path: "/staff/roster", iconPath: "M4 4h16v4H4V4zm0 6h7v10H4V10zm9 0h7v10h-7V10z", group: "Work" },
    { label: "Calendar", path: "/staff/calendar", iconPath: "M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v16h18V5a2 2 0 0 0-2-2zm0 16H5V9h14v10z", group: "Work", permission: "read:appointments" },
    { label: "Clients", path: "/staff/clients", iconPath: "M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zM8 12c2.2 0 4-1.8 4-4S10.2 4 8 4 4 5.8 4 8s1.8 4 4 4zm8 2c-2 0-6 1-6 3v2h12v-2c0-2-4-3-6-3zM8 14c-2.7 0-8 1.3-8 4v1h8v-2c0-1 .5-2 1.3-2.8-.4-.1-.8-.2-1.3-.2z", group: "Work", permission: "read:clients" },
    { label: "Performance", path: "/staff/performance", iconPath: "M3 17h3v4H3v-4zm5-6h3v10H8V11zm5 3h3v7h-3v-7zm5-9h3v16h-3V5z", group: "Intelligence", permission: "read:staff" },
    { label: "Leaderboard", path: "/staff/leaderboard", iconPath: "M7 21h10v-2H7v2zM5 3h14v4a7 7 0 0 1-6 6.9V17h-2v-3.1A7 7 0 0 1 5 7V3zm2 2v2a5 5 0 0 0 10 0V5H7z", group: "Intelligence", permission: "read:staff" },
    { label: "Reports", path: "/staff/reports", iconPath: "M5 3h11l3 3v15H5V3zm10 1.5V7h2.5L15 4.5zM8 11h8v2H8v-2zm0 4h8v2H8v-2z", group: "Intelligence", permission: "read:staff" },

    { label: "Payroll", path: "/staff/payroll", iconPath: "M4 6h16v12H4V6zm2 2v8h12V8H6zm6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", group: "Account", anyPermissions: ["read:payroll", "read:finance"] },
    { label: "Leaves", path: "/staff/leaves", iconPath: "M12 2C8 6 6 9 6 12a6 6 0 0 0 12 0c0-3-2-6-6-10z", group: "Account" },
    { label: "Profile", path: "/staff/profile", iconPath: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3.3 0-6 1.7-6 3.8V20h12v-2.2c0-2.1-2.7-3.8-6-3.8z", group: "Account" },
    { label: "Settings", path: "/staff/settings", iconPath: "M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7 7 0 0 0 7 6L4.6 5l-2 3.5 2 1.5A8 8 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5L7 17a7 7 0 0 0 2.6 1.5L10 21h4l.4-2.5A7 7 0 0 0 17 17l2.4 1 2-3.5-2-1.5zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z", group: "Account" }
  ];
  private readonly bottomNavIcons: Record<string, string> = {
    Appointments: "M7 2v2H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8H5V7h14v3z",
    Attendance: "M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z",
    Business: "M3 21V3h8v4h10v14H3zm3-3h2v-3H6v3zm0-6h2V9H6v3zm7 6h2v-3h-2v3zm0-6h2V9h-2v3zm5 6h1v-3h-1v3zm0-6h1V9h-1v3z",
    Clients: "M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zM8 12c2.2 0 4-1.8 4-4S10.2 4 8 4 4 5.8 4 8s1.8 4 4 4zm8 2c-2 0-6 1-6 3v2h12v-2c0-2-4-3-6-3zM8 14c-2.7 0-8 1.3-8 4v1h8v-2c0-1 .5-2 1.3-2.8-.4-.1-.8-.2-1.3-.2z",
    Tasks: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
  };

  readonly commandResults = computed(() => {
    const text = this.query().trim().toLowerCase();
    const navItems = this.visibleNav().map((item) => ({ ...item }));
    const notices = this.staff.hasPermission("read:appointments") ? (this.os()?.notifications || []).map((note) => ({ label: note.title, path: "/staff/notifications", iconPath: this.iconFor("Notifications"), group: note.body || "Notification" })) : [];
    const business = this.staff.hasPermission("read:appointments") ? (this.os()?.timeline || []).map((item) => ({ label: item.serviceNames?.join(", ") || "Appointment", path: "/staff/business", iconPath: this.iconFor("Business"), group: "Scheduled work" })) : [];
    const all = [...navItems, ...notices, ...business];
    if (!text) return all.slice(0, 12);
    return all
      .map((item) => ({ item, score: this.searchScore(item.label, item.group, text) }))
      .filter((match) => match.score >= 0)
      .sort((left, right) => right.score - left.score)
      .map((match) => match.item)
      .slice(0, 12);
  });

  readonly currentUrl = signal(this.router.url);
  readonly quickSuggestions = signal(["Appointments", "Clients", "Business", "Attendance", "Tasks", "Profile", "Chat"]);

  applyCommandSuggestion(text: string) {
    this.query.set(text);
  }

  constructor(readonly staff: StaffAppService, readonly push: StaffPushService, private readonly router: Router) {}

  ngOnInit() {
    this.destroyed = false;
    void this.loadShellData();
    void this.flushOfflineQueue();
    void this.connectRealtime();
    void this.push.refreshStatus();
    this.routerSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.currentUrl.set(event.urlAfterRedirects || event.url);
        this.showStaffHintOnce(event.urlAfterRedirects);
        if (this.mainShell) this.mainShell.nativeElement.scrollTop = 0;
      }
    });
    this.showStaffHintOnce(this.router.url);
    this.pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !this.realtimeConnected()) void this.loadShellData();
    }, 60000);
  }

  isRouteActive(path: string): boolean {
    const current = this.currentUrl().split("?")[0];
    if (path === "/staff/dashboard") return current === "/staff/dashboard";
    return current.startsWith(path);
  }

  ngOnDestroy() {
    this.destroyed = true;
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.staffHintTimer);
    this.routerSubscription?.unsubscribe();
    this.socket?.close();
    this.setOverlayLock(false);
  }

  @HostListener("window:online") onOnline() { this.online.set(true); void this.flushOfflineQueue(); void this.connectRealtime(); }
  @HostListener("window:offline") onOffline() { this.online.set(false); this.realtimeConnected.set(false); }
  @HostListener("window:keydown", ["$event"])
  onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.openCommand();
    }
    if (event.key === "Escape") {
      this.closeCommand();
      this.closeMenu();
      this.closeNotifications();
    }
  }

  @HostListener("window:touchstart", ["$event"])
  onTouchStart(event: TouchEvent) {
    this.touchStartX = event.touches[0]?.clientX || 0;
    this.touchStartY = event.touches[0]?.clientY || 0;
  }

  @HostListener("window:touchend", ["$event"])
  onTouchEnd(event: TouchEvent) {
    const touch = event.changedTouches[0];
    const endX = touch?.clientX || 0;
    const endY = touch?.clientY || 0;
    const deltaX = endX - this.touchStartX;
    const deltaY = endY - this.touchStartY;

    const target = event.target as HTMLElement | null;
    if (target?.closest("input,textarea,select,button,a,[role=dialog],.chat-message-viewport")) return;
    if (this.menuOpen() || this.notificationsOpen() || this.commandOpen()) {
      if (this.menuOpen() && deltaX < -70) this.closeMenu();
      return;
    }

    if (Math.abs(deltaX) < 70 || Math.abs(deltaY) > 50 || Math.abs(deltaX) < Math.abs(deltaY) * 1.8) return;

    if (this.touchStartX < 28 && deltaX > 70) {
      this.openMenu();
      return;
    }

    const paths: string[] = [];
    if (this.staff.hasPermission("read:appointments")) {
      paths.push("/staff/dashboard", "/staff/appointments", "/staff/business");
    }
    if (this.staff.hasPermission("read:clients")) {
      paths.push("/staff/clients");
    }
    if (this.staff.hasAnyPermission(["allow:staff-checkin-checkout", "read:staff", "write:staff"])) {
      paths.push("/staff/attendance");
    }
    if (this.staff.hasPermission("read:staff")) {
      paths.push("/staff/tasks");
    }

    const currentPath = this.router.url.split("?")[0];
    const currentIndex = paths.indexOf(currentPath);
    if (currentIndex === -1) return;

    if (deltaX < -80 && currentIndex < paths.length - 1) {
      void this.router.navigateByUrl(paths[currentIndex + 1]);
    } else if (deltaX > 80 && currentIndex > 0) {
      void this.router.navigateByUrl(paths[currentIndex - 1]);
    }
  }

  private touchStartX = 0;
  private touchStartY = 0;
  visibleNav(): StaffNavItem[] {
    return this.nav.filter((item) => (!item.permission || this.staff.hasPermission(item.permission)) && (!item.anyPermissions?.length || this.staff.hasAnyPermission([...item.anyPermissions])));
  }

  navGroups(): string[] {
    return [...new Set(this.visibleNav().map((item) => item.group))];
  }

  navByGroup(group: string): StaffNavItem[] {
    return this.visibleNav().filter((item) => item.group === group);
  }

  initials(): string {
    return String(this.staff.user()?.name || "Staff").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "S";
  }

  firstName(): string {
    return String(this.staff.user()?.name || "Solastio Staff").trim().split(/\s+/)[0] || "Solastio Staff";
  }

  greetingLabel(): string {
    const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()));
    return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  }

  roleLabel(): string { return this.identity().role; }

  branchLabel(): string { return this.identity().branch; }

  identitySubtitle(): string { return this.identity().subtitle; }

  private identity() {
    return resolveStaffIdentity({
      roleDisplayName: this.staff.profile()?.designation || this.os()?.staff.designation || this.staff.user()?.roleDisplayName,
      customRoleName: this.staff.user()?.customRoleName,
      systemRole: this.staff.user()?.role,
      branchName: this.staff.user()?.branchName
    });
  }

  isDashboard(): boolean { return this.router.url.split("?")[0] === "/staff/dashboard"; }

  dismissStaffHint(): void {
    window.clearTimeout(this.staffHintTimer);
    this.staffHintVisible.set(false);
  }

  private showStaffHintOnce(url: string): void {
    if (url.split("?")[0] === "/staff/dashboard" || typeof sessionStorage === "undefined" || sessionStorage.getItem(STAFF_HINT_SESSION_KEY)) return;
    sessionStorage.setItem(STAFF_HINT_SESSION_KEY, "1");
    this.staffHintVisible.set(true);
    this.staffHintTimer = window.setTimeout(() => this.staffHintVisible.set(false), 5000);
  }

  toggleTheme() {
    const next = this.theme() === "dark" ? "light" : "dark";
    this.theme.set(next);
    document.documentElement.dataset["staffTheme"] = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem("auraStaffTheme", next);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#2A1433" : "#7B2F62");
  }

  unreadCount(): number {
    return (this.os()?.notifications || []).filter((note) => String(note.status || "unread") !== "read").length;
  }

  iconFor(label: string): string {
    return this.nav.find((item) => item.label === label)?.iconPath || this.bottomNavIcons[label] || this.nav[0].iconPath;
  }

  async markNotification(id: string, status: "read" | "unread" | "archived") {
    if (!this.canUpdateOwnNotifications()) { this.showToast("You do not have permission to update notifications."); return; }
    try {
      await this.staff.updateNotification(id, status);
      await this.loadShellData();
    } catch {
      this.showToast(this.staff.error() || "Notification could not be updated.");
    }
  }

  async enableMobileNotifications() {
    await this.push.enable();
  }

  activateNav(item: StaffNavItem) {
    this.remember(item);
    this.closeMenu();
  }

  activateRecent(item: StaffRecentItem) {
    this.remember(item);
    this.closeMenu();
  }

  openMenu() {
    this.closeCommand(false);
    this.closeNotifications(false);
    this.menuOpen.set(true);
    this.setOverlayLock(true);
    window.setTimeout(() => this.menuDialog?.nativeElement.querySelector<HTMLElement>(".drawer-close")?.focus(), 0);
  }

  closeMenu(restoreFocus = true) {
    const wasOpen = this.menuOpen();
    this.menuOpen.set(false);
    this.syncOverlayLock();
    if (wasOpen && restoreFocus) window.setTimeout(() => this.menuButton?.nativeElement.focus(), 0);
  }

  private searchScore(label: string, group: string, query: string): number {
    const candidates = [label, group].map((value) => String(value || '').toLowerCase());
    let best = -1;
    for (const candidate of candidates) {
      if (!candidate) continue;
      const exactIndex = candidate.indexOf(query);
      if (exactIndex >= 0) best = Math.max(best, 1000 - exactIndex);
      let cursor = 0;
      let matched = 0;
      for (const character of query) {
        const index = candidate.indexOf(character, cursor);
        if (index < 0) { matched = -1; break; }
        matched += index === cursor ? 3 : 1;
        cursor = index + 1;
      }
      if (matched >= 0) best = Math.max(best, matched + (candidate === candidates[0] ? 100 : 0));
    }
    return best;
  }
  onCommandKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    const first = this.commandResults()[0];
    if (!first) return;
    event.preventDefault();
    this.go(first);
  }

  openCommand() {
    this.closeMenu(false);
    this.closeNotifications(false);
    this.commandOpen.set(true);
    this.setOverlayLock(true);
    window.setTimeout(() => this.commandInput?.nativeElement.focus(), 0);
  }

  closeCommand(restoreFocus = true) {
    const wasOpen = this.commandOpen();
    this.commandOpen.set(false);
    this.query.set("");
    this.syncOverlayLock();
    if (wasOpen && restoreFocus) window.setTimeout(() => this.commandButton?.nativeElement.focus(), 0);
  }

  toggleNotifications() {
    if (this.notificationsOpen()) { this.closeNotifications(); return; }
    this.closeMenu(false);
    this.closeCommand(false);
    this.notificationsOpen.set(true);
    this.setOverlayLock(true);
    window.setTimeout(() => document.querySelector<HTMLElement>(".notification-drawer.open button")?.focus(), 0);
  }

  closeNotifications(restoreFocus = true) {
    const wasOpen = this.notificationsOpen();
    this.notificationsOpen.set(false);
    this.syncOverlayLock();
    if (wasOpen && restoreFocus) window.setTimeout(() => this.notificationButton?.nativeElement.focus(), 0);
  }

  go(item: StaffRecentItem) {
    this.remember(item);
    this.closeCommand();
    void this.router.navigateByUrl(item.path);
  }

  async logout() {
    this.closeMenu();
    await this.staff.logout();
    await this.router.navigateByUrl("/staff/login");
  }

  async refreshChildPage(): Promise<void> {
    window.dispatchEvent(new CustomEvent("aura:refresh-child"));
    window.dispatchEvent(new CustomEvent("aura:attendance-updated"));
    await this.loadShellData();
  }

  private shellReloadInFlight = false;
  private shellReloadQueued = false;

  private async loadShellData() {
    if (this.shellReloadInFlight) {
      this.shellReloadQueued = true;
      return;
    }
    this.shellReloadInFlight = true;
    try {
      const [os, preferences] = await Promise.all([
        this.staff.enterpriseOs({}, false),
        this.staff.workspacePreferences(false).catch(() => this.preferences())
      ]);
      this.os.set(os);
      this.preferences.set(preferences);
      document.documentElement.dataset["staffCompactMode"] = preferences.interface.compactMode ? "true" : "false";
      document.documentElement.lang = preferences.localization.locale.split("-")[0] || "en";
      document.title = `${preferences.workspace.workspaceName} | Staff`;
      this.offlinePending.set(this.staff.offlineQueueSize());
    } catch {
      this.os.set(null);
    } finally {
      this.shellReloadInFlight = false;
      if (this.shellReloadQueued) {
        this.shellReloadQueued = false;
        void this.loadShellData();
      }
    }
  }

  private async connectRealtime() {
    if (this.destroyed || !this.online() || !this.staff.isAuthenticated()) return;
    if (this.socket && ([WebSocket.CONNECTING, WebSocket.OPEN] as number[]).includes(this.socket.readyState)) return;
    let url = "";
    try { url = await this.staff.realtimeSocketTicketUrl(); } catch { this.scheduleRealtimeReconnect(); return; }
    if (this.destroyed || !this.online() || !this.staff.isAuthenticated()) return;
    if (!url) return;
    try {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        this.realtimeConnected.set(true);
        socket.send(JSON.stringify({ type: "ping" }));
      };
      socket.onmessage = (event) => this.handleRealtimeMessage(event.data);
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        this.realtimeConnected.set(false);
        if (!this.destroyed && this.online() && this.staff.isAuthenticated()) this.scheduleRealtimeReconnect();
      };
    } catch {
      this.scheduleRealtimeReconnect();
    }
  }

  private scheduleRealtimeReconnect() {
    if (this.destroyed) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => void this.connectRealtime(), 5000);
  }

  private handleRealtimeMessage(raw: unknown) {
    let frame: { type?: string } = {};
    try { frame = JSON.parse(String(raw)); } catch { return; }
    if (!frame.type || ["connection.ready", "pong", "subscription.updated"].includes(frame.type)) return;
    if (["staff:clocked_in", "staff:clocked_out", "staff:break_started", "staff:break_ended"].includes(frame.type)) {
      window.dispatchEvent(new CustomEvent("aura:attendance-updated"));
    }
    if (frame.type.startsWith("staff-self.") || ["dashboard.updated", "booking.updated", "queue.updated"].includes(frame.type)) {
      void this.loadShellData();
    }
    if (frame.type.startsWith("staff:shift_swap_") || frame.type === "staff:shift_updated") {
      void this.loadShellData();
      window.dispatchEvent(new CustomEvent("aura:refresh-child"));
    }
  }

  canUpdateOwnNotifications(): boolean { return Boolean(this.staff.user()?.staffId) || this.staff.hasPermission("update:notifications"); }

  private async flushOfflineQueue() {
    this.offlinePending.set(this.staff.offlineQueueSize());
    const flushed = await this.staff.flushOfflineActions();
    this.offlinePending.set(this.staff.offlineQueueSize());
    if (flushed) {
      this.showToast(`${flushed} queued staff action${flushed === 1 ? "" : "s"} synced.`);
      window.dispatchEvent(new CustomEvent("aura:attendance-updated"));
      void this.loadShellData();
    }
  }

  private showToast(message: string) {
    this.toastMessage.set(message);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastMessage.set(""), 3600);
  }

  trapFocus(event: KeyboardEvent, root: HTMLElement) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  private syncOverlayLock() {
    this.setOverlayLock(this.menuOpen() || this.commandOpen() || this.notificationsOpen());
  }

  private setOverlayLock(locked: boolean) {
    document.documentElement.classList.toggle("staff-overlay-open", locked);
  }

  private remember(item: StaffRecentItem) {
    const next = [{ label: item.label, path: item.path }, ...this.recent().filter((entry) => entry.path !== item.path)].slice(0, 4);
    this.recent.set(next);
    localStorage.setItem("auraStaffRecent", JSON.stringify(next));
  }

  private readRecent(): StaffRecentItem[] {
    try {
      const parsed = JSON.parse(localStorage.getItem("auraStaffRecent") || "[]");
      return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
    } catch {
      return [];
    }
  }
}

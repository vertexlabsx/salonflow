import { Component, OnInit, signal } from "@angular/core";
import { Router } from "@angular/router";
import { StaffAppService, StaffDashboard } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";
import { StaffPermissionBadgesComponent } from "./staff-permission-badges.component";

@Component({
  standalone: true,
  imports: [StaffPageStateComponent, StaffPermissionBadgesComponent],
  template: `
    <section class="page settings-page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Settings</p>
          <h1>Staff settings</h1>
          <p>Security, biometric unlock, session and permission context.</p>
        </div>
      </header>

      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading settings...</section> }
      @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (dashboard(); as data) {
        <section class="grid two">
          <details class="panel session-panel">
            <summary><strong>Session</strong><span>{{ staff.hasSavedSession() ? 'active' : 'inactive' }}</span></summary>
            <div class="session-content">
              <div class="list">
                <div class="row"><strong>Login ID</strong><span>{{ staff.user()?.loginId || '-' }}</span></div>
                <div class="row"><strong>Staff</strong><span>{{ staff.user()?.name || data.staff.fullName || '-' }}</span></div>
                <div class="row"><strong>Role</strong><span>{{ staff.user()?.role || data.staff.roleId }}</span></div>
                <div class="row"><strong>Branch</strong><span>{{ staff.user()?.branchId || '-' }}</span></div>
              </div>
              <div class="row-actions permission-actions">
                <button class="button primary" type="button" (click)="refresh()">Refresh session</button>
                <button class="button" type="button" (click)="logout()">Logout</button>
              </div>
            </div>
          </details>

          <div class="security-stack">
            <article class="panel dark biometric-panel">
              <div class="panel-title">
                <h2>Biometric unlock</h2>
                <button
                  class="biometric-switch"
                  type="button"
                  role="switch"
                  [attr.aria-checked]="staff.biometricEnabled()"
                  aria-label="Biometric unlock"
                  [disabled]="!staff.biometricSupported() || !staff.hasSavedSession()"
                  (click)="toggleBiometric()"
                ><span aria-hidden="true"></span></button>
              </div>
              <div class="biometric-meta"><span>Device support</span><strong>{{ staff.biometricSupported() ? 'Available' : 'Not available' }}</strong></div>
            </article>

            <details class="panel permission-panel">
              <summary><strong>Permissions</strong><span>{{ staff.user()?.permissions?.length || 0 }}</span></summary>
              <div staffPermissionBadges class="row-actions permission-list" [permissions]="visiblePermissions()"></div>
            </details>
          </div>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .security-stack { display: flex; flex-direction: column; align-self: start; gap: 8px; min-width: 0; width: 100%; }
    .biometric-panel { padding: 12px 14px; border-radius: 16px; }
    .biometric-panel .panel-title { min-height: 24px; margin: 0; align-items: center; }
    .biometric-panel .panel-title h2 { font-size: .92rem; }
    .biometric-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 5px; color: var(--staff-text-secondary); font-size: .72rem; }
    .biometric-meta strong { color: inherit; font-weight: 650; }
    .biometric-switch { position: relative; width: 36px; height: 20px; flex: 0 0 36px; padding: 0; border: 1px solid var(--staff-border-accent); border-radius: 999px; background: var(--staff-surface-secondary); cursor: pointer; transition: background-color 180ms ease, border-color 180ms ease; }
    .biometric-switch span { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--staff-text-secondary); transition: transform 180ms ease, background-color 180ms ease; }
    .biometric-switch[aria-checked="true"] { border-color: var(--staff-primary); background: var(--staff-primary); }
    .biometric-switch[aria-checked="true"] span { transform: translateX(16px); background: var(--staff-on-primary); }
    .biometric-switch:focus-visible { outline: 3px solid var(--staff-focus-ring); outline-offset: 3px; }
    .biometric-switch:disabled { opacity: .55; cursor: not-allowed; }
    .session-panel, .permission-panel { width: 100%; min-width: 0; margin: 0; padding: 0; border-radius: 16px; box-sizing: border-box; }
    .session-panel summary, .permission-panel summary { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 58px; padding: 12px 14px; list-style: none; box-sizing: border-box; cursor: pointer; }
    .session-panel summary::-webkit-details-marker, .permission-panel summary::-webkit-details-marker { display: none; }
    .session-panel summary strong, .permission-panel summary strong { color: var(--staff-text); font-size: .92rem; }
    .session-panel summary span, .permission-panel summary span { color: var(--staff-text-secondary); font-size: .72rem; font-weight: 700; text-transform: capitalize; }
    .session-panel summary:focus-visible, .permission-panel summary:focus-visible { outline: 3px solid var(--staff-focus-ring); outline-offset: 2px; border-radius: 14px; }
    .session-content { padding: 0 14px 12px; border-top: 1px solid var(--staff-border); }
    .permission-list { justify-content: flex-start; padding: 0 14px 12px; border-top: 1px solid var(--staff-border); }
    .permission-panel[open] .permission-list { padding-top: 10px; }
    @media (prefers-reduced-motion: reduce) {
      .biometric-switch, .biometric-switch span { transition: none; }
    }
  `]
})
export class StaffSettingsPage implements OnInit {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly loading = signal(false);
  readonly message = signal("");

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  ngOnInit() { void this.load(); }

  async load() {
    const cached = this.staff.readStoredData<StaffDashboard>("dashboard");
    if (cached) {
      this.dashboard.set(cached);
      this.loading.set(false);
    } else {
      this.loading.set(true);
    }
    try {
      const data = await this.staff.dashboard();
      this.dashboard.set(data);
    } finally {
      this.loading.set(false);
    }
  }

  visiblePermissions(): string[] {
    return (this.staff.user()?.permissions || []).slice(0, 60);
  }

  async toggleBiometric() {
    try {
      const enabled = !this.staff.biometricEnabled();
      await this.staff.setBiometricEnabled(enabled);
      this.message.set(enabled ? "Biometric unlock enabled." : "Biometric unlock disabled.");
    } catch (error) {
      this.staff.error.set(error instanceof Error ? error.message : "Unable to update biometric unlock.");
    }
  }

  async refresh() {
    await this.load();
    this.message.set("Session refreshed.");
  }

  async logout() {
    await this.staff.logout();
    await this.router.navigateByUrl("/staff/login");
  }
}

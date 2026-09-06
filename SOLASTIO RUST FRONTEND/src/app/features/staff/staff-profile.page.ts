import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffDashboard } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";
import { StaffPermissionBadgesComponent } from "./staff-permission-badges.component";

@Component({
  standalone: true,
  imports: [StaffPageStateComponent, StaffPermissionBadgesComponent],
  template: `
    <section class="page profile-page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Profile</p>
          <h1>{{ staff.user()?.name || dashboard()?.staff?.fullName || 'My profile' }}</h1>
          <p>{{ dashboard()?.staff?.designation || staff.user()?.role || 'Staff' }} · {{ staff.user()?.branchId || 'branch scoped' }}</p>
        </div>
      </header>

      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading profile...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (dashboard(); as data) {
        <section class="profile-hero">
          <span class="profile-avatar" aria-hidden="true">{{ initials(data) }}</span>
          <div class="profile-hero-main">
            <h2>{{ staff.user()?.name || data.staff.fullName || 'Staff member' }}</h2>
            <p>{{ data.staff.designation || staff.user()?.role || 'Staff' }}{{ data.staff.department ? ' · ' + data.staff.department : '' }}</p>
            <div class="row-actions"><span class="badge" [class.green]="isActive(data)">{{ data.staff.status || 'active' }}</span></div>
          </div>
          <span class="profile-id">{{ staff.user()?.staffId || data.staff.id }}</span>
        </section>

        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Identity</h2><span>{{ data.staff.status }}</span></div>
            <div class="list">
              <div class="row"><strong>Staff ID</strong><span>{{ staff.user()?.staffId || data.staff.id }}</span></div>
              <div class="row"><strong>Login ID</strong><span>{{ staff.user()?.loginId || '-' }}</span></div>
              <div class="row"><strong>Role</strong><span>{{ staff.user()?.role || data.staff.roleId }}</span></div>
              <div class="row"><strong>Department</strong><span>{{ data.staff.department || '-' }}</span></div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-title"><h2>Contact</h2><span>connected</span></div>
            <div class="list">
              <div class="row"><strong>Mobile</strong><span>{{ data.staff.mobile || '-' }}</span></div>
              <div class="row"><strong>Email</strong><span>{{ data.staff.email || '-' }}</span></div>
              <div class="row"><strong>Branch</strong><span>{{ staff.user()?.branchId || '-' }}</span></div>
              <div class="row"><strong>Status</strong><span>{{ data.staff.status || '-' }}</span></div>
            </div>
          </article>
        </section>

        <section class="panel">
          <div class="panel-title"><h2>Connected permissions</h2><span>{{ visiblePermissions().length }}</span></div>
          <div staffPermissionBadges class="row-actions" [permissions]="visiblePermissions()"></div>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .profile-page { gap: 18px; }
    .profile-hero {
      position: relative;
      overflow: hidden;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 18px;
      padding: 26px;
      border: 1px solid color-mix(in srgb, var(--staff-primary) 14%, var(--staff-border));
      border-radius: 24px;
      background:
        radial-gradient(circle at 82% 12%, color-mix(in srgb, var(--staff-border-accent) 26%, transparent), transparent 30%),
        var(--staff-surface);
    }
    .profile-avatar {
      display: grid;
      width: 72px;
      height: 72px;
      place-items: center;
      border-radius: 24px;
      color: var(--staff-primary-hover);
      background: linear-gradient(135deg, var(--staff-primary-light), color-mix(in srgb, var(--staff-border-accent) 26%, var(--staff-primary-light)));
      font-size: 1.55rem;
      font-weight: 850;
      letter-spacing: -.02em;
    }
    .profile-hero-main { min-width: 0; }
    .profile-hero-main h2 { margin: 0; color: var(--staff-text); font-size: 1.35rem; font-weight: 800; letter-spacing: -.02em; }
    .profile-hero-main p { margin: 4px 0 10px; color: var(--staff-text-secondary); font-weight: 650; line-height: 1.4; }
    .profile-hero-main .row-actions { justify-content: flex-start; }
    .profile-id {
      align-self: start;
      padding: 6px 10px;
      border: 1px solid var(--staff-border);
      border-radius: 999px;
      color: var(--staff-text-secondary);
      background: var(--staff-surface-secondary);
      font-size: .68rem;
      font-weight: 800;
      letter-spacing: .04em;
    }
    @media (max-width: 700px) {
      .profile-page { padding-inline: 12px; gap: 12px; }
      .profile-hero { grid-template-columns: auto minmax(0, 1fr); padding: 18px; border-radius: 20px; }
      .profile-id { grid-column: 1 / -1; justify-self: start; }
      .profile-avatar { width: 60px; height: 60px; border-radius: 20px; font-size: 1.3rem; }
    }
  `]
})
export class StaffProfilePage implements OnInit {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly loading = signal(false);

  constructor(readonly staff: StaffAppService) {}

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
    return (this.staff.user()?.permissions || []).slice(0, 36);
  }

  initials(data: StaffDashboard): string {
    const name = data.staff.fullName || this.staff.user()?.name || "Staff Member";
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "S";
  }

  isActive(data: StaffDashboard): boolean {
    return /active|working|on\s?site/i.test(String(data.staff.status || ""));
  }
}

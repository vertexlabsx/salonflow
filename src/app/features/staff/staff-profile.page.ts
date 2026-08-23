import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffDashboard } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";
import { StaffPermissionBadgesComponent } from "./staff-permission-badges.component";

@Component({
  standalone: true,
  imports: [StaffPageStateComponent, StaffPermissionBadgesComponent],
  template: `
    <section class="page">
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
  styleUrls: ["./staff-app.styles.css"]
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
}

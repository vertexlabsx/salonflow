import { Component } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { StaffAppService } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="page">
      <article class="panel permission-panel">
        <p class="eyebrow">Permission denied</p>
        <h1>This workspace is restricted</h1>
        <p>Your current staff role does not include the permission needed for this page.</p>
        <div class="list">
          <div class="row"><strong>Signed in as</strong><span>{{ staff.user()?.name || 'Staff' }}</span></div>
          <div class="row"><strong>Role</strong><span>{{ staff.user()?.role || '-' }}</span></div>
          <div class="row"><strong>Required</strong><span>{{ required || 'Additional access' }}</span></div>
        </div>
        <div class="row-actions permission-actions">
          <a class="button primary" routerLink="/staff/dashboard">Back to dashboard</a>
          <a class="button" routerLink="/staff/profile">Open profile</a>
        </div>
      </article>
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffPermissionDeniedPage {
  readonly required = this.route.snapshot.queryParamMap.get("required") || "";
  constructor(readonly staff: StaffAppService, private readonly route: ActivatedRoute) {}
}

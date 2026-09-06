import { Component } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { StaffAppService } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="denied-shell">
      <article class="denied-card">
        <div class="denied-mark" aria-hidden="true">!</div>
        <p class="eyebrow">Restricted workspace</p>
        <h1>This workspace is out of reach</h1>
        <p class="denied-copy">Your current staff role does not include the permission needed for this page.</p>
        <div class="denied-context">
          <div class="row"><strong>Signed in as</strong><span>{{ staff.user()?.name || 'Staff' }}</span></div>
          <div class="row"><strong>Role</strong><span>{{ staff.user()?.role || '-' }}</span></div>
          <div class="row"><strong>Required</strong><span class="denied-required">{{ required || 'Additional access' }}</span></div>
        </div>
        <div class="row-actions denied-actions">
          <a class="button primary" routerLink="/staff/dashboard">Back to dashboard</a>
          <a class="button" routerLink="/staff/profile">Open profile</a>
        </div>
      </article>
    </main>
  `,
  styles: [`
    .denied-shell {
      min-height: 100dvh;
      display: grid;
      place-content: center;
      justify-items: center;
      padding: 24px;
      color: var(--staff-text);
      background:
        radial-gradient(circle at 16% 6%, color-mix(in srgb, var(--staff-primary) 14%, transparent), transparent 30%),
        radial-gradient(circle at 86% 14%, color-mix(in srgb, var(--staff-border-accent) 34%, transparent), transparent 26%),
        var(--staff-background);
    }
    .denied-card {
      width: min(480px, 100%);
      display: grid;
      justify-items: center;
      gap: 12px;
      padding: 38px 34px 30px;
      border: 1px solid color-mix(in srgb, var(--staff-primary) 16%, var(--staff-border));
      border-radius: 30px;
      background: linear-gradient(145deg, rgba(255,255,255,.98), var(--staff-surface-secondary));
      box-shadow: var(--staff-shadow-elevated);
      text-align: center;
    }
    .denied-mark {
      display: grid;
      width: 72px;
      height: 72px;
      place-items: center;
      margin-bottom: 6px;
      border-radius: 24px;
      color: var(--staff-error-text);
      background: var(--staff-error-surface);
      border: 1px solid var(--staff-error-border);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      font-size: 2rem;
      font-weight: 850;
      box-shadow: var(--staff-shadow);
    }
    .denied-card .eyebrow { margin: 0; color: var(--staff-primary); }
    .denied-card h1 { margin: 0; max-width: 14ch; font-size: clamp(1.8rem, 5vw, 2.6rem); font-weight: 840; line-height: .98; letter-spacing: -.05em; }
    .denied-copy { margin: 0; max-width: 40ch; color: var(--staff-text-secondary); font-weight: 650; line-height: 1.5; }
    .denied-context {
      width: 100%;
      margin-top: 8px;
      border-top: 1px solid var(--staff-border);
      text-align: left;
    }
    .denied-context .row strong { font-size: .82rem; }
    .denied-context .row span { color: var(--staff-text-secondary); font-size: .82rem; }
    .denied-required {
      padding: 2px 9px;
      border: 1px solid var(--staff-border-accent);
      border-radius: 999px;
      color: var(--staff-primary-hover);
      background: var(--staff-primary-light);
      font-weight: 800;
    }
    .denied-actions { justify-content: center; margin-top: 8px; }
    @media (max-width: 700px) {
      .denied-card { padding: 28px 20px 24px; border-radius: 24px; }
      .denied-actions a { flex: 1 1 auto; }
    }
  `]
})
export class StaffPermissionDeniedPage {
  readonly required = this.route.snapshot.queryParamMap.get("required") || "";
  constructor(readonly staff: StaffAppService, private readonly route: ActivatedRoute) {}
}
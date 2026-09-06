import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page leaderboard-page">
      <header class="page-head"><div><p class="eyebrow">Leaderboard</p><h1>Leaderboard</h1><p>Branch-scoped performance ranking and gamification.</p></div></header>
      @if (!canReadLeaderboard()) { <section staffPageState class="notice">You do not have permission to view leaderboard data.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading leaderboard...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (canReadLeaderboard() && os(); as data) {
        <section class="grid four leaderboard-kpis">
          <article class="kpi"><span>Points</span><strong>{{ data.gamification.points }}</strong><small>Your reward points</small></article>
          <article class="kpi"><span>Level</span><strong>{{ data.gamification.level }}</strong><small>Current rank level</small></article>
          <article class="kpi"><span>Stars</span><strong>{{ data.gamification.stars }}</strong><small>Badge stars</small></article>
          <article class="kpi"><span>Streak</span><strong>{{ data.gamification.monthlyStreak }}</strong><small>Day streak this month</small></article>
        </section>
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Rankings</h2><span>{{ data.leaderboard.length }} members</span></div>
            <div class="list">
              @for (row of data.leaderboard; track row.staffId) {
                <div class="row">
                  <span class="rank-badge" [class.mine]="row.isMe" [class.top]="row.rank <= 3" aria-hidden="true">#{{ row.rank }}</span>
                  <div class="row-main"><strong>{{ row.staffName }}{{ row.isMe ? ' · You' : '' }}</strong><small>{{ row.days }} tracked days</small></div>
                  <div class="row-actions"><span class="badge" [class.green]="row.isMe">{{ row.score }}/100</span>@if (canSeeRevenue()) { <span class="badge">{{ row.revenue | paiseInr }}</span> }</div>
                </div>
              } @empty { <p class="empty">No ranking data available.</p> }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Badges</h2><span>{{ earnedBadgeCount(data) }} earned</span></div>
            @if (!data.gamification.badges.length) { <p class="empty">No badges yet.</p> }
            <div class="badge-wall">
              @for (badge of data.gamification.badges; track badge.label) {
                <span class="award-badge" [class.earned]="badge.earned" [class.unearned]="!badge.earned"><i aria-hidden="true">{{ badge.earned ? '★' : '☆' }}</i><b>{{ badge.label }}</b><small>{{ badge.earned ? 'Earned' : 'Locked' }}</small></span>
              }
            </div>
          </article>
        </section>
      }
    </section>`,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    :host { display: block; }
    .leaderboard-page { gap: 18px; }
    .leaderboard-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .rank-badge { display: grid; place-items: center; min-width: 34px; height: 34px; border-radius: 10px; background: var(--staff-surface-secondary); color: var(--staff-text-secondary); font-size: .74rem; font-weight: 850; }
    .rank-badge.top { background: var(--staff-primary-light); color: var(--staff-primary-hover); }
    .rank-badge.mine { background: var(--staff-success); color: #fff; }
    .badge-wall { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .award-badge { display: grid; justify-items: center; gap: 3px; padding: 14px 10px; border: 1px solid var(--staff-border); border-radius: 15px; background: var(--staff-surface-secondary); text-align: center; }
    .award-badge i { font-style: normal; font-size: 1.35rem; line-height: 1; }
    .award-badge b { color: var(--staff-text); font-size: .78rem; }
    .award-badge small { color: var(--staff-text-secondary); font-size: .62rem; font-weight: 750; text-transform: uppercase; letter-spacing: .05em; }
    .award-badge.earned { border-color: color-mix(in srgb, var(--staff-primary) 45%, transparent); background: var(--staff-primary-light); }
    .award-badge.earned i { color: var(--staff-primary-hover); }
    .award-badge.unearned { opacity: .62; }
    .award-badge.unearned i { color: var(--staff-text-tertiary); }
    @media (max-width: 700px) {
      .leaderboard-page { padding-inline: 12px; gap: 12px; }
      .leaderboard-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .badge-wall { grid-template-columns: 1fr 1fr; gap: 8px; }
    }
  `]
})
export class StaffLeaderboardPage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly loading = signal(false);

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadLeaderboard()) void this.load(); }

  async load() {
    if (!this.canReadLeaderboard()) return;
    const cached = this.staff.readStoredData<StaffEnterpriseOs>("enterprise-os");
    if (cached) {
      this.os.set(cached);
      this.loading.set(false);
    } else {
      this.loading.set(true);
    }
    try {
      const data = await this.staff.enterpriseOs();
      this.os.set(data);
      this.staff.writeStoredData("enterprise-os", data);
    } finally {
      this.loading.set(false);
    }
  }

  canReadLeaderboard(): boolean { return this.staff.hasPermission("read:staff"); }
  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["read:finance", "read:sales", "read:payments", "read:invoices"]); }
  earnedBadgeCount(data: StaffEnterpriseOs): number { return data.gamification.badges.filter((badge) => badge.earned).length; }
}

import { Component, OnInit, inject } from "@angular/core";
import { ShopfiyClientService } from "../../core/shopify-client.service";

@Component({
  standalone: true,
  template: `
    <section class="client-dashboard">
      <header class="page-header">
        <h1>Automation Status</h1>
        @if (client.overview()?.store) {
          <span class="status-badge connected">Connected</span>
        } @else {
          <span class="status-badge disconnected">Not Connected</span>
        }
      </header>

      <section class="kpi-strip">
        <article class="kpi"><span>Active Flows</span><strong>{{ client.overview()?.stats?.activeFlows || 0 }}</strong></article>
        <article class="kpi"><span>Sent Today</span><strong>{{ client.overview()?.stats?.sentToday || 0 }}</strong></article>
        <article class="kpi"><span>Delivered</span><strong>{{ client.overview()?.stats?.delivered || 0 }}</strong></article>
        <article class="kpi failed"><span>Failed</span><strong>{{ client.overview()?.stats?.failed || 0 }}</strong></article>
      </section>

      <section class="flows-section">
        <h2>Your Flows</h2>
        <div class="flows-list">
          @for (flow of client.flows(); track flow.name) {
            <article class="flow-card">
              <div class="flow-info">
                <strong>{{ flow.name }}</strong>
                <small>{{ flow.description || flow.trigger }}</small>
              </div>
              <span class="flow-status" [attr.data-status]="flow.status">{{ flow.status }}</span>
              <span class="flow-metrics">{{ flow.metrics?.['messagesSent'] || 0 }} sent</span>
            </article>
          } @empty {
            <p class="empty">No flows configured yet. Contact your automation provider to get started.</p>
          }
        </div>
      </section>

      <section class="activity-section">
        <h2>Recent Activity</h2>
        <div class="activity-list">
          @for (item of client.activity(); track $index) {
            <article class="activity-item">
              <span class="activity-phone">{{ item.phone }}</span>
              <span class="activity-status" [attr.data-status]="item.status">{{ item.status }}</span>
              <span class="activity-time">{{ formatTime(item.time) }}</span>
            </article>
          } @empty {
            <p class="empty">No recent activity.</p>
          }
        </div>
      </section>

      <footer class="page-footer">
        <p>Managed by your automation provider. Contact support for changes.</p>
      </footer>
    </section>
  `,
  styles: [`
    .client-dashboard { display:grid; gap:20px; }
    .page-header { display:flex; align-items:center; justify-content:space-between; }
    h1 { margin:0; font-size:1.4rem; color:#1a202c; }
    h2 { margin:0 0 12px; font-size:1rem; color:#4a5568; }
    .status-badge { padding:4px 12px; border-radius:999px; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.08em; }
    .status-badge.connected { background:#c6f6d5; color:#276749; }
    .status-badge.disconnected { background:#fed7d7; color:#9b2c2c; }

    .kpi-strip { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
    .kpi { display:grid; gap:4px; padding:16px; border:1px solid #e2e8f0; border-radius:16px; background:#fff; }
    .kpi span { color:#718096; font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:.1em; }
    .kpi strong { font-size:1.5rem; color:#1a202c; }
    .kpi.failed strong { color:#e53e3e; }

    .flows-section, .activity-section { border:1px solid #e2e8f0; border-radius:16px; background:#fff; padding:16px; }
    .flows-list, .activity-list { display:grid; gap:8px; }
    .flow-card { display:flex; align-items:center; gap:12px; padding:12px; border:1px solid #f7fafc; border-radius:12px; background:#fafbff; }
    .flow-info { flex:1; display:grid; gap:2px; }
    .flow-info strong { color:#1a202c; }
    .flow-info small { color:#718096; font-size:.75rem; }
    .flow-status { padding:3px 10px; border-radius:999px; font-size:.7rem; font-weight:800; text-transform:uppercase; background:#e2e8f0; color:#4a5568; }
    .flow-status[data-status="active"] { background:#c6f6d5; color:#276749; }
    .flow-status[data-status="paused"] { background:#fefcbf; color:#975a16; }
    .flow-metrics { font-size:.75rem; color:#718096; font-weight:700; }

    .activity-item { display:flex; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid #f7fafc; }
    .activity-item:last-child { border-bottom:none; }
    .activity-phone { font-family:monospace; font-size:.8rem; color:#4a5568; }
    .activity-status { padding:2px 8px; border-radius:999px; font-size:.65rem; font-weight:800; text-transform:uppercase; background:#e2e8f0; color:#4a5568; }
    .activity-status[data-status="delivered"] { background:#c6f6d5; color:#276749; }
    .activity-status[data-status="failed"] { background:#fed7d7; color:#9b2c2c; }
    .activity-time { margin-left:auto; font-size:.7rem; color:#a0aec0; }

    .empty { color:#a0aec0; font-style:italic; text-align:center; padding:20px; }

    .page-footer { text-align:center; padding:12px; }
    .page-footer p { margin:0; color:#a0aec0; font-size:.75rem; }

    @media (max-width:600px) { .kpi-strip { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  `]
})
export class ShopifyClientPage implements OnInit {
  readonly client = inject(ShopfiyClientService);

  ngOnInit() { void this.client.loadDashboard(); }

  formatTime(time: string): string {
    if (!time) return "";
    return new Date(time).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
  }
}

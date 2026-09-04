import { Component, OnInit, inject, signal } from "@angular/core";
import { Metric, WorkItem } from "../../core/api.service";
import { WorkspaceService } from "../../core/workspace.service";

@Component({ standalone: true, template: `
  <section class="content"><section class="hero"><p class="eyebrow">Today</p><h1>Move the day forward.</h1><p>One calm view for what needs attention now.</p><div class="actions"><button class="btn primary" (click)="load()">Refresh</button><a class="btn" href="/staff/appointments">Appointments</a></div></section>
  @if (error()) { <p class="notice error">{{ error() }}</p> }
  <section class="grid three">@for (metric of metrics(); track metric.label) { <article class="metric"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.hint || '' }}</small></article> }</section>
  <section class="panel"><div class="panel-head"><h2>Priority work</h2><span class="muted">{{ loading() ? 'Loading' : work().length + ' items' }}</span></div><div class="list">@for (item of work(); track item.id) { <article class="list-row"><span><strong>{{ item.title }}</strong><small>{{ item.subtitle || item.status || 'Ready' }}</small></span><button class="btn">{{ item.primaryAction || 'Open' }}</button></article> } @empty { <p class="muted">No urgent work returned yet.</p> }</div></section></section>` })
export class StaffTodayPage implements OnInit {
  private readonly workspace = inject(WorkspaceService);
  readonly loading = signal(false); readonly error = signal("");
  readonly metrics = signal<Metric[]>([{ label: "Next", value: "--", hint: "Waiting for backend data" }, { label: "Queue", value: "--" }, { label: "Tasks", value: "--" }]);
  readonly work = signal<WorkItem[]>([]);
  ngOnInit() { void this.load(); }
  async load() { this.loading.set(true); this.error.set(""); try { const data = await this.workspace.staffToday(); this.metrics.set(data.metrics?.length ? data.metrics : this.metrics()); this.work.set(data.work || data.timeline || []); } catch { this.error.set("Staff today could not be loaded. Check backend session/API."); } finally { this.loading.set(false); } }
}

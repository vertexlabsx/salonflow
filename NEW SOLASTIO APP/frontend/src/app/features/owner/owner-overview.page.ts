import { Component, OnInit, inject, signal } from "@angular/core";
import { Metric, WorkItem } from "../../core/api.service";
import { WorkspaceService } from "../../core/workspace.service";

@Component({ standalone: true, template: `
  <section class="content"><section class="hero"><p class="eyebrow">Owner overview</p><h1>Know what matters.</h1><p>Revenue, appointments, people and operational alerts in one precise command surface.</p><button class="btn primary" (click)="load()">Refresh</button></section>
  @if (error()) { <p class="notice error">{{ error() }}</p> }
  <section class="grid four">@for (metric of metrics(); track metric.label) { <article class="metric"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.hint || '' }}</small></article> }</section>
  <section class="panel"><div class="panel-head"><h2>Attention</h2><span class="muted">{{ alerts().length }} alerts</span></div><div class="list">@for (alert of alerts(); track alert.id) { <article class="list-row"><span><strong>{{ alert.title }}</strong><small>{{ alert.subtitle || alert.status }}</small></span><button class="btn">Review</button></article> } @empty { <p class="muted">No critical alerts returned.</p> }</div></section></section>` })
export class OwnerOverviewPage implements OnInit { private readonly workspace = inject(WorkspaceService); readonly error = signal(""); readonly metrics = signal<Metric[]>([{ label: "Revenue", value: "--" }, { label: "Bookings", value: "--" }, { label: "Clients", value: "--" }, { label: "Alerts", value: "--" }]); readonly alerts = signal<WorkItem[]>([]); ngOnInit(){ void this.load(); } async load(){ this.error.set(""); try { const data = await this.workspace.ownerDashboard(); this.metrics.set(data.metrics?.length ? data.metrics : this.metrics()); this.alerts.set(data.alerts || data.work || []); } catch { this.error.set("Owner dashboard could not be loaded."); } } }

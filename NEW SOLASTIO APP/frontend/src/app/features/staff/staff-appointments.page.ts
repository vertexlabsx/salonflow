import { Component, OnInit, inject, signal } from "@angular/core";
import { Metric, WorkItem } from "../../core/api.service";
import { WorkspaceService } from "../../core/workspace.service";

@Component({ standalone: true, template: `
  <section class="content"><section class="hero"><p class="eyebrow">Appointments</p><h1>Every booking, under control.</h1><p>See assigned work, status and next action without visual noise.</p><button class="btn primary" (click)="load()">Refresh</button></section>
  @if (error()) { <p class="notice error">{{ error() }}</p> }
  <section class="grid four">@for (metric of metrics(); track metric.label) { <article class="metric"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong></article> }</section>
  <section class="panel"><div class="panel-head"><h2>Appointment queue</h2><span class="muted">{{ items().length }} shown</span></div><div class="list">@for (item of items(); track item.id) { <article class="list-row"><span><strong>{{ item.title }}</strong><small>{{ item.time || item.subtitle || item.status }}</small></span><button class="btn">Details</button></article> } @empty { <p class="muted">No appointment records loaded.</p> }</div></section></section>` })
export class StaffAppointmentsPage implements OnInit { private readonly workspace = inject(WorkspaceService); readonly error = signal(""); readonly metrics = signal<Metric[]>([{ label: "Today", value: "--" }, { label: "Live", value: "--" }, { label: "Done", value: "--" }, { label: "Issues", value: "--" }]); readonly items = signal<WorkItem[]>([]); ngOnInit(){ void this.load(); } async load(){ this.error.set(""); try { const data = await this.workspace.staffAppointments(); this.metrics.set(data.metrics?.length ? data.metrics : this.metrics()); this.items.set(data.items || []); } catch { this.error.set("Could not load appointments."); } } }

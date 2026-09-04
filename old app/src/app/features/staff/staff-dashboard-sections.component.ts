import { Component, EventEmitter, Input, Output } from "@angular/core";
import { RouterLink } from "@angular/router";
import { DashboardAction, StaffDashboardViewModel } from "./staff-dashboard.model";

@Component({
  selector: "aura-staff-dashboard-sections",
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="today-hero" aria-labelledby="today-heading">
      <div class="today-hero-copy">
        <p class="eyebrow">{{ viewModel.hero.eyebrow }}</p>
        <h1 id="today-heading">{{ viewModel.hero.title }}</h1>
        @if (viewModel.hero.detail) { <p>{{ viewModel.hero.detail }}</p> }
        @if (viewModel.hero.hint) { <small class="hero-hint">{{ viewModel.hero.hint }}</small> }
        @if (viewModel.hero.shiftAssigned) { <span class="shift-line"><b>Shift</b> {{ viewModel.hero.shift }}</span> }
      </div>
      <div class="hero-action-stack" aria-label="Recommended next actions">
        @for (action of viewModel.hero.actions; track action.id) {
          @if (action.route) { <a class="button" [class.primary]="action.primary" [routerLink]="action.route">{{ action.label }}</a> }
           @else { <button type="button" class="link-button" [class.primary-action]="action.primary" [disabled]="!!pendingAction" [attr.aria-busy]="isPending(action)" [attr.aria-pressed]="isPending(action)" (click)="actionSelected.emit(action)">@if (action.kind === 'clock') { <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11H7v-2h4V6h2v7z"></path></svg> }{{ pendingLabel(action) }}</button> }
        }
      </div>
    </section>

    @if (viewModel.quickActions.length) {
      <section class="dashboard-section quick-section" aria-labelledby="quick-actions-heading">
        <div class="section-heading"><div><p class="eyebrow">Start here</p><h2 id="quick-actions-heading">Quick Actions</h2></div></div>
        <div class="quick-action-grid">
          @for (action of viewModel.quickActions; track action.id) {
            @if (action.route) { <a [routerLink]="action.route"><span class="quick-action-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor(action.id)"></path></svg></span><span class="quick-action-copy"><b>{{ action.label }}</b>@if (action.status) { <small>{{ action.status }}</small> }</span></a> }
            @else { <button type="button" [disabled]="!!pendingAction" (click)="actionSelected.emit(action)"><span class="quick-action-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor(action.id)"></path></svg></span><span class="quick-action-copy"><b>{{ pendingLabel(action) }}</b>@if (action.status) { <small>{{ action.status }}</small> }</span></button> }
          }
        </div>
      </section>
    }

    <section class="dashboard-section" aria-labelledby="overview-heading">
      <div class="section-heading"><div><p class="eyebrow">At a glance</p><h2 id="overview-heading">Today’s Overview</h2></div></div>
       <div class="overview-grid" [class.three-metrics]="viewModel.overview.length === 3" [class.single-metric]="viewModel.overview.length === 1">
        @for (metric of viewModel.overview; track metric.label) {
          @if (metric.route) { <a class="overview-card" [routerLink]="metric.route"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.hint }}</small></a> }
          @else { <article class="overview-card"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.hint }}</small></article> }
        }
      </div>
    </section>

    <section class="dashboard-section" aria-labelledby="next-work-heading">
        <div class="section-heading"><div><p class="eyebrow">On the floor</p><h2 id="next-work-heading">{{ viewModel.work.mode === 'active' ? 'Current Service' : 'Next Work' }}</h2></div>@if (viewModel.work.queueRoute; as queueRoute) { <a [routerLink]="queueRoute">Open queue</a> }</div>
      <article class="next-work-card" [class.active-work]="viewModel.work.mode === 'active'" [class.waiting-work]="viewModel.work.mode === 'waiting'" [class.delayed-work]="viewModel.work.tone === 'amber'" [class.empty-work]="viewModel.work.mode === 'empty'">
        <div class="work-time"><span>{{ viewModel.work.eyebrow }}</span><b>{{ viewModel.work.meta }}</b></div>
        <div class="work-main"><h3>{{ viewModel.work.title }}</h3>@if (viewModel.work.detail) { <p>{{ viewModel.work.detail }}</p> }@if (viewModel.work.status) { <span class="work-status">{{ viewModel.work.status }}</span> }
          @if (viewModel.work.progress !== undefined) { <div class="timer-track" aria-label="Service progress"><span [style.width.%]="viewModel.work.progress"></span></div> }
        </div>
        <div class="work-actions">
          @for (action of viewModel.work.actions; track action.id) {
            @if (action.route) { <a class="button" [class.primary]="action.primary" [routerLink]="action.route">{{ action.label }}</a> }
            @else { <button type="button" class="link-button" [class.primary-action]="action.primary" [disabled]="!!pendingAction" (click)="actionSelected.emit(action)">{{ pendingLabel(action) }}</button> }
          }
          @if (viewModel.work.mode === 'empty' && viewModel.work.scheduleRoute; as scheduleRoute) { <a class="text-control" [routerLink]="scheduleRoute">{{ viewModel.work.scheduleActionLabel }}</a> }
        </div>
      </article>
    </section>

    @if (viewModel.alerts.length) {
      <section class="dashboard-section" aria-labelledby="priority-heading">
        <div class="section-heading"><div><p class="eyebrow alert-eyebrow">Needs attention</p><h2 id="priority-heading">Priority feed</h2></div></div>
        <div class="priority-list">
          @for (alert of viewModel.alerts; track alert.id) {
            <a [routerLink]="alert.route" [class.critical]="alert.tone === 'critical'"><i aria-hidden="true"></i><div><strong>{{ alert.title }}</strong><small>{{ alert.detail }}</small></div><b aria-hidden="true">→</b></a>
          }
        </div>
      </section>
    }

    @if (viewModel.performance.length) {
      <section class="dashboard-section performance-section" aria-labelledby="performance-heading">
        <div class="section-heading"><div><p class="eyebrow">Your progress</p><h2 id="performance-heading">Performance summary</h2></div>@if (viewModel.performanceRoute; as performanceRoute) { <a [routerLink]="performanceRoute">View details</a> }</div>
        <div class="performance-grid">
          @for (metric of viewModel.performance; track metric.label) {
            <article [attr.title]="metric.explanation || null" [attr.aria-label]="metric.explanation ? metric.label + ': ' + metric.value + '. ' + metric.explanation : null"><span class="metric-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor(metric.label.toLowerCase())"></path></svg>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.hint }}</small>
              @if (metric.progress !== undefined) { <div class="metric-progress" role="progressbar" [attr.aria-label]="metric.progressLabel || metric.label" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="metric.progress"><i [style.width.%]="metric.progress"></i></div> }
            </article>
          }
        </div>
      </section>
    }

    @if (viewModel.tools.length) {
      <section class="dashboard-section more-tools" aria-labelledby="tools-heading">
        <div class="section-heading"><div><p class="eyebrow">Your tools</p><h2 id="tools-heading">Workspace</h2></div></div>
        <div class="tool-grid">@for (tool of viewModel.tools; track tool.id) { <a [routerLink]="tool.route" [attr.title]="tool.label + ' — ' + tool.hint"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconFor(tool.id)"></path></svg><span><strong>{{ tool.label }}</strong><small>{{ tool.hint }}</small></span></a> }</div>
      </section>
    }
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffDashboardSectionsComponent {
  private readonly icons: Readonly<Record<string, string>> = {
    appointments: "M7 2v2H5a2 2 0 0 0-2 2v15h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 7H5v10h14V9z",
    attendance: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11H7v-2h4V6h2v7z",
    queue: "M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h11v2H4v-2z",
    tasks: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z",
    calendar: "M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v16h18V5a2 2 0 0 0-2-2zm0 16H5V9h14v10z",
    leave: "M12 2C8 6 6 9 6 12a6 6 0 0 0 12 0c0-3-2-6-6-10z",
    chat: "M4 4h16v12H7l-3 3V4zm4 5h8V7H8v2zm0 4h6v-2H8v2z",
    reports: "M5 3h11l3 3v15H5V3zm3 8h8v2H8v-2zm0 4h8v2H8v-2z",
    revenue: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 16.9V17h-2v1.9A8 8 0 0 1 4.1 13H7v-2H4.1A8 8 0 0 1 11 4.1V7h2V4.1A8 8 0 0 1 19.9 11H17v2h2.9A8 8 0 0 1 13 18.9z",
    productivity: "M4 19h16v2H4v-2zm1-3 4-4 3 3 6-7 1.5 1.3-7.4 8.6-3.1-3.1-2.6 2.6L5 16z",
    services: "M5 4h14v3H5V4zm0 6h14v3H5v-3zm0 6h10v3H5v-3z",
    utilization: "M4 19h3V9H4v10zm6 0h3V5h-3v14zm6 0h3V12h-3v7z",
    payroll: "M4 6h16v12H4V6zm2 2v8h12V8H6zm6 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    settings: "M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7 7 0 0 0 7 6L4.6 5l-2 3.5 2 1.5a8 8 0 0 0 0 3l-2 1.5 2 3.5L7 17a7 7 0 0 0 2.6 1.5L10 21h4l.4-2.5A7 7 0 0 0 17 17l2.4 1 2-3.5-2-1.5zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"
  };
  @Input({ required: true }) viewModel!: StaffDashboardViewModel;
  @Input() pendingAction = "";
  @Output() readonly actionSelected = new EventEmitter<DashboardAction>();

  pendingLabel(action: DashboardAction): string {
    return this.pendingAction === action.id || this.pendingAction === action.appointmentId ? "Saving…" : action.label;
  }

  isPending(action: DashboardAction): boolean {
    return this.pendingAction === action.id || this.pendingAction === action.appointmentId;
  }

  iconFor(id: string): string { return this.icons[id] || this.icons["settings"]; }
}

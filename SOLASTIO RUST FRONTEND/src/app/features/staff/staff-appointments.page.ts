import { DatePipe } from "@angular/common";
import { Component, computed, OnInit, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { StaffAppService, StaffAppointment, StaffDashboard } from "../../core/staff-app.service";
import { businessDate } from "../../core/business-date";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

type AppointmentView = "today" | "upcoming" | "live" | "completed" | "cancelled" | "unresolved";

const LIVE_STATUSES = new Set(["booked", "confirmed", "checked-in", "arrived", "in-service", "started"]);
const TERMINAL_STATUSES = new Set(["completed", "checked-out", "cancelled", "no-show"]);
const COMPLETED_STATUSES = new Set(["completed", "checked-out"]);
const CANCELLED_STATUSES = new Set(["cancelled", "no-show"]);
const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const VIEW_DEFS: ReadonlyArray<{ id: AppointmentView; label: string }> = [
  { id: "today", label: "Today" },
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "unresolved", label: "Past unresolved" }
];

function istDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(IST_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
  return [parts["year"], parts["month"], parts["day"]].join("-");
}

@Component({
  standalone: true,
  imports: [PaiseInrPipe, DatePipe, RouterLink, StaffPageStateComponent],
  template: `
    <section class="page appointments-page">
      <header class="page-head"><div><p class="eyebrow">Appointments</p><h1>Service queue</h1><p>Assigned bookings, live work, and follow-ups in one focused staff queue.</p></div></header>
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading appointments...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (dashboard()) {
        <nav class="queue-tabs" aria-label="Appointment queues">
          @for (view of viewDefs; track view.id) {
            <button class="link-button queue-tab" [class.active-toggle]="activeView() === view.id" type="button" [attr.aria-pressed]="activeView() === view.id" (click)="setView(view.id)"><span class="queue-tab-label">{{ view.label }}</span><span class="queue-tab-count">{{ viewCounts()[view.id] }}</span></button>
          }
        </nav>

        <section class="panel" aria-live="polite">
          <div class="panel-title">
            <h2>{{ viewTitle() }}</h2>
            <div class="row-actions">
              <span>{{ visibleAppointments().length }}</span>
              @if (activeView() === 'live') { <a class="button" routerLink="/staff/queue">Open live timers</a> }
            </div>
          </div>
          <div class="list">
            @for (item of visibleAppointments(); track item.id) {
              <details class="appointment-list-item">
                <summary>
                  <div class="appointment-list-copy">
                   <strong>{{ appointmentLead(item) }}</strong>
                    <span>{{ item.serviceNames.join(', ') || 'Service not mapped' }}</span>
                  @if (isValidDate(item.startAt) && isValidDate(item.endAt)) {
                  <small>{{ item.startAt | date:'mediumDate' }} · {{ item.startAt | date:'shortTime' }} - {{ item.endAt | date:'shortTime' }} · {{ item.durationMinutes || 0 }} min</small>
                  } @else {
                    <small>Date unavailable - {{ item.durationMinutes || 0 }} min</small>
                  }
                  </div>
                  <div class="appointment-list-meta"><span [class]="'badge ' + statusTone(item)">{{ item.status }}</span><span class="expand-indicator" aria-hidden="true"></span></div>
                </summary>
                <div class="appointment-list-expanded">
                  <div class="row-actions">
                  @if (canSeeRevenue()) { <span class="badge">{{ item.value | paiseInr }}</span> }
                  <button class="link-button" type="button" (click)="openAppointment(item)">Details</button>
                  </div>
                </div>
              </details>
            } @empty {
              <p class="empty">{{ emptyMessage() }}</p>
            }
          </div>
        </section>
      }

      @if (selectedAppointment(); as item) {
        <button class="detail-backdrop" type="button" (click)="closeDrawers()" aria-label="Close details"></button>
        <aside class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-detail-title" tabindex="-1">
          <div class="panel-title"><h2 id="appointment-detail-title">Appointment detail</h2><button class="link-button" type="button" (click)="closeDrawers()">Close</button></div>
           <section class="grid two compact-grid"><article class="kpi"><span>Work item</span><strong>{{ appointmentLead(item) }}</strong></article><article class="kpi"><span>Status</span><strong>{{ item.status }}</strong></article></section>
          <div class="list"><div class="row"><strong>Time</strong><span>{{ item.startAt | date:'short' }} - {{ item.endAt | date:'shortTime' }}</span></div><div class="row"><strong>Services</strong><span>{{ item.serviceNames.join(', ') || '-' }}</span></div><div class="row"><strong>Duration</strong><span>{{ item.durationMinutes || 0 }} min</span></div><div class="row"><strong>Chair</strong><span>{{ item.chair || '-' }}</span></div><div class="row"><strong>Source</strong><span>{{ item.source || '-' }}</span></div>@if (canSeeRevenue()) { <div class="row"><strong>Value</strong><span>{{ item.value | paiseInr }}</span></div> }</div>
        </aside>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .appointment-list-item { border-top: 1px solid var(--staff-border); }
    .appointment-list-item:first-child { border-top: 0; }
    .appointment-list-item > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 62px; padding: 8px 0; list-style: none; cursor: pointer; }
    .appointment-list-item > summary::-webkit-details-marker { display: none; }
    .appointment-list-copy { min-width: 0; display: grid; gap: 2px; }
    .appointment-list-copy strong, .appointment-list-copy span, .appointment-list-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .appointment-list-copy strong { color: var(--staff-text); font-size: .86rem; }
    .appointment-list-copy span { color: var(--staff-text-secondary); font-size: .75rem; font-weight: 650; }
    .appointment-list-copy small { color: var(--staff-text-secondary); font-size: .68rem; font-weight: 600; }
    .appointment-list-meta { display: flex; align-items: center; gap: 6px; }
    .appointment-list-meta .badge { max-width: 78px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .appointment-list-item[open] .expand-indicator::after { transform: none; }
    .appointment-list-expanded { padding: 8px 0 12px; border-top: 1px solid var(--staff-border); }
.appointment-list-expanded .row-actions { justify-content: flex-start; }
    .queue-tab { flex-direction: column; gap: 0; min-height: 52px; padding: 6px 14px; line-height: 1.15; }
    .queue-tab-count { display: grid; place-items: center; min-width: 22px; border-radius: 999px; padding: 1px 7px; background: var(--staff-surface-secondary); color: var(--staff-text-secondary); font-size: .7rem; font-weight: 850; }
.queue-tab.active-toggle .queue-tab-count { background: var(--staff-primary); color: var(--staff-on-primary); }
    @media (max-width: 900px) {
      .detail-drawer { top: var(--staff-header-height); padding-bottom: calc(20px + env(safe-area-inset-bottom)); }
    }
  `]
})
export class StaffAppointmentsPage implements OnInit {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly activeView = signal<AppointmentView>("today");
  readonly viewDefs = VIEW_DEFS;
  readonly viewCounts = computed<Record<AppointmentView, number>>(() => {
    const rows = this.dashboard()?.appointments || [];
    const today = businessDate();
    const terminal = (item: StaffAppointment) => TERMINAL_STATUSES.has(this.statusOf(item));
    return {
      today: rows.filter((item) => istDateKey(item.startAt) === today).length,
      live: rows.filter((item) => istDateKey(item.startAt) === today && LIVE_STATUSES.has(this.statusOf(item))).length,
      upcoming: rows.filter((item) => istDateKey(item.startAt) > today && !terminal(item)).length,
      completed: rows.filter((item) => this.isCompleted(item)).length,
      cancelled: rows.filter((item) => CANCELLED_STATUSES.has(this.statusOf(item))).length,
      unresolved: rows.filter((item) => { const date = istDateKey(item.startAt); return Boolean(date) && date < today && !terminal(item); }).length
    };
  });
  readonly visibleAppointments = computed(() => {
    const today = businessDate();
    const view = this.activeView();
    const rows = (this.dashboard()?.appointments || []).filter((item) => {
      const date = istDateKey(item.startAt);
      const status = this.statusOf(item);
      switch (view) {
        case "today": return date === today;
        case "upcoming": return date > today && !TERMINAL_STATUSES.has(status);
        case "live": return date === today && LIVE_STATUSES.has(status);
        case "completed": return this.isCompleted(item);
        case "cancelled": return CANCELLED_STATUSES.has(status);
        case "unresolved": return Boolean(date) && date < today && !TERMINAL_STATUSES.has(status);
      }
    });
    const ascending = view === "today" || view === "live" || view === "upcoming";
    return rows.sort((left, right) => this.compareStartTimes(left, right, ascending));
  });
  readonly loading = signal(false);
  readonly selectedAppointment = signal<StaffAppointment | null>(null);
  private loadGeneration = 0;

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { void this.load(); }

  setView(view: AppointmentView) { this.activeView.set(view); }

  viewTitle(): string {
    return ({ today: "Today's Queue", upcoming: "Upcoming appointments", live: "Live appointments", completed: "Completed appointments", cancelled: "Cancelled appointments", unresolved: "Past unresolved appointments" } as const)[this.activeView()];
  }

  emptyMessage(): string {
    return ({ today: "No appointments in today's queue.", upcoming: "No upcoming appointments assigned to you.", live: "No live appointments right now.", completed: "No completed appointments in the loaded range.", cancelled: "No cancelled appointments in the loaded range.", unresolved: "No past appointments are awaiting a terminal status." } as const)[this.activeView()];
  }

  isValidDate(value: string): boolean { return !Number.isNaN(new Date(value).getTime()); }

  async load() {
    const generation = ++this.loadGeneration;
    const cached = this.staff.readStoredData<StaffDashboard>("dashboard");
    if (cached) {
      this.dashboard.set(cached);
      this.loading.set(false);
    } else {
      this.loading.set(true);
    }
    try {
      const dashboard = await this.staff.dashboard();
      if (generation === this.loadGeneration) this.dashboard.set(dashboard);
    } catch (error) {
      if (!cached) throw error;
    } finally {
      if (generation === this.loadGeneration) this.loading.set(false);
    }
  }

  canSeeRevenue(): boolean { return this.staff.hasAnyPermission(["read:finance", "read:sales", "read:payments", "read:invoices"]); }
  openAppointment(item: StaffAppointment) { this.selectedAppointment.set(item); }
  closeDrawers() { this.selectedAppointment.set(null); }
  appointmentLead(item: StaffAppointment): string { return item.serviceNames.filter(Boolean)[0] || "Assigned appointment"; }
  statusTone(item: StaffAppointment): string {
    const status = this.statusOf(item);
    if (LIVE_STATUSES.has(status)) return "badge-live";
    if (COMPLETED_STATUSES.has(status)) return "green";
    if (CANCELLED_STATUSES.has(status)) return "red";
    return "";
  }

  private statusOf(item: StaffAppointment): string { return String(item.status || "").toLowerCase(); }
  private isCompleted(item: StaffAppointment): boolean {
    const status = this.statusOf(item);
    return COMPLETED_STATUSES.has(status);
  }
  private compareStartTimes(left: StaffAppointment, right: StaffAppointment, ascending: boolean): number {
    const leftTime = new Date(left.startAt).getTime();
    const rightTime = new Date(right.startAt).getTime();
    if (Number.isNaN(leftTime)) return Number.isNaN(rightTime) ? 0 : 1;
    if (Number.isNaN(rightTime)) return -1;
    return ascending ? leftTime - rightTime : rightTime - leftTime;
  }
}

import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, StaffPageStateComponent],
template: `
    <section class="page queue-page">
      <header class="page-head"><div><p class="eyebrow">Today's queue</p><h1>Live queue</h1><p>Timeline and service timers for today.</p></div></header>
      @if (!canReadQueue()) { <section staffPageState class="notice">You do not have permission to read queue data.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading queue...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (canReadQueue() && os(); as data) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Appointment timeline</h2><span>{{ data.timeline.length }} today</span></div>
            <div class="list">
              @for (item of data.timeline; track item.id) {
                <div class="row">
                  <div class="queue-row-time">{{ item.startAt | date:'shortTime' }}</div>
                  <div class="row-main"><strong>{{ item.serviceNames.join(', ') || 'Assigned appointment' }}</strong><small>{{ item.state }} · {{ item.durationMinutes || 0 }} min</small></div>
                  <span class="badge" [class.red]="item.state === 'late'" [class.badge-live]="item.state === 'active'">{{ item.status }}</span>
                </div>
              } @empty { <p class="empty">No queue items for today.</p> }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Service timers</h2><span>{{ runningTimerCount() }} running</span></div>
            <div class="list">
              @for (timer of data.serviceTimers; track timer.appointmentId) {
                <div class="row">
                  <div class="row-main">
                    <strong>{{ timerLabel(timer.status) }}</strong>
                    <small>{{ formatMinutes(timer.remainingMinutes) }} remaining · {{ timer.elapsedMinutes }} of {{ timer.totalMinutes }} min</small>
                    <div class="timer-track" [class.nearing]="isNearing(timer)"><span [style.width.%]="timer.progress"></span></div>
                  </div>
                  <span class="badge" [class.red]="isNearing(timer)">{{ timer.progress }}%</span>
                </div>
              } @empty { <p class="empty">No service timers available.</p> }
            </div>
          </article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    :host { display: block; }
    .queue-row-time { min-width: 62px; color: var(--staff-text-secondary); font-size: .76rem; font-weight: 800; letter-spacing: -.01em; }
    @media (max-width: 700px) { .queue-page { padding-inline: 12px; gap: 10px; } }
  `]
})
export class StaffQueuePage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly loading = signal(false);
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { if (this.canReadQueue()) void this.load(); }
  async load() {
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

  canReadQueue(): boolean {
    return this.staff.hasAnyPermission(["read:appointments", "read:staff"]);
  }

  formatMinutes(minutes: number): string { const safe = Math.max(0, Number(minutes || 0)); return `${Math.floor(safe / 60)}h ${safe % 60}m`; }
  timerLabel(status: string): string {
    return (status || "active service").split("_").join(" ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  runningTimerCount(): number { return this.os()?.serviceTimers?.filter((timer) => timer.remainingMinutes > 0).length || 0; }
  isNearing(timer: { remainingMinutes: number }): boolean { return timer.remainingMinutes > 0 && timer.remainingMinutes <= 15; }
}

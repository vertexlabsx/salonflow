import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Today's queue</p><h1>Live queue</h1><p>Timeline and service timers for today.</p></div></header>
      @if (!canReadQueue()) { <section staffPageState class="notice">You do not have permission to read queue data.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading queue...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (canReadQueue() && os(); as data) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Appointment timeline</h2><span>{{ data.timeline.length }}</span></div>
            <div class="list">
              @for (item of data.timeline; track item.id) {
                <div class="row"><div class="row-main"><strong>{{ item.startAt | date:'shortTime' }} · Assigned appointment</strong><small>{{ item.serviceNames.join(', ') || 'Service' }} · {{ item.state }}</small></div><span class="badge" [class.red]="item.state === 'late'" [class.green]="item.state === 'active'">{{ item.status }}</span></div>
              } @empty { <p class="empty">No queue items for today.</p> }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Service timers</h2><span>auto</span></div>
            <div class="list">
              @for (timer of data.serviceTimers; track timer.appointmentId) {
                <div class="row">
                  <div class="row-main">
                    <strong>Active service</strong>
                    <small>{{ formatMinutes(timer.remainingMinutes) }} remaining · {{ timer.status }}</small>
                    <div class="timer-track"><span [style.width.%]="timer.progress"></span></div>
                  </div>
                  <span class="badge">{{ timer.progress }}%</span>
                </div>
              } @empty { <p class="empty">No service timers available.</p> }
            </div>
          </article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
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
}

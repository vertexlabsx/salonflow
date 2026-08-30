import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, StaffPageStateComponent],
  template: `
    <section class="page notifications-page">
      <header class="page-head"><div><p class="eyebrow">Notifications</p><h1>Notifications</h1><p>Staff alerts and connected system notices.</p></div></header>
      @if (!canReadNotifications()) { <section staffPageState class="notice">You do not have permission to view notifications.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading notifications...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (message()) { <section staffPageState class="notice" [class.success]="!messageError()">{{ message() }}</section> }
      @if (canReadNotifications() && os(); as data) {
        <section class="panel">
          <div class="panel-title"><h2>Inbox</h2><span>{{ data.notifications.length }}</span></div>
          @if (!canUpdateNotifications()) { <p class="muted">Notifications are read-only for your role.</p> }
          <div class="list">
            @for (note of data.notifications; track note.id) {
              <div class="row"><div class="row-main"><strong>{{ note.title }}</strong><small>{{ note.body || 'No details' }} · {{ note.createdAt ? (note.createdAt | date:'short') : '' }}</small></div><div class="row-actions"><span class="badge">{{ note.status }}</span><button class="link-button" type="button" [disabled]="!canUpdateNotifications()" (click)="mark(note.id, note.status === 'read' ? 'unread' : 'read')">{{ note.status === 'read' ? 'Unread' : 'Read' }}</button><button class="link-button" type="button" [disabled]="!canUpdateNotifications()" (click)="mark(note.id, 'archived')">Archive</button></div></div>
            } @empty { <p class="empty">No staff notifications yet.</p> }
          </div>
        </section>
      }
    </section>`,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffNotificationsPage implements OnInit {
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly loading = signal(false);
  readonly message = signal("");
  readonly messageError = signal(false);

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadNotifications()) void this.load(); }

  async load() {
    if (!this.canReadNotifications()) {
      this.os.set(null);
      return;
    }
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

  async mark(id: string, status: "read" | "unread" | "archived") {
    this.message.set("");
    this.messageError.set(false);
    if (!this.canUpdateNotifications()) {
      this.message.set("You do not have permission to update notifications.");
      this.messageError.set(true);
      return;
    }
    try {
      await this.staff.updateNotification(id, status);
      this.message.set(`Notification marked ${status}.`);
      await this.load();
    } catch {
      this.message.set(this.staff.error() || "Notification could not be updated.");
      this.messageError.set(true);
    }
  }

  canReadNotifications(): boolean {
    return Boolean(this.staff.user()?.staffId) || this.staff.hasPermission("read:appointments");
  }

  canUpdateNotifications(): boolean {
    return Boolean(this.staff.user()?.staffId) || this.staff.hasPermission("update:notifications");
  }
}

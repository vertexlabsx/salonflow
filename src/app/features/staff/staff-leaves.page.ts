import { DatePipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffLeave, StaffLeaveBalance } from "../../core/staff-app.service";
import { businessDate } from "../../core/business-date";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page leaves-page">
      <header class="page-head"><div><p class="eyebrow">Leaves</p><h1>Leave management</h1><p>Balances, history and request form.</p></div></header>
      @if (!canReadLeaves()) { <section staffPageState class="notice">You do not have permission to view leave data.</section> }
      @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (canReadLeaves()) {
        <section class="grid two">
          <article class="panel"><div class="panel-title"><h2>Leave balance</h2><span>{{ balances().length }}</span></div><div class="list">@for (balance of balances(); track balance.id) { <div class="row"><strong>{{ balance.leaveType }}</strong><span>{{ leaveBalanceValue(balance) }} left</span></div> } @empty { <p class="empty">No leave balances configured.</p> }</div></article>
          <article class="panel"><div class="panel-title"><h2>Leave history</h2><span>{{ leaves().length }}</span></div><div class="list">@for (leave of leaves(); track leave.id) { <div class="row"><div class="row-main"><strong>{{ leave.leaveType }} · {{ leave.days || 1 }}d</strong><small>{{ leave.startDate | date:'mediumDate' }} - {{ leave.endDate | date:'mediumDate' }}</small></div><span class="badge">{{ leave.status }}</span></div> } @empty { <p class="empty">No leave requests yet.</p> }</div></article>
        </section>
        <section class="panel">
          <div class="panel-title"><h2>Request leave</h2><span>{{ canRequestLeave() ? 'enabled' : 'view only' }}</span></div>
          @if (!canRequestLeave()) { <p class="muted">You can view leave data, but your role cannot submit leave requests.</p> }
          <div class="form-grid"><label>Type<input [(ngModel)]="leaveType" name="leaveType" placeholder="casual" required maxlength="50" /></label><label>From<input [(ngModel)]="leaveStart" name="leaveStart" type="date" required /></label><label>To<input [(ngModel)]="leaveEnd" name="leaveEnd" type="date" required /></label><label>Reason<textarea [(ngModel)]="leaveReason" name="leaveReason" placeholder="Reason" maxlength="500" rows="3"></textarea></label></div>
          <button class="link-button" type="button" [disabled]="!canRequestLeave() || submitting()" (click)="requestLeave()">{{ submitting() ? 'Sending...' : 'Send request' }}</button>
        </section>
      }
    </section>`,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffLeavesPage implements OnInit {
  readonly leaves = signal<StaffLeave[]>(this.staff.readStoredData<StaffLeave[]>("leaves") || []);
  readonly balances = signal<StaffLeaveBalance[]>(this.staff.readStoredData<StaffLeaveBalance[]>("leave-balances") || []);
  readonly submitting = signal(false);
  readonly message = signal("");
  leaveType = "casual";
  leaveStart = businessDate();
  leaveEnd = businessDate();
  leaveReason = "";

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadLeaves()) void this.load(); }

  async load(fresh = false) {
    if (!this.canReadLeaves()) return;
    try {
      const [leaves, balances] = await Promise.all([this.staff.leaves(), this.staff.leaveBalances(fresh)]);
      this.leaves.set(leaves);
      this.balances.set(balances);
      this.staff.writeStoredData("leaves", leaves);
      this.staff.writeStoredData("leave-balances", balances);
    } catch {
      // Backend error handled by StaffAppService
    }
  }

  leaveBalanceValue(balance: StaffLeaveBalance): number {
    return Number(balance.balance ?? (Number(balance.openingBalance || 0) + Number(balance.accrued || 0) - Number(balance.used || 0)));
  }

  async requestLeave() {
    if (this.submitting()) return;
    this.message.set("");
    if (!this.canRequestLeave()) {
      this.message.set("You do not have permission to request leave.");
      return;
    }
    if (!this.leaveType.trim() || !this.leaveStart || !this.leaveEnd) {
      this.message.set("Leave type and dates are required.");
      return;
    }
    if (this.leaveEnd < this.leaveStart) {
      this.message.set("Leave end date cannot be before start date.");
      return;
    }
    this.submitting.set(true);
    try {
      const result = await this.staff.requestLeave({ leaveType: this.leaveType.trim(), startDate: this.leaveStart, endDate: this.leaveEnd, reason: this.leaveReason.trim() }) as { queued?: boolean; duplicate?: boolean };
      this.leaveReason = "";
      if (result?.queued) {
        this.message.set("You are offline. Leave request queued and will send after reconnecting.");
        return;
      }
      this.message.set(result?.duplicate ? "This leave request is already pending." : "Leave request sent.");
      await this.load(true);
    } catch {
      // StaffAppService exposes the API error through staff.error().
    } finally {
      this.submitting.set(false);
    }
  }

  canReadLeaves(): boolean {
    return Boolean(this.staff.user()?.staffId) || this.staff.hasPermission("read:staff");
  }

  canRequestLeave(): boolean {
    return Boolean(this.staff.user()?.staffId) || this.staff.hasAnyPermission(["write:staff", "update:staff"]);
  }
}

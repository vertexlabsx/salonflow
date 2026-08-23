import { Component, OnDestroy, OnInit, signal } from "@angular/core";
import { StaffAppService, StaffEnterpriseOs, StaffShiftSwap, StaffShiftSwapCoworker, StaffToday } from "../../core/staff-app.service";
import { addBusinessDays, businessDate } from "../../core/business-date";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Roster</p>
          <h1>Roster</h1>
          <p>Shift and calendar assignments.</p>
        </div>
        <div class="row-actions">
          <input aria-label="Roster window start date" [value]="windowStart()" type="date" (click)="openDatePicker($event)" (change)="updateWindowStart($any($event.target).value)" />
          <button class="button" type="button" (click)="setWindow(7)">Next 7 days</button>
          <button class="button" type="button" (click)="setWindow(14)">Next 14 days</button>
          <button class="button" type="button" (click)="setWindow(30)">Next 30 days</button>
        </div>
      </header>

      @if (!canReadRoster() && !canUseShiftSwaps()) { <section staffPageState class="notice">You do not have permission to read roster or shift swap data.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading roster...</section> }
      @if (message()) { <section staffPageState class="notice success">{{ message() }}</section> }
      @if (errorMessage()) { <section staffPageState class="notice">{{ errorMessage() }}</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (canReadRoster() && today(); as data) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Today shift</h2><span>{{ data.schedules.length }}</span></div>
            <div class="list">
              @for (shift of data.schedules; track shift.id) {
                <div class="row">
                  <div class="row-main">
                    <strong>{{ shift.startTime || '-' }} - {{ shift.endTime || '-' }}</strong>
                    <small>{{ shift.scheduleDate }}</small>
                  </div>
                  <span class="badge">{{ shift.shiftType || shift.status }}</span>
                </div>
              } @empty { <p class="empty">No rostered shift found today.</p> }
            </div>
          </article>
          <article class="panel">
            <div class="panel-title"><h2>Upcoming roster</h2><span>{{ upcomingSchedules().length }}</span></div>
            <div class="list">
              @for (item of upcomingSchedules(); track item.id) {
                <div class="row">
                  <div class="row-main">
                    <strong>{{ item.date }}</strong>
                    <small>{{ item.startTime || '-' }} - {{ item.endTime || '-' }}</small>
                    <small class="muted">{{ item.type || 'roster' }}</small>
                    @if (hasConflict(item)) { <small class="badge red">Overlap warning</small> }
                  </div>
                  <div class="row-actions">
                    <span class="badge">{{ item.status }}</span>
                    @if (canUpdateRoster()) {
                      @if (editingId() !== item.id) {
                        <button class="link-button" type="button" (click)="startMove(item)">Move</button>
                        <button class="link-button" type="button" (click)="changeStatus(item, item.status === 'cancelled' ? 'scheduled' : 'cancelled')">{{ item.status === 'cancelled' ? 'Reinstate' : 'Cancel' }}</button>
                      }
                    }
                    @if (canUseShiftSwaps() && item.status !== 'cancelled' && !activeSwapFor(item.id)) { <button class="link-button" type="button" (click)="openSwap(item.id)">Request swap</button> }
                  </div>
                </div>
                @if (editingId() === item.id) {
                  <div class="form-grid compact-grid">
                    <label>Date<input [value]="moveDate()" type="date" (click)="openDatePicker($event)" (change)="moveDate.set($any($event.target).value)" /></label>
                    <label>Start<input [value]="moveStart()" type="time" (change)="moveStart.set($any($event.target).value)" /></label>
                    <label>End<input [value]="moveEnd()" type="time" (change)="moveEnd.set($any($event.target).value)" /></label>
                    <div class="row-actions">
                      <button class="button" type="button" (click)="saveMove(item)">Save</button>
                      <button class="button" type="button" (click)="cancelMove()">Close</button>
                    </div>
                  </div>
                }
                @if (swapScheduleId() === item.id) {
                  <div class="form-grid compact-grid">
                    <label>Coworker<select [value]="swapToStaffId()" (change)="swapToStaffId.set($any($event.target).value)"><option value="">Choose coworker</option>@for (person of coworkers(); track person.id) { <option [value]="person.id">{{ person.name }}{{ person.designation ? ' · ' + person.designation : '' }}</option> }</select></label>
                    <label class="wide">Reason<textarea maxlength="300" [value]="swapReason()" (input)="swapReason.set($any($event.target).value)" placeholder="Why do you need this swap?"></textarea></label>
                    <div class="row-actions"><button class="button" type="button" [disabled]="swapBusy() || !swapToStaffId()" (click)="submitSwap()">Send request</button><button class="button" type="button" [disabled]="swapBusy()" (click)="closeSwap()">Close</button></div>
                  </div>
                }
              } @empty { <p class="empty">No upcoming roster entries.</p> }
            </div>
          </article>
        </section>
      }
      @if (canUseShiftSwaps()) {
        <section class="grid two">
          <article class="panel"><div class="panel-title"><h2>Needs your response</h2><span>{{ incomingSwaps().length }}</span></div><div class="list">@for (swap of incomingSwaps(); track swap.id) { <div class="row"><div class="row-main"><strong>{{ swap.scheduleDate }} · {{ swap.startTime }} - {{ swap.endTime }}</strong><small>{{ swap.fromStaffName || 'Coworker' }}: {{ swap.reason || 'No reason added' }}</small></div><div class="row-actions"><button class="button" type="button" [disabled]="swapBusy()" (click)="respondSwap(swap, 'accept')">Accept</button><button class="button" type="button" [disabled]="swapBusy()" (click)="respondSwap(swap, 'decline')">Decline</button></div></div> } @empty { <p class="empty">No swap request needs your response.</p> }</div></article>
          <article class="panel"><div class="panel-title"><h2>Swap requests</h2><span>{{ swaps().length }}</span></div><div class="list">@for (swap of swaps(); track swap.id) { <div class="row"><div class="row-main"><strong>{{ swap.scheduleDate }} · {{ swap.startTime }} - {{ swap.endTime }}</strong><small>{{ swap.fromStaffName }} → {{ swap.toStaffName }}</small><small>{{ swapStatusLabel(swap.status) }}</small></div><div class="row-actions"><span class="badge">{{ swapStatusLabel(swap.status) }}</span>@if (swap.fromStaffId === staff.user()?.staffId && (swap.status === 'pending_staff' || swap.status === 'pending_manager')) { <button class="link-button" type="button" [disabled]="swapBusy()" (click)="cancelSwap(swap)">Cancel</button> }</div></div> } @empty { <p class="empty">No shift swap requests yet.</p> }</div></article>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffRosterPage implements OnInit, OnDestroy {
  readonly today = signal<StaffToday | null>(null);
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly coworkers = signal<StaffShiftSwapCoworker[]>([]);
  readonly swaps = signal<StaffShiftSwap[]>([]);
  readonly loading = signal(false);
  readonly message = signal("");
  readonly errorMessage = signal("");
  readonly windowStart = signal(businessDate());
  readonly windowDays = signal(14);
  readonly editingId = signal<string | null>(null);
  readonly moveDate = signal(this.windowStart());
  readonly moveStart = signal("09:00");
  readonly moveEnd = signal("18:00");
  readonly swapScheduleId = signal<string | null>(null);
  readonly swapToStaffId = signal("");
  readonly swapReason = signal("");
  readonly swapBusy = signal(false);
  private loadGeneration = 0;
  private readonly onRefresh = () => void this.load();

  constructor(readonly staff: StaffAppService) {}

  openDatePicker(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }

  ngOnInit() {
    window.addEventListener("aura:refresh-child", this.onRefresh);
    if (this.canReadRoster() || this.canUseShiftSwaps()) void this.load();
  }

  ngOnDestroy() {
    this.loadGeneration++;
    window.removeEventListener("aura:refresh-child", this.onRefresh);
  }

  async load() {
    const generation = ++this.loadGeneration;
    const cachedToday = this.staff.readStoredData<StaffToday>("today");
    if (cachedToday) {
      this.today.set(cachedToday);
      this.loading.set(false);
    } else {
      this.loading.set(true);
    }
    this.message.set("");
    this.errorMessage.set("");
    const from = this.windowStart();
    const to = this.windowEnd();
    const base = this.canReadRoster() ? await Promise.allSettled([this.staff.today(this.windowStart()), this.staff.enterpriseOs({ from, to })]) : [];
    if (generation !== this.loadGeneration) return;
    if (base[0]?.status === "fulfilled") this.today.set(base[0].value);
    if (base[1]?.status === "fulfilled") this.os.set(base[1].value);
    const baseFailed = base.some((result) => result.status === "rejected");
    const swapData = this.canUseShiftSwaps() ? await Promise.allSettled([this.staff.shiftSwapCoworkers(), this.staff.shiftSwaps()]) : [];
    if (generation !== this.loadGeneration) return;
    if (swapData[0]?.status === "fulfilled") this.coworkers.set(swapData[0].value);
    if (swapData[1]?.status === "fulfilled") this.swaps.set(swapData[1].value);
    const swapsFailed = swapData.some((result) => result.status === "rejected");
    if (baseFailed && swapsFailed) this.errorMessage.set("Roster and shift swap data are temporarily unavailable.");
    else if (baseFailed) this.errorMessage.set("Roster data is temporarily unavailable. Shift swap requests remain available.");
    else if (swapsFailed) this.errorMessage.set("Roster loaded, but shift swap data is temporarily unavailable.");
    this.loading.set(false);
  }

  canReadRoster(): boolean {
    return this.staff.hasPermission("read:appointments");
  }

  canUpdateRoster(): boolean {
    return this.staff.hasPermission("update:appointments");
  }

  canUseShiftSwaps(): boolean { return Boolean(this.staff.user()?.staffId) || this.staff.hasPermission("read:staff"); }

  upcomingSchedules() {
    const from = this.windowStart();
    const to = this.windowEnd();
    return (this.os()?.calendar || [])
      .filter((item) => item.date >= from && item.date <= to)
      .sort((left, right) => `${left.date} ${left.startTime || "00:00"}`.localeCompare(`${right.date} ${right.startTime || "00:00"}`));
  }

  windowEnd(): string {
    return this.addDays(this.windowStart(), this.windowDays() - 1);
  }

  setWindow(days: number) {
    this.windowDays.set(days);
    void this.load();
  }

  updateWindowStart(value: string) {
    this.windowStart.set(value || this.windowStart());
    void this.load();
  }

  startMove(item: { id: string; date: string; startTime: string; endTime: string }) {
    if (!this.canUpdateRoster()) return;
    this.editingId.set(item.id);
    this.moveDate.set(item.date || this.windowStart());
    this.moveStart.set(item.startTime || "09:00");
    this.moveEnd.set(item.endTime || "18:00");
  }

  cancelMove() {
    this.editingId.set(null);
  }

  openSwap(scheduleId: string) {
    this.swapScheduleId.set(scheduleId);
    this.swapToStaffId.set("");
    this.swapReason.set("");
  }

  closeSwap() { this.swapScheduleId.set(null); }

  activeSwapFor(scheduleId: string): StaffShiftSwap | undefined {
    return this.swaps().find((swap) => swap.scheduleId === scheduleId && ["pending_staff", "pending_manager"].includes(swap.status));
  }

  incomingSwaps(): StaffShiftSwap[] {
    const staffId = this.staff.user()?.staffId;
    return this.swaps().filter((swap) => swap.toStaffId === staffId && swap.status === "pending_staff");
  }

  async submitSwap() {
    const scheduleId = this.swapScheduleId();
    const toStaffId = this.swapToStaffId();
    if (!scheduleId || !toStaffId || this.swapBusy()) return;
    this.swapBusy.set(true); this.message.set(""); this.errorMessage.set("");
    try {
      await this.staff.requestShiftSwap({ scheduleId, toStaffId, reason: this.swapReason() });
      this.message.set("Swap request sent to your coworker.");
      this.closeSwap();
      await this.load();
    } catch { this.errorMessage.set(this.staff.error() || "Unable to request this shift swap."); }
    finally { this.swapBusy.set(false); }
  }

  async respondSwap(swap: StaffShiftSwap, decision: "accept" | "decline") {
    if (this.swapBusy()) return;
    this.swapBusy.set(true); this.message.set(""); this.errorMessage.set("");
    try {
      await this.staff.respondShiftSwap(swap.id, decision, swap.version);
      this.message.set(decision === "accept" ? "Swap accepted and sent to the owner." : "Swap declined.");
      await this.load();
    } catch { this.errorMessage.set(this.staff.error() || "Unable to respond to the swap request."); }
    finally { this.swapBusy.set(false); }
  }

  async cancelSwap(swap: StaffShiftSwap) {
    if (this.swapBusy()) return;
    this.swapBusy.set(true); this.message.set(""); this.errorMessage.set("");
    try { await this.staff.cancelShiftSwap(swap.id, swap.version); this.message.set("Swap request cancelled."); await this.load(); }
    catch { this.errorMessage.set(this.staff.error() || "Unable to cancel the swap request."); }
    finally { this.swapBusy.set(false); }
  }

  swapStatusLabel(status: string): string {
    return ({ pending_staff: "Waiting for coworker", pending_manager: "Waiting for owner", approved: "Approved", rejected: "Rejected", declined: "Declined", cancelled: "Cancelled" } as Record<string, string>)[status] || status.replaceAll("_", " ");
  }

  async saveMove(item: { id: string; version?: number }) {
    if (!this.canUpdateRoster()) return;
    this.message.set("");
    this.errorMessage.set("");
    const date = this.moveDate() || this.windowStart();
    const startTime = this.moveStart() || "09:00";
    const endTime = this.moveEnd() || "18:00";
    if (endTime <= startTime) {
      this.errorMessage.set("End time must be after start time.");
      return;
    }
    try {
      await this.staff.updateSchedule(item.id, {
        version: Number(item.version || 1),
        scheduleDate: date,
        startTime,
        endTime
      });
      this.message.set("Shift rescheduled.");
      this.editingId.set(null);
      await this.load();
    } catch {
      this.errorMessage.set(this.staff.error() || "Unable to update shift due to overlap or conflict.");
    }
  }

  async changeStatus(item: { id: string; version?: number; status: string }, status: string) {
    if (!this.canUpdateRoster()) return;
    this.message.set("");
    this.errorMessage.set("");
    try {
      await this.staff.updateSchedule(item.id, { version: Number(item.version || 1), status });
      this.message.set(`Shift ${status}`);
      await this.load();
    } catch {
      this.errorMessage.set(this.staff.error() || "Unable to update shift status.");
    }
  }

  hasConflict(item: { date: string; startTime: string; endTime: string; id: string }) {
    const items = this.upcomingSchedules();
    if (!item.date || !item.startTime || !item.endTime) return false;
    for (const other of items) {
      if (other.id === item.id || other.date !== item.date) continue;
      if (!other.startTime || !other.endTime) continue;
      if (item.startTime < other.endTime && item.endTime > other.startTime) return true;
    }
    return false;
  }

  private addDays(value: string, days = 0): string {
    return addBusinessDays(value, days);
  }
}

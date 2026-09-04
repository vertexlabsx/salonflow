import { Component, HostListener, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { Router } from "@angular/router";
import { isQueuedMutation, MutationResult, StaffAttendance, StaffAppService, StaffDashboard, StaffEnterpriseOs, StaffLeaveBalance, StaffOvertimeSummary, StaffToday, StaffWorkspacePreferences } from "../../core/staff-app.service";
import { DashboardAction, buildStaffDashboardViewModel, shouldShowDashboardRecommendation } from "./staff-dashboard.model";
import { StaffDashboardSectionsComponent } from "./staff-dashboard-sections.component";
import { StaffPageStateComponent } from "./staff-page-state.component";

type DashboardModule = "enterprise" | "today" | "overtime" | "leave" | "preferences";

@Component({
  standalone: true,
  imports: [StaffDashboardSectionsComponent, StaffPageStateComponent],
  template: `
    <section class="page dashboard-page" [attr.aria-busy]="initialLoading()">
      @if (blockingError()) {
        <section class="dashboard-blocking-state" role="alert">
          <span class="state-mark" aria-hidden="true">!</span>
          <p class="eyebrow">Staff workspace unavailable</p>
          <h1>We could not open your staff record.</h1>
          <p>{{ blockingError() }}</p>
          <div class="row-actions">
            <button type="button" class="link-button primary-action" [disabled]="refreshing()" (click)="load(true)">{{ refreshing() ? 'Retrying…' : 'Retry' }}</button>
            <button type="button" class="button" (click)="signOut()">Sign out</button>
          </div>
          <small>If retry does not work, ask your salon manager to confirm that this login is linked to an active staff profile.</small>
        </section>
      } @else if (initialLoading()) {
        <section class="dashboard-skeleton" aria-label="Loading dashboard">
          <div class="skeleton hero-skeleton"></div><div class="skeleton action-skeleton"></div><div class="skeleton-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><span class="sr-only">Loading your staff dashboard</span>
        </section>
      } @else if (viewModel(); as vm) {
        @if (!online()) { <section class="sync-banner offline" role="status"><b>Offline</b><span>Live data may be out of date. Supported changes will sync when you reconnect.</span></section> }
        @if (queuedActions() > 0) { <section class="sync-banner" role="status"><b>{{ queuedActions() }} pending</b><span>Staff action{{ queuedActions() === 1 ? '' : 's' }} waiting to sync.</span></section> }

        @if (showTip()) {
          <aside class="context-notice" aria-label="Recommended action"><span class="recommendation-mark" aria-hidden="true">✓</span><b>{{ recommendationText() }}</b><button type="button" (click)="dismissTip()" aria-label="Dismiss recommendation">×</button></aside>
        }

        @if (actionMessage()) { <section staffPageState class="notice" [class.success]="!actionFailed()" role="status">{{ actionMessage() }}</section> }
        @if (refreshWarning()) {
          <section class="optional-warning" role="status"><span aria-hidden="true">!</span><p>Couldn’t refresh everything.</p><button type="button" class="text-control" [disabled]="refreshing()" (click)="load(true)">{{ refreshing() ? 'Retrying…' : 'Retry' }}</button></section>
        }

        <aura-staff-dashboard-sections
          [viewModel]="vm"
          [pendingAction]="pendingMutation()"
          (actionSelected)="runAction($event)"
        />
      } @else {
        <section class="dashboard-blocking-state" role="alert">
          <span class="state-mark" aria-hidden="true">!</span>
          <p class="eyebrow">Staff workspace</p>
          <h1>Unable to format dashboard content</h1>
          <p>The server returned staff data, but your workspace layout could not be prepared.</p>
          <div class="row-actions">
            <button type="button" class="link-button primary-action" [disabled]="refreshing()" (click)="load(true)">{{ refreshing() ? 'Retrying…' : 'Retry' }}</button>
            <button type="button" class="button" (click)="signOut()">Sign out</button>
          </div>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffDashboardPage implements OnInit, OnDestroy {
  readonly data = signal<StaffDashboard | null>(null);
  readonly os = signal<StaffEnterpriseOs | null>(null);
  readonly today = signal<StaffToday | null>(null);
  readonly overtime = signal<StaffOvertimeSummary | null>(null);
  readonly leaveBalances = signal<StaffLeaveBalance[]>([]);
  readonly preferences = signal<StaffWorkspacePreferences | null>(null);
  readonly initialLoading = signal(true);
  readonly refreshing = signal(false);
  readonly blockingError = signal("");
  readonly optionalErrors = signal<string[]>([]);
  readonly refreshWarning = signal(false);
  readonly actionMessage = signal("");
  readonly actionFailed = signal(false);
  readonly pendingMutation = signal("");
  readonly online = signal(typeof navigator === "undefined" ? true : navigator.onLine);
  readonly queuedActions = signal(0);
  readonly dismissedRecommendation = signal("");
  readonly viewModel = computed(() => {
    const dashboard = this.data();
    if (!dashboard) return null;
    try {
      return buildStaffDashboardViewModel({
        user: this.staff.user(),
        dashboard,
        enterprise: this.os(),
        today: this.today(),
        overtime: this.overtime(),
        leaveBalances: this.leaveBalances() || [],
        hasPermission: (permission) => this.staff.hasPermission(permission)
      });
    } catch (error) {
      console.error("Failed to build staff dashboard view model:", error);
      return null;
    }
  });
  readonly recommendationIdentity = computed(() => {
    const hero = this.viewModel()?.hero;
    const action = hero?.actions[0];
    return action ? [action.id, action.appointmentId || "", action.route || "", hero?.title || ""].join(":") : "";
  });
  readonly recommendationText = computed(() => this.viewModel()?.hero.title || "Review today’s priorities");
  readonly showTip = computed(() => {
    const identity = this.recommendationIdentity();
    const vm = this.viewModel();
    return !!vm && shouldShowDashboardRecommendation({
      identity,
      text: this.recommendationText(),
      hero: vm.hero,
      hintsEnabled: this.preferences()?.defaults.staffHints !== false,
      dismissedIdentity: this.dismissedRecommendation(),
      hasPartialWarning: this.refreshWarning()
    });
  });

  private loadGeneration = 0;
  private loadInFlight = false;
  private loadQueued = false;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly attendanceUpdated = () => this.scheduleReload();

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  ngOnInit() {
    this.dismissedRecommendation.set(this.readRecommendationDismissal());
    window.addEventListener("aura:attendance-updated", this.attendanceUpdated);
    this.queuedActions.set(this.staff.offlineQueueSize());
    void this.load();
  }

  ngOnDestroy() {
    window.removeEventListener("aura:attendance-updated", this.attendanceUpdated);
    if (this.reloadTimer !== null) clearTimeout(this.reloadTimer);
  }
  @HostListener("window:online") onOnline() { this.online.set(true); this.queuedActions.set(this.staff.offlineQueueSize()); this.scheduleReload(); }
  @HostListener("window:offline") onOffline() { this.online.set(false); }

  private scheduleReload() {
    if (this.reloadTimer !== null) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => { this.reloadTimer = null; void this.load(true); }, 800);
  }

  async load(fresh = false) {
    if (this.loadInFlight) {
      this.loadQueued = true;
      return;
    }
    this.loadInFlight = true;
    try {
      await this.performLoad(fresh);
      while (this.loadQueued) {
        this.loadQueued = false;
        await this.performLoad(fresh);
      }
    } finally {
      this.loadInFlight = false;
    }
  }

  private async performLoad(fresh = false) {
    const generation = ++this.loadGeneration;
    const hasData = !!this.data();
    this.initialLoading.set(!hasData);
    this.refreshing.set(hasData);
    this.blockingError.set("");
    if (!hasData) this.optionalErrors.set([]);

    if (!hasData) {
      const cached = this.staff.readStoredData<StaffDashboard>("dashboard");
      if (cached) {
        this.data.set(cached);
        this.initialLoading.set(false);
        this.refreshing.set(true);
      }
    }

    try {
      const dashboard = await this.staff.dashboard();
      if (generation !== this.loadGeneration) return;
      if (!dashboard || typeof dashboard !== "object") {
        throw new Error("Dashboard dataset is empty or invalid.");
      }
      this.data.set(dashboard);

      const canReadStaff = this.staff.hasPermission("read:staff");
      const canUseAttendance = this.staff.hasAnyPermission(["allow:staff-checkin-checkout", "read:staff", "write:staff"]);
      const modules: Array<{ name: DashboardModule; request: Promise<unknown> }> = [
        { name: "enterprise", request: this.staff.enterpriseOs({}, fresh) },
        { name: "preferences", request: this.staff.workspacePreferences(fresh) }
      ];
      if (canUseAttendance) modules.push(
        { name: "today", request: this.staff.today(undefined, fresh) },
        { name: "overtime", request: this.staff.overtimeSummary(fresh) }
      );
      if (canReadStaff) modules.push({ name: "leave", request: this.staff.leaveBalances(fresh) });

      const results = await Promise.allSettled(modules.map((m) => m.request));
      if (generation !== this.loadGeneration) return;

      const errors: string[] = [];
      results.forEach((result, index) => {
        const name = modules[index].name;
        if (result.status === "rejected") { errors.push(this.moduleError(name)); return; }
        if (name === "enterprise") this.os.set(result.value as StaffEnterpriseOs);
        if (name === "today") this.today.set(result.value as StaffToday);
        if (name === "overtime") this.overtime.set(result.value as StaffOvertimeSummary);
        if (name === "leave") this.leaveBalances.set(result.value as StaffLeaveBalance[]);
        if (name === "preferences") this.preferences.set(result.value as StaffWorkspacePreferences);
      });
      this.optionalErrors.set(errors);
      this.refreshWarning.set(hasData && errors.length > 0);
      this.queuedActions.set(this.staff.offlineQueueSize());
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      const message = this.staff.error() || (error instanceof Error ? error.message : "Unable to load your staff workspace.");
      this.blockingError.set(this.friendlyBlockingError(message));
    } finally {
      if (generation === this.loadGeneration) {
        if (!this.data() && !this.blockingError()) {
          this.blockingError.set("We could not load your staff workspace. Please tap Retry to reload.");
        }
        this.initialLoading.set(false);
        this.refreshing.set(false);
      }
    }
  }

  async runAction(action: DashboardAction) {
    if (this.pendingMutation()) return;
    if (action.route) { await this.router.navigate(Array.isArray(action.route) ? [...action.route] : [action.route]); return; }
    if (action.kind === "clock") {
      const currentToday = this.today();
      const attendance = Array.isArray(currentToday?.attendance) ? currentToday.attendance : [];
      const isOpen = attendance.some((item) => !item.clockOutAt && !/out|closed|complete/i.test(String(item.status || "")));
      if (isOpen) {
        const openRecord = attendance.find((item) => !item.clockOutAt && !/out|closed|complete/i.test(String(item.status || "")));
        const clockInMs = new Date(openRecord?.clockInAt || "").getTime();
        const isStale = !!openRecord && Number.isFinite(clockInMs) && clockInMs < Date.now() - 36 * 60 * 60 * 1000;
        if (isStale) { this.actionMessage.set("Your last shift wasn’t clocked out. Ask your owner to close it, then you can clock in fresh."); this.actionFailed.set(false); return; }
        await this.runMutation("clock-out", () => this.staff.clockOut(openRecord?.id || ""), "Clocked out.");
      } else {
        await this.runMutation("clock-in", () => this.staff.clockIn(), "Clocked in.");
      }
      window.dispatchEvent(new CustomEvent("aura:attendance-updated"));
      return;
    }
    if (action.kind === "end-break") { await this.runMutation("end-break", () => this.staff.endBreak(), "Break ended."); return; }
  }

  dismissTip() {
    const identity = this.recommendationIdentity();
    if (!identity) return;
    this.dismissedRecommendation.set(identity);
    this.writeScopedValue("dashboardRecommendationDismissed", identity);
  }

  async signOut() { await this.staff.logout(); await this.router.navigateByUrl("/staff/login"); }

  private async runMutation(id: string, mutate: () => Promise<MutationResult<unknown>>, completedMessage: string) {
    if (this.pendingMutation()) return;
    this.pendingMutation.set(id); this.actionMessage.set(""); this.actionFailed.set(false);
    try {
      const result = await mutate();
      if (isQueuedMutation(result)) {
        this.actionMessage.set("Change saved offline and queued for sync."); this.queuedActions.set(this.staff.offlineQueueSize()); return;
      }
      const rec = (result && typeof result === "object" && "data" in result ? (result as { data: StaffAttendance }).data : result) as StaffAttendance;
      if (rec && typeof rec === "object" && rec.id) {
        const curToday = this.today();
        if (curToday) {
          const list = [rec, ...curToday.attendance.filter((a) => a.id !== rec.id)];
          this.today.set({ ...curToday, attendance: list });
        }
      }
      this.actionMessage.set(completedMessage); await this.load(true);
    } catch {
      this.actionFailed.set(true); this.actionMessage.set(this.staff.error() || "Unable to save this change. Please try again.");
    } finally { this.pendingMutation.set(""); }
  }

  private isStaffRecordError(message: string): boolean { return /staff (record|profile)|not linked/i.test(message); }
  private isSessionError(message: string): boolean { return /jwt|expired|session|401|login required/i.test(message); }
  private friendlyBlockingError(message: string): string {
    if (this.isSessionError(message)) return "Your session has expired. Sign in again to continue.\n\n[Debug] " + message;
    if (this.isStaffRecordError(message)) return "This login is not currently linked to an available staff profile.\n\n[Debug] " + message;
    return "We could not load your staff workspace.\n\n[Debug] " + message;
  }
  private moduleError(module: DashboardModule): string {
    const labels: Record<DashboardModule, string> = { enterprise: "Floor alerts are unavailable.", today: "Shift, attendance, and tasks are unavailable.", overtime: "Overtime totals are unavailable.", leave: "Leave balance is unavailable.", preferences: "Workspace preferences are unavailable." };
    return labels[module];
  }
  private scopedKey(suffix: string): string { const user = this.staff.user(); return `auraStaff:${user?.id || user?.staffId || "unknown"}:${user?.branchId || "workspace"}:${suffix}`; }
  private readRecommendationDismissal(): string { try { return localStorage.getItem(this.scopedKey("dashboardRecommendationDismissed")) || ""; } catch { return ""; } }
  private writeScopedValue(suffix: string, value: string) { try { localStorage.setItem(this.scopedKey(suffix), value); } catch { /* Preferences remain usable when storage is unavailable. */ } }
}

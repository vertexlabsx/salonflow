import { Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, effect, signal, untracked } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import { OwnerStatusBadgeComponent } from "./owner-dashboard.components";
import {
  OwnerAppointment,
  OwnerAppointmentAction,
  OwnerAppointmentApiErrorBody,
  OwnerAppointmentBranchOption,
  OwnerAppointmentClientOption,
  OwnerAppointmentConflict,
  OwnerAppointmentDetailResponse,
  OwnerAppointmentFormErrors,
  OwnerAppointmentFormValue,
  OwnerAppointmentListMetadata,
  OwnerAppointmentPageInfo,
  OwnerAppointmentRescheduleFormValue,
  OwnerAppointmentServiceOption,
  OwnerAppointmentStaffOption,
  OwnerAppointmentView
} from "./owner-appointments.models";

type AppointmentModal = "create" | "edit" | "reschedule" | "cancel" | "complete" | "noShow" | "status" | null;
interface ScheduleGroup { id: string; label: string; meta: string; items: OwnerAppointment[]; }
interface CalendarDay { date: string; label: string; items: OwnerAppointment[]; }

const INITIAL_STATUSES = ["draft", "booked", "confirmed"];

@Component({
  standalone: true,
  imports: [FormsModule, PaiseInrPipe, OwnerStatusBadgeComponent],
  templateUrl: "./owner-appointments.page.html",
  styleUrls: ["./owner-shell.styles.css", "./owner-appointments.page.css"]
})
export class OwnerAppointmentsPage implements OnDestroy {
  @ViewChild("modalPanel") modalPanel?: ElementRef<HTMLElement>;
  @ViewChild("detailPanel") detailPanel?: ElementRef<HTMLElement>;

  readonly items = signal<OwnerAppointment[]>([]);
  readonly page = signal<OwnerAppointmentPageInfo | null>(null);
  readonly metadata = signal<OwnerAppointmentListMetadata | null>(null);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly blockingError = signal("");
  readonly refreshError = signal("");
  readonly search = signal("");
  readonly debouncedSearch = signal("");
  readonly staffId = signal("");
  readonly serviceId = signal("");
  readonly clientId = signal("");
  readonly status = signal("");
  readonly source = signal("");
  readonly paymentStatus = signal("");
  readonly from = signal("");
  readonly to = signal("");
  readonly focusDate = signal("");
  readonly view = signal<OwnerAppointmentView>(this.readView());

  readonly branches = signal<OwnerAppointmentBranchOption[]>([]);
  readonly clients = signal<OwnerAppointmentClientOption[]>([]);
  readonly staff = signal<OwnerAppointmentStaffOption[]>([]);
  readonly services = signal<OwnerAppointmentServiceOption[]>([]);
  readonly optionsLoading = signal(false);
  readonly optionsError = signal("");
  readonly writeOptionsScope = signal("");

  readonly detail = signal<OwnerAppointmentDetailResponse | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal("");
  readonly modal = signal<AppointmentModal>(null);
  readonly submitting = signal(false);
  readonly formErrors = signal<OwnerAppointmentFormErrors>({});
  readonly mutationError = signal("");
  readonly mutationNotice = signal("");
  readonly conflicts = signal<OwnerAppointmentConflict[]>([]);
  readonly cancelReason = signal("");
  readonly actionNote = signal("");
  readonly nextStatus = signal("");
  readonly posFallback = signal<{ targetUrl: string; expiresAt: string } | null>(null);

  form: OwnerAppointmentFormValue = this.emptyForm();
  rescheduleForm: OwnerAppointmentRescheduleFormValue = this.emptyRescheduleForm();

  readonly hasRows = computed(() => this.items().length > 0);
  readonly backgroundRefreshing = computed(() => this.loading() && this.hasRows());
  readonly activeFilterCount = computed(() => [this.staffId(), this.serviceId(), this.clientId(), this.status(), this.source(), this.paymentStatus()].filter(Boolean).length);
  readonly selectedId = computed(() => this.detail()?.appointment.id || "");
  readonly availableStatuses = computed(() => this.unique([this.status(), ...this.items().map((item) => item.status)]));
  readonly availableSources = computed(() => this.unique([this.source(), ...this.items().map((item) => item.sourceChannel || item.source || "")]));
  readonly availablePaymentStatuses = computed(() => this.unique([this.paymentStatus(), ...this.items().map((item) => item.paymentStatus || "")]));
  readonly calendarDays = computed<CalendarDay[]>(() => {
    const byDate = new Map<string, OwnerAppointment[]>();
    for (const item of this.items()) { const key = this.dateKey(item.startAt); byDate.set(key, [...(byDate.get(key) || []), item]); }
    return this.dateSequence(this.from(), this.to()).map((date) => ({ date, label: this.calendarDateLabel(date), items: byDate.get(date) || [] }));
  });
  readonly staffGroups = computed<ScheduleGroup[]>(() => this.groupSchedule("staff"));
  readonly branchGroups = computed<ScheduleGroup[]>(() => this.groupSchedule("branch"));
  readonly formBranches = computed(() => {
    const selected = this.context.selectedBranchId();
    return selected ? this.branches().filter((branch) => branch.id === selected) : this.branches();
  });

  readonly views: Array<{ id: OwnerAppointmentView; label: string }> = [
    { id: "list", label: "List" }, { id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "staff", label: "Staff" }, { id: "branch", label: "Branch" }
  ];
  readonly initialStatuses = INITIAL_STATUSES;

  private listRequestId = 0;
  private optionsRequestId = 0;
  private detailRequestId = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private deepLinkTimer?: ReturnType<typeof setTimeout>;
  private triggerElement: HTMLElement | null = null;
  private detailTrigger: HTMLElement | null = null;
  private lastContextRange = "";
  private readonly queryFrom: string;
  private readonly queryTo: string;
  private queryRangeApplied = false;
  private queryBranchApplied = false;
  private readonly requestedAppointmentId: string;
  private requestedAppointmentOpened = false;
  private readonly deepLinkAppointmentId: string;
  private pendingDeepLinkBranchId = "";

  constructor(readonly context: OwnerContextService, private readonly owner: OwnerAppService, route: ActivatedRoute) {
    const query = route.snapshot.queryParamMap;
    this.queryFrom = this.validDate(query.get("from") || "") ? query.get("from") || "" : "";
    this.queryTo = this.validDate(query.get("to") || "") ? query.get("to") || "" : "";
    this.requestedAppointmentId = ((query.get("appointmentId") || "").trim() || (query.get("id") || "").trim());
    this.requestedAppointmentOpened = Boolean(this.requestedAppointmentId);
    this.status.set(query.get("status") || "");
    this.staffId.set(query.get("staffId") || "");
    this.serviceId.set(query.get("serviceId") || "");
    this.clientId.set(query.get("clientId") || "");
    this.source.set(query.get("source") || "");
    this.paymentStatus.set(query.get("paymentStatus") || query.get("paymentState") || "");
    const canonicalAppointmentId = (query.get("appointmentId") || "").trim();
    this.deepLinkAppointmentId = canonicalAppointmentId || (query.get("id") || "").trim();
    this.search.set(query.get("search") || "");
    this.debouncedSearch.set(this.search().trim());
    if (this.queryFrom && this.queryTo && this.queryFrom <= this.queryTo) {
      this.from.set(this.queryFrom); this.to.set(this.queryTo); this.focusDate.set(this.queryFrom);
    }

    const requestedBranch = query.get("branchId") || "";
    effect(() => {
      const branchOptions = this.context.branches();
      if (!this.queryBranchApplied && requestedBranch) {
        if (requestedBranch === "all") { this.context.selectBranch(""); this.queryBranchApplied = true; }
        else if (branchOptions.some((branch) => branch.id === requestedBranch)) { this.context.selectBranch(requestedBranch); this.queryBranchApplied = true; }
      }
      this.applyPendingDeepLinkBranch(branchOptions);
      const branchId = this.context.selectedBranchId() || "all";
      const range = this.context.periodRange();
      const rangeKey = `${range.start}:${range.end}`;
      untracked(() => {
        if (!this.queryRangeApplied && this.queryFrom && this.queryTo && this.queryFrom <= this.queryTo) this.queryRangeApplied = true;
        else if (rangeKey !== this.lastContextRange) {
          this.focusDate.set(range.start);
          this.from.set(this.view() === "week" ? this.weekStart(range.start) : range.start);
          this.to.set(this.view() === "day" ? range.start : this.view() === "week" ? this.addDays(this.from(), 6) : range.end);
        }
        this.lastContextRange = rangeKey;
        void this.loadOptions(branchId);
        void this.loadAppointments(true);
      });
    });
    if (this.deepLinkAppointmentId) this.deepLinkTimer = setTimeout(() => void this.openDetailById(this.deepLinkAppointmentId, true), 0);
  }

  ngOnDestroy(): void { if (this.searchTimer) clearTimeout(this.searchTimer); if (this.deepLinkTimer) clearTimeout(this.deepLinkTimer); this.listRequestId++; this.optionsRequestId++; this.detailRequestId++; document.documentElement.classList.remove("staff-overlay-open"); }

  searchChanged(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.debouncedSearch.set(value.trim()); void this.loadAppointments(true); }, 350);
  }

  clearSearch(): void { if (this.searchTimer) clearTimeout(this.searchTimer); this.search.set(""); this.debouncedSearch.set(""); void this.loadAppointments(true); }
  filterChanged(): void { void this.loadAppointments(true); }
  dateRangeChanged(): void { if (!this.validDate(this.from()) || !this.validDate(this.to()) || this.from() > this.to()) return; this.focusDate.set(this.from()); void this.loadAppointments(true); }
  refresh(): void { if (!this.loading()) void this.loadAppointments(true); }
  loadMore(): void { if (this.page()?.hasMore && !this.loadingMore()) void this.loadAppointments(false); }

  setView(view: OwnerAppointmentView): void {
    this.view.set(view); this.writeView(view);
    if (view === "day") this.applyCalendarSpan(1);
    if (view === "week") this.applyCalendarSpan(7);
  }

  moveCalendar(direction: -1 | 1): void {
    const days = this.view() === "week" ? 7 : 1;
    const next = this.addDays(this.focusDate() || this.from(), direction * days);
    this.focusDate.set(next);
    this.from.set(this.view() === "week" ? this.weekStart(next) : next);
    this.to.set(this.view() === "week" ? this.addDays(this.from(), 6) : next);
    void this.loadAppointments(true);
  }

  clearFilters(): void {
    this.staffId.set(""); this.serviceId.set(""); this.clientId.set(""); this.status.set(""); this.source.set(""); this.paymentStatus.set("");
    void this.loadAppointments(true);
  }

  async openDetail(item: OwnerAppointment, event?: Event): Promise<void> {
    this.detailTrigger = event?.currentTarget as HTMLElement || null;
    await this.openDetailById(item.id);
  }

  private async openDetailById(appointmentId: string, alignContext = false): Promise<void> {
    const id = ++this.detailRequestId;
    this.detailLoading.set(true); this.detailError.set(""); this.detail.set(null); this.lockPage();
    setTimeout(() => this.detailPanel?.nativeElement.focus(), 0);
    try {
      const response = await this.owner.appointment(appointmentId);
      if (id === this.detailRequestId) {
        this.detail.set(response);
        if (alignContext) {
          this.pendingDeepLinkBranchId = response.appointment.branchId;
          this.applyPendingDeepLinkBranch(this.context.branches());
        }
      }
    }
    catch (error) { if (id === this.detailRequestId) this.detailError.set(this.apiError(error, "Appointment detail could not be loaded.").message); }
    finally { if (id === this.detailRequestId) this.detailLoading.set(false); }
  }

  closeDetail(restoreFocus = true): void {
    if (this.modal()) return;
    this.detailRequestId++; this.detail.set(null); this.detailError.set(""); this.detailLoading.set(false); this.unlockPage();
    if (restoreFocus) setTimeout(() => this.detailTrigger?.focus(), 0);
  }

  openCreate(event: Event): void { this.form = this.emptyForm(); this.form.branchId = this.context.selectedBranchId() || this.branches()[0]?.id || ""; this.openModal("create", event); }
  openEdit(event: Event): void { const detail = this.detail(); if (!detail || !this.writeOptionsReady(detail.appointment.branchId)) return; this.form = this.formFrom(detail.appointment); this.form.serviceIds = this.form.serviceIds.filter((serviceId) => this.formServices().some((service) => service.id === serviceId)); this.openModal("edit", event); }
  openReschedule(event: Event): void { const appointment = this.detail()?.appointment; if (!appointment) return; this.rescheduleForm = this.rescheduleFrom(appointment); this.openModal("reschedule", event); }
  openActionModal(kind: "cancel" | "complete" | "noShow" | "status", event: Event): void { this.cancelReason.set(""); this.actionNote.set(""); this.nextStatus.set(""); this.openModal(kind, event); }

  closeModal(restoreFocus = true): void {
    if (this.submitting()) return;
    this.modal.set(null); this.formErrors.set({}); this.mutationError.set(""); this.conflicts.set([]);
    this.unlockPage();
    if (restoreFocus) setTimeout(() => this.triggerElement?.focus(), 0);
  }

  actionSupported(action: OwnerAppointmentAction): boolean {
    const detail = this.detail();
    if (!detail?.supportedActions.includes(action)) return false;
    return action !== "setStatus" || (detail.allowedStatusTransitions || []).length > 0;
  }

  allowedStatusTransitions(): string[] { return this.detail()?.allowedStatusTransitions || []; }

  formClients(): OwnerAppointmentClientOption[] { return this.form.branchId ? this.clients().filter((client) => client.branchId === this.form.branchId) : []; }
  formStaff(): OwnerAppointmentStaffOption[] { return this.form.branchId ? this.staff().filter((staff) => staff.branchId === this.form.branchId) : []; }
  formServices(): OwnerAppointmentServiceOption[] { return this.form.branchId ? this.services().filter((service) => !service.branchId || service.branchId === this.form.branchId) : []; }
  writeOptionsReady(branchId: string): boolean { return this.writeOptionsScope() === "all" || this.writeOptionsScope() === branchId; }
  rescheduleStaff(): OwnerAppointmentStaffOption[] { return this.rescheduleForm.branchId ? this.staff().filter((staff) => staff.branchId === this.rescheduleForm.branchId) : []; }

  formBranchChanged(branchId: string): void {
    this.form.branchId = branchId;
    if (!this.formClients().some((client) => client.id === this.form.clientId)) this.form.clientId = "";
    if (!this.formStaff().some((staff) => staff.id === this.form.staffId)) this.form.staffId = "";
    this.form.serviceIds = this.form.serviceIds.filter((serviceId) => this.formServices().some((service) => service.id === serviceId));
  }

  rescheduleBranchChanged(branchId: string): void {
    this.rescheduleForm.branchId = branchId;
    if (!this.rescheduleStaff().some((staff) => staff.id === this.rescheduleForm.staffId)) this.rescheduleForm.staffId = "";
  }

  async saveAppointment(): Promise<void> {
    if (this.submitting()) return;
    const errors = this.validateAppointmentForm(this.form); this.formErrors.set(errors);
    if (Object.keys(errors).length) return;
    const startAt = this.toIso(this.form.date, this.form.time);
    const endAt = this.form.endDate && this.form.endTime ? this.toIso(this.form.endDate, this.form.endTime) : "";
    const payload = {
      branchId: this.form.branchId, clientId: this.form.clientId, staffId: this.form.staffId, serviceIds: [...this.form.serviceIds], startAt,
      ...(endAt ? { endAt } : {}), ...(this.form.notes.trim() ? { notes: this.form.notes.trim() } : {}),
      ...(this.modal() === "create" && INITIAL_STATUSES.includes(this.form.status) ? { status: this.form.status } : {}),
      ...(this.form.source.trim() ? { source: this.form.source.trim() } : {})
    };
    await this.mutate(async () => {
      const current = this.detail();
      const response = this.modal() === "edit" && current
        ? await this.owner.updateAppointment(current.appointment.id, payload, current.version)
        : await this.owner.createAppointment(payload);
      this.detail.set(response);
      return this.modal() === "edit" ? "Appointment updated." : "Appointment created.";
    });
  }

  async saveReschedule(): Promise<void> {
    const appointment = this.detail()?.appointment; if (!appointment || this.submitting()) return;
    const errors = this.validateReschedule(this.rescheduleForm); this.formErrors.set(errors); if (Object.keys(errors).length) return;
    const endAt = this.rescheduleForm.endDate && this.rescheduleForm.endTime ? this.toIso(this.rescheduleForm.endDate, this.rescheduleForm.endTime) : "";
    await this.mutate(async () => {
      await this.owner.rescheduleAppointment(appointment.id, { branchId: this.rescheduleForm.branchId, staffId: this.rescheduleForm.staffId, startAt: this.toIso(this.rescheduleForm.date, this.rescheduleForm.time), ...(endAt ? { endAt } : {}), ...(this.rescheduleForm.reason.trim() ? { reason: this.rescheduleForm.reason.trim() } : {}) });
      return "Appointment rescheduled.";
    });
  }

  async confirmModalAction(): Promise<void> {
    const appointment = this.detail()?.appointment; const kind = this.modal(); if (!appointment || !kind || this.submitting()) return;
    if (kind === "cancel" && !this.cancelReason().trim()) { this.formErrors.set({ reason: "Enter a cancellation reason." }); return; }
    if (kind === "status" && (!this.nextStatus() || !this.allowedStatusTransitions().includes(this.nextStatus()))) { this.formErrors.set({ status: "Choose an allowed status transition." }); return; }
    await this.mutate(async () => {
      if (kind === "cancel") await this.owner.cancelAppointment(appointment.id, { reason: this.cancelReason().trim() });
      else if (kind === "complete") await this.owner.completeAppointment(appointment.id, { notes: this.actionNote().trim() || undefined });
      else if (kind === "noShow") await this.owner.noShowAppointment(appointment.id, { reason: this.actionNote().trim() || undefined });
      else if (kind === "status") await this.owner.setAppointmentStatus(appointment.id, { status: this.nextStatus(), reason: this.actionNote().trim() || undefined });
      return kind === "cancel" ? "Appointment cancelled." : kind === "complete" ? "Appointment completed." : kind === "noShow" ? "Appointment marked as no-show." : "Appointment status updated.";
    });
  }

  async runLifecycle(action: "checkIn" | "startService"): Promise<void> {
    const appointment = this.detail()?.appointment; if (!appointment || this.submitting()) return;
    await this.mutate(async () => { if (action === "checkIn") await this.owner.checkInAppointment(appointment.id); else await this.owner.startAppointment(appointment.id); return action === "checkIn" ? "Client checked in." : "Service started."; });
  }

  async openPos(): Promise<void> {
    const appointment = this.detail()?.appointment; if (!appointment || this.submitting()) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    this.submitting.set(true); this.mutationError.set(""); this.posFallback.set(null);
    try {
      const response = await this.owner.appointmentPosHandoff(appointment.id);
      if (popup) popup.location.replace(response.targetUrl);
      else this.posFallback.set(response);
    } catch (error) {
      popup?.close();
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      const fallback = status === 403 ? "POS access is not permitted for this appointment." : status === 404 || status === 410 ? "POS handoff is unavailable or has expired." : "POS could not be opened. Try again.";
      this.mutationError.set(this.apiError(error, fallback).message);
    } finally { this.submitting.set(false); }
  }

  usePosFallback(): void { const fallback = this.posFallback(); if (fallback) window.location.assign(fallback.targetUrl); }

  clientName(item: OwnerAppointment): string { return item.clientName || this.clients().find((client) => client.id === item.clientId)?.name || "Client unavailable"; }
  staffName(item: OwnerAppointment): string { return item.staffName || this.staff().find((staff) => staff.id === item.staffId)?.name || "Staff unavailable"; }
  branchName(item: OwnerAppointment): string { return item.branchName || this.branches().find((branch) => branch.id === item.branchId)?.name || "Branch unavailable"; }
  serviceNames(item: OwnerAppointment): string { const names = item.serviceIds.map((id) => this.services().find((service) => service.id === id)?.name).filter((name): name is string => !!name); return names.length ? names.join(", ") : item.serviceIds.length ? `${item.serviceIds.length} service${item.serviceIds.length === 1 ? "" : "s"}` : "Services unavailable"; }
  sourceLabel(item: OwnerAppointment): string { return this.humanize(item.sourceChannel || item.source || "Not supplied"); }
  paymentLabel(item: OwnerAppointment): string { return item.paymentStatus ? this.humanize(item.paymentStatus) : "Not billed"; }
  statusTone(status: string): string { const value = status.toLowerCase(); return /completed|paid|confirmed/.test(value) ? "positive" : /cancel|no-show|failed/.test(value) ? "negative" : /waiting|arrived|in-service/.test(value) ? "attention" : "neutral"; }
  dateTime(value?: string | null): string { if (!value) return "Not supplied"; return this.context.formatDateTime(value); }
  time(value?: string | null): string { if (!value) return "Time unavailable"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(this.context.effectiveLocale(), { hour: "numeric", minute: "2-digit", timeZone: this.context.effectiveTimezone() }).format(date); }
  duration(item: OwnerAppointment): string { if (!item.endAt) return "Duration not supplied"; const minutes = Math.round((new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 60000); return Number.isFinite(minutes) && minutes > 0 ? `${minutes} min` : "Duration unavailable"; }
  activityLabel(action: string): string { return this.humanize(action || "Updated"); }
  humanize(value: string): string { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase()); }
  trackItem(_index: number, item: OwnerAppointment): string { return item.id; }

  @HostListener("window:keydown", ["$event"])
  onKeydown(event: KeyboardEvent): void {
    const panel = this.modal() ? this.modalPanel?.nativeElement : (this.detail() || this.detailLoading() || this.detailError()) ? this.detailPanel?.nativeElement : undefined;
    if (!panel) return;
    if (event.key === "Escape") { event.preventDefault(); if (this.modal()) this.closeModal(); else this.closeDetail(); return; }
    if (event.key !== "Tab") return;
    const focusable = panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) { event.preventDefault(); panel.focus(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  private async loadAppointments(reset: boolean): Promise<void> {
    if (!this.validDate(this.from()) || !this.validDate(this.to()) || this.from() > this.to()) return;
    const id = ++this.listRequestId;
    if (reset) this.loading.set(true); else this.loadingMore.set(true);
    this.blockingError.set(""); this.refreshError.set("");
    try {
      const offset = reset ? 0 : this.page()?.nextOffset || 0;
      const response = await this.owner.appointments({
        branchId: this.context.selectedBranchId() || "all", from: this.from(), to: this.to(), search: this.debouncedSearch() || undefined,
        staffId: this.staffId() || undefined, serviceId: this.serviceId() || undefined, clientId: this.clientId() || undefined,
        status: this.status() || undefined, source: this.source() || undefined, paymentStatus: this.paymentStatus() || undefined, limit: 100, offset
      });
      if (id !== this.listRequestId) return;
      this.items.set(reset ? response.items : [...this.items(), ...response.items]); this.page.set(response.page); this.metadata.set(response.metadata); this.context.markSuccessfulRefresh();
      if (reset && this.requestedAppointmentId && !this.requestedAppointmentOpened) {
        const requested = response.items.find((item) => item.id === this.requestedAppointmentId);
        if (requested) { this.requestedAppointmentOpened = true; void this.openDetail(requested); }
      }
    } catch (error) {
      if (id !== this.listRequestId) return;
      const message = this.apiError(error, "Appointments could not be loaded. Check the connection and try again.").message;
      if (!this.items().length) this.blockingError.set(message); else this.refreshError.set(`${message} Previously loaded appointments remain visible.`);
    } finally { if (id === this.listRequestId) { this.loading.set(false); this.loadingMore.set(false); } }
  }

  private async loadOptions(branchId: string): Promise<void> {
    const id = ++this.optionsRequestId; this.optionsLoading.set(true); this.optionsError.set(""); this.writeOptionsScope.set("");
    const results = await Promise.allSettled([this.owner.appointmentBranches("all"), this.owner.appointmentClients(branchId), this.owner.appointmentStaff(branchId), this.owner.appointmentServices(branchId)]);
    if (id !== this.optionsRequestId) return;
    const failures: string[] = [];
    if (results[0].status === "fulfilled") this.branches.set(results[0].value.items); else failures.push("branches");
    if (results[1].status === "fulfilled") this.clients.set(results[1].value.items); else failures.push("clients");
    if (results[2].status === "fulfilled") this.staff.set(results[2].value.items); else failures.push("staff");
    if (results[3].status === "fulfilled") this.services.set(results[3].value.items); else failures.push("services");
    if (results[1].status === "fulfilled" && results[2].status === "fulfilled" && results[3].status === "fulfilled") this.writeOptionsScope.set(branchId);
    this.resetDependentFilters(branchId);
    if (failures.length) this.optionsError.set(`${failures.map((value) => this.humanize(value)).join(", ")} options are temporarily unavailable. Available filters remain usable.`);
    this.optionsLoading.set(false);
  }

  private async mutate(operation: () => Promise<string>): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true); this.mutationError.set(""); this.mutationNotice.set(""); this.conflicts.set([]);
    try {
      const notice = await operation();
      const id = this.detail()?.appointment.id;
      this.modal.set(null); this.formErrors.set({}); this.mutationNotice.set(notice);
      try {
        await this.loadAppointments(true);
        if (id) { const fresh = await this.owner.appointment(id); this.detail.set(fresh); }
      } catch {
        this.refreshError.set("The change was saved, but the latest appointment detail could not be refreshed.");
      }
      setTimeout(() => this.detailPanel?.nativeElement.focus(), 0);
    } catch (error) {
      const parsed = this.apiError(error, "The appointment change could not be saved.");
      this.mutationError.set(parsed.message); this.conflicts.set(parsed.conflicts);
    } finally { this.submitting.set(false); }
  }

  private apiError(error: unknown, fallback: string): { message: string; conflicts: OwnerAppointmentConflict[] } {
    if (!(error instanceof HttpErrorResponse)) return { message: error instanceof Error && error.message ? error.message : fallback, conflicts: [] };
    const body = error.error as OwnerAppointmentApiErrorBody | string | null;
    if (typeof body === "string") return { message: body.trim() || fallback, conflicts: [] };
    const nested = body && typeof body.error === "object" ? body.error : null;
    const details = nested?.details || body?.details;
    const message = typeof body?.error === "string" ? body.error : nested?.message || body?.message || fallback;
    if (error.status === 409 || error.status === 412 || error.status === 428) {
      return { message: error.status === 428 ? "This appointment must be refreshed before editing." : `${message} Refresh the appointment before trying again.`, conflicts: details?.conflicts || [] };
    }
    return { message, conflicts: details?.conflicts || [] };
  }

  private openModal(kind: Exclude<AppointmentModal, null>, event: Event): void {
    this.triggerElement = event.currentTarget as HTMLElement; this.formErrors.set({}); this.mutationError.set(""); this.conflicts.set([]); this.modal.set(kind); this.lockPage();
    setTimeout(() => this.modalPanel?.nativeElement.focus(), 0);
  }

  private validateAppointmentForm(form: OwnerAppointmentFormValue): OwnerAppointmentFormErrors {
    const errors: OwnerAppointmentFormErrors = {};
    if (!form.branchId) errors.branchId = "Choose a branch.";
    if (!form.clientId) errors.clientId = "Choose a client.";
    if (!form.staffId) errors.staffId = "Choose a staff member.";
    if (!form.serviceIds.length) errors.serviceIds = "Choose at least one service.";
    if (this.modal() === "create" && !INITIAL_STATUSES.includes(form.status)) errors.status = "Choose draft, booked or confirmed.";
    if (!this.validDate(form.date) || !form.time) errors.startAt = "Choose a valid date and start time.";
    const start = this.toIso(form.date, form.time); const end = form.endDate && form.endTime ? this.toIso(form.endDate, form.endTime) : "";
    if (end && new Date(end).getTime() <= new Date(start).getTime()) errors.endAt = "End time must be after start time.";
    return errors;
  }

  private validateReschedule(form: OwnerAppointmentRescheduleFormValue): OwnerAppointmentFormErrors {
    const errors: OwnerAppointmentFormErrors = {};
    if (!form.branchId) errors.branchId = "Choose a branch.";
    if (!form.staffId) errors.staffId = "Choose a staff member.";
    if (!this.validDate(form.date) || !form.time) errors.startAt = "Choose a valid date and start time.";
    const start = this.toIso(form.date, form.time); const end = form.endDate && form.endTime ? this.toIso(form.endDate, form.endTime) : "";
    if (end && new Date(end).getTime() <= new Date(start).getTime()) errors.endAt = "End time must be after start time.";
    return errors;
  }

  private resetDependentFilters(branchId: string): void {
    if (branchId === "all") return;
    if (this.staffId() && !this.staff().some((item) => item.id === this.staffId() && item.branchId === branchId)) this.staffId.set("");
    if (this.clientId() && !this.clients().some((item) => item.id === this.clientId() && item.branchId === branchId)) this.clientId.set("");
  }

  private applyPendingDeepLinkBranch(branches: OwnerAppointmentBranchOption[]): void {
    const branchId = this.pendingDeepLinkBranchId;
    if (!branchId || !branches.some((branch) => branch.id === branchId)) return;
    const selected = this.context.selectedBranchId();
    if (selected && selected !== branchId) this.context.selectBranch(branchId);
    this.pendingDeepLinkBranchId = "";
  }

  private groupSchedule(kind: "staff" | "branch"): ScheduleGroup[] {
    const options = kind === "staff" ? this.staff().map((item) => ({ id: item.id, label: item.name, meta: item.role || "Staff" })) : this.branches().map((item) => ({ id: item.id, label: item.name, meta: item.city || item.status }));
    const ids = this.unique(this.items().map((item) => kind === "staff" ? item.staffId : item.branchId));
    return ids.map((id) => {
      const option = options.find((item) => item.id === id);
      return { id, label: option?.label || (kind === "staff" ? "Staff unavailable" : "Branch unavailable"), meta: option?.meta || "Returned appointment context", items: this.items().filter((item) => (kind === "staff" ? item.staffId : item.branchId) === id) };
    });
  }

  private emptyForm(): OwnerAppointmentFormValue { return { branchId: "", clientId: "", staffId: "", serviceIds: [], date: "", time: "", endDate: "", endTime: "", notes: "", status: "booked", source: "" }; }
  private emptyRescheduleForm(): OwnerAppointmentRescheduleFormValue { return { branchId: "", staffId: "", date: "", time: "", endDate: "", endTime: "", reason: "" }; }
  private formFrom(item: OwnerAppointment): OwnerAppointmentFormValue { const start = this.localParts(item.startAt); const end = item.endAt ? this.localParts(item.endAt) : { date: "", time: "" }; return { branchId: item.branchId, clientId: item.clientId, staffId: item.staffId, serviceIds: [...item.serviceIds], date: start.date, time: start.time, endDate: end.date, endTime: end.time, notes: item.notes || "", status: item.status || "", source: item.sourceChannel || item.source || "" }; }
  private rescheduleFrom(item: OwnerAppointment): OwnerAppointmentRescheduleFormValue { const start = this.localParts(item.startAt); const end = item.endAt ? this.localParts(item.endAt) : { date: "", time: "" }; return { branchId: item.branchId, staffId: item.staffId, date: start.date, time: start.time, endDate: end.date, endTime: end.time, reason: "" }; }
  private localParts(value: string): { date: string; time: string } { const date = new Date(value); if (Number.isNaN(date.getTime())) return { date: "", time: "" }; const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: this.context.effectiveTimezone() }).formatToParts(date); const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ""; return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` }; }
  private toIso(date: string, time: string): string { return new Date(`${date}T${time}:00+05:30`).toISOString(); }
  private dateKey(value: string): string { return this.localParts(value).date; }
  private validDate(value: string): boolean { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
  private dateSequence(from: string, to: string): string[] { if (!this.validDate(from) || !this.validDate(to) || from > to) return []; const days: string[] = []; for (let value = from; value <= to; value = this.addDays(value, 1)) days.push(value); return days; }
  private calendarDateLabel(value: string): string { return new Intl.DateTimeFormat(this.context.effectiveLocale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
  private addDays(value: string, days: number): string { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
  private weekStart(value: string): string { const date = new Date(`${value}T00:00:00Z`); return this.addDays(value, -((date.getUTCDay() + 6) % 7)); }
  private applyCalendarSpan(days: 1 | 7): void { const focus = this.focusDate() || this.from(); this.from.set(days === 7 ? this.weekStart(focus) : focus); this.to.set(days === 7 ? this.addDays(this.from(), 6) : focus); void this.loadAppointments(true); }
  private unique(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
  private readView(): OwnerAppointmentView { try { const value = localStorage.getItem("auraOwner:appointmentView"); return value === "day" || value === "week" || value === "staff" || value === "branch" ? value : "list"; } catch { return "list"; } }
  private writeView(value: OwnerAppointmentView): void { try { localStorage.setItem("auraOwner:appointmentView", value); } catch { /* Current view remains available in memory. */ } }
  private lockPage(): void { document.documentElement.classList.add("staff-overlay-open"); }
  private unlockPage(): void { if (!this.modal() && !this.detail() && !this.detailLoading() && !this.detailError()) document.documentElement.classList.remove("staff-overlay-open"); }
}

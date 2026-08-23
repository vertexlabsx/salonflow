import { Injectable, computed, signal } from "@angular/core";
import { addBusinessDays, businessDate } from "../../core/business-date";
import { OwnerAppService, OwnerRecord, OwnerUser } from "./owner-app.service";
import { OwnerGeneralSettings } from "./owner-administration.models";

export type OwnerTheme = "light" | "dark";
export type OwnerPeriod = "today" | "week" | "month" | "quarter" | "year" | "custom";
export type OwnerBranch = {
  id: string;
  name: string;
  status: string;
  city: string;
  location: string;
};

type StoredPeriod = { period: OwnerPeriod; start?: string; end?: string };

const PERIOD_LABELS: Record<OwnerPeriod, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
  custom: "Custom"
};

const DEFAULT_SETTINGS: OwnerGeneralSettings = {
  workspace: { workspaceName: "Aura", defaultLandingPage: "dashboard", fastPosEnabled: true },
  localization: { country: "India", language: "English", timezone: "Asia/Kolkata", currency: "INR", locale: "en-IN" },
  branchBehavior: { rememberLastBranch: true, requireBranchSelection: true, allowBranchSwitch: true },
  dateTime: { dateFormat: "DD/MM/YYYY", timeFormat: "12h", businessDayStartHour: 0, weekStartsOn: "Monday" },
  interface: { compactMode: false, showModuleBadges: true, enableCommandSearch: true },
  defaults: { refreshReportsOnOpen: true, ownerNotifications: true, staffHints: true }
};

@Injectable({ providedIn: "root" })
export class OwnerContextService {
  readonly theme = signal<OwnerTheme>(this.readTheme());
  readonly branches = signal<OwnerBranch[]>([]);
  readonly branchesLoading = signal(false);
  readonly branchesError = signal("");
  readonly selectedBranchId = signal("");
  readonly recentBranchId = signal("");
  readonly settings = signal<OwnerGeneralSettings>(structuredClone(DEFAULT_SETTINGS));
  readonly settingsLoaded = signal(false);
  readonly period = signal<OwnerPeriod>("today");
  readonly customStart = signal("");
  readonly customEnd = signal("");
  readonly lastSuccessfulRefresh = signal<Date | null>(null);
  private previousThemeColor: string | null = null;
  private previousColorScheme = "";
  private settingsRequest = 0;

  readonly selectedBranch = computed(() => this.branches().find((branch) => branch.id === this.selectedBranchId()) || null);
  readonly branchLabel = computed(() => this.selectedBranch()?.name || "All Branches");
  readonly workspaceName = computed(() => this.settings().workspace.workspaceName || "Aura");
  readonly allowBranchSwitch = computed(() => this.settings().branchBehavior.allowBranchSwitch);
  readonly compactMode = computed(() => this.settings().interface.compactMode);
  readonly showModuleBadges = computed(() => this.settings().interface.showModuleBadges);
  readonly commandSearchEnabled = computed(() => this.settings().interface.enableCommandSearch);
  readonly fastPosEnabled = computed(() => this.settings().workspace.fastPosEnabled);
  readonly periodName = computed(() => PERIOD_LABELS[this.period()]);
  readonly periodRange = computed(() => this.resolveRange(this.period(), this.customStart(), this.customEnd()));
  readonly periodRangeLabel = computed(() => this.formatRange(this.periodRange().start, this.periodRange().end));
  readonly effectiveTimezone = computed(() => this.settings().localization.timezone || "Asia/Kolkata");
  readonly effectiveLocale = computed(() => this.settings().localization.locale || "en-IN");
  readonly effectiveCurrency = computed(() => this.settings().localization.currency || "INR");
  readonly effectiveDateFormat = computed(() => this.settings().dateTime.dateFormat || "DD/MM/YYYY");
  readonly effectiveTimeFormat = computed(() => this.settings().dateTime.timeFormat || "12h");
  readonly lastRefreshLabel = computed(() => {
    const value = this.lastSuccessfulRefresh();
    if (!value) return "";
    return `Last refreshed ${new Intl.DateTimeFormat(this.effectiveLocale(), { hour: "numeric", minute: "2-digit", timeZone: this.effectiveTimezone() }).format(value)}`;
  });

  constructor(private readonly owner: OwnerAppService) {}

  initializeTheme(): void {
    if (this.previousThemeColor === null) {
      this.previousThemeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute("content") || "";
      this.previousColorScheme = document.documentElement.style.colorScheme;
    }
    this.applyTheme(this.theme());
  }

  async initialize(): Promise<void> {
    this.initializeTheme();
    this.restorePeriod();
    await this.loadSettings("");
    await this.loadBranches();
    if (this.selectedBranchId()) await this.loadSettings(this.selectedBranchId());
  }

  async loadSettings(branchId = this.selectedBranchId()): Promise<void> {
    const request = ++this.settingsRequest;
    this.settingsLoaded.set(false);
    try {
      const response = await this.owner.administrationSettings(branchId);
      if (request === this.settingsRequest && branchId === this.selectedBranchId()) this.applySettings(response.settings);
    } catch {
      if (request === this.settingsRequest && !this.settingsLoaded()) this.applySettings(structuredClone(DEFAULT_SETTINGS));
    }
    finally { if (request === this.settingsRequest) this.settingsLoaded.set(true); }
  }

  applySettings(settings: OwnerGeneralSettings): void {
    this.settings.set(structuredClone(settings));
    this.settingsLoaded.set(true);
    document.documentElement.dataset["ownerCompactMode"] = settings.interface.compactMode ? "true" : "false";
    document.title = `${settings.workspace.workspaceName || "Aura"} | Owner`;
    if (!settings.branchBehavior.rememberLastBranch) this.writeStorage(this.storageKey("branch"), "");
  }

  defaultLandingRoute(): string {
    const route = this.settings().workspace.defaultLandingPage;
    return ({ dashboard: "/owner/dashboard", pos: "/owner/billing", appointments: "/owner/appointments", clients: "/owner/clients", reports: "/owner/reports" } as Record<string, string>)[route] || "/owner/dashboard";
  }

  leaveOwnerSurface(): void {
    delete document.documentElement.dataset["ownerTheme"];
    delete document.documentElement.dataset["ownerCompactMode"];
    document.documentElement.style.colorScheme = this.previousColorScheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", this.previousThemeColor || "");
    this.previousThemeColor = null;
  }

  async loadBranches(): Promise<void> {
    this.branchesLoading.set(true);
    this.branchesError.set("");
    try {
      const records = await this.owner.list("branches", { limit: 500 });
      const user = this.owner.user();
      const allowed = new Set((user?.branchIds || []).map(String));
      const branches = records
        .map((record) => this.toBranch(record))
        .filter((branch): branch is OwnerBranch => !!branch && allowed.has(branch.id));
      this.branches.set(branches);
      this.restoreBranch(user, branches);
    } catch {
      this.branches.set([]);
      this.selectedBranchId.set("");
      this.branchesError.set("Branch context is temporarily unavailable.");
    } finally {
      this.branchesLoading.set(false);
    }
  }

  selectBranch(branchId: string): void {
    const next = branchId && this.branches().some((branch) => branch.id === branchId) ? branchId : "";
    if (!this.allowBranchSwitch() && this.selectedBranchId() && next !== this.selectedBranchId()) return;
    this.selectedBranchId.set(next);
    this.writeStorage(this.storageKey("branch"), this.settings().branchBehavior.rememberLastBranch ? next : "");
    if (next) {
      this.recentBranchId.set(next);
      this.writeStorage(this.storageKey("recentBranch"), next);
    }
    this.settingsLoaded.set(false);
    void this.loadSettings(next);
  }

  selectPeriod(period: OwnerPeriod): void {
    this.period.set(period);
    if (period !== "custom") this.persistPeriod();
  }

  rangeLabelFor(period: OwnerPeriod): string {
    const range = this.resolveRange(period, this.customStart(), this.customEnd());
    return this.formatRange(range.start, range.end);
  }

  applyCustomPeriod(start: string, end: string): boolean {
    if (!this.isBusinessDate(start) || !this.isBusinessDate(end) || start > end) return false;
    this.customStart.set(start);
    this.customEnd.set(end);
    this.period.set("custom");
    this.persistPeriod();
    return true;
  }

  toggleTheme(): void {
    this.applyTheme(this.theme() === "dark" ? "light" : "dark");
  }

  markSuccessfulRefresh(): void {
    this.lastSuccessfulRefresh.set(new Date());
  }

  formatDate(value: string): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(this.effectiveLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: this.effectiveTimezone() }).format(date);
  }

  formatDateTime(value: string): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(this.effectiveLocale(), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: this.effectiveTimezone() }).format(date);
  }

  formatDateShort(value: string): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(this.effectiveLocale(), { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  }

  formatCurrency(paise: number): string {
    return new Intl.NumberFormat(this.effectiveLocale(), { style: "currency", currency: this.effectiveCurrency(), maximumFractionDigits: 2 }).format(paise / 100);
  }

  formatCurrencyCompact(paise: number): string {
    return new Intl.NumberFormat(this.effectiveLocale(), { style: "currency", currency: this.effectiveCurrency(), maximumFractionDigits: 0 }).format(paise / 100);
  }

  formatNumber(value: number): string {
    return value.toLocaleString(this.effectiveLocale());
  }

  private restoreBranch(user: OwnerUser | null, branches: OwnerBranch[]): void {
    const validIds = new Set(branches.map((branch) => branch.id));
    const remember = this.settings().branchBehavior.rememberLastBranch;
    const stored = remember ? this.readStorage(this.storageKey("branch", user)) : "";
    const recent = this.readStorage(this.storageKey("recentBranch", user));
    const selected = branches.length === 1
      ? branches[0].id
      : stored && validIds.has(stored)
        ? stored
        : this.settings().branchBehavior.requireBranchSelection ? branches[0]?.id || "" : "";
    this.selectedBranchId.set(selected);
    this.recentBranchId.set(recent && validIds.has(recent) ? recent : "");
    if (stored && !validIds.has(stored)) this.writeStorage(this.storageKey("branch", user), "");
    if (recent && !validIds.has(recent)) this.writeStorage(this.storageKey("recentBranch", user), "");
  }

  private restorePeriod(): void {
    const raw = this.readStorage(this.storageKey("period"));
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as StoredPeriod;
      if (!stored || !Object.prototype.hasOwnProperty.call(PERIOD_LABELS, stored.period)) return;
      if (stored.period === "custom") {
        if (!stored.start || !stored.end || !this.applyCustomPeriod(stored.start, stored.end)) return;
      } else {
        this.period.set(stored.period);
      }
    } catch { /* Invalid owner-only preferences fall back to Today. */ }
  }

  private persistPeriod(): void {
    const value: StoredPeriod = { period: this.period() };
    if (value.period === "custom") {
      value.start = this.customStart();
      value.end = this.customEnd();
    }
    this.writeStorage(this.storageKey("period"), JSON.stringify(value));
  }

  private resolveRange(period: OwnerPeriod, customStart: string, customEnd: string): { start: string; end: string } {
    const today = businessDate();
    if (period === "custom" && this.isBusinessDate(customStart) && this.isBusinessDate(customEnd) && customStart <= customEnd) return { start: customStart, end: customEnd };
    if (period === "today") return { start: today, end: today };
    const [year, month, day] = today.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (period === "week") {
      const mondayOffset = -((date.getUTCDay() + 6) % 7);
      const start = addBusinessDays(today, mondayOffset);
      return { start, end: addBusinessDays(start, 6) };
    }
    if (period === "month") return { start: this.dateString(year, month, 1), end: this.dateString(year, month + 1, 0) };
    if (period === "quarter") {
      const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
      return { start: this.dateString(year, quarterStart, 1), end: this.dateString(year, quarterStart + 3, 0) };
    }
    return { start: this.dateString(year, 1, 1), end: this.dateString(year, 12, 31) };
  }

  private formatRange(start: string, end: string): string {
    const formatter = new Intl.DateTimeFormat(this.effectiveLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const startLabel = formatter.format(new Date(`${start}T00:00:00Z`));
    if (start === end) return startLabel;
    return `${startLabel} – ${formatter.format(new Date(`${end}T00:00:00Z`))}`;
  }

  private applyTheme(theme: OwnerTheme): void {
    this.theme.set(theme);
    document.documentElement.dataset["ownerTheme"] = theme;
    document.documentElement.style.colorScheme = theme;
    this.writeStorage("auraOwnerTheme", theme);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#151512" : "#F4F1E9");
  }

  private readTheme(): OwnerTheme {
    const saved = this.readStorage("auraOwnerTheme");
    if (saved === "dark" || saved === "light") return saved;
    const staffTheme = this.readStorage("auraStaffTheme");
    if (staffTheme === "dark" || staffTheme === "light") return staffTheme;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  private storageKey(suffix: string, user = this.owner.user()): string {
    return `auraOwner:${user?.id || "unknown"}:${suffix}`;
  }

  private readStorage(key: string): string {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  }

  private writeStorage(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* Owner context remains available for the current session. */ }
  }

  private toBranch(record: OwnerRecord): OwnerBranch | null {
    const id = String(record["id"] || "").trim();
    if (!id) return null;
    return {
      id,
      name: String(record["name"] || "Branch"),
      status: String(record["status"] || "unknown").replaceAll("_", " "),
      city: String(record["city"] || ""),
      location: String(record["location"] || record["address"] || "")
    };
  }

  private isBusinessDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    return this.dateString(Number(match[1]), Number(match[2]), Number(match[3])) === value;
  }

  private dateString(year: number, month: number, day: number): string {
    const date = new Date(Date.UTC(year, month - 1, day));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
}

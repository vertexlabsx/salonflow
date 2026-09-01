import { HttpClient, HttpErrorResponse, HttpHeaders, HttpResponse } from "@angular/common/http";
import { Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { environment } from "../../../environments/environment";
import { OwnerDashboardResponse } from "./owner-dashboard.models";
import {
  OwnerAppointmentBranchOption,
  OwnerAppointmentCancelPayload,
  OwnerAppointmentClientOption,
  OwnerAppointmentDetailResponse,
  OwnerAppointmentLifecycleResponse,
  OwnerAppointmentListParams,
  OwnerAppointmentListResponse,
  OwnerAppointmentNotePayload,
  OwnerAppointmentOptionsResponse,
  OwnerAppointmentPosResponse,
  OwnerAppointmentReschedulePayload,
  OwnerAppointmentServiceOption,
  OwnerAppointmentStaffOption,
  OwnerAppointmentStatusPayload,
  OwnerAppointmentWritePayload
} from "./owner-appointments.models";
import { OwnerAttendance, OwnerAttendanceDevice, OwnerAttendanceEvidence, OwnerAttendancePolicy, OwnerLeave, OwnerLeaveDetail, OwnerListResponse, OwnerPayroll, OwnerPayrollDetail, OwnerShiftSwap, OwnerStaff, OwnerStaffDetail, OwnerStaffWrite } from "./owner-people.models";
import { OwnerExportFile, OwnerFinanceDrilldown, OwnerFinanceOverview, OwnerFinanceQuery, OwnerReportCatalogue, OwnerReportData } from "./owner-finance-reports.models";
import { OwnerCampaign, OwnerChatConversation, OwnerChatMessage, OwnerChatMessagesResponse, OwnerChatReceiptResponse, OwnerClient, OwnerClientDetail, OwnerInventoryDetail, OwnerInventoryResponse, OwnerNotification, OwnerNotificationReceipt, OwnerOperationsQuery, OwnerOperationsResponse } from "./owner-operations.models";
import { OwnerAccessAdministration, OwnerAdministrationUser, OwnerBranchCatalogue, OwnerBranchMutation, OwnerBranchWrite, OwnerRoleMutation, OwnerRoleWrite, OwnerSettingsResponse, OwnerUserWrite, OwnerWhatsAppBotSettings, OwnerWhatsAppBotSettingsResponse, OwnerWhatsAppConversationList, OwnerWhatsAppIntelligence, OwnerWhatsAppMessageList, OwnerWhatsAppStatus, OwnerWhatsAppSignupState } from "./owner-administration.models";
import { OwnerBillingDetail, OwnerBillingList } from "./owner-billing.models";

export interface OwnerPromo {
  _id?: string; id?: string; salonId: string; kind: "coupon" | "referral"; code: string; label: string; description?: string;
  discountType: "percent" | "flat"; discountPercent?: number; discountPaise?: number; minimumSpendPaise?: number;
  maxRedemptions?: number; startsAt?: string; expiresAt?: string; anyBranch: boolean; branchIds: string[];
  status: "active" | "paused" | "expired" | "exhausted"; redemptionCount: number; totalDiscountPaise: number;
  referrerRewardType?: "percent" | "flat"; referrerRewardPercent?: number; referrerRewardPaise?: number;
  createdBy: string; createdAt?: string; updatedAt?: string;
}
export interface OwnerPromoRedemption {
  _id?: string; id?: string; salonId: string; branchId: string; promoId: string; code: string;
  customerId: string; customerName: string; appointmentId?: string; invoiceId?: string;
  discountPaise: number; discountPercent?: number; appliedByUserId: string; appliedAt: string; createdAt?: string;
}
export interface OwnerPromoRedeemResponse {
  promo: OwnerPromo; discountPaise: number; redemptionsUsed: number; remaining: number | null;
}
export interface OwnerExpense {
  id: string; branchId: string; date: string; category: string; vendor: string; description: string; amountPaise: number; taxRateBps: number; taxPaise: number; totalPaise: number; notes: string; createdAt: string;
}
export interface OwnerExpenseList { items: OwnerExpense[]; page: { limit: number; offset: number; total: number; hasMore: boolean; nextOffset: number | null }; metadata: { timezone: string; moneyUnit: string } }
export interface OwnerGstReport { gstin: string; placeOfSupply: string; fromDate: string; toDate: string; taxableValuePaise: number; outputTaxPaise: number; inputCreditPaise: number; netGstPayablePaise: number; collection: { invoiceCount: number; totalCollectedPaise: number }; liability: { type: string; cgstPaise: number; sgstPaise: number; igstPaise: number }; expenses: { count: number; totalExpenseAmountPaise: number; inputTaxPaise: number }; rateBreakdown: Array<{ rateBps: number; taxablePaise: number; taxPaise: number }> }
export interface OwnerGstReportResponse { report: OwnerGstReport; metadata: { timezone: string; moneyUnit: string } }
export interface OwnerGiftCard { id: string; code: string; purchaserName: string; recipientName: string; recipientPhone: string; initialValuePaise: number; balancePaise: number; expiresAt: string; status: string; createdAt: string }
export interface OwnerBundleDeal { id: string; name: string; description: string; items: Array<{ serviceId: string; quantity: number }>; pricePaise: number; startsAt: string; expiresAt: string; status: string; createdAt: string }
export interface OwnerPurchaseOrder { id: string; branchId: string; poNumber: string; supplierName: string; supplierPhone: string; status: string; expectedAt: string; lines: Array<{ itemName: string; sku: string; quantity: number; unitCostPaise: number; totalPaise: number }>; subtotalPaise: number; taxPaise: number; totalPaise: number; notes: string; createdAt: string }
export interface OwnerBusyHourCell { dayOfWeek: number; hour: number; appointments: number; valuePaise: number; intensity: number }
export type OwnerUser = {
  id: string;
  name: string;
  loginId?: string;
  email: string;
  role: string;
  branchId: string;
  branchIds: string[];
};

type OwnerSession = { accessToken: string; refreshToken?: string; user: OwnerUser; tenant?: { id: string; name: string } };
type ApiEnvelope<T> = { success?: boolean; data?: T; error?: { message?: string; details?: { requiresTotp?: boolean } } | string; message?: string };
export type OwnerRecord = Record<string, unknown>;
const OWNER_LOGOUT_PENDING = "auraOwner:logoutPending";

@Injectable({ providedIn: "root" })
export class OwnerAppService {
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, "");
  private accessToken = "";
  private restorePromise?: Promise<boolean>;
  private refreshPromise?: Promise<void>;
  private logoutRequested = false;
  readonly user = signal<OwnerUser | null>(null);
  readonly tenantName = signal("");
  readonly loading = signal(false);
  readonly error = signal("");
  readonly requiresTotp = signal(false);
  readonly sessionExpired = signal(false);

  constructor(private readonly http: HttpClient) {}

  isOwner(): boolean {
    return !!this.accessToken && this.normalizeRole(this.user()?.role) === "owner";
  }

  async restore(): Promise<boolean> {
    if (this.isOwner()) return true;
    if (this.logoutPending()) {
      await this.finishPendingLogout();
      return false;
    }
    if (!this.restorePromise) {
      this.restorePromise = this.refresh().then(() => this.isOwner()).catch(() => false).finally(() => { this.restorePromise = undefined; });
    }
    return this.restorePromise;
  }

  async login(payload: { tenantId: string; loginId: string; password: string; totpToken?: string; twoFactorCode?: string }): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    const completingTotp = this.requiresTotp();
    const twoFactorCode = String(payload.totpToken || payload.twoFactorCode || "").trim();
    try {
      const response = await firstValueFrom(this.http.post<OwnerSession | ApiEnvelope<OwnerSession>>(`${this.baseUrl}/auth/login`, {
        tenantId: payload.tenantId.trim(),
        loginId: payload.loginId.trim(),
        password: payload.password,
        ...(twoFactorCode ? { totpToken: twoFactorCode, twoFactorCode } : {}),
        device: { type: "owner-app", name: "Solastio Owner", platform: "web" }
      }, { withCredentials: true }));
      const session = this.unwrap(response);
      if (this.normalizeRole(session.user?.role) !== "owner") {
        this.setLogoutPending(!(await this.discardNonOwnerSession(session.accessToken)));
        throw new Error("This workspace is reserved for the salon owner.");
      }
      this.applySession(session);
      this.setLogoutPending(false);
    } catch (error) {
      this.clear();
      const requiresTotp = completingTotp || this.isTotpChallenge(error);
      this.requiresTotp.set(requiresTotp);
      this.error.set(requiresTotp && this.isTotpChallenge(error) ? "Enter the code from your authenticator app or a recovery code." : this.errorMessage(error, "Unable to sign in to the owner workspace."));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async logout(): Promise<boolean> {
    this.logoutRequested = true;
    const previousToken = this.accessToken;
    this.invalidateSession();
    try {
      try { await this.refreshPromise; } catch { /* Logout still clears the cookie after a failed refresh. */ }
      const token = this.accessToken || previousToken;
      const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
      this.invalidateSession();
      await firstValueFrom(this.http.post(`${this.baseUrl}/auth/logout`, {}, { headers, withCredentials: true }));
      this.setLogoutPending(false);
      return true;
    } catch {
      this.setLogoutPending(true);
      return false;
    } finally {
      this.logoutRequested = false;
    }
  }

  list(path: string, params: Record<string, string | number | boolean> = {}): Promise<OwnerRecord[]> { return this.get(`/${path}`, params); }
  read(path: string, params: Record<string, string | number | boolean> = {}): Promise<OwnerRecord> { return this.get(`/${path}`, params); }
  financeSummary(): Promise<OwnerRecord> { return this.read("finance/summary"); }
  staffSummary(): Promise<OwnerRecord> { return this.read("staff-management/summary"); }
  reportSummary(): Promise<OwnerRecord> { return this.read("reports/dashboard"); }
  securitySummary(): Promise<OwnerRecord> { return this.read("security/summary"); }
  userManagement(): Promise<OwnerRecord> { return this.read("security/user-management", { includeAllBranches: true }); }
  dashboard(params: { branchId: string; range: string; from?: string; to?: string }): Promise<OwnerDashboardResponse> { return this.get("/owner-console/dashboard", params); }
  ownerBillingInvoices(params: Record<string, string | number | boolean>): Promise<OwnerBillingList> { return this.get("/owner-console/billing/invoices", params); }
  ownerBillingInvoice(id: string): Promise<OwnerBillingDetail> { return this.get(`/owner-console/billing/invoices/${encodeURIComponent(id)}`); }
  recordOwnerInvoicePayment(id: string, payload: { method: "cash" | "card" | "upi" | "bank_transfer" | "other"; amountPaise: number; reference?: string }): Promise<unknown> { return this.post(`/owner-console/finance/invoices/${encodeURIComponent(id)}/payments`, payload); }
  recordOwnerInvoiceTip(id: string, payload: { method: "cash" | "card" | "upi" | "bank_transfer" | "other"; amountPaise: number; reference?: string; staffId?: string }): Promise<unknown> { return this.post(`/owner-console/finance/invoices/${encodeURIComponent(id)}/tips`, payload); }
  voidOwnerInvoice(id: string, reason: string): Promise<unknown> { return this.post(`/owner-console/finance/invoices/${encodeURIComponent(id)}/void`, { reason }); }
  async realtimeSocketTicketUrl(branchId = ""): Promise<string> {
    const response = await this.post<{ ticket: string }>("/realtime/ticket", { branchId: branchId === "all" ? "" : branchId }, true);
    const base = this.baseUrl.startsWith("http") ? new URL(this.baseUrl) : new URL(this.baseUrl, window.location.origin);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/$/, "")}/realtime`;
    base.searchParams.set("ticket", response.ticket);
    if (branchId && branchId !== "all") base.searchParams.set("branchId", branchId);
    return base.toString();
  }
  financeOverview(params: OwnerFinanceQuery): Promise<OwnerFinanceOverview> { return this.get("/owner-console/finance/overview", this.ownerFinanceParams(params)); }
  financeDrilldown(type: string, params: OwnerFinanceQuery): Promise<OwnerFinanceDrilldown> { return this.get("/owner-console/finance/drilldown", { ...this.ownerFinanceParams(params), type }); }
  reportsCatalogue(params: OwnerFinanceQuery): Promise<OwnerReportCatalogue> { return this.get("/owner-console/reports/catalogue", this.ownerFinanceParams(params)); }
  ownerReport(key: string, params: OwnerFinanceQuery): Promise<OwnerReportData> { return this.get(`/owner-console/reports/${encodeURIComponent(key)}`, this.ownerFinanceParams(params)); }
  async exportOwnerReport(reportKey: string, format: "csv" | "xlsx" | "pdf", params: OwnerFinanceQuery): Promise<OwnerExportFile> {
    try { if (!this.accessToken) await this.refresh(); return await this.downloadRequest(reportKey, format, params); }
    catch (error) { if (!this.isSessionRejected(error)) throw error; await this.refresh(); return this.downloadRequest(reportKey, format, params); }
  }
  appointments(params: OwnerAppointmentListParams): Promise<OwnerAppointmentListResponse> {
    const query: { [key: string]: string | number | boolean } = { branchId: params.branchId, from: params.from, to: params.to, limit: params.limit || 100, offset: params.offset || 0 };
    if (params.search) query["search"] = params.search;
    if (params.staffId) query["staffId"] = params.staffId;
    if (params.serviceId) query["serviceId"] = params.serviceId;
    if (params.clientId) query["clientId"] = params.clientId;
    if (params.status) query["status"] = params.status;
    if (params.source) query["source"] = params.source;
    if (params.paymentStatus) query["paymentStatus"] = params.paymentStatus;
    return this.get("/owner-console/appointments", query);
  }
  appointment(id: string): Promise<OwnerAppointmentDetailResponse> { return this.get(`/owner-console/appointments/${encodeURIComponent(id)}`); }
  appointmentBranches(branchId = "all"): Promise<OwnerAppointmentOptionsResponse<OwnerAppointmentBranchOption>> { return this.get("/owner-console/appointments/options/branches", { branchId, limit: 500 }); }
  appointmentClients(branchId: string, search = ""): Promise<OwnerAppointmentOptionsResponse<OwnerAppointmentClientOption>> { return this.get("/owner-console/appointments/options/clients", { branchId, limit: 500, ...(search ? { search } : {}) }); }
  appointmentStaff(branchId: string): Promise<OwnerAppointmentOptionsResponse<OwnerAppointmentStaffOption>> { return this.get("/owner-console/appointments/options/staff", { branchId, limit: 500 }); }
  appointmentServices(branchId: string): Promise<OwnerAppointmentOptionsResponse<OwnerAppointmentServiceOption>> { return this.get("/owner-console/appointments/options/services", { branchId, limit: 500 }); }
  createAppointment(payload: OwnerAppointmentWritePayload): Promise<OwnerAppointmentDetailResponse> { return this.post("/owner-console/appointments", payload); }
  updateAppointment(id: string, payload: OwnerAppointmentWritePayload, version: number): Promise<OwnerAppointmentDetailResponse> { return this.patch(`/owner-console/appointments/${encodeURIComponent(id)}`, { ...payload, version }, new HttpHeaders({ "If-Match": String(version) })); }
  rescheduleAppointment(id: string, payload: OwnerAppointmentReschedulePayload): Promise<OwnerAppointmentLifecycleResponse> { return this.post(`/owner-console/appointments/${encodeURIComponent(id)}/reschedule`, payload); }
  cancelAppointment(id: string, payload: OwnerAppointmentCancelPayload): Promise<OwnerAppointmentLifecycleResponse> { return this.post(`/owner-console/appointments/${encodeURIComponent(id)}/cancel`, payload); }
  setAppointmentStatus(id: string, payload: OwnerAppointmentStatusPayload): Promise<OwnerAppointmentLifecycleResponse> { return this.post(`/owner-console/appointments/${encodeURIComponent(id)}/status`, payload); }
  checkInAppointment(id: string): Promise<OwnerAppointmentLifecycleResponse> { return this.post(`/owner-console/appointments/${encodeURIComponent(id)}/check-in`, {}); }
  startAppointment(id: string): Promise<OwnerAppointmentLifecycleResponse> { return this.post(`/owner-console/appointments/${encodeURIComponent(id)}/start-service`, {}); }
  completeAppointment(id: string, payload: OwnerAppointmentNotePayload): Promise<OwnerAppointmentLifecycleResponse> { return this.post(`/owner-console/appointments/${encodeURIComponent(id)}/complete`, payload); }
  noShowAppointment(id: string, payload: OwnerAppointmentNotePayload): Promise<OwnerAppointmentLifecycleResponse> { return this.post(`/owner-console/appointments/${encodeURIComponent(id)}/no-show`, payload); }
  appointmentPosHandoff(id: string): Promise<OwnerAppointmentPosResponse> { return this.post(`/owner-console/appointments/${encodeURIComponent(id)}/pos-handoff`, {}, true); }
  leaveDecision(id: string, decision: "approve" | "reject", payload: { version?: number; reason?: string }): Promise<OwnerRecord> { return this.patch(`/staff-os/leaves/${encodeURIComponent(id)}/${decision}`, payload); }
  ownerStaff(params: Record<string, string | number | boolean>): Promise<OwnerListResponse<OwnerStaff>> { return this.get("/owner-console/people/staff", params); }
  ownerStaffDetail(id: string, params: Record<string, string | number | boolean>): Promise<OwnerStaffDetail> { return this.get(`/owner-console/people/staff/${encodeURIComponent(id)}`, params); }
  createOwnerStaff(payload: OwnerStaffWrite): Promise<OwnerStaff> { return this.post("/owner-console/people/staff", payload); }
  updateOwnerStaff(id: string, payload: OwnerStaffWrite): Promise<OwnerStaff> { return this.patch(`/owner-console/people/staff/${encodeURIComponent(id)}`, payload); }
  setOwnerStaffStatus(id: string, status: string, version: number): Promise<OwnerStaff> { return this.patch(`/owner-console/people/staff/${encodeURIComponent(id)}/status`, { status, version }); }
  setOwnerStaffLogin(id: string, payload: { loginId: string; email?: string; password?: string; role: string; status: string; branchIds: string[] }): Promise<OwnerRecord> { return this.post(`/owner-console/people/staff/${encodeURIComponent(id)}/login`, payload); }
  transferOwnerStaff(id: string, toBranchId: string, version: number, reason: string): Promise<OwnerStaff> { return this.post(`/owner-console/people/staff/${encodeURIComponent(id)}/transfer`, { toBranchId, version, reason }); }
  createOwnerSchedule(id: string, payload: { branchId: string; scheduleDate: string; startTime: string; endTime: string; shiftType: string; notes?: string }): Promise<OwnerRecord> { return this.post(`/owner-console/people/staff/${encodeURIComponent(id)}/schedules`, payload); }
  ownerShiftSwaps(branchId = "all", status = ""): Promise<OwnerShiftSwap[]> { return this.get("/staff-os/shift-swaps", { branchId, ...(status ? { status } : {}) }); }
  approveOwnerShiftSwap(id: string, version: number): Promise<OwnerShiftSwap> { return this.post(`/staff-os/shift-swaps/${encodeURIComponent(id)}/approve`, { version }); }
  rejectOwnerShiftSwap(id: string, version: number, reason: string): Promise<OwnerShiftSwap> { return this.post(`/staff-os/shift-swaps/${encodeURIComponent(id)}/reject`, { version, reason }); }
  calculateOwnerCommission(id: string, payload: { periodStart: string; periodEnd: string; baseAmountPaise: number; rate: number; commissionType: string }): Promise<OwnerRecord> { return this.post(`/owner-console/people/staff/${encodeURIComponent(id)}/commissions`, payload); }
  ownerAttendance(params: Record<string, string | number | boolean>): Promise<OwnerListResponse<OwnerAttendance>> { return this.get("/owner-console/people/attendance", params); }
  correctOwnerAttendance(id: string, payload: { reason: string; patch: Record<string, string> }): Promise<OwnerRecord> { return this.post(`/owner-console/people/attendance/${encodeURIComponent(id)}/corrections`, payload); }
  resetOwnerAttendance(id: string, payload: { reason: string }): Promise<OwnerRecord> { return this.post(`/owner-console/people/attendance/${encodeURIComponent(id)}/reset`, payload); }
  ownerAttendancePolicy(branchId: string): Promise<OwnerAttendancePolicy> { return this.get(`/attendance-verification/branches/${encodeURIComponent(branchId)}/policy`); }
  saveOwnerAttendancePolicy(branchId: string, policy: OwnerAttendancePolicy): Promise<OwnerAttendancePolicy> { return this.put(`/attendance-verification/branches/${encodeURIComponent(branchId)}/policy`, policy); }
  ownerAttendanceDevices(params: { branchId: string; status?: string }): Promise<OwnerAttendanceDevice[]> { return this.get<{ items: OwnerAttendanceDevice[] }>("/attendance-verification/devices", params).then((response) => response.items); }
  setOwnerAttendanceDeviceStatus(id: string, decision: "approved" | "revoked", version: number, reason: string): Promise<OwnerAttendanceDevice> { return this.post(`/attendance-verification/devices/${encodeURIComponent(id)}/reviews`, { decision, version, reason }); }
  ownerAttendanceEvidence(params: { branchId: string; from: string; to: string; decision?: string }): Promise<OwnerAttendanceEvidence[]> { return this.get<{ items: OwnerAttendanceEvidence[] }>("/attendance-verification/evidence", params).then((response) => response.items); }
  ownerLeaves(params: Record<string, string | number | boolean>): Promise<OwnerListResponse<OwnerLeave>> { return this.get("/owner-console/people/leaves", params); }
  ownerLeaveDetail(id: string): Promise<OwnerLeaveDetail> { return this.get(`/owner-console/people/leaves/${encodeURIComponent(id)}`); }
  decideOwnerLeave(id: string, decision: "approve" | "reject", payload: { version: number; reason?: string }): Promise<OwnerLeave> { return this.patch(`/owner-console/people/leaves/${encodeURIComponent(id)}/${decision}`, payload); }
  ownerPayroll(params: Record<string, string | number | boolean>): Promise<OwnerListResponse<OwnerPayroll>> { return this.get("/owner-console/people/payroll", params); }
  ownerPayrollDetail(id: string): Promise<OwnerPayrollDetail> { return this.get(`/owner-console/people/payroll/${encodeURIComponent(id)}`); }
  generateOwnerPayroll(payload: { branchId: string; periodStart: string; periodEnd: string }, idempotencyKey: string): Promise<OwnerPayroll> { return this.post("/owner-console/people/payroll/generate", payload, false, new HttpHeaders({ "Idempotency-Key": idempotencyKey })); }
  approveOwnerPayroll(id: string): Promise<OwnerPayroll> { return this.post(`/owner-console/people/payroll/${encodeURIComponent(id)}/approve`, {}); }
  markOwnerPayrollPaid(id: string): Promise<OwnerPayroll> { return this.post(`/owner-console/people/payroll/${encodeURIComponent(id)}/mark-paid`, {}); }
  ownerClients(params: OwnerOperationsQuery & { relationship?: string; outstanding?: string; lastVisit?: string }): Promise<OwnerOperationsResponse<OwnerClient>> { return this.get("/owner-console/operations/clients", this.operationsParams(params)); }
  ownerClient(id: string, branchId: string): Promise<OwnerClientDetail> { return this.get(`/owner-console/operations/clients/${encodeURIComponent(id)}`, { branchId }); }
  createOwnerClient(payload: { branchId: string; name: string; phone: string; email?: string; gender?: string; birthday?: string; anniversary?: string; tags?: string[]; notes?: string; address?: string; walletBalancePaise?: number; loyaltyPoints?: number; membershipPlanName?: string; membershipCredits?: number; membershipCreditsRemaining?: number; membershipValidUntil?: string; membershipStatus?: string; packageName?: string; packageCreditsRemaining?: number; subscriptionName?: string; subscriptionStatus?: string }): Promise<{ id: string }> { return this.post("/owner-console/operations/clients", payload); }
  updateOwnerClient(id: string, payload: { name?: string; email?: string; gender?: string; birthday?: string; anniversary?: string; tags?: string[]; notes?: string; address?: string; walletBalancePaise?: number; loyaltyPoints?: number; membershipPlanName?: string; membershipCredits?: number; membershipCreditsRemaining?: number; membershipValidUntil?: string; membershipStatus?: string; packageName?: string; packageCreditsRemaining?: number; subscriptionName?: string; subscriptionStatus?: string }): Promise<{ id: string; updatedAt: string }> { return this.patch(`/owner-console/operations/clients/${encodeURIComponent(id)}`, payload); }
  ownerInventory(params: OwnerOperationsQuery & { category?: string; supplier?: string }): Promise<OwnerInventoryResponse> { return this.get("/owner-console/operations/inventory", this.operationsParams(params)); }
  ownerInventoryProduct(id: string, branchId: string): Promise<OwnerInventoryDetail> { return this.get(`/owner-console/operations/inventory/${encodeURIComponent(id)}`, { branchId }); }
  ownerMarketing(params: OwnerOperationsQuery & { channel?: string }): Promise<OwnerOperationsResponse<OwnerCampaign>> { return this.get("/owner-console/operations/marketing", this.operationsParams({ ...params, branchId: "all" })); }
  ownerNotifications(params: OwnerOperationsQuery & { category?: string; read?: string; type?: string }): Promise<OwnerOperationsResponse<OwnerNotification>> { return this.get("/owner-console/operations/notifications", this.operationsParams(params)); }
  setOwnerNotificationRead(id: string, read: boolean): Promise<OwnerNotificationReceipt> { return this.patch(`/owner-console/operations/notifications/${encodeURIComponent(id)}/receipt`, { read }); }
  markAllOwnerNotificationsRead(branchId: string, filters?: { category?: string; search?: string; read?: string; status?: string }): Promise<{ updated: number; readAt: string }> { return this.post("/owner-console/operations/notifications/mark-all-read", { branchId, ...filters }); }
  ownerChats(params: OwnerOperationsQuery): Promise<OwnerOperationsResponse<OwnerChatConversation>> { return this.get("/owner-console/operations/chats", this.operationsParams(params)); }
  ownerChatMessages(id: string, branchId: string): Promise<OwnerChatMessagesResponse> { return this.get(`/owner-console/operations/chats/${encodeURIComponent(id)}/messages`, { branchId }); }
  createOwnerPrivateChat(branchId: string, staffId: string, idempotencyKey: string): Promise<OwnerChatConversation> { return this.post("/owner-console/operations/chats/private", { branchId, staffId }, false, new HttpHeaders({ "Idempotency-Key": idempotencyKey })); }
  sendOwnerChatMessage(id: string, branchId: string, body: string, idempotencyKey: string): Promise<OwnerChatMessage> { return this.post(`/owner-console/operations/chats/${encodeURIComponent(id)}/messages`, { branchId, body }, false, new HttpHeaders({ "Idempotency-Key": idempotencyKey })); }
  markOwnerChatReceipts(id: string, branchId: string, messageIds: string[], status: "delivered" | "read"): Promise<OwnerChatReceiptResponse> { return this.post(`/owner-console/operations/chats/${encodeURIComponent(id)}/receipts`, { branchId, messageIds, status }); }
  administrationBranches(): Promise<OwnerBranchCatalogue> { return this.get("/owner-console/administration/branches"); }
  createAdministrationBranch(payload: OwnerBranchWrite): Promise<OwnerBranchMutation> { return this.post("/owner-console/administration/branches", payload); }
  updateAdministrationBranch(id: string, payload: OwnerBranchWrite): Promise<OwnerBranchMutation> { return this.patch(`/owner-console/administration/branches/${encodeURIComponent(id)}`, payload); }
  setAdministrationBranchStatus(id: string, status: "active" | "inactive"): Promise<OwnerBranchMutation> { return this.patch(`/owner-console/administration/branches/${encodeURIComponent(id)}/status`, { status }); }
  administrationAccess(branchId = ""): Promise<OwnerAccessAdministration> { return this.get("/owner-console/administration/access", branchId ? { branchId } : {}); }
  saveAdministrationRole(payload: OwnerRoleWrite): Promise<OwnerRoleMutation> { return this.post("/owner-console/administration/roles", payload); }
  restoreAdministrationRoleDefaults(role: string, branchId = ""): Promise<OwnerRoleMutation> { return this.post(`/owner-console/administration/roles/${encodeURIComponent(role)}/restore-defaults`, { branchId }); }
  createAdministrationUser(payload: OwnerUserWrite): Promise<{ user: OwnerAdministrationUser; access: OwnerAccessAdministration }> { return this.post("/owner-console/administration/users", payload); }
  updateAdministrationUser(id: string, payload: Partial<OwnerUserWrite>): Promise<{ user: OwnerAdministrationUser; access: OwnerAccessAdministration }> { return this.patch(`/owner-console/administration/users/${encodeURIComponent(id)}`, payload); }
  administrationSettings(branchId = ""): Promise<OwnerSettingsResponse> { return this.get("/owner-console/administration/settings", branchId ? { branchId } : {}); }
  saveAdministrationSettings(branchId: string, settings: OwnerSettingsResponse["settings"]): Promise<OwnerSettingsResponse> { return this.put("/owner-console/administration/settings", { branchId, settings }); }
  whatsappStatus(): Promise<OwnerWhatsAppStatus> { return this.get("/whatsapp/status"); }
  whatsappSignupState(): Promise<OwnerWhatsAppSignupState> { return this.post("/whatsapp/embedded-signup/state", {}); }
  whatsappSignupCallback(payload: { state: string; authorizationCode: string; wabaId?: string; phoneNumberId?: string; businessId?: string; redirectUri?: string }): Promise<OwnerWhatsAppStatus> { return this.post("/whatsapp/embedded-signup/callback", payload); }
  disconnectWhatsApp(phoneNumberId?: string): Promise<{ connection: unknown }> { return this.post("/whatsapp/disconnect", phoneNumberId ? { phoneNumberId } : {}); }
  whatsappConversations(params: { search?: string; limit?: number; offset?: number } = {}): Promise<OwnerWhatsAppConversationList> { return this.get("/whatsapp/conversations", params); }
  whatsappMessages(phone: string, params: { limit?: number; offset?: number } = {}): Promise<OwnerWhatsAppMessageList> { return this.get(`/whatsapp/conversations/${encodeURIComponent(phone)}/messages`, params); }
  whatsappIntelligence(days = 30): Promise<OwnerWhatsAppIntelligence> { return this.get("/owner-console/whatsapp/intelligence", { days }); }
  whatsappBotSettings(branchId = ""): Promise<OwnerWhatsAppBotSettingsResponse> { return this.get("/owner-console/whatsapp/bot-settings", branchId ? { branchId } : {}); }
  saveWhatsAppBotSettings(branchId: string, settings: OwnerWhatsAppBotSettings): Promise<OwnerWhatsAppBotSettingsResponse> { return this.put("/owner-console/whatsapp/bot-settings", { branchId, settings }); }

  ownerPromos(params: OwnerOperationsQuery & { kind?: string }): Promise<OwnerOperationsResponse<OwnerPromo>> { return this.get("/owner-console/promos", this.operationsParams({ ...params, branchId: "all" })); }
  createOwnerPromo(payload: { kind: string; code?: string; label: string; description?: string; discountType: string; discountPercent?: number; discountPaise?: number; minimumSpendPaise?: number; maxRedemptions?: number; startsAt?: string; expiresAt?: string; branchId: string; branchIds?: string[]; referrerRewardType?: string; referrerRewardPercent?: number; referrerRewardPaise?: number }): Promise<OwnerPromo> { return this.post("/owner-console/promos", payload); }
  setOwnerPromoStatus(id: string, status: "active" | "paused"): Promise<OwnerPromo> { return this.patch(`/owner-console/promos/${encodeURIComponent(id)}/status`, { status }); }
  ownerPromoRedemptions(id: string, params: { page?: number; pageSize?: number } = {}): Promise<OwnerOperationsResponse<OwnerPromoRedemption>> { return this.get(`/owner-console/promos/${encodeURIComponent(id)}/redemptions`, params); }
  redeemOwnerPromo(payload: { code: string; customerId?: string; customerPhone?: string; valuePaise: number; branchId?: string; appointmentId?: string; invoiceId?: string }): Promise<OwnerPromoRedeemResponse> { return this.post("/owner-console/promos/redeem", payload); }
  ownerExpenses(params: { branchId: string; fromDate: string; toDate: string; category?: string; limit?: number; offset?: number }): Promise<OwnerExpenseList> { return this.get("/owner-console/finance/expenses", params); }
  createOwnerExpense(payload: Omit<OwnerExpense, "id" | "taxPaise" | "totalPaise" | "createdAt">): Promise<{ expense: OwnerExpense }> { return this.post("/owner-console/finance/expenses", payload); }
  updateOwnerExpense(id: string, payload: Omit<OwnerExpense, "id" | "taxPaise" | "totalPaise" | "createdAt">): Promise<{ expense: OwnerExpense }> { return this.put(`/owner-console/finance/expenses/${encodeURIComponent(id)}`, payload); }
  deleteOwnerExpense(id: string): Promise<{ id: string }> { return this.delete(`/owner-console/finance/expenses/${encodeURIComponent(id)}`); }
  ownerGstReport(params: { branchId: string; fromDate: string; toDate: string }): Promise<OwnerGstReportResponse> { return this.get("/owner-console/finance/gst-report", params); }
  ownerGiftCards(params: { status?: string } = {}): Promise<{ items: OwnerGiftCard[] }> { return this.get("/owner-console/commerce/gift-cards", params); }
  createOwnerGiftCard(payload: { purchaserName?: string; recipientName?: string; recipientPhone?: string; initialValuePaise: number; expiresAt?: string }): Promise<{ giftCard: Pick<OwnerGiftCard, "id" | "code" | "status" | "balancePaise"> }> { return this.post("/owner-console/commerce/gift-cards", payload); }
  setOwnerGiftCardStatus(id: string, status: string): Promise<{ id: string; status: string }> { return this.patch(`/owner-console/commerce/gift-cards/${encodeURIComponent(id)}/status`, { status }); }
  redeemOwnerGiftCard(id: string, payload: { amountPaise: number; reference?: string }): Promise<{ giftCard: Pick<OwnerGiftCard, "id" | "code" | "status" | "balancePaise"> }> { return this.post(`/owner-console/commerce/gift-cards/${encodeURIComponent(id)}/redeem`, payload); }
  ownerBundles(): Promise<{ items: OwnerBundleDeal[] }> { return this.get("/owner-console/commerce/bundles"); }
  createOwnerBundle(payload: { name: string; description?: string; items: Array<{ serviceId: string; quantity: number }>; pricePaise: number; startsAt?: string; expiresAt?: string; status?: string }): Promise<{ bundle: Pick<OwnerBundleDeal, "id" | "name" | "status" | "pricePaise"> }> { return this.post("/owner-console/commerce/bundles", payload); }
  setOwnerBundleStatus(id: string, status: string): Promise<{ id: string; status: string }> { return this.patch(`/owner-console/commerce/bundles/${encodeURIComponent(id)}/status`, { status }); }
  ownerPurchaseOrders(params: { branchId: string; status?: string }): Promise<{ items: OwnerPurchaseOrder[] }> { return this.get("/owner-console/operations/purchase-orders", params); }
  createOwnerPurchaseOrder(payload: { branchId: string; supplierName: string; supplierPhone?: string; expectedAt?: string; taxPaise?: number; notes?: string; lines: Array<{ itemName: string; sku?: string; quantity: number; unitCostPaise: number }> }): Promise<{ purchaseOrder: Pick<OwnerPurchaseOrder, "id" | "poNumber" | "status" | "totalPaise"> }> { return this.post("/owner-console/operations/purchase-orders", payload); }
  setOwnerPurchaseOrderStatus(id: string, status: string): Promise<{ id: string; status: string }> { return this.patch(`/owner-console/operations/purchase-orders/${encodeURIComponent(id)}/status`, { status }); }
  sendOwnerReviewRequest(clientId: string, payload: { reviewUrl: string; message?: string }): Promise<{ id: string; sent: boolean }> { return this.post(`/owner-console/operations/clients/${encodeURIComponent(clientId)}/review-request`, payload); }
  createOwnerClientPhoto(clientId: string, payload: { branchId: string; appointmentId?: string; beforeUrl?: string; afterUrl?: string; caption?: string; serviceNames?: string[] }): Promise<{ photo: unknown }> { return this.post(`/owner-console/operations/clients/${encodeURIComponent(clientId)}/photos`, payload); }
  deleteOwnerClientPhoto(clientId: string, photoId: string): Promise<{ id: string }> { return this.delete(`/owner-console/operations/clients/${encodeURIComponent(clientId)}/photos/${encodeURIComponent(photoId)}`); }
  ownerBusyHours(params: { branchId: string; fromDate: string; toDate: string }): Promise<{ cells: OwnerBusyHourCell[]; metadata: { timezone: string; fromDate: string; toDate: string; branchId: string } }> { return this.get("/owner-console/analytics/busy-hours", params); }

  private async get<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    try {
      if (!this.accessToken) await this.refresh();
      return await this.request<T>(path, params);
    } catch (error) {
      if (!this.isSessionRejected(error)) throw error;
      await this.refresh();
      return this.request<T>(path, params);
    }
  }

  private async request<T>(path: string, params: Record<string, string | number | boolean>): Promise<T> {
    const response = await firstValueFrom(this.http.get<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, { headers: this.authHeaders(), params }));
    return this.unwrap(response);
  }

  private async downloadRequest(reportKey: string, format: "csv" | "xlsx" | "pdf", params: OwnerFinanceQuery): Promise<OwnerExportFile> {
    const response: HttpResponse<Blob> = await firstValueFrom(this.http.get(`${this.baseUrl}/owner-console/reports/export`, { headers: this.authHeaders(), params: { ...this.ownerFinanceParams(params), reportKey, format }, observe: "response", responseType: "blob" }));
    const disposition = response.headers.get("content-disposition") || "";
    const filename = /filename="([^"]+)"/i.exec(disposition)?.[1] || `owner-report.${format}`;
    return { blob: response.body || new Blob(), filename };
  }

  private ownerFinanceParams(params: OwnerFinanceQuery): Record<string, string | number | boolean> {
    const query: Record<string, string | number | boolean> = { branchId: params.branchId, from: params.from, to: params.to };
    if (params.page !== undefined) query["page"] = params.page;
    if (params.pageSize !== undefined) query["pageSize"] = params.pageSize;
    if (params.search) query["search"] = params.search;
    if (params.status) query["status"] = params.status;
    if (params.paymentMethod) query["paymentMethod"] = params.paymentMethod;
    if (params.sortBy) query["sortBy"] = params.sortBy;
    if (params.sortDirection) query["sortDirection"] = params.sortDirection;
    return query;
  }

  private operationsParams(params: OwnerOperationsQuery & { relationship?: string; outstanding?: string; lastVisit?: string; category?: string; supplier?: string; channel?: string; read?: string; type?: string }): Record<string, string | number | boolean> {
    const query: Record<string, string | number | boolean> = { branchId: params.branchId, page: params.page, pageSize: params.pageSize };
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "" && !["branchId", "page", "pageSize"].includes(key)) query[key] = value;
    return query;
  }

  private async post<T>(path: string, body: object, withCredentials = false, extraHeaders?: HttpHeaders): Promise<T> {
    try {
      if (!this.accessToken) await this.refresh();
      const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.mergeAuthHeaders(extraHeaders), withCredentials }));
      return this.unwrap(response);
    } catch (error) {
      if (!this.isSessionRejected(error)) throw error;
      await this.refresh();
      const response = await firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.mergeAuthHeaders(extraHeaders), withCredentials }));
      return this.unwrap(response);
    }
  }

  private async patch<T>(path: string, body: object, extraHeaders?: HttpHeaders): Promise<T> {
    try {
      if (!this.accessToken) await this.refresh();
      const response = await firstValueFrom(this.http.patch<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.mergeAuthHeaders(extraHeaders) }));
      return this.unwrap(response);
    } catch (error) {
      if (!this.isSessionRejected(error)) throw error;
      await this.refresh();
      const response = await firstValueFrom(this.http.patch<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.mergeAuthHeaders(extraHeaders) }));
      return this.unwrap(response);
    }
  }

  private async put<T>(path: string, body: object): Promise<T> {
    try {
      if (!this.accessToken) await this.refresh();
      const response = await firstValueFrom(this.http.put<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.authHeaders() }));
      return this.unwrap(response);
    } catch (error) {
      if (!this.isSessionRejected(error)) throw error;
      await this.refresh();
      const response = await firstValueFrom(this.http.put<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body, { headers: this.authHeaders() }));
      return this.unwrap(response);
    }
  }

  private async delete<T>(path: string): Promise<T> {
    try {
      if (!this.accessToken) await this.refresh();
      const response = await firstValueFrom(this.http.delete<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, { headers: this.authHeaders() }));
      return this.unwrap(response);
    } catch (error) {
      if (!this.isSessionRejected(error)) throw error;
      await this.refresh();
      const response = await firstValueFrom(this.http.delete<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, { headers: this.authHeaders() }));
      return this.unwrap(response);
    }
  }

  private async refresh(): Promise<void> {
    if (this.logoutRequested || this.logoutPending()) throw new Error("Owner sign-out is in progress.");
    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().catch((error) => { this.invalidateSession(); throw error; }).finally(() => { this.refreshPromise = undefined; });
    }
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<void> {
    const response = await firstValueFrom(this.http.post<OwnerSession | ApiEnvelope<OwnerSession>>(`${this.baseUrl}/auth/refresh`, {
      device: { type: "owner-app", name: "Solastio Owner", platform: "web" }
    }, { withCredentials: true }));
    const session = this.unwrap(response);
    if (this.normalizeRole(session.user?.role) !== "owner") {
      this.setLogoutPending(!(await this.discardNonOwnerSession(session.accessToken)));
      this.clear();
      throw new Error("Owner access is required.");
    }
    if (this.logoutRequested) {
      this.accessToken = session.accessToken;
      return;
    }
    this.applySession(session);
  }

  private applySession(session: OwnerSession): void {
    this.accessToken = session.accessToken;
    this.user.set(session.user);
    this.tenantName.set(session.tenant?.name || "");
    this.requiresTotp.set(false);
    this.sessionExpired.set(false);
  }

  private clear(): void {
    this.accessToken = "";
    this.user.set(null);
    this.tenantName.set("");
  }

  private invalidateSession(): void {
    this.clear();
    this.sessionExpired.set(true);
  }

  private async finishPendingLogout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.baseUrl}/auth/logout`, {}, { withCredentials: true }));
      this.setLogoutPending(false);
    } catch { /* Keep blocking refresh restoration until cookie revocation succeeds. */ }
  }

  private logoutPending(): boolean {
    try { return localStorage.getItem(OWNER_LOGOUT_PENDING) === "true"; } catch { return false; }
  }

  private setLogoutPending(pending: boolean): void {
    try { pending ? localStorage.setItem(OWNER_LOGOUT_PENDING, "true") : localStorage.removeItem(OWNER_LOGOUT_PENDING); } catch { /* The in-memory session is still closed. */ }
  }

  private authHeaders(): HttpHeaders {
    if (this.logoutRequested) throw new Error("Owner sign-out is in progress.");
    if (!this.accessToken) throw new Error("Owner sign-in is required.");
    return new HttpHeaders({ Authorization: `Bearer ${this.accessToken}` });
  }

  private mergeAuthHeaders(headers?: HttpHeaders): HttpHeaders {
    let result = this.authHeaders();
    for (const key of headers?.keys() || []) result = result.set(key, headers?.get(key) || "");
    return result;
  }

  private async discardNonOwnerSession(token: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.post(`${this.baseUrl}/auth/logout`, {}, {
        headers: token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined,
        withCredentials: true
      }));
      return true;
    } catch {
      return false;
    }
  }

  private normalizeRole(role?: string): string {
    return String(role || "").trim().replace(/[\s_-]+/g, "").toLowerCase();
  }

  private isSessionRejected(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (
      error.status === 401 ||
      (error.status === 400 && this.isProxyBadRequest(error.error))
    );
  }

  private isProxyBadRequest(body: unknown): boolean {
    return typeof body === "string" && /<title>\s*400 Bad Request\s*<\/title>/i.test(body);
  }

  private unwrap<T>(response: T | ApiEnvelope<T>): T {
    if (response && typeof response === "object" && "data" in response) {
      const envelope = response as ApiEnvelope<T>;
      if (envelope.data !== undefined) return envelope.data;
      const error = envelope.error;
      throw new Error((typeof error === "string" ? error : error?.message) || envelope.message || "Unexpected owner API response.");
    }
    return response as T;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (this.isNetworkError(error)) return "No internet connection. Please check your network and try again.";
    if (error instanceof HttpErrorResponse) {
      const body = error.error as ApiEnvelope<unknown> | { message?: string } | string | undefined;
      if (this.isProxyBadRequest(body)) return "Session request was rejected. Please sign in again.";
      if (typeof body === "string" && body.trim()) return body;
      if (body && typeof body === "object") {
        const nested = "error" in body ? body.error : undefined;
        const message = typeof nested === "string" ? nested : nested?.message || body.message;
        if (message) return message;
      }
    }
    return error instanceof Error ? error.message : fallback;
  }

  private isNetworkError(error: unknown): boolean {
    if (!navigator.onLine) return true;
    if (!(error instanceof Error)) return false;
    const msg = (error.message || "").toLowerCase();
    return msg.includes("no address associated with hostname") ||
      msg.includes("unable to host") ||
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("err_network") ||
      msg.includes("err_name_not_resolved") ||
      msg.includes("fetch failed") ||
      msg.includes("network request failed");
  }

  private isTotpChallenge(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse) || !error.error || typeof error.error !== "object") return false;
    const body = error.error as ApiEnvelope<unknown> & { details?: { requiresTotp?: boolean } };
    const nested = typeof body.error === "object" ? body.error.details : undefined;
    return body.details?.requiresTotp === true || nested?.requiresTotp === true;
  }
}

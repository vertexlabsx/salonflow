export type OwnerAppointmentView = "list" | "day" | "week" | "staff" | "branch";

export type OwnerAppointmentAction =
  | "update"
  | "reschedule"
  | "cancel"
  | "checkIn"
  | "startService"
  | "complete"
  | "noShow"
  | "setStatus"
  | "openPos";

export interface OwnerAppointment {
  id: string;
  branchId: string;
  clientId: string;
  staffId: string;
  serviceIds: string[];
  startAt: string;
  endAt?: string | null;
  status: string;
  source?: string | null;
  sourceChannel?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  version: number;
  clientName?: string | null;
  clientPhone?: string | null;
  staffName?: string | null;
  branchName?: string | null;
  paymentStatus?: string | null;
  touchupCostPaise?: number;
}

export interface OwnerAppointmentPageInfo {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface OwnerAppointmentListMetadata {
  timezone: string;
  moneyUnit: "paise";
  branchIds: string[];
  filters: OwnerAppointmentAppliedFilters;
  supportedFilters: string[];
}

export interface OwnerAppointmentAppliedFilters {
  from: string;
  to: string;
  branchId: string;
  search: string | null;
  staffId: string | null;
  serviceId: string | null;
  clientId: string | null;
  status: string | null;
  source: string | null;
  paymentStatus: string | null;
}

export interface OwnerAppointmentListResponse {
  items: OwnerAppointment[];
  page: OwnerAppointmentPageInfo;
  metadata: OwnerAppointmentListMetadata;
}

export interface OwnerAppointmentListParams {
  branchId: string;
  from: string;
  to: string;
  search?: string;
  staffId?: string;
  serviceId?: string;
  clientId?: string;
  status?: string;
  source?: string;
  paymentStatus?: string;
  limit?: number;
  offset?: number;
}

export interface OwnerAppointmentBranchOption {
  id: string;
  name: string;
  city?: string | null;
  timezone?: string | null;
  status: string;
}

export interface OwnerAppointmentClientOption {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  branchId: string;
}

export interface OwnerAppointmentStaffOption {
  id: string;
  name: string;
  role?: string | null;
  branchId: string;
  status: string;
}

export interface OwnerAppointmentServiceOption {
  id: string;
  name: string;
  branchId?: string | null;
  category?: string | null;
  pricePaise: number;
  durationMinutes?: number | null;
  status: string;
}

export type OwnerAppointmentOptionResource = "branches" | "clients" | "staff" | "services";
export interface OwnerAppointmentOptionsResponse<T> { items: T[]; }

export interface OwnerAppointmentContext {
  client: OwnerAppointmentClientOption | null;
  staff: OwnerAppointmentStaffOption | null;
  branch: OwnerAppointmentBranchOption | null;
  services: OwnerAppointmentServiceOption[];
}

export interface OwnerAppointmentInvoice {
  id: string;
  invoiceNumber?: string | null;
  status: string;
  paymentStatus: string;
  grandTotalPaise: number;
  paidAmountPaise: number;
  dueAmountPaise: number;
  createdAt?: string | null;
}

export interface OwnerAppointmentBilling {
  eligible: boolean;
  reason: string | null;
  invoice: OwnerAppointmentInvoice | null;
}

export interface OwnerAppointmentActivity {
  id: string;
  action: string;
  actionGroup?: string | null;
  statusBefore?: string | null;
  statusAfter?: string | null;
  changedBy?: string | null;
  changedByRole?: string | null;
  source?: string | null;
  reason?: string | null;
  createdAt: string;
  version?: number | null;
}

export interface OwnerAppointmentDetailMetadata {
  timezone: string;
  moneyUnit: "paise";
  activitySource: string;
}

export interface OwnerAppointmentDetailResponse {
  appointment: OwnerAppointment;
  context: OwnerAppointmentContext;
  billing: OwnerAppointmentBilling;
  supportedActions: OwnerAppointmentAction[];
  allowedStatusTransitions: string[];
  version: number;
  activityHistory: OwnerAppointmentActivity[];
  metadata: OwnerAppointmentDetailMetadata;
}

export interface OwnerAppointmentWritePayload {
  branchId: string;
  clientId: string;
  staffId: string;
  serviceIds: string[];
  startAt: string;
  endAt?: string;
  notes?: string;
  status?: string;
  source?: string;
  version?: number;
}

export interface OwnerAppointmentReschedulePayload {
  branchId: string;
  staffId: string;
  startAt: string;
  endAt?: string;
  reason?: string;
}

export interface OwnerAppointmentCancelPayload { reason: string; }
export interface OwnerAppointmentStatusPayload { status: string; reason?: string; }
export interface OwnerAppointmentNotePayload { notes?: string; reason?: string; }

export interface OwnerAppointmentLifecycleResponse {
  appointment: OwnerAppointment | null;
  appointments?: OwnerAppointment[];
  bookingGroupId?: string;
  appliedToGroup?: boolean;
}

export interface OwnerAppointmentFormValue {
  branchId: string;
  clientId: string;
  staffId: string;
  serviceIds: string[];
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  notes: string;
  status: string;
  source: string;
}

export interface OwnerAppointmentRescheduleFormValue {
  branchId: string;
  staffId: string;
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  reason: string;
}

export interface OwnerAppointmentFormErrors {
  branchId?: string;
  clientId?: string;
  staffId?: string;
  serviceIds?: string;
  startAt?: string;
  endAt?: string;
  reason?: string;
  status?: string;
}

export interface OwnerAppointmentConflict {
  id?: string;
  startAt?: string;
  endAt?: string;
  staffId?: string;
  message?: string;
}

export interface OwnerAppointmentApiErrorDetails {
  conflicts?: OwnerAppointmentConflict[];
  currentVersion?: number;
  violations?: Array<{ message?: string; rule?: string }>;
}

export interface OwnerAppointmentApiErrorBody {
  message?: string;
  error?: string | { message?: string; details?: OwnerAppointmentApiErrorDetails };
  details?: OwnerAppointmentApiErrorDetails;
}

export interface OwnerAppointmentPosResponse {
  targetUrl: string;
  expiresAt: string;
}

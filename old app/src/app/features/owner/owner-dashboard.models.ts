export type OwnerDashboardTrend = "positive" | "negative" | "flat" | "unavailable";
export type OwnerDashboardUnit = "paise" | "count";

export interface OwnerDashboardAvailability {
  available: boolean;
  partial?: boolean;
  reason: string | null;
}

export type OwnerDashboardFilterValue = string | number | boolean | string[] | number[] | null;

export interface OwnerDashboardFilters {
  [key: string]: OwnerDashboardFilterValue;
}

export interface OwnerDashboardDestination {
  route: string;
  filters: OwnerDashboardFilters;
}

export interface OwnerDashboardTrace {
  apiRoute: string;
  filters: OwnerDashboardFilters;
  sourceLabel: string;
}

export interface OwnerDashboardSupport extends OwnerDashboardTrace {}

export interface OwnerDashboardComparisonValue {
  unit: OwnerDashboardUnit;
  current: number | null;
  previous: number | null;
  absoluteDelta: number | null;
  percentDelta: number | null;
  trend: OwnerDashboardTrend;
  comparisonAvailable: boolean;
  availability: OwnerDashboardAvailability;
}

export interface OwnerDashboardSparkPoint {
  bucket: string;
  valuePaise: number;
}

export interface OwnerDashboardKpi extends OwnerDashboardComparisonValue {
  sparkline?: OwnerDashboardSparkPoint[];
  support: OwnerDashboardSupport;
}

export interface OwnerDashboardKpis {
  netRevenuePaise: OwnerDashboardKpi;
  grossSalesPaise: OwnerDashboardKpi;
  appointments: OwnerDashboardKpi;
  completedAppointments: OwnerDashboardKpi;
  newClients: OwnerDashboardKpi;
  returningClients: OwnerDashboardKpi;
  averageBillPaise: OwnerDashboardKpi;
  outstandingPaise: OwnerDashboardKpi;
}

export interface OwnerDashboardRange {
  key?: string;
  from: string;
  to: string;
  spanDays: number;
  timezone: string;
}

export interface OwnerDashboardBranch {
  id: string;
  name: string;
  city: string;
  timezone: string;
  status: string;
}

export interface OwnerDashboardContext {
  selection: { type: "branch" | "allAccessibleBranches"; branchId: string | null; label: string };
  accessibleBranches: OwnerDashboardBranch[];
  selectedBranchIds: string[];
  currentRange: OwnerDashboardRange;
  previousRange: OwnerDashboardRange;
  customRangeLimitDays: number;
  generatedAt: string;
}

export interface OwnerRevenuePoint {
  bucket: string;
  netRevenuePaise: number;
}

export interface OwnerRevenueAggregates {
  grossSalesPaise: OwnerDashboardComparisonValue;
  netRevenuePaise: OwnerDashboardComparisonValue;
  discountsPaise: OwnerDashboardComparisonValue;
  taxesPaise: OwnerDashboardComparisonValue;
  outstandingPaise: OwnerDashboardComparisonValue;
  refundsPaise: OwnerDashboardComparisonValue;
  serviceRevenuePaise: OwnerDashboardComparisonValue;
  productRevenuePaise: OwnerDashboardComparisonValue;
}

export interface OwnerDashboardRevenue {
  grouping: "day" | "week" | "month";
  unit: "paise";
  current: OwnerRevenuePoint[];
  previous: OwnerRevenuePoint[];
  aggregates: OwnerRevenueAggregates;
  availability?: OwnerDashboardAvailability;
  support?: OwnerDashboardSupport;
}

export interface OwnerAppointmentStatusCount { status: string; count: number; }
export interface OwnerAppointmentPeakDay { date: string; appointments: number; }
export interface OwnerAppointmentPeakHour { hour: string; appointments: number; }

export interface OwnerDashboardAppointments {
  statusCounts: OwnerAppointmentStatusCount[];
  peakDay: OwnerAppointmentPeakDay | null;
  peakHour: OwnerAppointmentPeakHour | null;
  availability?: OwnerDashboardAvailability;
  support?: OwnerDashboardSupport;
}

export type OwnerStaffOperationalStatus = "clockedIn" | "scheduledWithAppointments" | "scheduled" | "statusUnavailable";

export interface OwnerStaffOperation {
  id: string;
  name: string;
  role: string;
  branchId: string;
  operationalStatus: OwnerStaffOperationalStatus;
  statusSource: string;
  bookedAppointments: number;
}

export interface OwnerDashboardStaffOperations {
  asOfBusinessDate: string;
  realtimePresenceClaimed: boolean;
  availability: OwnerDashboardAvailability;
  staff: OwnerStaffOperation[];
}

export type OwnerActionSeverity = "critical" | "attention" | "warning" | "info";

export interface OwnerActionItem {
  id: string;
  type: string;
  label: string;
  severity: OwnerActionSeverity;
  relevantDate: string | null;
  branchId: string;
  count?: number;
  value?: number;
  valuePaise?: number;
  threshold?: number;
  sourceRecordId: string;
  sourceLabel: string;
  destination: OwnerDashboardDestination;
  trace: OwnerDashboardTrace;
}

export interface OwnerActionCategory {
  available: boolean;
  count: number | null;
  reason: string | null;
  destination: OwnerDashboardDestination | null;
  trace: OwnerDashboardTrace | null;
}

export interface OwnerActionCategories { [key: string]: OwnerActionCategory; }

export interface OwnerDashboardActionCentre {
  categories: OwnerActionCategories;
  totalAvailableActions: number | null;
  itemsReturned: number;
  items: OwnerActionItem[];
}

export type OwnerSummaryGroup = "positive" | "attention" | "operational";

export interface OwnerDashboardSummary {
  id: string;
  group: OwnerSummaryGroup;
  label: string;
  condition: string;
  currentValue: number;
  comparisonValue: number | null;
  metricKey: string;
  destination: OwnerDashboardDestination;
  trace: OwnerDashboardTrace;
  context: OwnerDashboardFilters;
  sourceLabel: string;
}

export interface OwnerDashboardSummaries {
  positive: OwnerDashboardSummary[];
  attention: OwnerDashboardSummary[];
  operational: OwnerDashboardSummary[];
}

export interface OwnerBranchComparisonValue extends OwnerDashboardComparisonValue { missingData: boolean; }

export interface OwnerBranchComparisonMetrics {
  netRevenuePaise: OwnerBranchComparisonValue;
  grossSalesPaise: OwnerBranchComparisonValue;
  appointments: OwnerBranchComparisonValue;
  completedAppointments: OwnerBranchComparisonValue;
  averageBillPaise: OwnerBranchComparisonValue;
  refundsPaise: OwnerBranchComparisonValue;
  serviceRevenuePaise: OwnerBranchComparisonValue;
  productRevenuePaise: OwnerBranchComparisonValue;
}

export interface OwnerBranchComparisonRow {
  branchId: string;
  branchName: string;
  metrics: OwnerBranchComparisonMetrics;
  contributionPercent: number | null;
  comparable: boolean;
  missingData: boolean;
  rank: null;
}

export interface OwnerDashboardBranchComparison {
  contributionMetric: "netRevenuePaise";
  rankingApplied: false;
  branches: OwnerBranchComparisonRow[];
}

export interface OwnerSourceWarning { source: string; code: string; message: string; }
export interface OwnerSourceAvailability { [key: string]: OwnerDashboardAvailability; }

export interface OwnerDashboardSources {
  availability: OwnerSourceAvailability;
  partial: boolean;
  warnings: OwnerSourceWarning[];
}

export interface OwnerDashboardResponse {
  schemaVersion: string;
  context: OwnerDashboardContext;
  kpis: OwnerDashboardKpis;
  revenue: OwnerDashboardRevenue;
  appointments: OwnerDashboardAppointments;
  staffOperations: OwnerDashboardStaffOperations;
  actionCentre: OwnerDashboardActionCentre;
  branchComparison: OwnerDashboardBranchComparison;
  summaries: OwnerDashboardSummaries;
  sources: OwnerDashboardSources;
}

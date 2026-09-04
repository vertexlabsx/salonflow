export type OwnerAvailability = { available: boolean; reason: string | null };
export type OwnerReportCell = string | number | null;
export type OwnerReportRow = Record<string, OwnerReportCell>;
export type OwnerColumnType = "text" | "date" | "money" | "number";
export interface OwnerTypedColumn { key: string; label: string; type: OwnerColumnType; sortable: boolean; }
export interface OwnerPagination { page: number; pageSize: number; total: number; pages: number; }
export interface OwnerFinanceMetric { currentPaise: number | null; previousPaise: number | null; deltaPercent: number | null; availability: OwnerAvailability; }
export type OwnerFinanceMetricKey = "grossSales" | "netRevenue" | "cashCollected" | "outstanding" | "refunds" | "expenses" | "taxes" | "discounts" | "profit" | "tips";
export type OwnerDrilldownType = "sales" | "payments" | "outstanding" | "refunds" | "expenses" | "creditNotes";
export interface OwnerFinanceOverview {
  context: { branchId: string; branchLabel: string; from: string; to: string; timezone: string; generatedAt: string };
  kpis: Record<OwnerFinanceMetricKey, OwnerFinanceMetric>;
  trend: Array<{ date: string; netRevenuePaise: number }>;
  paymentMethods: Array<{ method: string; amountPaise: number }>;
  breakdown: { grossSalesPaise: number; discountsPaise: number; taxesPaise: number; netRevenuePaise: number; cashCollectedPaise: number; outstandingPaise: number; refundsPaise: number; expensesPaise: number; creditNotesPaise: number | null; serviceRevenuePaise: number | null; productRevenuePaise: number | null; membershipRevenuePaise: number | null; packageRevenuePaise: number | null };
  branchComparison: Array<{ branchId: string; branchName: string; grossSalesPaise: number; netRevenuePaise: number; invoiceCount: number }>;
  drilldowns: Record<OwnerFinanceMetricKey, OwnerDrilldownType | null>;
  availability: Record<string, OwnerAvailability>;
  partial: boolean;
  warnings: Array<{ source: string; message: string }>;
}
export interface OwnerFinanceDrilldown { metadata: { type: OwnerDrilldownType; from: string; to: string; branchLabel: string }; columns: OwnerTypedColumn[]; rows: OwnerReportRow[]; pagination: OwnerPagination; availability: OwnerAvailability; }
export interface OwnerReportCatalogueItem { key: string; category: "sales" | "appointments" | "clients" | "staff" | "inventory" | "branch"; title: string; description: string; available: boolean; reason?: string; }
export interface OwnerReportCatalogue { categories: string[]; reports: OwnerReportCatalogueItem[]; context: { branchLabel: string; from: string; to: string } }
export interface OwnerReportData {
  metadata: OwnerReportCatalogueItem & { from: string; to: string; branchLabel: string; generatedAt?: string; timezone?: string; appliedFilters?: Record<string, string> };
  totals: Record<string, number | null>;
  series: Array<{ label: string; value: number }>;
  columns: OwnerTypedColumn[];
  rows: OwnerReportRow[];
  pagination: OwnerPagination;
  availability: OwnerAvailability;
  partial?: boolean;
}
export interface OwnerFinanceQuery { branchId: string; from: string; to: string; page?: number; pageSize?: number; search?: string; status?: string; paymentMethod?: string; sortBy?: string; sortDirection?: "asc" | "desc"; }
export interface OwnerExportFile { blob: Blob; filename: string; }

export interface OwnerBillingInvoice {
  id: string; invoiceNumber: string; branchId: string; branchName: string; customerId: string; customerName: string;
  status: string; paymentStatus: string; grandTotalPaise: number; paidAmountPaise: number; dueAmountPaise: number;
  currency: string; dueDate: string; createdAt: string; finalizedAt: string; updatedAt: string;
}

export interface OwnerBillingList {
  context: { branchId: string; branchIds: string[]; from: string; to: string; timezone: string };
  summary: { invoiceCount: number; billedPaise: number; paidPaise: number; outstandingPaise: number; overduePaise: number };
  items: OwnerBillingInvoice[];
  page: { page: number; pageSize: number; total: number; pages: number; hasMore: boolean };
  capabilities: Record<string, boolean>;
}

export interface OwnerBillingDetail {
  invoice: OwnerBillingInvoice;
  items: Array<{ id: string; name: string; type: string; quantity: number; unitPricePaise: number; discountAmountPaise: number; taxAmountPaise: number; totalAmountPaise: number }>;
  taxes: Array<{ id: string; type: string; rate: number; amountPaise: number }>;
  payments: Array<{ id: string; method: string; status: string; reference: string; amountPaise: number; paidAt: string; createdAt: string }>;
  events: Array<{ id: string; type: string; actorUserId: string; createdAt: string }>;
  capabilities: Record<string, boolean>;
}

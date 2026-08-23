export interface OwnerOperationsPage { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean; }
export interface OwnerOperationsMetadata { timezone: "Asia/Kolkata"; partial: boolean; unavailableSources: string[]; scopeNote?: string; filters?: Record<string, string>; unreadTotal?: number; }
export interface OwnerOperationsResponse<T> { items: T[]; page: OwnerOperationsPage; metadata: OwnerOperationsMetadata; }
export interface OwnerOperationsQuery { branchId: string; page: number; pageSize: number; search?: string; status?: string; from?: string; to?: string; sort?: string; sortDirection?: "asc" | "desc"; }

export interface OwnerClient {
  id: string; name: string; phone: string; email: string; branchId: string; branchName: string; status: string;
  visitCount: number; totalSpendPaise: number; lastVisitAt: string; walletBalancePaise: number; loyaltyPoints: number;
  membershipId: string; outstandingPaise: number; createdAt: string; updatedAt: string;
}
export interface OwnerClientAppointment { id: string; branchId: string; branchName: string; startAt: string; endAt: string; status: string; serviceIds: string[]; notes: string; createdAt: string; }
export interface OwnerClientPurchase { id: string; branchId: string; branchName: string; items: unknown[]; totalPaise: number; paidPaise: number; balancePaise: number; status: string; createdAt: string; invoiceId: string; invoiceNumber: string; }
export interface OwnerClientMembership { id: string; planName: string; planCredits: number; creditsRemaining: number; validityDate: string; status: string; branchId: string; }
export interface OwnerClientDetail { client: OwnerClient & { gender: string; birthday: string; anniversary: string; tags: string[]; notes: string }; appointments: OwnerClientAppointment[]; purchases: OwnerClientPurchase[]; membership: OwnerClientMembership | null; metadata: OwnerOperationsMetadata & { branchRelationship: string[] }; }

export interface OwnerInventoryProduct { id: string; name: string; sku: string; category: string; supplier: string; branchId: string; branchName: string; stock: number; lowStockThreshold: number; expiryDate: string; unitCostPaise: number; pricePaise: number; stockValuePaise: number; status: string; updatedAt: string; }
export interface OwnerInventoryMetrics { products: number; lowStock: number; outOfStock: number; reorderCount: number; stockValuePaise: number; }
export interface OwnerInventoryResponse extends OwnerOperationsResponse<OwnerInventoryProduct> { metrics: OwnerInventoryMetrics; facets: { categories: string[]; suppliers: string[] }; }
export interface OwnerInventoryTransaction { id: string; type: string; quantity: number; unitCostPaise: number; totalCostPaise: number; reason: string; referenceType: string; referenceId: string; createdAt: string; }
export interface OwnerInventoryDetail { product: OwnerInventoryProduct; transactions: OwnerInventoryTransaction[]; metadata: OwnerOperationsMetadata; }

export interface OwnerCampaign { id: string; name: string; channel: string; audience: unknown[]; status: string; scheduledAt: string; sentCount: number; createdAt: string; updatedAt: string; branchId: null; branchName: "Tenant-wide"; scope: "tenant-wide"; }
export type OwnerNotificationCategory = "action-required" | "business" | "staff" | "financial" | "inventory" | "system";
export interface OwnerNotification { id: string; clientId: string; type: string; channel: string; message: string; status: string; createdAt: string; readAt: string; isRead: boolean; category: OwnerNotificationCategory; branchId: string | null; branchName: string; scope: "branch" | "tenant-wide"; destination: string | null; }
export interface OwnerNotificationReceipt { notificationId: string; isRead: boolean; readAt: string; }

export interface OwnerChatConversation { id: string; type: "team" | "private-owner"; title: string; branchId: string; branchName: string; participantUserIds: string[] | null; messageCount: number; unreadCount: number; lastMessageAt: string; createdAt: string; updatedAt: string; }
export interface OwnerChatMessage { id: string; conversationId: string; type: "team" | "private-owner"; senderUserId: string; senderName: string; body: string; createdAt: string; receipt: { deliveredCount: number; readCount: number }; }
export interface OwnerChatMessagesResponse { items: OwnerChatMessage[]; metadata: OwnerOperationsMetadata & { branchId: string }; }
export interface OwnerChatReceiptUpdate { messageId: string; deliveredCount: number; readCount: number; }
export interface OwnerChatReceiptResponse { conversationId: string; receipts: OwnerChatReceiptUpdate[]; }

export type OwnerAvailabilityMap = Record<string, string>;

export interface OwnerBranchAdministration {
  id: string;
  name: string;
  city: string;
  address?: string;
  phone?: string;
  gstin?: string;
  timezone?: string;
  status: "active" | "inactive" | string;
  onlineBookingEnabled?: boolean | number;
  tierAdvanceBookingDays?: string;
  peakSlotsReservedPct?: number;
  peakHoursDefinition?: string;
  slug?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface OwnerBranchWrite {
  name: string;
  city: string;
  address?: string;
  phone?: string;
  gstin?: string;
  timezone?: string;
  onlineBookingEnabled?: boolean;
  peakSlotsReservedPct?: number;
  peakHoursDefinition?: string;
  slug?: string;
}

export interface OwnerBranchCatalogue {
  items: OwnerBranchAdministration[];
  capabilities: { create: boolean; update: boolean; deactivate: boolean; hardDelete: false; creatorAssignment: boolean };
  availability: OwnerAvailabilityMap;
}

export interface OwnerBranchMutation { branch: OwnerBranchAdministration; creatorAssigned?: boolean; requiresReauthentication?: boolean; }

export interface OwnerPermissionItem { key: string; label: string; resource: string; action: string; sensitive: boolean; }
export interface OwnerPermissionGroup { key: string; label: string; items: OwnerPermissionItem[]; }

export interface OwnerAdministrationRole {
  role: string;
  name: string;
  description: string;
  isSystem: boolean | number;
  status: string;
  permissionKeys: string[];
  editable: boolean;
  configuredKeys: string[];
  inheritedKeys: string[];
  effectiveKeys: string[];
  allowKeys: string[];
  denyKeys: string[];
  policyMode: "inherited" | "override";
  policySource: "default" | "tenant-override" | "branch-override" | string;
  editablePolicy: boolean;
  kind: "system" | "custom";
  assignedUserCount: number;
  activeAssignedUserCount: number;
}

export interface OwnerAdministrationUser {
  id: string;
  name: string;
  loginId: string;
  email: string;
  role: string;
  branchIds: string[];
  status: string;
  isLocked: boolean;
  permissionVersion: number;
  lastLoginAt: string;
  activeSessions: number;
  staffId?: string;
}

export interface OwnerAccessAdministration {
  branches: OwnerBranchAdministration[];
  roles: OwnerAdministrationRole[];
  users: OwnerAdministrationUser[];
  permissionGroups: OwnerPermissionGroup[];
  capabilities: { createRole: boolean; editCustomRole: boolean; editBuiltinStaffAppPolicy: boolean; restoreRoleDefaults: boolean; duplicateRole: boolean; setCustomRoleStatus: boolean; createUser: boolean; updateUser: boolean; disableUser: boolean };
  safeguards: { lastActiveOwner: boolean; ownerEssentialAccess: boolean; assignmentsLimitedToOwnerBranches: boolean; permissionVersionInvalidation: boolean };
}

export interface OwnerRoleWrite { role: string; name: string; description: string; status: string; permissionKeys: string[]; mode?: "inherited" | "override"; allowKeys?: string[]; denyKeys?: string[]; branchId?: string; intent?: "create" | "update"; }
export interface OwnerUserWrite { name: string; loginId: string; email: string; role: string; branchIds: string[]; status: string; password?: string; }

export interface OwnerRoleMutationImpact { affectedUsers: number; activeAffectedUsers: number; requiresReauthentication: boolean; permissionVersionIncremented: number; affectedActiveSessions: number; scope: "tenant" | "branch"; branchId: string; }
export interface OwnerRoleMutation { role: OwnerAdministrationRole; access: OwnerAccessAdministration; invalidatedUsers: number; requiresReauthentication: boolean; impact: OwnerRoleMutationImpact; }

export interface OwnerGeneralSettings {
  workspace: { workspaceName: string; defaultLandingPage: string; fastPosEnabled: boolean };
  localization: { country: string; language: string; timezone: string; currency: string; locale: string };
  branchBehavior: { rememberLastBranch: boolean; requireBranchSelection: boolean; allowBranchSwitch: boolean };
  dateTime: { dateFormat: string; timeFormat: string; businessDayStartHour: number; weekStartsOn: string };
  interface: { compactMode: boolean; showModuleBadges: boolean; enableCommandSearch: boolean };
  defaults: { refreshReportsOnOpen: boolean; ownerNotifications: boolean; staffHints: boolean };
  whatsappNudges: { birthdayOfferPercent: number; feedbackDelayMinutes: number; rebookingWeeks: number; loyaltyStep: number; noShowEnabled: boolean; abandonedEnabled: boolean; birthdayEnabled: boolean; feedbackEnabled: boolean; rebookingEnabled: boolean; loyaltyEnabled: boolean };
  whatsappPolicy: { cancellationCutoffHours: number; enforceCancellationCutoff: boolean; rescheduleCutoffHours: number; enforceRescheduleCutoff: boolean; depositRefundPolicy: string; googleReviewUrl: string };
  booking: { depositsEnabled: boolean; depositMode: "fixed" | "percent"; depositPercent: number; depositFixedPaise: number; depositMinimumPaise: number };
}

export interface OwnerSettingsAudit { lastChangedBy: string; lastChangedAt: string; }
export interface OwnerSettingsResponse {
  branchId: string;
  settings: OwnerGeneralSettings;
  audit: OwnerSettingsAudit;
  supportedSections: string[];
  unavailableSections: OwnerAvailabilityMap;
  preservedUnknownSettings?: boolean;
}

export interface OwnerWhatsAppConnection {
  id: string;
  salonId: string;
  provider: string;
  wabaId: string;
  phoneNumberId: string;
  businessId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  status: "pending" | "connected" | "disconnected" | "error" | "token_expired" | "permission_revoked" | "phone_unregistered";
  webhookSubscribed: boolean;
  connectedAt: string | null;
  disconnectedAt: string | null;
  updatedAt: string | null;
}

export interface OwnerWhatsAppStatus {
  configured: boolean;
  connections: OwnerWhatsAppConnection[];
}

export interface OwnerWhatsAppSignupState {
  state: string;
  expiresAt: string;
  appId: string;
  configId: string;
  apiVersion: string;
  provider: string;
}

export interface OwnerWhatsAppConversation {
  phone: string;
  customerId: string;
  customerName: string;
  branchId: string;
  interactionStatus: string;
  marketingOptOut: boolean;
  lastMessageAt: string | null;
  lastDirection: "inbound" | "outbound" | null;
  lastBody: string;
  lastStatus: string;
  inboundCount: number;
  outboundCount: number;
  appointmentId: string | null;
}

export interface OwnerWhatsAppMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  type: string;
  appointmentId: string | null;
  providerMessageId: string;
  at: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  error?: string;
}

export interface OwnerWhatsAppConversationList {
  items: OwnerWhatsAppConversation[];
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

export interface OwnerWhatsAppMessageList {
  customer: { id: string; name: string; phone: string; branchId: string; interactionStatus: string; marketingOptOut: boolean; lastBookedAt: string | null };
  items: OwnerWhatsAppMessage[];
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

export interface OwnerWhatsAppBotSettings {
  personality?: "friendly" | "luxury" | "quick" | "hinglish";
  address?: string;
  contact?: string;
  instagram?: string;
  parking?: string;
  paymentModes?: string[];
  customAnswers?: Array<{ question: string; answer: string; keywords?: string[]; enabled?: boolean }>;
  features?: { upsells?: boolean; hinglishReplies?: boolean; groupBooking?: boolean; abandonedRecovery?: boolean; reviewPrompts?: boolean };
}

export interface OwnerWhatsAppBotSettingsResponse { branchId: string; settings: OwnerWhatsAppBotSettings; }

export interface OwnerWhatsAppIntelligence {
  analytics: { since: string; inboundCount: number; outboundCount: number; actionCounts: Record<string, number>; statusCounts: Record<string, number>; topServices: Array<{ name: string; count: number }> };
  health: { failedSends: number; stuckSessions: number; repeatedMisunderstandings: number };
  templateReadiness: Array<{ name: string; ready: boolean; templates: Array<{ name: string; language: string; status: string; category: string; lastSyncedAt?: string }> }>;
  waitlist: Array<{ id: string; branchId: string; staffId: string; serviceNames: string[]; date: string; preferredTime: string; customerPhone: string; status: string; notified: boolean; opportunityExpiresAt: string; createdAt: string }>;
  qualityQueue: Array<{ id: string; phone: string; name: string; text: string; receivedAt: string; reason: string }>;
  campaignSegments: Array<{ key: string; tags: string[]; count: number }>;
  customers: Array<{ id: string; name: string; phone: string; tags: string[]; preferredStaffIds: string[]; favoriteServiceIds: string[]; visitCount: number; lastBookedAt: string; interactionStatus: string }>;
}

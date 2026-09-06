export type Overview = {
  store: null | { shop: string; storeName: string; status: string; lastSyncAt?: string };
  whatsapp: { status: string; sentToday: number; delivered: number; read: number; failed: number };
  metrics: Record<string, number>;
  recentActivity: Array<{ time: string; title: string; detail: string }>;
};

export type Flow = {
  _id: string;
  name: string;
  description: string;
  trigger: string;
  status: "draft" | "active" | "paused";
  nodes: Array<{ id: string; type: string; label: string; config: Record<string, unknown>; next?: string; yes?: string; no?: string }>;
  metrics?: Record<string, number>;
};

export type Template = { name: string; category: string; language: string; status: string; lastSyncedAt: string };

export type Customer = { name: string; normalizedPhone: string; email: string; orderCount: number; totalSpend: number; tags: string[]; marketingConsent: boolean; marketingOptOut: boolean };

export type Campaign = { _id: string; name: string; templateName: string; status: string; scheduledAt?: string; sentCount: number; failedCount: number };

export type LogRow = { toPhone: string; type: string; body: string; status: string; providerMessageId: string; error: string; createdAt: string };

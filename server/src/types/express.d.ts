import type { UserDocument } from "../models/user.model";

/** Tenant-aware request context established by authentication middleware. */
export interface RequestContext {
  userId: string;
  salonId: string;
  role: string;
  staffId?: string;
  branchId: string;
  branchIds: string[];
  /** Effective Staff App grants — mirrors the frontend permission surface. */
  permissions: string[];
  crmPermissions: string[];
  sessionId: string;
  user: UserDocument;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      context?: RequestContext;
      rawBody?: string;
      /** Set by the idempotency guard when a key was successfully reserved. */
      idempotencyReservedKey?: { scope: string; key: string };
    }
  }
}

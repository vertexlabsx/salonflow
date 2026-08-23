import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../shared/http";

/**
 * Tenant/branch scoping helpers. Every tenant-owned repository operation MUST
 * receive the salonId from this validated context — never from client input.
 */

/** Resolves and authorizes a branch for the current request context. */
export function resolveAuthorizedBranchId(context: NonNullable<Request["context"]>, requestedBranchId?: unknown): string {
  const requested = typeof requestedBranchId === "string" ? requestedBranchId.trim() : "";
  if (!requested || requested === "all") {
    if (context.branchIds.length === 0) throw ApiError.forbidden("No branch is assigned to this account.");
    return context.branchIds[0] as string;
  }
  if (requested !== context.branchId && !context.branchIds.includes(requested)) {
    // Cross-tenant / unauthorized branch access attempt — rejected centrally.
    throw ApiError.forbidden("The requested branch is not available to this account.");
  }
  return requested;
}

/** Returns branch ids to query for "all-branches" requests, always intersected with authorized branches. */
export function resolveAuthorizedBranchIds(context: NonNullable<Request["context"]>, requestedBranchId?: unknown): string[] {
  const requested = typeof requestedBranchId === "string" ? requestedBranchId.trim() : "";
  if (!requested || requested === "all") return [...context.branchIds];
  if (requested !== context.branchId && !context.branchIds.includes(requested)) {
    throw ApiError.forbidden("The requested branch is not available to this account.");
  }
  return [requested];
}

export function requireContext(req: Request): NonNullable<Request["context"]> {
  if (!req.context) throw ApiError.unauthorized();
  return req.context;
}

/**
 * Placeholder for Phase C+: ensures a staff profile belongs to the caller's salon.
 * Kept central so appointment/staff routes cannot forget the check.
 */
export function assertSalonEntity(context: NonNullable<Request["context"]>, entitySalonId: string): void {
  if (entitySalonId !== context.salonId) {
    throw ApiError.notFound("Resource was not found in your workspace.");
  }
}

export const tenantContextPlaceholder = (_req: Request, _res: Response, _next: NextFunction): void => undefined;

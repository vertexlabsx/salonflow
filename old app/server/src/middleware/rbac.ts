import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../shared/http";

const WRITE_ALIASES = new Set(["create", "update", "delete", "back", "print", "export"]);

/**
 * Server-side mirror of the frontend permission semantics (StaffAppService.hasPermission)
 * so both surfaces authorize identically, including scoped `staff-app-*` grants.
 */
export function hasPermission(grants: string[], permission: string): boolean {
  if (!permission) return true;
  if (grants.includes("*")) return true;

  const [actionRaw, resourceRaw] = permission.split(":");
  const action = actionRaw || "";
  const resource = resourceRaw || "";
  const scopedResource = resource ? `staff-app-${resource === "staff-checkin-checkout" ? "checkin-checkout" : resource}` : "";
  const scopedPolicy = grants.some((grant) => grant.includes(":staff-app-"));

  if (scopedPolicy) {
    return (
      grants.includes(`${action}:${scopedResource}`) ||
      grants.includes("admin:staff-app-*") ||
      (WRITE_ALIASES.has(action) && (grants.includes(`write:${scopedResource}`) || grants.includes("write:staff-app-*")))
    );
  }

  if (grants.includes(permission)) return true;
  return (
    grants.includes(`${action}:*`) ||
    grants.includes("admin:*") ||
    (resource ? grants.includes(`admin:${resource}`) : false) ||
    (resource && WRITE_ALIASES.has(action) ? grants.includes(`write:${resource}`) || grants.includes("write:*") : false)
  );
}

export function hasAnyPermission(grants: string[], permissions: string[]): boolean {
  return permissions.some((permission) => hasPermission(grants, permission));
}

export function hasEveryPermission(grants: string[], permissions: string[]): boolean {
  return permissions.every((permission) => hasPermission(grants, permission));
}

type PermissionInput = string | { any?: string[]; every?: string[] };

function toRequirement(input: PermissionInput): { any: string[]; every: string[] } {
  if (typeof input === "string") return { any: [], every: [input] };
  return { any: input.any || [], every: input.every || [] };
}

/** Route guard factory — enforces the same permission contract the frontend guards use. */
export function requirePermissions(requirement: PermissionInput) {
  const { any, every } = toRequirement(requirement);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const context = req.context;
    if (!context) return next(ApiError.unauthorized());
    const grants = context.permissions;
    if (every.length && !hasEveryPermission(grants, every)) return next(ApiError.forbidden("Required permission is missing."));
    if (any.length && !hasAnyPermission(grants, any)) return next(ApiError.forbidden("Required permission is missing."));
    next();
  };
}

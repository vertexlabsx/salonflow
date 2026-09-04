import type { Request } from "express";
import { AuditLogModel } from "../models/audit-log.model";
import { logger } from "./logger";

export async function audit(req: Request, action: string, resourceType: string, resourceId = "", metadata: Record<string, unknown> = {}): Promise<void> {
  const context = req.context;
  if (!context) return;
  try {
    await AuditLogModel.create({
      salonId: context.salonId,
      actorUserId: context.userId,
      actorRole: context.role,
      action,
      resourceType,
      resourceId,
      ip: req.ip || "",
      userAgent: req.header("user-agent") || "",
      metadata
    });
  } catch (error) {
    logger.error("Audit log write failed", { error: error instanceof Error ? error.message : String(error), action, resourceType, resourceId });
  }
}

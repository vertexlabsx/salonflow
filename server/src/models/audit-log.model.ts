import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface AuditLog {
  salonId: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ip: string;
  userAgent: string;
  metadata: Record<string, unknown>;
  createdAt?: Date;
}

const auditLogSchema = new Schema<AuditLog>(
  {
    salonId: { type: String, required: true },
    actorUserId: { type: String, required: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, maxlength: 120 },
    resourceType: { type: String, required: true, maxlength: 80 },
    resourceId: { type: String, default: "" },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

auditLogSchema.index({ salonId: 1, createdAt: -1 });
auditLogSchema.index({ salonId: 1, resourceType: 1, resourceId: 1, createdAt: -1 });

export const AuditLogModel: Model<AuditLog> = (mongoose.models.AuditLog as Model<AuditLog>) || model<AuditLog>("AuditLog", auditLogSchema);

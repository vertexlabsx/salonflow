import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface OwnerSettings {
  salonId: string;
  branchId: string;
  settings: Record<string, unknown>;
  lastChangedBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const ownerSettingsSchema = new Schema<OwnerSettings>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, default: "" },
    settings: { type: Schema.Types.Mixed, required: true, default: {} },
    lastChangedBy: { type: String, default: "system" }
  },
  { timestamps: true, minimize: false }
);

ownerSettingsSchema.index({ salonId: 1, branchId: 1 }, { unique: true });

export const OwnerSettingsModel: Model<OwnerSettings> = (mongoose.models.OwnerSettings as Model<OwnerSettings>) || model<OwnerSettings>("OwnerSettings", ownerSettingsSchema);

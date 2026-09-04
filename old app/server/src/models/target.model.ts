import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Target {
  salonId: string;
  branchId: string;
  staffId: string | null;
  targetName: string;
  targetType: string;
  targetValuePaise: number;
  achievedValuePaise: number;
  status: string;
  startsOn: string;
  endsOn: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const targetSchema = new Schema<Target>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    staffId: { type: String, default: null },
    targetName: { type: String, required: true, maxlength: 160 },
    targetType: { type: String, maxlength: 40, default: "revenue" },
    targetValuePaise: { type: Number, required: true, min: 0 },
    achievedValuePaise: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "completed", "missed"], default: "active" },
    startsOn: { type: String, required: true },
    endsOn: { type: String, required: true }
  },
  { timestamps: true }
);

targetSchema.index({ salonId: 1, staffId: 1, status: 1 });

export const TargetModel: Model<Target> = (mongoose.models.Target as Model<Target>) || model<Target>("Target", targetSchema);

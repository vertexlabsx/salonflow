import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Leave {
  salonId: string;
  staffId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  days: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const leaveSchema = new Schema<Leave>(
  {
    salonId: { type: String, required: true },
    staffId: { type: String, required: true },
    leaveType: { type: String, required: true, maxlength: 40 },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    reason: { type: String, maxlength: 500, default: "" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    days: { type: Number, required: true, min: 0 }
  },
  { timestamps: true }
);

leaveSchema.index({ salonId: 1, staffId: 1, createdAt: -1 });

export const LeaveModel: Model<Leave> = (mongoose.models.Leave as Model<Leave>) || model<Leave>("Leave", leaveSchema);

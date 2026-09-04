import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export type ShiftSwapStatus = "pending_staff" | "pending_manager" | "approved" | "rejected" | "declined" | "cancelled";

export interface ShiftSwap {
  salonId: string;
  branchId: string;
  scheduleId: string;
  fromStaffId: string;
  toStaffId: string;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  shiftType: string;
  reason: string;
  status: ShiftSwapStatus;
  targetResponseNote: string;
  rejectionReason: string;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const shiftSwapSchema = new Schema<ShiftSwap>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    scheduleId: { type: String, required: true },
    fromStaffId: { type: String, required: true },
    toStaffId: { type: String, required: true },
    scheduleDate: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    shiftType: { type: String, maxlength: 40, default: "regular" },
    reason: { type: String, maxlength: 500, default: "" },
    status: {
      type: String,
      enum: ["pending_staff", "pending_manager", "approved", "rejected", "declined", "cancelled"],
      default: "pending_staff"
    },
    targetResponseNote: { type: String, maxlength: 500, default: "" },
    rejectionReason: { type: String, maxlength: 500, default: "" },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
);

shiftSwapSchema.index({ salonId: 1, createdAt: -1 });

export const ShiftSwapModel: Model<ShiftSwap> =
  (mongoose.models.ShiftSwap as Model<ShiftSwap>) || model<ShiftSwap>("ShiftSwap", shiftSwapSchema);

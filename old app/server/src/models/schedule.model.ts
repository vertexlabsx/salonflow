import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Schedule {
  salonId: string;
  branchId: string;
  staffId: string;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  shiftType: string;
  status: string;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const scheduleSchema = new Schema<Schedule>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    staffId: { type: String, required: true },
    scheduleDate: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    shiftType: { type: String, maxlength: 40, default: "regular" },
    status: { type: String, enum: ["scheduled", "confirmed", "completed", "cancelled", "leave"], default: "scheduled" },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
);

scheduleSchema.index({ salonId: 1, staffId: 1, scheduleDate: -1 });

export const ScheduleModel: Model<Schedule> =
  (mongoose.models.Schedule as Model<Schedule>) || model<Schedule>("Schedule", scheduleSchema);

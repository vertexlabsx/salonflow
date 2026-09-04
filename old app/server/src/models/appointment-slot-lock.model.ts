import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface AppointmentSlotLock {
  salonId: string;
  branchId: string;
  staffId: string;
  appointmentId: string;
  slotAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const appointmentSlotLockSchema = new Schema<AppointmentSlotLock>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    staffId: { type: String, required: true },
    appointmentId: { type: String, required: true },
    slotAt: { type: Date, required: true }
  },
  { timestamps: true }
);

appointmentSlotLockSchema.index({ salonId: 1, staffId: 1, slotAt: 1 }, { unique: true });
appointmentSlotLockSchema.index({ salonId: 1, appointmentId: 1 });

export const AppointmentSlotLockModel: Model<AppointmentSlotLock> =
  (mongoose.models.AppointmentSlotLock as Model<AppointmentSlotLock>) || model<AppointmentSlotLock>("AppointmentSlotLock", appointmentSlotLockSchema);

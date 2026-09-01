import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface WaitlistEntry {
  salonId: string;
  branchId: string;
  staffId: string;
  serviceIds: string[];
  serviceNames: string[];
  date: string;
  preferredTime: string;
  customerId: string;
  customerPhone: string;
  status: "waiting" | "offered" | "booked" | "declined" | "expired";
  notified: boolean;
  offeredAppointmentId?: string;
  opportunityExpiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const waitlistSchema = new Schema<WaitlistEntry>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    staffId: { type: String, required: true },
    serviceIds: { type: [String], default: [] },
    serviceNames: { type: [String], default: [] },
    date: { type: String, maxlength: 10, default: "" },
    preferredTime: { type: String, maxlength: 10, default: "" },
    customerId: { type: String, required: true },
    customerPhone: { type: String, required: true },
    status: { type: String, enum: ["waiting", "offered", "booked", "declined", "expired"], default: "waiting" },
    notified: { type: Boolean, default: false },
    offeredAppointmentId: { type: String, default: "" },
    opportunityExpiresAt: { type: Date, default: null }
  },
  { timestamps: true }
);

waitlistSchema.index({ salonId: 1, status: 1, createdAt: 1 });
waitlistSchema.index({ salonId: 1, customerId: 1, serviceIds: 1 });

export const WaitlistModel: Model<WaitlistEntry> =
  (mongoose.models.Waitlist as Model<WaitlistEntry>) || model<WaitlistEntry>("Waitlist", waitlistSchema);

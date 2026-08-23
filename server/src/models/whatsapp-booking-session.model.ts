import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface WhatsAppBookingSession {
  salonId: string;
  branchId: string;
  waPhone: string;
  profileName: string;
  state: "select_service" | "select_date" | "select_time" | "confirm_name" | "confirm" | "completed" | "cancelled";
  serviceId: string | null;
  serviceName: string | null;
  date: string | null;
  startAt: Date | null;
  staffId: string | null;
  customerName: string;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const whatsAppBookingSessionSchema = new Schema<WhatsAppBookingSession>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    waPhone: { type: String, required: true },
    profileName: { type: String, maxlength: 160, default: "" },
    state: { type: String, required: true, default: "select_service" },
    serviceId: { type: String, default: null },
    serviceName: { type: String, default: null },
    date: { type: String, default: null },
    startAt: { type: Date, default: null },
    staffId: { type: String, default: null },
    customerName: { type: String, maxlength: 160, default: "" },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

whatsAppBookingSessionSchema.index({ salonId: 1, waPhone: 1 }, { unique: true });
whatsAppBookingSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WhatsAppBookingSessionModel: Model<WhatsAppBookingSession> =
  (mongoose.models.WhatsAppBookingSession as Model<WhatsAppBookingSession>) ||
  model<WhatsAppBookingSession>("WhatsAppBookingSession", whatsAppBookingSessionSchema);

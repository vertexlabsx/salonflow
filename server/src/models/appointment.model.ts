import mongoose, { model, Schema } from "mongoose";
import type { Model, Types } from "mongoose";

export type AppointmentStatus = "booked" | "confirmed" | "arrived" | "in_service" | "completed" | "cancelled" | "no_show";

export interface Appointment {
  salonId: string;
  branchId: string;
  staffId: string;
  customerId?: string;
  customerName?: string;
  serviceIds: string[];
  serviceNames: string[];
  durationMinutes: number;
  /** Amount in paise — the app renders money exclusively in paise. */
  value: number;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  chair?: string;
  source?: string;
  version: number;
  whatsappConfirmationSentAt?: Date | null;
  whatsappReminderSentAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type AppointmentDocument = mongoose.Document<Types.ObjectId> & Appointment;

const appointmentSchema = new Schema<Appointment>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    staffId: { type: String, required: true },
    customerId: { type: String },
    customerName: { type: String, maxlength: 160 },
    serviceIds: { type: [String], default: [] },
    serviceNames: { type: [String], default: [] },
    durationMinutes: { type: Number, required: true, min: 0 },
    value: { type: Number, required: true, min: 0 },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: { type: String, enum: ["booked", "confirmed", "arrived", "in_service", "completed", "cancelled", "no_show"], default: "booked" },
    chair: { type: String, maxlength: 60 },
    source: { type: String, maxlength: 60, default: "crm" },
    version: { type: Number, default: 1 },
    whatsappConfirmationSentAt: { type: Date, default: null },
    whatsappReminderSentAt: { type: Date, default: null }
  },
  { timestamps: true, minimize: false }
);

appointmentSchema.index({ salonId: 1, staffId: 1, startAt: -1 });
appointmentSchema.index({ salonId: 1, branchId: 1, startAt: -1 });

export const AppointmentModel: Model<Appointment> =
  (mongoose.models.Appointment as Model<Appointment>) || model<Appointment>("Appointment", appointmentSchema);

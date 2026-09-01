import mongoose, { model, Schema } from "mongoose";
import type { Model, Types } from "mongoose";

export type AppointmentStatus = "pending" | "booked" | "confirmed" | "arrived" | "in_service" | "completed" | "cancelled" | "no_show" | "expired" | "rescheduled";

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
  paymentStatus?: "not_required" | "pending" | "paid" | "failed";
  depositAmountPaise?: number;
  paymentLink?: string;
  paymentProvider?: "razorpay" | "manual" | "none";
  paymentProviderId?: string;
  paymentReference?: string;
  holdExpiresAt?: Date | null;
  /** Set on the OLD appointment when a customer reschedules: points to the new appointment id. */
  rescheduledToId?: string | null;
  /** Set on the NEW appointment created by a customer reschedule: points to the original appointment id. */
  rescheduledFromId?: string | null;
  version: number;
  whatsappConfirmationSentAt?: Date | null;
  whatsappReminderSentAt?: Date | null;
  whatsappShortReminderSentAt?: Date | null;
  reminderOptIn?: boolean;
  reminderPreference?: "both" | "day_before" | "short" | "none";
  paymentHoldReminderSentAt?: Date | null;
  feedbackRating?: number | null;
  feedbackComment?: string;
  feedbackReceivedAt?: Date | null;
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
    status: { type: String, enum: ["pending", "booked", "confirmed", "arrived", "in_service", "completed", "cancelled", "no_show", "expired", "rescheduled"], default: "booked" },
    chair: { type: String, maxlength: 60 },
    source: { type: String, maxlength: 60, default: "crm" },
    paymentStatus: { type: String, enum: ["not_required", "pending", "paid", "failed"], default: "not_required" },
    depositAmountPaise: { type: Number, min: 0, default: 0 },
    paymentLink: { type: String, maxlength: 1000, default: "" },
    paymentProvider: { type: String, enum: ["razorpay", "manual", "none"], default: "none" },
    paymentProviderId: { type: String, maxlength: 160, default: "" },
    paymentReference: { type: String, maxlength: 200, default: "" },
    holdExpiresAt: { type: Date, default: null },
    rescheduledToId: { type: String, default: null },
    rescheduledFromId: { type: String, default: null },
    version: { type: Number, default: 1 },
    whatsappConfirmationSentAt: { type: Date, default: null },
    whatsappReminderSentAt: { type: Date, default: null },
    whatsappShortReminderSentAt: { type: Date, default: null },
    reminderOptIn: { type: Boolean, default: false },
    reminderPreference: { type: String, enum: ["both", "day_before", "short", "none"], default: "both" },
    paymentHoldReminderSentAt: { type: Date, default: null },
    feedbackRating: { type: Number, min: 1, max: 5, default: null },
    feedbackComment: { type: String, maxlength: 1000, default: "" },
    feedbackReceivedAt: { type: Date, default: null }
  },
  { timestamps: true, minimize: false }
);

appointmentSchema.index({ salonId: 1, staffId: 1, startAt: -1 });
appointmentSchema.index({ salonId: 1, branchId: 1, startAt: -1 });

export const AppointmentModel: Model<Appointment> =
  (mongoose.models.Appointment as Model<Appointment>) || model<Appointment>("Appointment", appointmentSchema);

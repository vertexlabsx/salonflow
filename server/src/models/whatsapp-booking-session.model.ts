import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface WhatsAppBookingSession {
  salonId: string;
  branchId: string;
  waPhone: string;
  profileName: string;
  state: "select_branch" | "select_category" | "select_service" | "add_more_services" | "select_staff" | "select_date" | "select_time" | "confirm_hold" | "awaiting_payment" | "confirm_name" | "confirm" | "completed" | "cancelled" | "menu" | "view_bookings" | "manage_booking" | "view_history" | "select_cancel_booking" | "confirm_cancel" | "select_reschedule_booking" | "reschedule_date" | "reschedule_time" | "select_modify_booking" | "modify_choose_field" | "confirm_modify" | "select_rebook_booking" | "confirm_rebook";
  managementAction: string | null;
  modifyField: string | null;
  targetAppointmentId: string | null;
  category: string | null;
  categoryPage: number;
  servicePage: number;
  staffPage: number;
  searchQuery: string;
  serviceId: string | null;
  serviceName: string | null;
  serviceIds: string[];
  serviceNames: string[];
  durationMinutes: number;
  value: number;
  availableSlots: Array<{ label: string; startAt: Date }>;
  date: string | null;
  startAt: Date | null;
  staffId: string | null;
  holdAppointmentId: string | null;
  customerName: string;
  consecutiveFailures: number;
  lastAlternates: string;
  earliestOffer: string;
  pendingReminder: boolean;
  conciergeTurns: number;
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
    category: { type: String, default: null },
    categoryPage: { type: Number, default: 0 },
    servicePage: { type: Number, default: 0 },
    staffPage: { type: Number, default: 0 },
    searchQuery: { type: String, default: "" },
    serviceId: { type: String, default: null },
    serviceName: { type: String, default: null },
    serviceIds: { type: [String], default: [] },
    serviceNames: { type: [String], default: [] },
    durationMinutes: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    availableSlots: { type: [{ label: String, startAt: Date }], default: [] },
    date: { type: String, default: null },
    startAt: { type: Date, default: null },
    staffId: { type: String, default: null },
    holdAppointmentId: { type: String, default: null },
    customerName: { type: String, maxlength: 160, default: "" },
    consecutiveFailures: { type: Number, default: 0 },
    lastAlternates: { type: String, default: "" },
    earliestOffer: { type: String, default: "" },
    pendingReminder: { type: Boolean, default: false },
    conciergeTurns: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    managementAction: { type: String, default: null },
    modifyField: { type: String, default: null },
    targetAppointmentId: { type: String, default: null }
  },
  { timestamps: true }
);

whatsAppBookingSessionSchema.index({ salonId: 1, waPhone: 1 }, { unique: true });
whatsAppBookingSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WhatsAppBookingSessionModel: Model<WhatsAppBookingSession> =
  (mongoose.models.WhatsAppBookingSession as Model<WhatsAppBookingSession>) ||
  model<WhatsAppBookingSession>("WhatsAppBookingSession", whatsAppBookingSessionSchema);

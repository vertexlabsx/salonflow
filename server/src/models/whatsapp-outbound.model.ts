import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface WhatsAppOutbound {
  salonId: string;
  appointmentId: string | null;
  toPhone: string;
  type: "confirmation" | "reminder" | "cancellation" | "reschedule" | "utility";
  body: string;
  provider: "mock" | "meta" | "meta_test" | "meta_production";
  providerMessageId: string;
  status: "queued" | "sent" | "delivered" | "read" | "failed";
  error: string;
  retryCount: number;
  lastAttemptAt?: Date | null;
  deliveredAt?: Date | null;
  readAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const whatsAppOutboundSchema = new Schema<WhatsAppOutbound>(
  {
    salonId: { type: String, required: true },
    appointmentId: { type: String, default: null },
    toPhone: { type: String, required: true },
    type: { type: String, enum: ["confirmation", "reminder", "cancellation", "reschedule", "utility"], required: true },
    body: { type: String, required: true, maxlength: 4096 },
    provider: { type: String, enum: ["mock", "meta", "meta_test", "meta_production"], required: true },
    providerMessageId: { type: String, default: "" },
    status: { type: String, enum: ["queued", "sent", "delivered", "read", "failed"], default: "queued" },
    error: { type: String, default: "" },
    retryCount: { type: Number, default: 0, min: 0 },
    lastAttemptAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
);

whatsAppOutboundSchema.index({ salonId: 1, appointmentId: 1, type: 1 });
whatsAppOutboundSchema.index({ status: 1, createdAt: 1 });

export const WhatsAppOutboundModel: Model<WhatsAppOutbound> =
  (mongoose.models.WhatsAppOutbound as Model<WhatsAppOutbound>) || model<WhatsAppOutbound>("WhatsAppOutbound", whatsAppOutboundSchema);

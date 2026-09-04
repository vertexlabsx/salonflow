import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface WhatsAppWebhookEvent {
  eventId: string;
  phoneNumberId: string;
  wabaId: string;
  salonId: string;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
  processedAt?: Date | null;
  status: "received" | "processed" | "ignored" | "failed";
  retryCount: number;
  error: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const whatsappWebhookEventSchema = new Schema<WhatsAppWebhookEvent>(
  {
    eventId: { type: String, required: true },
    phoneNumberId: { type: String, required: true },
    wabaId: { type: String, default: "" },
    salonId: { type: String, required: true },
    eventType: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true, default: {} },
    receivedAt: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    status: { type: String, enum: ["received", "processed", "ignored", "failed"], default: "received" },
    retryCount: { type: Number, default: 0, min: 0 },
    error: { type: String, default: "" }
  },
  { timestamps: true, minimize: false }
);

whatsappWebhookEventSchema.index({ eventId: 1 }, { unique: true });
whatsappWebhookEventSchema.index({ phoneNumberId: 1, receivedAt: -1 });
whatsappWebhookEventSchema.index({ salonId: 1, receivedAt: -1 });

export const WhatsAppWebhookEventModel: Model<WhatsAppWebhookEvent> =
  (mongoose.models.WhatsAppWebhookEvent as Model<WhatsAppWebhookEvent>) || model<WhatsAppWebhookEvent>("WhatsAppWebhookEvent", whatsappWebhookEventSchema);

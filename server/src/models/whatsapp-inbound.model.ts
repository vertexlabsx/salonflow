import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface WhatsAppInbound {
  salonId: string;
  waPhone: string;
  profileName: string;
  messageId: string;
  text: string;
  receivedAt: Date;
  appointmentId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const whatsAppInboundSchema = new Schema<WhatsAppInbound>(
  {
    salonId: { type: String, required: true },
    waPhone: { type: String, required: true },
    profileName: { type: String, maxlength: 160, default: "" },
    messageId: { type: String, required: true },
    text: { type: String, maxlength: 4000, default: "" },
    receivedAt: { type: Date, required: true },
    appointmentId: { type: String, default: null }
  },
  { timestamps: true }
);

whatsAppInboundSchema.index({ salonId: 1, messageId: 1 }, { unique: true });

export const WhatsAppInboundModel: Model<WhatsAppInbound> =
  (mongoose.models.WhatsAppInbound as Model<WhatsAppInbound>) ||
  model<WhatsAppInbound>("WhatsAppInbound", whatsAppInboundSchema);

import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export type WhatsAppConnectionStatus = "pending" | "connected" | "disconnected" | "error" | "token_expired" | "permission_revoked" | "phone_unregistered";

export interface WhatsAppConnection {
  salonId: string;
  provider: "mock" | "meta_test" | "meta_production";
  wabaId: string;
  phoneNumberId: string;
  businessId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  status: WhatsAppConnectionStatus;
  encryptedAccessToken: string;
  tokenExpiresAt?: Date | null;
  scopes: string[];
  webhookSubscribed: boolean;
  connectedAt?: Date | null;
  disconnectedAt?: Date | null;
  createdBy: string;
  lastError: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const whatsappConnectionSchema = new Schema<WhatsAppConnection>(
  {
    salonId: { type: String, required: true, index: true },
    provider: { type: String, enum: ["mock", "meta_test", "meta_production"], default: "meta_production" },
    wabaId: { type: String, required: true },
    phoneNumberId: { type: String, required: true },
    businessId: { type: String, default: "" },
    displayPhoneNumber: { type: String, default: "" },
    verifiedName: { type: String, default: "" },
    status: { type: String, enum: ["pending", "connected", "disconnected", "error", "token_expired", "permission_revoked", "phone_unregistered"], default: "pending" },
    encryptedAccessToken: { type: String, default: "", select: false },
    tokenExpiresAt: { type: Date, default: null },
    scopes: { type: [String], default: [] },
    webhookSubscribed: { type: Boolean, default: false },
    connectedAt: { type: Date, default: null },
    disconnectedAt: { type: Date, default: null },
    createdBy: { type: String, required: true },
    lastError: { type: String, default: "" }
  },
  { timestamps: true }
);

whatsappConnectionSchema.index({ phoneNumberId: 1 }, { unique: true });
whatsappConnectionSchema.index({ salonId: 1, status: 1 });
whatsappConnectionSchema.index({ salonId: 1, createdAt: -1 });
whatsappConnectionSchema.index({ salonId: 1, wabaId: 1, phoneNumberId: 1 }, { unique: true });

export const WhatsAppConnectionModel: Model<WhatsAppConnection> =
  (mongoose.models.WhatsAppConnection as Model<WhatsAppConnection>) || model<WhatsAppConnection>("WhatsAppConnection", whatsappConnectionSchema);

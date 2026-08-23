import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface WhatsAppOAuthState {
  stateHash: string;
  salonId: string;
  userId: string;
  createdAt?: Date;
  expiresAt: Date;
  consumedAt?: Date | null;
}

const whatsappOAuthStateSchema = new Schema<WhatsAppOAuthState>(
  {
    stateHash: { type: String, required: true, unique: true },
    salonId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    consumedAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

whatsappOAuthStateSchema.index({ salonId: 1, userId: 1, createdAt: -1 });

export const WhatsAppOAuthStateModel: Model<WhatsAppOAuthState> =
  (mongoose.models.WhatsAppOAuthState as Model<WhatsAppOAuthState>) || model<WhatsAppOAuthState>("WhatsAppOAuthState", whatsappOAuthStateSchema);

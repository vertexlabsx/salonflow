import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface GiftCard {
  salonId: string;
  code: string;
  purchaserName: string;
  recipientName: string;
  recipientPhone: string;
  initialValuePaise: number;
  balancePaise: number;
  expiresAt?: Date | null;
  status: "active" | "redeemed" | "expired" | "void";
  createdByUserId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const giftCardSchema = new Schema<GiftCard>(
  {
    salonId: { type: String, required: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 40 },
    purchaserName: { type: String, maxlength: 160, default: "" },
    recipientName: { type: String, maxlength: 160, default: "" },
    recipientPhone: { type: String, maxlength: 32, default: "" },
    initialValuePaise: { type: Number, required: true, min: 1 },
    balancePaise: { type: Number, required: true, min: 0 },
    expiresAt: { type: Date, default: null },
    status: { type: String, enum: ["active", "redeemed", "expired", "void"], default: "active" },
    createdByUserId: { type: String, default: "" }
  },
  { timestamps: true }
);

giftCardSchema.index({ salonId: 1, code: 1 }, { unique: true });
giftCardSchema.index({ salonId: 1, status: 1, createdAt: -1 });

export const GiftCardModel: Model<GiftCard> = (mongoose.models.GiftCard as Model<GiftCard>) || model<GiftCard>("GiftCard", giftCardSchema);

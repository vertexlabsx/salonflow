import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Tip {
  salonId: string;
  branchId: string;
  invoiceId: string;
  appointmentId: string;
  staffId: string;
  amountPaise: number;
  method: "cash" | "card" | "upi" | "bank_transfer" | "other";
  reference: string;
  recordedByUserId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const tipSchema = new Schema<Tip>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    invoiceId: { type: String, required: true },
    appointmentId: { type: String, default: "" },
    staffId: { type: String, default: "" },
    amountPaise: { type: Number, required: true, min: 1 },
    method: { type: String, enum: ["cash", "card", "upi", "bank_transfer", "other"], required: true },
    reference: { type: String, maxlength: 120, default: "" },
    recordedByUserId: { type: String, default: "" }
  },
  { timestamps: true }
);

tipSchema.index({ salonId: 1, invoiceId: 1, createdAt: -1 });
tipSchema.index({ salonId: 1, staffId: 1, createdAt: -1 });

export const TipModel: Model<Tip> = (mongoose.models.Tip as Model<Tip>) || model<Tip>("Tip", tipSchema);

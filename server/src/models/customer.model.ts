import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Customer {
  salonId: string;
  branchId: string;
  name: string;
  normalizedPhone: string;
  whatsappPhoneNumberId: string;
  marketingOptOut: boolean;
  interactionStatus: "active" | "booking_started" | "booked" | "cancelled";
  source: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const customerSchema = new Schema<Customer>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    name: { type: String, maxlength: 160, default: "" },
    normalizedPhone: { type: String, required: true },
    whatsappPhoneNumberId: { type: String, maxlength: 120, default: "" },
    marketingOptOut: { type: Boolean, default: false },
    source: { type: String, maxlength: 40, default: "whatsapp" }
  },
  { timestamps: true }
);

customerSchema.index({ salonId: 1, normalizedPhone: 1 }, { unique: true });

export const CustomerModel: Model<Customer> = (mongoose.models.Customer as Model<Customer>) || model<Customer>("Customer", customerSchema);

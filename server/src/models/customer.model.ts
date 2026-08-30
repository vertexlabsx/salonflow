import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Customer {
  salonId: string;
  branchId: string;
  name: string;
  email: string;
  gender: string;
  birthday: string;
  anniversary: string;
  tags: string[];
  notes: string;
  address: string;
  normalizedPhone: string;
  whatsappPhoneNumberId: string;
  marketingOptOut: boolean;
  interactionStatus: "active" | "booking_started" | "booked" | "cancelled";
  source: string;
  preferredStaffIds: string[];
  favoriteServiceIds: string[];
  visitCount: number;
  lastBookedAt: Date | null;
  walletBalancePaise: number;
  loyaltyPoints: number;
  membershipId: string;
  membershipPlanName: string;
  membershipCredits: number;
  membershipCreditsRemaining: number;
  membershipValidUntil: string;
  membershipStatus: string;
  packageName: string;
  packageCreditsRemaining: number;
  subscriptionName: string;
  subscriptionStatus: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const customerSchema = new Schema<Customer>(
  {
      salonId: { type: String, required: true },
      branchId: { type: String, required: true },
      name: { type: String, maxlength: 160, default: "" },
      email: { type: String, maxlength: 180, default: "" },
      gender: { type: String, maxlength: 40, default: "" },
      birthday: { type: String, maxlength: 10, default: "" },
      anniversary: { type: String, maxlength: 10, default: "" },
      tags: { type: [String], default: [] },
      notes: { type: String, maxlength: 2000, default: "" },
      address: { type: String, maxlength: 500, default: "" },
      normalizedPhone: { type: String, required: true },
      whatsappPhoneNumberId: { type: String, maxlength: 120, default: "" },
      marketingOptOut: { type: Boolean, default: false },
      interactionStatus: { type: String, enum: ["active", "booking_started", "booked", "cancelled"], default: "active" },
      source: { type: String, maxlength: 40, default: "whatsapp" },
    preferredStaffIds: { type: [String], default: [] },
    favoriteServiceIds: { type: [String], default: [] },
    visitCount: { type: Number, default: 0 },
    lastBookedAt: { type: Date, default: null },
    walletBalancePaise: { type: Number, default: 0, min: 0 },
    loyaltyPoints: { type: Number, default: 0, min: 0 },
    membershipId: { type: String, maxlength: 80, default: "" },
    membershipPlanName: { type: String, maxlength: 120, default: "" },
    membershipCredits: { type: Number, default: 0, min: 0 },
    membershipCreditsRemaining: { type: Number, default: 0, min: 0 },
    membershipValidUntil: { type: String, maxlength: 10, default: "" },
    membershipStatus: { type: String, maxlength: 40, default: "" },
    packageName: { type: String, maxlength: 120, default: "" },
    packageCreditsRemaining: { type: Number, default: 0, min: 0 },
    subscriptionName: { type: String, maxlength: 120, default: "" },
    subscriptionStatus: { type: String, maxlength: 40, default: "" }
  },
  { timestamps: true }
);

customerSchema.index({ salonId: 1, normalizedPhone: 1 }, { unique: true });

export const CustomerModel: Model<Customer> = (mongoose.models.Customer as Model<Customer>) || model<Customer>("Customer", customerSchema);

import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export type PromoKind = "coupon" | "referral";

export type PromoDiscountType = "percent" | "flat";

export type PromoStatus = "active" | "paused" | "expired" | "exhausted";

export interface PromoRedemption {
  id?: string;
  salonId: string;
  branchId: string;
  promoId: string;
  code: string;
  customerId: string;
  customerName: string;
  appointmentId?: string;
  invoiceId?: string;
  discountPaise: number;
  discountPercent?: number;
  appliedByUserId: string;
  appliedAt: Date;
}

export interface PromoCode {
  salonId: string;
  kind: PromoKind;
  code: string;
  label: string;
  description?: string;
  discountType: PromoDiscountType;
  discountPercent?: number;
  discountPaise?: number;
  minimumSpendPaise?: number;
  maxRedemptions?: number;
  startsAt?: Date;
  expiresAt?: Date;
  anyBranch: boolean;
  branchIds: string[];
  status: PromoStatus;
  redemptionCount: number;
  totalDiscountPaise: number;
  /** Referral only: reward given to the existing customer who referred someone. */
  referrerRewardType?: PromoDiscountType;
  referrerRewardPercent?: number;
  referrerRewardPaise?: number;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const promoSchema = new Schema<PromoCode>(
  {
    salonId: { type: String, required: true },
    kind: { type: String, required: true, enum: ["coupon", "referral"] },
    code: { type: String, required: true, uppercase: true, trim: true },
    label: { type: String, required: true, maxlength: 120 },
    description: { type: String, maxlength: 400 },
    discountType: { type: String, required: true, enum: ["percent", "flat"] },
    discountPercent: { type: Number, min: 0, max: 100 },
    discountPaise: { type: Number, min: 0 },
    minimumSpendPaise: { type: Number, min: 0, default: 0 },
    maxRedemptions: { type: Number, min: 1 },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    anyBranch: { type: Boolean, default: false },
    branchIds: { type: [String], default: [] },
    status: { type: String, enum: ["active", "paused", "expired", "exhausted"], default: "active" },
    redemptionCount: { type: Number, min: 0, default: 0 },
    totalDiscountPaise: { type: Number, min: 0, default: 0 },
    referrerRewardType: { type: String, enum: ["percent", "flat"] },
    referrerRewardPercent: { type: Number, min: 0, max: 100 },
    referrerRewardPaise: { type: Number, min: 0 },
    createdBy: { type: String, required: true }
  },
  { timestamps: true }
);

promoSchema.index({ salonId: 1, code: 1 }, { unique: true });
promoSchema.index({ salonId: 1, kind: 1, status: 1, createdAt: -1 });

export const PromoCodeModel: Model<PromoCode> =
  (mongoose.models.PromoCode as Model<PromoCode>) || model<PromoCode>("PromoCode", promoSchema);

const redemptionSchema = new Schema<PromoRedemption>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    promoId: { type: String, required: true },
    code: { type: String, required: true },
    customerId: { type: String, required: true },
    customerName: { type: String, default: "" },
    appointmentId: { type: String },
    invoiceId: { type: String },
    discountPaise: { type: Number, min: 0, default: 0 },
    discountPercent: { type: Number, min: 0, max: 100 },
    appliedByUserId: { type: String, required: true },
    appliedAt: { type: Date, default: () => new Date() }
  },
  { timestamps: true }
);

redemptionSchema.index({ salonId: 1, promoId: 1, createdAt: -1 });
redemptionSchema.index({ salonId: 1, customerId: 1, createdAt: -1 });
redemptionSchema.index({ salonId: 1, code: 1, createdAt: -1 });

export const PromoRedemptionModel: Model<PromoRedemption> =
  (mongoose.models.PromoRedemption as Model<PromoRedemption>) || model<PromoRedemption>("PromoRedemption", redemptionSchema);

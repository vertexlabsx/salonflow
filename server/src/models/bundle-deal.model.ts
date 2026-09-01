import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface BundleDealItem { serviceId: string; quantity: number; }
export interface BundleDeal {
  salonId: string;
  name: string;
  description: string;
  items: BundleDealItem[];
  pricePaise: number;
  status: "active" | "paused";
  startsAt?: Date | null;
  expiresAt?: Date | null;
  createdByUserId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const itemSchema = new Schema<BundleDealItem>({ serviceId: { type: String, required: true }, quantity: { type: Number, min: 1, max: 50, default: 1 } }, { _id: false });
const bundleDealSchema = new Schema<BundleDeal>(
  {
    salonId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 160 },
    description: { type: String, maxlength: 600, default: "" },
    items: { type: [itemSchema], default: [] },
    pricePaise: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["active", "paused"], default: "active" },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    createdByUserId: { type: String, default: "" }
  },
  { timestamps: true }
);

bundleDealSchema.index({ salonId: 1, status: 1, createdAt: -1 });

export const BundleDealModel: Model<BundleDeal> = (mongoose.models.BundleDeal as Model<BundleDeal>) || model<BundleDeal>("BundleDeal", bundleDealSchema);

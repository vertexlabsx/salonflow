import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Service {
  salonId: string;
  branchIds: string[];
  name: string;
  description: string;
  pricePaise: number;
  durationMinutes: number;
  eligibleStaffIds: string[];
  status: "active" | "inactive";
  createdAt?: Date;
  updatedAt?: Date;
}

const serviceSchema = new Schema<Service>(
  {
    salonId: { type: String, required: true },
    branchIds: { type: [String], default: [] },
    name: { type: String, required: true, maxlength: 160 },
    description: { type: String, maxlength: 1000, default: "" },
    pricePaise: { type: Number, required: true, min: 0 },
    durationMinutes: { type: Number, required: true, min: 5, max: 600 },
    eligibleStaffIds: { type: [String], default: [] },
    status: { type: String, enum: ["active", "inactive"], default: "active" }
  },
  { timestamps: true }
);

serviceSchema.index({ salonId: 1, status: 1 });

export const ServiceModel: Model<Service> = (mongoose.models.Service as Model<Service>) || model<Service>("Service", serviceSchema);

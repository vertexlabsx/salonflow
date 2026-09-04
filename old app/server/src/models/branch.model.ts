import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface BranchHours {
  weekday: number;
  open: string;
  close: string;
  closed: boolean;
}

export interface Branch {
  _id: string;
  salonId: string;
  name: string;
  timezone: string;
  status: "active" | "inactive";
  hours: BranchHours[];
  slotIntervalMinutes: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const branchSchema = new Schema<Branch>(
  {
    _id: { type: String, required: true },
    salonId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 160 },
    timezone: { type: String, default: "Asia/Kolkata" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    hours: {
      type: [
        {
          weekday: { type: Number, required: true, min: 0, max: 6 },
          open: { type: String, required: true },
          close: { type: String, required: true },
          closed: { type: Boolean, default: false }
        }
      ],
      default: []
    },
    slotIntervalMinutes: { type: Number, default: 30, min: 5, max: 120 }
  },
  { timestamps: true }
);

branchSchema.index({ salonId: 1, status: 1 });

export const BranchModel: Model<Branch> = (mongoose.models.Branch as Model<Branch>) || model<Branch>("Branch", branchSchema);

import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface PayrollRunItem {
  staffId: string;
  grossMinutes: number;
  overtimeMinutes: number;
  grossPayPaise: number;
  status: "draft" | "approved" | "paid";
}

export interface PayrollRun {
  salonId: string;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "approved" | "paid";
  items: PayrollRunItem[];
  totalGrossPayPaise: number;
  generatedByUserId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const payrollRunItemSchema = new Schema<PayrollRunItem>(
  {
    staffId: { type: String, required: true },
    grossMinutes: { type: Number, default: 0, min: 0 },
    overtimeMinutes: { type: Number, default: 0, min: 0 },
    grossPayPaise: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["draft", "approved", "paid"], default: "draft" }
  },
  { _id: false }
);

const payrollRunSchema = new Schema<PayrollRun>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    periodStart: { type: String, required: true },
    periodEnd: { type: String, required: true },
    status: { type: String, enum: ["draft", "approved", "paid"], default: "draft" },
    items: { type: [payrollRunItemSchema], default: [] },
    totalGrossPayPaise: { type: Number, default: 0, min: 0 },
    generatedByUserId: { type: String, required: true }
  },
  { timestamps: true }
);

payrollRunSchema.index({ salonId: 1, branchId: 1, periodStart: 1, periodEnd: 1 }, { unique: true });

export const PayrollRunModel: Model<PayrollRun> = (mongoose.models.PayrollRun as Model<PayrollRun>) || model<PayrollRun>("PayrollRun", payrollRunSchema);

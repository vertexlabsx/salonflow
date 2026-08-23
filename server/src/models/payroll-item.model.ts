import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface PayrollItem {
  salonId: string;
  staffId: string;
  payrollRunId: string;
  periodStart: string | null;
  periodEnd: string | null;
  grossAmountPaise: number;
  overtimeAmountPaise: number;
  bonusAmountPaise: number;
  deductionAmountPaise: number;
  netAmountPaise: number;
  overtimeMinutes: number;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const payrollItemSchema = new Schema<PayrollItem>(
  {
    salonId: { type: String, required: true },
    staffId: { type: String, required: true },
    payrollRunId: { type: String, required: true },
    periodStart: { type: String, default: null },
    periodEnd: { type: String, default: null },
    grossAmountPaise: { type: Number, required: true, min: 0 },
    overtimeAmountPaise: { type: Number, default: 0 },
    bonusAmountPaise: { type: Number, default: 0 },
    deductionAmountPaise: { type: Number, default: 0 },
    netAmountPaise: { type: Number, required: true, min: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    status: { type: String, enum: ["draft", "approved", "paid"], default: "draft" }
  },
  { timestamps: true }
);

payrollItemSchema.index({ salonId: 1, staffId: 1, createdAt: -1 });

export const PayrollItemModel: Model<PayrollItem> =
  (mongoose.models.PayrollItem as Model<PayrollItem>) || model<PayrollItem>("PayrollItem", payrollItemSchema);

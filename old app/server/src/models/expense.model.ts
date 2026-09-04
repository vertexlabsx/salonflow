import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Expense {
  salonId: string;
  branchId: string;
  date: string;
  category: string;
  vendor: string;
  description: string;
  amountPaise: number;
  taxRateBps: number;
  taxPaise: number;
  totalPaise: number;
  notes: string;
  createdByUserId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const EXPENSE_CATEGORIES = [
  "rent",
  "salaries",
  "utilities",
  "products",
  "equipment",
  "marketing",
  "maintenance",
  "insurance",
  "taxes",
  "other"
] as const;

const expenseSchema = new Schema<Expense>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    date: { type: String, required: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, default: "other" },
    vendor: { type: String, maxlength: 160, default: "" },
    description: { type: String, maxlength: 300, default: "" },
    amountPaise: { type: Number, required: true, min: 0 },
    taxRateBps: { type: Number, default: 0, min: 0, max: 10000 },
    taxPaise: { type: Number, required: true, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    notes: { type: String, maxlength: 600, default: "" },
    createdByUserId: { type: String, default: "" }
  },
  { timestamps: true }
);

expenseSchema.index({ salonId: 1, branchId: 1, date: -1 });
expenseSchema.index({ salonId: 1, date: -1 });

export const ExpenseModel: Model<Expense> = (mongoose.models.Expense as Model<Expense>) || model<Expense>("Expense", expenseSchema);

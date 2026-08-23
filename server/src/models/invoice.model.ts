import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitAmountPaise: number;
  taxRateBps: number;
  totalPaise: number;
}

export interface InvoicePayment {
  method: "cash" | "card" | "upi" | "bank_transfer" | "other";
  amountPaise: number;
  reference: string;
  receivedByUserId: string;
  receivedAt: Date;
}

export interface Invoice {
  salonId: string;
  branchId: string;
  customerId?: string;
  appointmentId?: string;
  invoiceNumber: string;
  status: "draft" | "issued" | "void";
  paymentStatus: "unpaid" | "partial" | "paid";
  currency: "INR";
  lines: InvoiceLine[];
  subtotalPaise: number;
  taxPaise: number;
  grandTotalPaise: number;
  paidAmountPaise: number;
  dueAmountPaise: number;
  payments: InvoicePayment[];
  voidReason: string;
  issuedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const invoiceLineSchema = new Schema<InvoiceLine>(
  {
    description: { type: String, required: true, maxlength: 240 },
    quantity: { type: Number, required: true, min: 1 },
    unitAmountPaise: { type: Number, required: true, min: 0 },
    taxRateBps: { type: Number, required: true, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const invoicePaymentSchema = new Schema<InvoicePayment>(
  {
    method: { type: String, enum: ["cash", "card", "upi", "bank_transfer", "other"], required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    reference: { type: String, maxlength: 120, default: "" },
    receivedByUserId: { type: String, default: "" },
    receivedAt: { type: Date, required: true }
  },
  { _id: false }
);

const invoiceSchema = new Schema<Invoice>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    customerId: { type: String, default: "" },
    appointmentId: { type: String, default: "" },
    invoiceNumber: { type: String, required: true },
    status: { type: String, enum: ["draft", "issued", "void"], default: "draft" },
    paymentStatus: { type: String, enum: ["unpaid", "partial", "paid"], default: "unpaid" },
    currency: { type: String, enum: ["INR"], default: "INR" },
    lines: { type: [invoiceLineSchema], default: [] },
    subtotalPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, required: true, min: 0 },
    grandTotalPaise: { type: Number, required: true, min: 0 },
    paidAmountPaise: { type: Number, default: 0, min: 0 },
    dueAmountPaise: { type: Number, required: true, min: 0 },
    payments: { type: [invoicePaymentSchema], default: [] },
    voidReason: { type: String, maxlength: 500, default: "" },
    issuedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

invoiceSchema.index({ salonId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ salonId: 1, branchId: 1, createdAt: -1 });
invoiceSchema.index({ salonId: 1, appointmentId: 1 });

export const InvoiceModel: Model<Invoice> = (mongoose.models.Invoice as Model<Invoice>) || model<Invoice>("Invoice", invoiceSchema);

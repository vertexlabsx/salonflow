import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface PurchaseOrderLine { itemName: string; sku: string; quantity: number; unitCostPaise: number; totalPaise: number; }
export interface PurchaseOrder {
  salonId: string;
  branchId: string;
  poNumber: string;
  supplierName: string;
  supplierPhone: string;
  status: "draft" | "sent" | "received" | "cancelled";
  expectedAt?: Date | null;
  lines: PurchaseOrderLine[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  notes: string;
  createdByUserId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema<PurchaseOrderLine>({ itemName: { type: String, required: true, maxlength: 180 }, sku: { type: String, maxlength: 80, default: "" }, quantity: { type: Number, min: 1, default: 1 }, unitCostPaise: { type: Number, min: 0, default: 0 }, totalPaise: { type: Number, min: 0, default: 0 } }, { _id: false });
const purchaseOrderSchema = new Schema<PurchaseOrder>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    poNumber: { type: String, required: true },
    supplierName: { type: String, required: true, maxlength: 180 },
    supplierPhone: { type: String, maxlength: 32, default: "" },
    status: { type: String, enum: ["draft", "sent", "received", "cancelled"], default: "draft" },
    expectedAt: { type: Date, default: null },
    lines: { type: [lineSchema], default: [] },
    subtotalPaise: { type: Number, min: 0, default: 0 },
    taxPaise: { type: Number, min: 0, default: 0 },
    totalPaise: { type: Number, min: 0, default: 0 },
    notes: { type: String, maxlength: 800, default: "" },
    createdByUserId: { type: String, default: "" }
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ salonId: 1, poNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ salonId: 1, branchId: 1, status: 1, createdAt: -1 });

export const PurchaseOrderModel: Model<PurchaseOrder> = (mongoose.models.PurchaseOrder as Model<PurchaseOrder>) || model<PurchaseOrder>("PurchaseOrder", purchaseOrderSchema);

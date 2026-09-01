import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface ClientPhotoRecord {
  salonId: string;
  branchId: string;
  customerId: string;
  appointmentId: string;
  beforeUrl: string;
  afterUrl: string;
  caption: string;
  serviceNames: string[];
  createdByUserId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const clientPhotoSchema = new Schema<ClientPhotoRecord>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    customerId: { type: String, required: true },
    appointmentId: { type: String, default: "" },
    beforeUrl: { type: String, maxlength: 1000, default: "" },
    afterUrl: { type: String, maxlength: 1000, default: "" },
    caption: { type: String, maxlength: 500, default: "" },
    serviceNames: { type: [String], default: [] },
    createdByUserId: { type: String, default: "" }
  },
  { timestamps: true }
);

clientPhotoSchema.index({ salonId: 1, customerId: 1, createdAt: -1 });
clientPhotoSchema.index({ salonId: 1, branchId: 1, createdAt: -1 });

export const ClientPhotoModel: Model<ClientPhotoRecord> = (mongoose.models.ClientPhotoRecord as Model<ClientPhotoRecord>) || model<ClientPhotoRecord>("ClientPhotoRecord", clientPhotoSchema);

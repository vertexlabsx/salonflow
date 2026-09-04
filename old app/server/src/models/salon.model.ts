import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

/**
 * A salon is a tenant. Its `_id` doubles as the public `tenantId`/`salonId`
 * string used across every tenant-owned collection and by client logins
 * (e.g. "tenant_aura"). Every tenant-owned document stores this id.
 */
export interface Salon {
  _id: string;
  name: string;
  timezone: string;
  currency: "INR";
  status: "active" | "inactive";
  /** WhatsApp business numbers registered for this salon (Phase D/E). */
  whatsappPhoneNumberIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const salonSchema = new Schema<Salon>(
  {
    _id: { type: String, required: true, match: /^[a-z0-9][a-z0-9_-]{1,62}$/ },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    timezone: { type: String, default: "Asia/Kolkata" },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    whatsappPhoneNumberIds: { type: [String], default: [] }
  },
  { timestamps: true, _id: false }
);

export const SalonModel: Model<Salon> =
  (mongoose.models.Salon as Model<Salon>) || model<Salon>("Salon", salonSchema);

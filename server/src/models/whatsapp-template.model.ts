import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface WhatsAppTemplate {
  salonId: string;
  wabaId: string;
  metaTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  lastSyncedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const whatsappTemplateSchema = new Schema<WhatsAppTemplate>(
  {
    salonId: { type: String, required: true, index: true },
    wabaId: { type: String, required: true },
    metaTemplateId: { type: String, required: true },
    name: { type: String, required: true },
    language: { type: String, required: true },
    category: { type: String, default: "" },
    status: { type: String, default: "" },
    components: { type: [Schema.Types.Mixed], default: [] },
    lastSyncedAt: { type: Date, required: true }
  },
  { timestamps: true }
);

whatsappTemplateSchema.index({ salonId: 1, name: 1, language: 1 }, { unique: true });
whatsappTemplateSchema.index({ salonId: 1, status: 1 });

export const WhatsAppTemplateModel: Model<WhatsAppTemplate> =
  (mongoose.models.WhatsAppTemplate as Model<WhatsAppTemplate>) || model<WhatsAppTemplate>("WhatsAppTemplate", whatsappTemplateSchema);

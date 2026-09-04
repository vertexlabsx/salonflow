import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface PushDevice {
  salonId: string;
  userId: string;
  deviceId: string;
  platform: string;
  pushProvider: string;
  deviceToken: string;
  appVersion: string;
  capabilities: { pwa: boolean; native: boolean; pushNotifications: boolean };
  /** Web-push subscription blob (endpoint/keys) when the provider is web-push. */
  subscription: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

const pushDeviceSchema = new Schema<PushDevice>(
  {
    salonId: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    platform: { type: String, maxlength: 40, default: "web" },
    pushProvider: { type: String, maxlength: 40, default: "web-push" },
    deviceToken: { type: String, maxlength: 500, default: "" },
    appVersion: { type: String, maxlength: 40, default: "" },
    capabilities: {
      pwa: { type: Boolean, default: true },
      native: { type: Boolean, default: false },
      pushNotifications: { type: Boolean, default: true }
    },
    subscription: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

pushDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

export const PushDeviceModel: Model<PushDevice> =
  (mongoose.models.PushDevice as Model<PushDevice>) || model<PushDevice>("PushDevice", pushDeviceSchema);

import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export type NotificationStatus = "unread" | "read" | "archived";

export interface AppNotification {
  salonId: string;
  /** null => broadcast to every staff member of the salon. */
  staffId: string | null;
  title: string;
  body: string;
  status: NotificationStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

const notificationSchema = new Schema<AppNotification>(
  {
    salonId: { type: String, required: true },
    staffId: { type: String, default: null },
    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, maxlength: 1000, default: "" },
    status: { type: String, enum: ["unread", "read", "archived"], default: "unread" }
  },
  { timestamps: true }
);

notificationSchema.index({ salonId: 1, staffId: 1, createdAt: -1 });

export const NotificationModel: Model<AppNotification> =
  (mongoose.models.AppNotification as Model<AppNotification>) || model<AppNotification>("AppNotification", notificationSchema);

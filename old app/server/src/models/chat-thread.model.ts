import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface ChatThread {
  salonId: string;
  branchId: string;
  title: string;
  channel: string;
  createdByStaffId: string | null;
  lastMessageAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const chatThreadSchema = new Schema<ChatThread>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    title: { type: String, required: true, maxlength: 120 },
    channel: { type: String, maxlength: 40, default: "internal" },
    createdByStaffId: { type: String, default: null },
    lastMessageAt: { type: Date, default: null }
  },
  { timestamps: true }
);

chatThreadSchema.index({ salonId: 1, branchId: 1 });

export const ChatThreadModel: Model<ChatThread> =
  (mongoose.models.ChatThread as Model<ChatThread>) || model<ChatThread>("ChatThread", chatThreadSchema);

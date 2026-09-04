import mongoose, { model, Schema, Types } from "mongoose";
import type { Model } from "mongoose";

export interface ChatMessage {
  salonId: string;
  threadId: Types.ObjectId;
  senderStaffId: string;
  senderName: string;
  body: string;
  readBy: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

const chatMessageSchema = new Schema<ChatMessage>(
  {
    salonId: { type: String, required: true },
    threadId: { type: Schema.Types.ObjectId, required: true },
    senderStaffId: { type: String, required: true },
    senderName: { type: String, maxlength: 120, default: "" },
    body: { type: String, required: true, maxlength: 4000 },
    readBy: { type: [String], default: [] }
  },
  { timestamps: true }
);

chatMessageSchema.index({ threadId: 1, createdAt: 1 });

export const ChatMessageModel: Model<ChatMessage> =
  (mongoose.models.ChatMessage as Model<ChatMessage>) || model<ChatMessage>("ChatMessage", chatMessageSchema);

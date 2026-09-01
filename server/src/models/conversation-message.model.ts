import mongoose, { model, Schema, Types } from "mongoose";
import type { Model } from "mongoose";

export interface ConversationMessage {
  salonId: string;
  conversationId: Types.ObjectId;
  type: "team" | "private-owner";
  senderUserId: string;
  senderName: string;
  body: string;
  deliveredCount: number;
  readCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const conversationMessageSchema = new Schema<ConversationMessage>(
  {
    salonId: { type: String, required: true },
    conversationId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ["team", "private-owner"], required: true },
    senderUserId: { type: String, required: true },
    senderName: { type: String, maxlength: 120, default: "" },
    body: { type: String, required: true, maxlength: 4000 },
    deliveredCount: { type: Number, default: 0 },
    readCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

conversationMessageSchema.index({ conversationId: 1, createdAt: 1 });
conversationMessageSchema.index({ body: "text", senderName: "text" });

export const ConversationMessageModel: Model<ConversationMessage> =
  (mongoose.models.ConversationMessage as Model<ConversationMessage>) ||
  model<ConversationMessage>("ConversationMessage", conversationMessageSchema);

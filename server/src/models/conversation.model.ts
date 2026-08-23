import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Conversation {
  salonId: string;
  branchId: string;
  /** "team" => whole branch (participantUserIds empty). "private-owner" => exactly the listed users. */
  type: "team" | "private-owner";
  title: string;
  participantUserIds: string[];
  lastMessageAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const conversationSchema = new Schema<Conversation>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    type: { type: String, enum: ["team", "private-owner"], required: true },
    title: { type: String, required: true, maxlength: 120 },
    participantUserIds: { type: [String], default: [] },
    lastMessageAt: { type: Date, default: null }
  },
  { timestamps: true }
);

conversationSchema.index({ salonId: 1, branchId: 1, type: 1 });

export const ConversationModel: Model<Conversation> =
  (mongoose.models.Conversation as Model<Conversation>) || model<Conversation>("Conversation", conversationSchema);

import mongoose, { Schema, model, type Model, type Types } from "mongoose";
import { randomBytes, createHash } from "node:crypto";

export interface RefreshTokenRecord {
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  replacedByHash?: string | null;
  deviceType?: string;
}

export interface ShopifyUser {
  _id: Types.ObjectId;
  shopDomain: string;
  loginId: string;
  loginIdNormalized: string;
  email: string;
  name: string;
  passwordHash: string;
  role: "admin" | "client";
  status: "active" | "disabled";
  refreshTokens: RefreshTokenRecord[];
  createdAt: Date;
  updatedAt: Date;
}

const refreshSchema = new Schema<RefreshTokenRecord>(
  {
    tokenHash: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
    deviceType: { type: String, default: "" }
  },
  { _id: false }
);

const shopifyUserSchema = new Schema<ShopifyUser>(
  {
    shopDomain: { type: String, required: true, lowercase: true, trim: true },
    loginId: { type: String, required: true, trim: true, maxlength: 120 },
    loginIdNormalized: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 200 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "client"], required: true },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    refreshTokens: { type: [refreshSchema], default: [], select: false }
  },
  { timestamps: true }
);

shopifyUserSchema.index({ shopDomain: 1, loginIdNormalized: 1 }, { unique: true });
shopifyUserSchema.index({ loginIdNormalized: 1 });

export const ShopifyUserModel: Model<ShopifyUser> =
  (mongoose.models.ShopifyUser as Model<ShopifyUser>) || model<ShopifyUser>("ShopifyUser", shopifyUserSchema);

export function hashRefreshToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

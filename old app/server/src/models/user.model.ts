import mongoose, { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";
import { randomBytes, createHash } from "node:crypto";

export type UserRole = "owner" | "admin" | "superAdmin" | string;

/** Hashed refresh token record — raw tokens are never persisted. */
export interface RefreshTokenRecord {
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  replacedByHash?: string | null;
  deviceType?: string;
}

export interface User {
  _id: Types.ObjectId;
  salonId: string;
  loginId: string;
  loginIdNormalized: string;
  email?: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  roleDisplayName?: string;
  customRoleName?: string;
  /** Linked staff profile id. Required for non-owner logins by the app contract. */
  staffId?: string;
  branchId: string;
  branchIds: string[];
  /** Effective grants used by the Staff App authorization surface. */
  staffAppPermissions: string[];
  /** Broader CRM grants retained for diagnostics. */
  crmPermissions: string[];
  status: "active" | "disabled" | "suspended";
  /** TOTP two-factor — enabled only after a successful verification. */
  totpEnabled: boolean;
  totpSecret?: string | null;
  /** Hashed single-use recovery codes (sha256), shown once at enrollment. */
  recoveryCodes?: string[];
  /** Payroll input — paise per hour used by payroll generation. */
  hourlyRatePaise?: number;
  /** WebAuthn credentials (Phase F). Kept on schema so the contract is stable. */
  webauthnCredentials: Array<{ credentialId: string; publicKey: string; label: string; createdAt: Date }>;
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

const userSchema = new Schema<User>(
  {
    salonId: { type: String, required: true, index: true },
    loginId: { type: String, required: true, trim: true, maxlength: 120 },
    loginIdNormalized: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: undefined },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true },
    roleDisplayName: { type: String, maxlength: 120 },
    customRoleName: { type: String, maxlength: 120 },
    staffId: { type: String, index: true },
    branchId: { type: String, required: true },
    branchIds: { type: [String], default: [] },
    staffAppPermissions: { type: [String], default: [] },
    crmPermissions: { type: [String], default: [] },
    status: { type: String, enum: ["active", "disabled", "suspended"], default: "active" },
    totpEnabled: { type: Boolean, default: false },
    totpSecret: { type: String, default: null },
    recoveryCodes: { type: [String], default: [], select: false },
    hourlyRatePaise: { type: Number, default: 0, min: 0 },
    webauthnCredentials: { type: [{ credentialId: String, publicKey: String, label: String, createdAt: Date }], default: [] },
    refreshTokens: { type: [refreshSchema], default: [], select: false }
  },
  { timestamps: true }
);

userSchema.index({ salonId: 1, loginIdNormalized: 1 }, { unique: true });
// Partial unique index: only documents that actually HAVE an email participate,
// so users without email can coexist within the same salon.
userSchema.index(
  { salonId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } }, collation: { locale: "en", strength: 2 } }
);

export const UserModel: Model<User> =
  (mongoose.models.User as Model<User>) || model<User>("User", userSchema);
export type UserDocument = HydratedDocument<User>;

export function hashRefreshToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

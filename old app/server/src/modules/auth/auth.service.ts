import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Salon } from "../../models/salon.model";
import {
  UserModel,
  generateRefreshToken,
  hashRefreshToken,
  type User,
  type UserDocument
} from "../../models/user.model";
import { loadEnv } from "../../config/env";
import { ApiError } from "../../shared/http";
import { signAccessToken } from "../../middleware/auth.middleware";
import { isRecoveryCodeMatch, verifyTotp as verifyTotpSecret } from "../../shared/totp";

export interface SessionUserPayload {
  id: string;
  name: string;
  loginId: string;
  email?: string;
  role: string;
  roleDisplayName?: string;
  customRoleName?: string;
  staffId?: string;
  branchId: string;
  branchIds: string[];
  permissions?: string[];
  staffAppPermissions?: string[];
  crmPermissions?: string[];
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  user: SessionUserPayload;
  tenant: { id: string; name: string };
}

const OWNER_ROLES = new Set(["owner", "admin", "superadmin"]);

export function normalizeRole(role: string | undefined): string {
  return String(role || "").trim().replace(/[\s_-]+/g, "").toLowerCase();
}

export function isOwnerRole(role: string | undefined): boolean {
  return OWNER_ROLES.has(normalizeRole(role));
}

function effectiveGrants(userDoc: User): string[] {
  const staffApp = Array.isArray(userDoc.staffAppPermissions) ? userDoc.staffAppPermissions : [];
  const crm = Array.isArray(userDoc.crmPermissions) ? userDoc.crmPermissions : [];
  return staffApp.length ? [...staffApp] : [...crm];
}

function toSessionPayload(userDoc: User): SessionUserPayload {
  return {
    id: String(userDoc._id),
    name: userDoc.name,
    loginId: userDoc.loginId,
    ...(userDoc.email ? { email: userDoc.email } : {}),
    role: userDoc.role,
    ...(userDoc.roleDisplayName ? { roleDisplayName: userDoc.roleDisplayName } : {}),
    ...(userDoc.customRoleName ? { customRoleName: userDoc.customRoleName } : {}),
    ...(userDoc.staffId ? { staffId: userDoc.staffId } : {}),
    branchId: userDoc.branchId,
    branchIds: Array.isArray(userDoc.branchIds) ? [...userDoc.branchIds] : [],
    staffAppPermissions: [...(userDoc.staffAppPermissions || [])],
    crmPermissions: [...(userDoc.crmPermissions || [])],
    permissions: effectiveGrants(userDoc)
  };
}

async function findLoginUser(tenantId: string, loginIdentifier: string): Promise<UserDocument | null> {
  const identifier = loginIdentifier.trim();
  if (!tenantId.trim()) throw ApiError.badRequest("Tenant ID is required.");
  if (identifier.includes("@")) {
    return UserModel.findOne({ salonId: tenantId, email: identifier.toLowerCase() }).select("+refreshTokens");
  }
  return UserModel.findOne({
    salonId: tenantId,
    loginIdNormalized: identifier.toLowerCase()
  }).select("+refreshTokens +recoveryCodes");
}

/**
 * Verifies credentials and optional TOTP. TOTP stays fail-closed: a user with
 * totpEnabled must present a valid code (Phase F implements the verifier).
 */
export async function authenticate(
  tenantId: string,
  loginIdentifier: string,
  password: string,
  twoFactorCode?: string
): Promise<{ user: UserDocument; tenant: Salon }> {
  const userDoc = await findLoginUser(tenantId, loginIdentifier);
  // Uniform failure message + constant-ish work factor to avoid account enumeration.
  const passwordMatches = userDoc ? await bcrypt.compare(password, userDoc.passwordHash).catch(() => false) : false;
  const dummyCompare = userDoc ? null : await bcrypt.compare(password, "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpQ0PzNROl2tkVgkvXn8v1Rf2oA6W").catch(() => false);
  void dummyCompare;

  if (!userDoc || !passwordMatches) throw ApiError.unauthorized("Invalid credentials.");

  if (userDoc.totpEnabled) {
    const provided = String(twoFactorCode || "").trim();
    if (!provided) {
      throw new ApiError(401, "Enter the code from your authenticator app or a recovery code.", { requiresTotp: true });
    }
    const verified = await verifyTotpCode(userDoc, provided);
    if (!verified) {
      throw new ApiError(401, "That code was not accepted. Enter the current authenticator code or a recovery code.", { requiresTotp: true });
    }
  }

  if (userDoc.status !== "active") throw ApiError.forbidden("This account is not active. Contact the salon owner.");

  const salon = await requireSalon(tenantId);
  if (salon.status !== "active") throw ApiError.forbidden("This workspace is not active.");
  return { user: userDoc, tenant: salon };
}

/** RFC 6238 codes first; otherwise a single-use recovery code is consumed. */
async function verifyTotpCode(user: User, code: string): Promise<boolean> {
  if (user.totpSecret && verifyTotpSecret(user.totpSecret, code)) return true;
  const match = isRecoveryCodeMatch(user.recoveryCodes, code);
  if (!match) return false;
  await UserModel.updateOne({ _id: user._id }, { $pull: { recoveryCodes: match } });
  return true;
}

export async function requireSalon(tenantId: string): Promise<Salon> {
  const { SalonModel } = await import("../../models/salon.model");
  const salon = await SalonModel.findById(tenantId.trim());
  if (!salon) throw ApiError.unauthorized("Unknown workspace. Check the Tenant ID.");
  return salon;
}export function issueSession(userDoc: User, tenant: Salon, deviceType = ""): IssuedSession {
  const env = loadEnv();
  const sessionId = randomUUID();
  const rawRefresh = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  userDoc.refreshTokens = [
    ...(userDoc.refreshTokens || []).filter((record) => !record.revokedAt && record.expiresAt > new Date()),
    { tokenHash: hashRefreshToken(rawRefresh), issuedAt: new Date(), expiresAt, revokedAt: null, replacedByHash: null, deviceType }
  ].slice(-10);

  const accessToken = signAccessToken({
    sub: String(userDoc._id),
    sid: sessionId,
    ten: userDoc.salonId,
    rol: userDoc.role,
    stf: userDoc.staffId,
    br0: userDoc.branchId,
    brs: [...userDoc.branchIds],
    prm: effectiveGrants(userDoc)
  });

  return {
    accessToken,
    refreshToken: rawRefresh,
    user: toSessionPayload(userDoc),
    tenant: { id: tenant._id as unknown as string, name: tenant.name }
  };
}

/** Consumes a refresh token (body or cookie), rotates it, and issues a fresh session. */
export async function rotateRefresh(rawToken: string, deviceType = ""): Promise<IssuedSession> {
  if (!rawToken) throw ApiError.unauthorized("Session refresh failed.");
  const tokenHash = hashRefreshToken(rawToken);

  const userDoc = await UserModel.findOne({ "refreshTokens.tokenHash": tokenHash }).select("+refreshTokens");
  const record = userDoc?.refreshTokens.find((item) => item.tokenHash === tokenHash);
  if (!userDoc || !record || record.revokedAt || record.expiresAt <= new Date()) {
    throw ApiError.unauthorized("Session refresh failed or expired. Sign in again.");
  }
  if (userDoc.status !== "active") throw ApiError.forbidden("This account is not active.");

  const tenant = await requireSalon(userDoc.salonId);
  if (tenant.status !== "active") throw ApiError.forbidden("This workspace is not active.");

  const nextSession = issueSession(userDoc, tenant, deviceType);
  const previousIndex = userDoc.refreshTokens.indexOf(record);
  if (previousIndex >= 0) {
    const target = userDoc.refreshTokens[previousIndex];
    if (target) {
      target.revokedAt = new Date();
      target.replacedByHash = hashRefreshToken(nextSession.refreshToken);
    }
  }
  await userDoc.save();
  return nextSession;
}

/** Revokes one refresh token if valid. Never throws — logout must always succeed locally. */
export async function revokeRefresh(rawToken: string | undefined | null): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashRefreshToken(rawToken);
  await UserModel.updateOne(
    { "refreshTokens.tokenHash": tokenHash },
    { $set: { "refreshTokens.$.revokedAt": new Date() } }
  ).catch(() => undefined);
}

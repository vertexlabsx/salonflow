import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { loadEnv } from "../config/env";
import { ApiError } from "../shared/http";
import { UserModel, type User } from "../models/user.model";

export interface AccessClaims {
  sub: string;
  sid: string;
  ten: string;
  rol: string;
  stf?: string;
  br0: string;
  brs: string[];
  prm: string[];
}

export function signAccessToken(claims: AccessClaims): string {
  const env = loadEnv();
  const ttlSeconds = env.ACCESS_TOKEN_TTL_MINUTES * 60;
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { algorithm: "HS256", expiresIn: ttlSeconds, issuer: "aura-staff-server" });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const decoded = jwt.verify(token, loadEnv().JWT_ACCESS_SECRET, { algorithms: ["HS256"], issuer: "aura-staff-server" });
    if (typeof decoded === "string" || typeof decoded.sub !== "string" || typeof decoded.ten !== "string") {
      throw ApiError.unauthorized("Session token is invalid.");
    }
    return decoded as unknown as AccessClaims;
  } catch {
    throw ApiError.unauthorized("Session token is invalid or expired.");
  }
}

function extractToken(req: Request): string | null {
  const headerToken = req.header("x-auth-token");
  if (headerToken && headerToken.trim()) return headerToken.trim();
  const authorization = req.header("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim();
  return null;
}

function toContext(userDoc: User, sessionId: string) {
  const permissions = Array.isArray(userDoc.staffAppPermissions) ? [...userDoc.staffAppPermissions] : [];
  const crmPermissions = Array.isArray(userDoc.crmPermissions)
    ? [...userDoc.crmPermissions]
    : Array.isArray((userDoc as unknown as { permissions?: string[] }).permissions)
      ? [...((userDoc as unknown as { permissions: string[] }).permissions)]
      : [];
  return {
    userId: String(userDoc._id),
    salonId: userDoc.salonId,
    role: userDoc.role,
    staffId: userDoc.staffId,
    branchId: userDoc.branchId,
    branchIds: Array.isArray(userDoc.branchIds) ? [...userDoc.branchIds] : [],
    permissions: permissions.length ? permissions : [...crmPermissions],
    crmPermissions,
    sessionId,
    user: userDoc as never
  };
}

/**
 * Verifies the access token (x-auth-token for the native app path,
 * Authorization: Bearer for the owner web path) and re-hydrates the user so
 * disabled accounts and permission changes take effect immediately.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized("Authentication is required.");
    const claims = verifyAccessToken(token);
    void UserModel.findOne({ _id: claims.sub, salonId: claims.ten })
      .select("+refreshTokens")
      .then((userDoc) => {
        if (!userDoc) return next(ApiError.unauthorized("Account no longer exists."));
        if (userDoc.status !== "active") return next(ApiError.forbidden("This account is not active."));
        req.context = toContext(userDoc, claims.sid);
        next();
      })
      .catch(next);
  } catch (error) {
    next(error);
  }
}

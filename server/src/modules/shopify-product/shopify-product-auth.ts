import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { loadEnv } from "../../config/env";
import { ApiError } from "../../shared/http";
import { ShopifyUserModel, type ShopifyUser } from "../../models/shopify-user.model";

export interface ShopifyAccessClaims {
  sub: string;
  sid: string;
  shopDomain: string;
  role: "admin" | "client";
}

export interface ShopifyContext {
  userId: string;
  shopDomain: string;
  role: "admin" | "client";
  user: ShopifyUser;
}

declare global {
  namespace Express {
    interface Request {
      shopifyContext?: ShopifyContext;
    }
  }
}

const ISSUER = "shopify-automation";

export function signShopifyAccessToken(claims: ShopifyAccessClaims): string {
  const env = loadEnv();
  const ttlSeconds = env.ACCESS_TOKEN_TTL_MINUTES * 60;
  return jwt.sign(claims, env.SHOPIFY_JWT_SECRET, { algorithm: "HS256", expiresIn: ttlSeconds, issuer: ISSUER });
}

export function verifyShopifyAccessToken(token: string): ShopifyAccessClaims {
  try {
    const decoded = jwt.verify(token, loadEnv().SHOPIFY_JWT_SECRET, { algorithms: ["HS256"], issuer: ISSUER });
    if (typeof decoded === "string" || typeof decoded.sub !== "string" || typeof decoded.shopDomain !== "string") {
      throw ApiError.unauthorized("Session token is invalid.");
    }
    return decoded as unknown as ShopifyAccessClaims;
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

export function requireShopifyAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized("Authentication is required.");
    const claims = verifyShopifyAccessToken(token);
    void ShopifyUserModel.findOne({ _id: claims.sub, shopDomain: claims.shopDomain })
      .select("+refreshTokens")
      .then((userDoc) => {
        if (!userDoc) return next(ApiError.unauthorized("Account no longer exists."));
        if (userDoc.status !== "active") return next(ApiError.forbidden("This account is not active."));
        req.shopifyContext = { userId: String(userDoc._id), shopDomain: claims.shopDomain, role: claims.role, user: userDoc };
        next();
      })
      .catch(next);
  } catch (error) {
    next(error);
  }
}

export function requireShopifyAdmin(_req: Request, res: Response, next: NextFunction): void {
  if (!_req.shopifyContext || _req.shopifyContext.role !== "admin") {
    return next(ApiError.forbidden("Admin access is required."));
  }
  next();
}

export function requireShopifyClient(_req: Request, res: Response, next: NextFunction): void {
  if (!_req.shopifyContext || _req.shopifyContext.role !== "client") {
    return next(ApiError.forbidden("Client access is required."));
  }
  next();
}

import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { loadEnv } from "../../config/env";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { ShopifyUserModel, type ShopifyUser, type RefreshTokenRecord, hashRefreshToken, generateRefreshToken } from "../../models/shopify-user.model";
import { signShopifyAccessToken, type ShopifyAccessClaims } from "./shopify-product-auth";

export const shopifyProductAuthRouter = Router();

function refreshCookieOptions() {
  const env = loadEnv();
  const ttlMs = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE as "lax" | "none" | "strict",
    maxAge: ttlMs,
    path: "/api/v1/shopify-api/auth"
  };
}

function issueShopifySession(userDoc: ShopifyUser, deviceType = "web") {
  const sessionId = crypto.randomUUID();
  const rawRefresh = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawRefresh);
  const now = new Date();
  const env = loadEnv();
  const expiresAt = new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  userDoc.refreshTokens.push({ tokenHash, issuedAt: now, expiresAt, revokedAt: null, replacedByHash: null, deviceType });
  if (userDoc.refreshTokens.length > 10) {
    const nonRevoked = userDoc.refreshTokens.filter((t: RefreshTokenRecord) => !t.revokedAt);
    while (nonRevoked.length > 10) {
      const oldest = nonRevoked.shift()!;
      oldest.revokedAt = now;
    }
  }

  const claims: ShopifyAccessClaims = { sub: String(userDoc._id), sid: sessionId, shopDomain: userDoc.shopDomain, role: userDoc.role };
  const accessToken = signShopifyAccessToken(claims);

  return { accessToken, refreshToken: rawRefresh, user: { id: String(userDoc._id), email: userDoc.email, name: userDoc.name, role: userDoc.role, shopDomain: userDoc.shopDomain }, expiresAt };
}

shopifyProductAuthRouter.post("/login", asyncHandler(async (req, res) => {
  const body = z.object({ email: z.string().min(1), password: z.string().min(1) }).parse(req.body);
  const emailNormalized = body.email.trim().toLowerCase();

  const userDoc = await ShopifyUserModel.findOne({ loginIdNormalized: emailNormalized }).select("+refreshTokens");
  if (!userDoc) throw ApiError.unauthorized("Invalid email or password.");
  if (userDoc.status !== "active") throw ApiError.forbidden("This account is not active.");

  const valid = await bcrypt.compare(body.password, userDoc.passwordHash);
  if (!valid) throw ApiError.unauthorized("Invalid email or password.");

  const session = issueShopifySession(userDoc, "web");
  await userDoc.save();

  res.cookie("shopifyRefresh", session.refreshToken, refreshCookieOptions());
  ok(res, { accessToken: session.accessToken, user: session.user });
}));

shopifyProductAuthRouter.post("/refresh", asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.cookies?.shopifyRefresh;
  if (!refreshToken) throw ApiError.unauthorized("Refresh token is required.");

  const tokenHash = hashRefreshToken(refreshToken);
  const userDoc = await ShopifyUserModel.findOne({ "refreshTokens.tokenHash": tokenHash }).select("+refreshTokens");
  if (!userDoc) throw ApiError.unauthorized("Invalid refresh token.");

  const record = userDoc.refreshTokens.find((t) => t.tokenHash === tokenHash);
  if (!record || record.revokedAt) throw ApiError.unauthorized("Refresh token has been revoked.");
  if (new Date() > record.expiresAt) throw ApiError.unauthorized("Refresh token has expired.");
  if (userDoc.status !== "active") throw ApiError.forbidden("This account is not active.");

  record.revokedAt = new Date();
  record.replacedByHash = hashRefreshToken(generateRefreshToken());

  const session = issueShopifySession(userDoc, "web");
  await userDoc.save();

  res.cookie("shopifyRefresh", session.refreshToken, refreshCookieOptions());
  ok(res, { accessToken: session.accessToken, user: session.user });
}));

shopifyProductAuthRouter.post("/logout", asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.cookies?.shopifyRefresh;
  if (refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    const userDoc = await ShopifyUserModel.findOne({ "refreshTokens.tokenHash": tokenHash }).select("+refreshTokens");
    if (userDoc) {
      const record = userDoc.refreshTokens.find((t: RefreshTokenRecord) => t.tokenHash === tokenHash);
      if (record) record.revokedAt = new Date();
      await userDoc.save();
    }
  }
  res.clearCookie("shopifyRefresh", { path: "/api/v1/shopify-api/auth" });
  ok(res, { loggedOut: true });
}));

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { loadEnv } from "../../config/env";
import { CSRF_COOKIE, issueCsrfToken } from "../../middleware/csrf";
import { requireAuth } from "../../middleware/auth.middleware";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { logger } from "../../shared/logger";
import { generateRecoveryCodes, generateTotpSecret, verifyTotp } from "../../shared/totp";
import {
  authenticate,
  isOwnerRole,
  issueSession,
  requireSalon,
  revokeRefresh,
  rotateRefresh
} from "./auth.service";
import { UserModel } from "../../models/user.model";

const loginSchema = z.object({
  tenantId: z.string().trim().min(1).max(80),
  loginId: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(200).optional(),
  password: z.string().min(1).max(256),
  branchId: z.string().trim().max(80).optional(),
  totpToken: z.string().trim().max(20).optional(),
  twoFactorCode: z.string().trim().max(20).optional(),
  device: z.object({ type: z.string().max(60).optional() }).partial().optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().max(512).optional(),
  device: z.object({ type: z.string().max(60).optional() }).partial().optional()
});

const REFRESH_COOKIE = "auraRefresh";

function refreshCookieOptions() {
  const env = loadEnv();
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE as "lax" | "none" | "strict",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/api/v1/auth"
  };
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
}

export const authRouter = Router();

/* ── CSRF token issuance ─────────────────────────────────────────────────── */

authRouter.get(
  "/csrf",
  (req: Request, res: Response) => {
    const { token, expiresAt } = issueCsrfToken();
    res.cookie(CSRF_COOKIE, token, {
      ...refreshCookieOptions(),
      maxAge: 10 * 60_000,
      path: "/"
    });
    ok(res, { csrfToken: token, expiresAt: expiresAt.toISOString() });
  }
);

/* ── Login ──────────────────────────────────────────────────────────────── */

authRouter.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    const body = loginSchema.parse(req.body);
    const { user, tenant } = await authenticate(body.tenantId, body.loginId, body.password, body.totpToken || body.twoFactorCode);

    if (body.branchId && user.branchIds.length && !user.branchIds.includes(body.branchId)) {
      throw ApiError.forbidden("The requested branch is not available to this account.");
    }

    const session = issueSession(user, tenant, body.device?.type || "");
    await user.save();
    res.cookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions());
    logger.info("Login succeeded", { tenantId: tenant._id, role: session.user.role, deviceType: body.device?.type || "" });
    ok(res, session);
  })
);

/* ── Refresh (body token for the native app, cookie for the owner web app) ── */

authRouter.post(
  "/refresh",
  asyncHandler(async (req: Request, res: Response) => {
    const body = refreshSchema.parse(req.body ?? {});
    const rawToken = body.refreshToken || (typeof req.cookies?.[REFRESH_COOKIE] === "string" ? (req.cookies[REFRESH_COOKIE] as string) : "");
    const session = await rotateRefresh(rawToken, body.device?.type || req.context?.role || "");
    res.cookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions());
    ok(res, session);
  })
);

/* ── Logout ─────────────────────────────────────────────────────────────── */

authRouter.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    const cookieToken = typeof req.cookies?.[REFRESH_COOKIE] === "string" ? (req.cookies[REFRESH_COOKIE] as string) : "";
    const bodyToken = typeof (req.body as { refreshToken?: unknown })?.refreshToken === "string"
      ? (req.body as { refreshToken: string }).refreshToken
      : "";
    await Promise.all([revokeRefresh(cookieToken), revokeRefresh(bodyToken)]);
    clearRefreshCookie(res);
    ok(res, { loggedOut: true });
  })
);

/* ── Demo staff session (development convenience only) ──────────────────── */

authRouter.get(
  "/demo-staff-session",
  asyncHandler(async (_req: Request, res: Response) => {
    const env = loadEnv();
    if (env.NODE_ENV === "production") throw ApiError.notFound("API route was not found.");
    const salon = await requireSalon(env.SEED_SALON_ID);
    const staffUser = await UserModel.findOne({ salonId: salon._id, loginIdNormalized: env.SEED_STAFF_LOGIN.trim().toLowerCase() }).select("+refreshTokens");
    if (!staffUser || staffUser.status !== "active") throw ApiError.notFound("Demo staff workspace is not seeded.");
    const session = issueSession(staffUser, salon, "staff-app");
    await staffUser.save();
    ok(res, session);
  })
);

/* ── TOTP two-factor enrollment ─────────────────────────────────────────── */

authRouter.post(
  "/totp/setup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.context!.userId);
    if (!user) throw ApiError.unauthorized("Session user no longer exists.");
    if (user.totpEnabled) throw ApiError.badRequest("Two-factor authentication is already enabled.");
    const secret = generateTotpSecret();
    user.totpSecret = secret;
    await user.save();
    const otpauthUrl = `otpauth://totp/Aura:${encodeURIComponent(user.loginId)}?secret=${secret}&issuer=Aura&algorithm=SHA1&digits=6&period=30`;
    ok(res, { secret, otpauthUrl });
  })
);

authRouter.post(
  "/totp/enable",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).parse(req.body ?? {});
    const user = await UserModel.findById(req.context!.userId).select("+recoveryCodes");
    if (!user) throw ApiError.unauthorized("Session user no longer exists.");
    if (user.totpEnabled) throw ApiError.badRequest("Two-factor authentication is already enabled.");
    if (!user.totpSecret || !verifyTotp(user.totpSecret, body.code)) throw ApiError.badRequest("That code was not accepted. Scan the secret again and retry with the current code.");
    user.totpEnabled = true;
    let recoveryCodes: string[] | undefined;
    if (!user.recoveryCodes?.length) {
      const generated = generateRecoveryCodes();
      user.recoveryCodes = generated.hashed;
      recoveryCodes = generated.plain;
    }
    await user.save();
    logger.info("TOTP enabled", { userId: String(user._id), salonId: req.context!.salonId });
    ok(res, { enabled: true, recoveryCodes: recoveryCodes || null, recoveryCodesAlreadyIssued: !recoveryCodes });
  })
);

authRouter.post(
  "/totp/disable",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ password: z.string().min(1).max(256) }).parse(req.body ?? {});
    const user = await UserModel.findById(req.context!.userId).select("+recoveryCodes");
    if (!user) throw ApiError.unauthorized("Session user no longer exists.");
    if (!(await bcrypt.compare(body.password, user.passwordHash))) throw ApiError.unauthorized("Password did not match.");
    user.totpEnabled = false;
    user.totpSecret = null;
    user.recoveryCodes = [];
    await user.save();
    logger.info("TOTP disabled", { userId: String(user._id), salonId: req.context!.salonId });
    ok(res, { enabled: false });
  })
);

authRouter.get("/totp/status", requireAuth, asyncHandler(async (req, res) => {
  const user = await UserModel.findById(req.context!.userId);
  if (!user) throw ApiError.unauthorized("Session user no longer exists.");
  ok(res, { enabled: Boolean(user.totpEnabled), enrolledAt: null });
}));

/* ── WebAuthn / passkeys compatibility surface ──────────────────────────── */

const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60_000;

function signWebAuthn(payload: string): string {
  return createHmac("sha256", loadEnv().CSRF_SECRET).update(payload).digest("base64url");
}

function webAuthnChallenge(kind: "registration" | "authentication", tenantId = "", loginId = "") {
  const challenge = randomBytes(32).toString("base64url");
  const expiresMs = Date.now() + WEBAUTHN_CHALLENGE_TTL_MS;
  const payload = `${kind}.${expiresMs}.${challenge}.${tenantId}.${loginId}`;
  return { challenge, challengeToken: `${payload}.${signWebAuthn(payload)}`, expiresAt: new Date(expiresMs).toISOString() };
}

function rpId(): string {
  const firstOrigin = loadEnv().CORS_ORIGINS.split(",").map((item) => item.trim()).find(Boolean) || "http://localhost";
  try {
    return new URL(firstOrigin).hostname;
  } catch {
    return "localhost";
  }
}

authRouter.post(
  "/webauthn/register/begin",
  asyncHandler(async (req, res) => {
    const body = z.object({ tenantId: z.string().trim().max(80).optional(), loginId: z.string().trim().max(160).optional() }).parse(req.body ?? {});
    const challenge = webAuthnChallenge("registration", body.tenantId || "", body.loginId || "");
    ok(res, {
      challengeToken: challenge.challengeToken,
      expiresAt: challenge.expiresAt,
      publicKey: {
        challenge: challenge.challenge,
        rp: { name: "Aura", id: rpId() },
        user: { id: randomBytes(16).toString("base64url"), name: body.loginId || "staff", displayName: body.loginId || "Staff" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        timeout: WEBAUTHN_CHALLENGE_TTL_MS,
        attestation: "none",
        authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" }
      }
    });
  })
);

authRouter.post(
  "/webauthn/login/begin",
  asyncHandler(async (req, res) => {
    const body = z.object({ tenantId: z.string().trim().max(80).optional(), loginId: z.string().trim().max(160).optional() }).parse(req.body ?? {});
    const challenge = webAuthnChallenge("authentication", body.tenantId || "", body.loginId || "");
    ok(res, {
      challengeToken: challenge.challengeToken,
      expiresAt: challenge.expiresAt,
      publicKey: {
        challenge: challenge.challenge,
        timeout: WEBAUTHN_CHALLENGE_TTL_MS,
        rpId: rpId(),
        userVerification: "preferred",
        allowCredentials: []
      }
    });
  })
);

authRouter.post("/webauthn/register/finish", () => {
  throw ApiError.unavailableFeature("Passkey registration is available only after verified device credentials are enrolled.");
});

authRouter.post("/webauthn/login/finish", () => {
  throw ApiError.unauthorized("No passkey is enrolled for this account yet. Use password sign-in.");
});

/** Exported so the owner persona can branch on role exactly like the legacy server did. */
export { isOwnerRole };

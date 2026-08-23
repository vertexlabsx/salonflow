import type { NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { loadEnv } from "../config/env";

export const CSRF_COOKIE = "auraCsrf";
const CSRF_TTL_MS = 10 * 60_000;

function sign(payload: string): string {
  return createHmac("sha256", loadEnv().CSRF_SECRET).update(payload).digest("base64url");
}

/** Issues a stateless signed CSRF token: `<expiryMs>.<nonce>.<hmac>`. */
export function issueCsrfToken(): { token: string; expiresAt: Date } {
  const expiresMs = Date.now() + CSRF_TTL_MS;
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const payload = `${expiresMs}.${nonce}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(expiresMs) };
}

function isValidToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiryRaw, nonce, signature] = parts as [string, string, string];
  const expiryMs = Number(expiryRaw);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;
  const expected = sign(`${expiryRaw}.${nonce}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Double-submit CSRF verification with a native-app fallback:
 *  - bearer/token-authenticated requests are CSRF-immune (no ambient cookie
 *    credentials exist for an attacker to abuse) and skip the check entirely
 *  - browser path: cookie must be present AND match x-csrf-token
 *  - native CapacitorHttp path (no cookie jar): signed header token alone is accepted
 */
export function csrfGuard(exemptPaths: RegExp[] = []) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!MUTATING_METHODS.has(req.method)) return next();
    // Token-authenticated API clients cannot be CSRF'd — their credentials are
    // not attached automatically by browsers.
    const headerAuth = String(req.header("x-auth-token") || req.header("authorization") || "");
    if (headerAuth) return next();
    if (exemptPaths.some((pattern) => pattern.test(req.path))) return next();

    const headerToken = String(req.header("x-csrf-token") || "");
    const cookieToken = typeof req.cookies?.[CSRF_COOKIE] === "string" ? (req.cookies[CSRF_COOKIE] as string) : "";

    if (!headerToken) {
      if (req.path === "/auth/login" && cookieToken && isValidToken(cookieToken)) return next();
      res.status(403).json({ success: false, error: { message: "csrf token missing or expired. Refresh and try again." } });
      return;
    }
    if (!isValidToken(headerToken)) {
      res.status(403).json({ success: false, error: { message: "csrf token invalid or expired. Fetch a fresh token." } });
      return;
    }
    // When a cookie accompanies the request it must match the header (browser session).
    if (cookieToken && !safeEqual(cookieToken, headerToken)) {
      res.status(403).json({ success: false, error: { message: "csrf token mismatch. Reload the app and try again." } });
      return;
    }
    next();
  };
}

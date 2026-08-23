import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { loadEnv } from "../../../config/env";
import { ApiError } from "../../../shared/http";

const STATE_TTL_MS = 10 * 60_000;
const usedStates = new Set<string>();

function sign(payload: string): string {
  return createHmac("sha256", loadEnv().CSRF_SECRET).update(payload).digest("base64url");
}

export function createEmbeddedSignupState(input: { salonId: string; userId: string }): { state: string; expiresAt: string } {
  const expiresMs = Date.now() + STATE_TTL_MS;
  const nonce = randomBytes(18).toString("base64url");
  const payload = `${input.salonId}.${input.userId}.${expiresMs}.${nonce}`;
  return { state: `${payload}.${sign(payload)}`, expiresAt: new Date(expiresMs).toISOString() };
}

export function consumeEmbeddedSignupState(state: string, expected: { salonId: string; userId: string }): void {
  if (usedStates.has(state)) throw ApiError.badRequest("Embedded Signup state has already been used.");
  const parts = state.split(".");
  if (parts.length !== 5) throw ApiError.badRequest("Invalid Embedded Signup state.");
  const [salonId, userId, expiresRaw, nonce, signature] = parts as [string, string, string, string, string];
  const payload = `${salonId}.${userId}.${expiresRaw}.${nonce}`;
  const expectedSignature = Buffer.from(sign(payload));
  const receivedSignature = Buffer.from(signature);
  if (expectedSignature.length !== receivedSignature.length || !timingSafeEqual(expectedSignature, receivedSignature)) throw ApiError.badRequest("Invalid Embedded Signup state signature.");
  if (salonId !== expected.salonId || userId !== expected.userId) throw ApiError.forbidden("Embedded Signup state does not belong to this session.");
  if (Number(expiresRaw) < Date.now()) throw ApiError.badRequest("Embedded Signup state expired. Start again.");
  usedStates.add(state);
}

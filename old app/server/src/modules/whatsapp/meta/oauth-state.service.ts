import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { loadEnv } from "../../../config/env";
import { ApiError } from "../../../shared/http";
import { WhatsAppOAuthStateModel } from "../../../models/whatsapp-oauth-state.model";

const STATE_TTL_MS = 10 * 60_000;

function sign(payload: string): string {
  return createHmac("sha256", loadEnv().CSRF_SECRET).update(payload).digest("base64url");
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function createEmbeddedSignupState(input: { salonId: string; userId: string }): Promise<{ state: string; expiresAt: string }> {
  const expiresMs = Date.now() + STATE_TTL_MS;
  const nonce = randomBytes(18).toString("base64url");
  const payload = `${input.salonId}.${input.userId}.${expiresMs}.${nonce}`;
  const state = `${payload}.${sign(payload)}`;
  const expiresAt = new Date(expiresMs);
  await WhatsAppOAuthStateModel.create({ stateHash: stateHash(state), salonId: input.salonId, userId: input.userId, expiresAt, consumedAt: null });
  return { state, expiresAt: expiresAt.toISOString() };
}

export async function consumeEmbeddedSignupState(state: string, expected: { salonId: string; userId: string }): Promise<void> {
  const parts = state.split(".");
  if (parts.length !== 5) throw ApiError.badRequest("Invalid Embedded Signup state.");
  const [salonId, userId, expiresRaw, nonce, signature] = parts as [string, string, string, string, string];
  const payload = `${salonId}.${userId}.${expiresRaw}.${nonce}`;
  const expectedSignature = Buffer.from(sign(payload));
  const receivedSignature = Buffer.from(signature);
  if (expectedSignature.length !== receivedSignature.length || !timingSafeEqual(expectedSignature, receivedSignature)) throw ApiError.badRequest("Invalid Embedded Signup state signature.");
  if (salonId !== expected.salonId || userId !== expected.userId) throw ApiError.forbidden("Embedded Signup state does not belong to this session.");
  if (Number(expiresRaw) < Date.now()) throw ApiError.badRequest("Embedded Signup state expired. Start again.");
  const result = await WhatsAppOAuthStateModel.updateOne(
    { stateHash: stateHash(state), salonId: expected.salonId, userId: expected.userId, consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } }
  );
  if (result.modifiedCount !== 1) {
    const existing = await WhatsAppOAuthStateModel.findOne({ stateHash: stateHash(state), salonId: expected.salonId, userId: expected.userId });
    if (existing?.consumedAt) throw ApiError.badRequest("Embedded Signup state has already been used.");
    if (existing && existing.expiresAt <= new Date()) throw ApiError.badRequest("Embedded Signup state expired. Start again.");
    throw ApiError.badRequest("Invalid Embedded Signup state.");
  }
}

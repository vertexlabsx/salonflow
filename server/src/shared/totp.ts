import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** RFC 6238 with a ±1 step window (30s steps). */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(atMs / 30_000);
  const expected = Buffer.from(code, "utf8");
  return [-1, 0, 1].some((drift) => {
    const candidate = Buffer.from(totpCode(secret, counter + drift), "utf8");
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
  });
}

const RECOVERY_CODE_COUNT = 10;

function hashCode(code: string): string {
  return createHash("sha256").update(`aura-recovery:${code}`).digest("hex");
}

export function generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n: number) => Array.from({ length: n }, () => alphabet[randomBytes(1)[0]! % alphabet.length]).join("");
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () => `${pick(4)}-${pick(4)}`);
  return { plain, hashed: plain.map(hashCode) };
}

export function isRecoveryCodeMatch(hashedCodes: string[] | undefined, code: string): string | null {
  const target = hashCode(code.trim());
  return hashedCodes?.find((hashed) => hashed === target) || null;
}

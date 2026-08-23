import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { IdempotencyModel } from "../models/idempotency.model";
import { logger } from "../shared/logger";

const IDEMPOTENCY_HEADER = "idempotency-key";

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex").slice(0, 32);
}

/**
 * Replays the stored response for a repeated (method, path, key, body) tuple.
 * Concurrent duplicates wait for the original to finish via a unique-index insert race.
 */
export function idempotencyGuard() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = String(req.header(IDEMPOTENCY_HEADER) || "").trim();
    if (!key) return next();
    if (key.length > 120) {
      res.status(400).json({ success: false, error: { message: "Idempotency-Key is too long." } });
      return;
    }

    const scope = `${req.method} ${req.baseUrl}${req.path}:${req.context?.salonId || "anon"}`;
    const hash = requestHash(req.body);
    const filter = { scope, key };

    try {
      const existing = await IdempotencyModel.findOne(filter);
      if (existing) {
        if (existing.requestHash !== hash) {
          res.status(409).json({
            success: false,
            error: { message: "This Idempotency-Key was already used with a different payload. Generate a new key." }
          });
          return;
        }
        res.status(existing.responseStatus).type("json").send(existing.responseBody);
        return;
      }

      // Reserve the key before execution; a concurrent duplicate insert fails here.
      try {
        await IdempotencyModel.create({ ...filter, requestHash: hash, responseStatus: 0, responseBody: "", storedAt: new Date() });
        req.idempotencyReservedKey = { ...filter };
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code === 11000) {
          // Another request with this key is in flight — poll briefly then replay.
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            const winner = await IdempotencyModel.findOne(filter);
            if (winner && winner.responseStatus > 0) {
              if (winner.requestHash !== hash) {
                res.status(409).json({ success: false, error: { message: "Idempotency-Key reused with a different payload." } });
                return;
              }
              res.status(winner.responseStatus).type("json").send(winner.responseBody);
              return;
            }
          }
          res.status(409).json({ success: false, error: { message: "A request with this Idempotency-Key is still in progress." } });
          return;
        }
        throw error;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Stores the final response for the reserved idempotency key (best-effort). */
export async function storeIdempotentResponse(
  reserved: { scope: string; key: string } | undefined,
  status: number,
  body: string
): Promise<void> {
  if (!reserved) return;
  try {
    await IdempotencyModel.updateOne({ scope: reserved.scope, key: reserved.key }, { $set: { responseStatus: status, responseBody: body } });
  } catch (error) {
    logger.warn("Failed to persist idempotent response", { error: String(error), scope: reserved.scope });
  }
}

export async function releaseIdempotencyReservation(reserved: { scope: string; key: string } | undefined): Promise<void> {
  if (!reserved) return;
  try {
    await IdempotencyModel.deleteOne({ scope: reserved.scope, key: reserved.key });
  } catch {
    /* best-effort cleanup */
  }
}

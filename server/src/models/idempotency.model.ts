import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

/**
 * Durable idempotency store. Guarantees that a client retry with the same
 * Idempotency-Key replays the original response instead of executing twice.
 */
export interface IdempotencyRecord {
  key: string;
  scope: string;
  requestHash: string;
  responseStatus: number;
  responseBody: string;
  storedAt: Date;
}

const idempotencySchema = new Schema<IdempotencyRecord>({
  key: { type: String, required: true, maxlength: 120 },
  scope: { type: String, required: true, maxlength: 300 },
  requestHash: { type: String, required: true },
  responseStatus: { type: Number, required: true },
  responseBody: { type: String, required: true },
  storedAt: { type: Date, required: true }
});

// TTL cleanup after 24h; uniqueness guarantees exactly one stored response per scope+key.
idempotencySchema.index({ storedAt: 1 }, { expireAfterSeconds: 86_400 });
idempotencySchema.index({ scope: 1, key: 1 }, { unique: true });

export const IdempotencyModel: Model<IdempotencyRecord> =
  (mongoose.models.IdempotencyKey as Model<IdempotencyRecord>) || model<IdempotencyRecord>("IdempotencyKey", idempotencySchema);

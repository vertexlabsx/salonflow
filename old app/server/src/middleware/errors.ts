import type { ErrorRequestHandler, Request, Response } from "express";
import { ZodError } from "zod";
import mongoose from "mongoose";
import { ApiError, fail } from "../shared/http";
import { logger } from "../shared/logger";
import { releaseIdempotencyReservation } from "./idempotency";

interface EnvelopeErrorBody {
  success: false;
  error: { message: string; details?: Record<string, unknown> };
}

function normalize(error: unknown): { status: number; body: EnvelopeErrorBody } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: { success: false, error: { message: error.message, ...(error.details ? { details: error.details } : {}) } }
    };
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    return { status: 400, body: { success: false, error: { message: `Invalid request -> ${issues.join("; ")}` } } };
  }
  if (error instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(error.errors).map((item) => item.message);
    return { status: 400, body: { success: false, error: { message: messages.join("; ") || "Validation failed." } } };
  }
  if (error instanceof mongoose.Error.CastError) {
    return { status: 400, body: { success: false, error: { message: `Invalid value for ${error.path}.` } } };
  }
  if (typeof error === "object" && error && (error as { code?: number }).code === 11000) {
    return { status: 409, body: { success: false, error: { message: "This record already exists." } } };
  }

  // Transport-level failures from body-parser / cors carry a `type` marker.
  if (typeof error === "object" && error) {
    const transport = error as { type?: string; message?: unknown };
    if (transport.type === "entity.parse.failed") {
      return { status: 400, body: { success: false, error: { message: "Request body is not valid JSON." } } };
    }
    if (transport.type === "entity.too.large") {
      return { status: 413, body: { success: false, error: { message: "Request body is too large." } } };
    }
    if (typeof transport.message === "string" && /not allowed by CORS/i.test(transport.message)) {
      return { status: 400, body: { success: false, error: { message: transport.message } } };
    }
  }

  logger.error("Unhandled API error", { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  return { status: 500, body: { success: false, error: { message: "Unexpected server error. Please try again." } } };
}

export function notFoundHandler(req: Request, res: Response): void {
  fail(res, 404, "API route was not found.");
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  void releaseIdempotencyReservation(req.idempotencyReservedKey).finally(() => {
    const { status, body } = normalize(error);
    // The frontend surfaces `message` directly; keep it human-readable.
    fail(res as unknown as Response, status, body.error.message, body.error.details);
  });
};

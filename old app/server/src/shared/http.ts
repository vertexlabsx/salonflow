import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Every API response uses the envelope contract expected by the Angular app:
 *   success -> { success: true, data }
 *   failure -> { success: false, error: { message, details? } } or { success: false, error: "string" }
 */
export type ApiErrorDetails = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly details?: ApiErrorDetails;

  constructor(status: number, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }

  static badRequest(message = "Invalid request.", details?: ApiErrorDetails): ApiError {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Authentication is required."): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(message = "You do not have access to this resource."): ApiError {
    return new ApiError(403, message);
  }

  static notFound(message = "Resource was not found."): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message = "The request conflicts with existing state.", details?: ApiErrorDetails): ApiError {
    return new ApiError(409, message, details);
  }

  static staleVersion(message = "This record must be refreshed before editing.", details?: ApiErrorDetails): ApiError {
    return new ApiError(428, message, details);
  }

  static unavailableFeature(message: string): ApiError {
    return new ApiError(501, message);
  }
}

/** Appointment scheduling conflicts — surfaced to the owner UI exactly like the legacy contract. */
export interface SchedulingConflict {
  id?: string;
  startAt?: string;
  endAt?: string;
  staffId?: string;
  message?: string;
}

export function conflictError(conflicts: SchedulingConflict[], message = "Requested time is not available."): ApiError {
  return new ApiError(409, message, { conflicts });
}

export function ok(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json({ success: true, data });
}

export function fail(res: Response, status: number, message: string, details?: ApiErrorDetails): Response {
  return res.status(status).json({ success: false, error: { message, ...(details ? { details } : {}) } });
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** Pagination contract used by every list endpoint: { items, page: { limit, offset, total, hasMore } }. */
export interface PageEnvelope<T> {
  items: T[];
  page: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export function pageEnvelope<T>(items: T[], total: number, limit: number, offset: number): PageEnvelope<T> {
  const safeLimit = Math.max(1, limit);
  const safeOffset = Math.max(0, offset);
  const hasMore = safeOffset + items.length < total;
  return {
    items,
    page: { limit: safeLimit, offset: safeOffset, total, hasMore, nextOffset: hasMore ? safeOffset + items.length : null }
  };
}

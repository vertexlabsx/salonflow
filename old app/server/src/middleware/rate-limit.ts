import rateLimit from "express-rate-limit";
import { loadEnv } from "../config/env";

const isTest = () => loadEnv().NODE_ENV === "test";

/** Global API budget — generous for app usage, protective against abuse. */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => isTest(),
  message: { success: false, error: { message: "Too many requests. Please slow down and try again shortly." } }
});

/** Credential endpoints get a strict per-IP budget. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => isTest(),
  message: { success: false, error: { message: "Too many sign-in attempts. Try again in a few minutes." } }
});

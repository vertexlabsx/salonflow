import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ok } from "../../shared/http";
import { requireAuth } from "../../middleware/auth.middleware";
import { PushDeviceModel } from "../../models/push-device.model";
import { loadEnv } from "../../config/env";

export const mobileRouter = Router();
mobileRouter.use(requireAuth);

mobileRouter.get(
  "/push-config",
  asyncHandler(async (_req, res) => {
    const env = loadEnv();
    const publicKey = env.WEB_PUSH_PUBLIC_KEY || "";
    ok(res, { configured: Boolean(publicKey && env.WEB_PUSH_PRIVATE_KEY), publicKey });
  })
);

mobileRouter.post(
  "/devices",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        id: z.string().trim().min(1).max(200),
        platform: z.string().trim().max(40).default("web"),
        pushProvider: z.string().trim().max(40).default("web-push"),
        deviceToken: z.string().max(500).default(""),
        appVersion: z.string().max(40).default(""),
        capabilities: z
          .object({
            pwa: z.boolean().default(true),
            native: z.boolean().default(false),
            pushNotifications: z.boolean().default(true)
          })
          .partial()
          .default({})
      })
      .parse(req.body ?? {});

    await PushDeviceModel.findOneAndUpdate(
      { userId: req.context!.userId, deviceId: body.id },
      {
        $set: {
          salonId: req.context!.salonId,
          platform: body.platform,
          pushProvider: body.pushProvider,
          deviceToken: body.deviceToken,
          appVersion: body.appVersion,
          capabilities: {
            pwa: body.capabilities.pwa ?? true,
            native: body.capabilities.native ?? false,
            pushNotifications: body.capabilities.pushNotifications ?? true
          }
        }
      },
      { upsert: true }
    );
    ok(res, { id: body.id }, 201);
  })
);

mobileRouter.post(
  "/push-subscriptions",
  asyncHandler(async (req, res) => {
    const payload = (req.body ?? {}) as Record<string, unknown>;
    const endpoint = typeof payload.endpoint === "string" ? payload.endpoint : "";
    const deviceId = endpoint || `sub-${Date.now()}`;
    await PushDeviceModel.findOneAndUpdate(
      { userId: req.context!.userId, deviceId },
      { $set: { salonId: req.context!.salonId, subscription: payload } },
      { upsert: true }
    );
    ok(res, { saved: true }, 201);
  })
);

import webpush from "web-push";
import { loadEnv } from "../../config/env";
import { PushDeviceModel } from "../../models/push-device.model";
import { UserModel } from "../../models/user.model";
import { logger } from "../../shared/logger";

export interface PushNotification {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const env = loadEnv();
  if (!env.WEB_PUSH_PUBLIC_KEY || !env.WEB_PUSH_PRIVATE_KEY) return false;
  webpush.setVapidDetails("mailto:support@aura-salon.app", env.WEB_PUSH_PUBLIC_KEY, env.WEB_PUSH_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

/** Fire-and-forget push to every registered subscription of one user. */
export async function sendPushToUser(salonId: string, userId: string, notification: PushNotification): Promise<void> {
  try {
    if (!ensureVapid()) return;
    const devices = await PushDeviceModel.find({ salonId, userId, subscription: { $ne: null } });
    const payload = JSON.stringify(notification);
    await Promise.all(
      devices.map(async (device) => {
        try {
          await webpush.sendNotification(device.subscription as Parameters<typeof webpush.sendNotification>[0], payload, { TTL: 3600 });
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await device.deleteOne();
          } else {
            logger.warn("Push send failed", { userId, statusCode, error: error instanceof Error ? error.message : String(error) });
          }
        }
      })
    );
  } catch (error) {
    logger.error("Push dispatch failed", { userId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Resolves a staff profile to its login user, then sends the push. Safe to fire-and-forget. */
export async function notifyStaffByStaffId(salonId: string, staffId: string, notification: PushNotification): Promise<void> {
  const user = await UserModel.findOne({ salonId, staffId }, { _id: 1 }).lean();
  if (!user) return;
  await sendPushToUser(salonId, String(user._id), notification);
}

import { loadEnv } from "../../config/env";
import { CustomerModel } from "../../models/customer.model";
import { WhatsAppConnectionModel } from "../../models/whatsapp-connection.model";
import { WhatsAppOutboundModel, type WhatsAppOutbound } from "../../models/whatsapp-outbound.model";
import { logger } from "../../shared/logger";
import { decryptSecret } from "../../shared/secret-box";

export const WHATSAPP_MAX_RETRIES = 5;

async function attemptMetaSend(row: Pick<WhatsAppOutbound, "salonId" | "toPhone" | "type" | "body">): Promise<{ providerMessageId: string }> {
  const env = loadEnv();
  let token = env.META_WHATSAPP_TOKEN || "";
  let phoneNumberId = env.META_WABA_PHONE_NUMBER_ID || "";
  if (env.WHATSAPP_PROVIDER === "meta_test" || env.WHATSAPP_PROVIDER === "meta_production") {
    const connection = await WhatsAppConnectionModel.findOne({ salonId: row.salonId, status: "connected" }).select("+encryptedAccessToken").sort({ connectedAt: -1 });
    if (!connection) throw new Error("No connected WhatsApp number for this salon.");
    if (!connection.encryptedAccessToken) throw new Error("Connected WhatsApp credentials are missing for this salon.");
    token = decryptSecret(connection.encryptedAccessToken);
    phoneNumberId = connection.phoneNumberId;
  }
  if (!token || !phoneNumberId) throw new Error("Meta WhatsApp credentials are not configured.");
  const response = await fetch(`${env.META_GRAPH_API_BASE_URL}/${env.META_API_VERSION || env.META_GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: row.toPhone, type: "text", text: { body: row.body } })
  });
  const payload = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Meta send failed (${response.status})`);
  return { providerMessageId: payload.messages?.[0]?.id || "" };
}

export async function sendWhatsAppMessage(input: {
  salonId: string;
  appointmentId?: string | null;
  toPhone: string;
  type: "confirmation" | "reminder" | "cancellation" | "reschedule" | "utility";
  body: string;
}): Promise<void> {
  const env = loadEnv();
  const provider = env.WHATSAPP_PROVIDER;

  if (input.type === "reminder") {
    const customer = await CustomerModel.findOne({ salonId: input.salonId, normalizedPhone: input.toPhone }, { marketingOptOut: 1 });
    if (customer?.marketingOptOut) {
      await WhatsAppOutboundModel.create({ ...input, appointmentId: input.appointmentId || null, provider, status: "failed", error: "recipient_opted_out", lastAttemptAt: new Date() });
      logger.info("WhatsApp reminder suppressed (opted out)", { toPhone: input.toPhone });
      return;
    }
  }

  const row = await WhatsAppOutboundModel.create({ ...input, appointmentId: input.appointmentId || null, provider, status: "queued", lastAttemptAt: new Date() });

  if (provider === "mock") {
    row.status = "sent";
    row.providerMessageId = `mock_${String(row._id)}`;
    await row.save();
    logger.info("Mock WhatsApp message queued", { toPhone: input.toPhone, type: input.type });
    return;
  }

  try {
    const { providerMessageId } = await attemptMetaSend(row);
    row.status = "sent";
    row.providerMessageId = providerMessageId;
    row.error = "";
  } catch (error) {
    row.status = "failed";
    row.retryCount += 1;
    row.error = error instanceof Error ? error.message : String(error);
    logger.error("WhatsApp send failed", { error: row.error, toPhone: input.toPhone, type: input.type });
  }
  await row.save();
}

export async function retryFailedMessages(salonId?: string): Promise<{ attempted: number; sent: number; failed: number }> {
  const now = Date.now();
  const cutoff = new Date(now - 10 * 60_000);
  const filter: Record<string, unknown> = { status: { $in: ["failed", "queued"] }, retryCount: { $lt: WHATSAPP_MAX_RETRIES }, $or: [{ lastAttemptAt: { $lte: cutoff } }, { lastAttemptAt: null }] };
  if (salonId) filter.salonId = salonId;
  const rows = await WhatsAppOutboundModel.find(filter).sort({ createdAt: 1 }).limit(100);

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    row.lastAttemptAt = new Date();
    try {
      const { providerMessageId } = await attemptMetaSend(row);
      row.status = "sent";
      row.providerMessageId = providerMessageId;
      row.error = "";
      sent += 1;
    } catch (error) {
      row.status = "failed";
      row.retryCount += 1;
      row.error = error instanceof Error ? error.message : String(error);
      failed += 1;
    }
    await row.save();
  }
  if (rows.length) logger.info("WhatsApp retry pass complete", { attempted: rows.length, sent, failed });
  return { attempted: rows.length, sent, failed };
}

export async function applyWhatsAppDeliveryStatus(providerMessageId: string, status: string, timestampMs: number): Promise<boolean> {
  const normalized = status === "delivered" || status === "read" || status === "failed" || status === "sent" ? status : "sent";
  const update: Record<string, unknown> = { status: normalized };
  if (normalized === "delivered") update.deliveredAt = new Date(timestampMs);
  if (normalized === "read") update.readAt = new Date(timestampMs);
  if (normalized === "failed") update.error = "Meta delivery failure";
  const result = await WhatsAppOutboundModel.updateOne({ providerMessageId }, { $set: update });
  return result.modifiedCount > 0;
}

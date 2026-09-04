import { loadEnv } from "../../config/env";
import { CustomerModel } from "../../models/customer.model";
import { WhatsAppConnectionModel } from "../../models/whatsapp-connection.model";
import { WhatsAppOutboundModel, type WhatsAppOutbound } from "../../models/whatsapp-outbound.model";
import { logger } from "../../shared/logger";
import { decryptSecret } from "../../shared/secret-box";

export const WHATSAPP_MAX_RETRIES = 5;

const MARKETING_TYPES = new Set(["reminder", "birthday", "loyalty", "feedback", "rebooking"]);

/** Appends a compliance opt-out footer to marketing-type outbound message bodies. */
export function withOptOutFooter(type: string, body: string): string {
  if (!MARKETING_TYPES.has(type)) return body;
  const footer = "\n\nReply STOP to opt out.";
  if (body.includes("Reply STOP to opt out")) return body;
  return `${body}${footer}`;
}

async function resolveMetaCredentials(salonId: string): Promise<{ token: string; phoneNumberId: string }> {
  const env = loadEnv();
  let token = env.META_WHATSAPP_TOKEN || "";
  let phoneNumberId = env.META_WABA_PHONE_NUMBER_ID || "";
  if (env.WHATSAPP_PROVIDER === "meta_test" || env.WHATSAPP_PROVIDER === "meta_production") {
    const connection = await WhatsAppConnectionModel.findOne({ salonId, status: "connected" }).select("+encryptedAccessToken").sort({ connectedAt: -1 });
    if (!connection) throw new Error("No connected WhatsApp number for this salon.");
    if (!connection.encryptedAccessToken) throw new Error("Connected WhatsApp credentials are missing for this salon.");
    token = decryptSecret(connection.encryptedAccessToken);
    phoneNumberId = connection.phoneNumberId;
  }
  if (!token || !phoneNumberId) throw new Error("Meta WhatsApp credentials are not configured.");
  return { token, phoneNumberId };
}

async function attemptMetaSend(row: Pick<WhatsAppOutbound, "salonId" | "toPhone" | "type" | "body" | "interactive" | "templatePayload">): Promise<{ providerMessageId: string }> {
  const env = loadEnv();
  const { token, phoneNumberId } = await resolveMetaCredentials(row.salonId);
  const messagePayload = row.templatePayload
    ? row.templatePayload
    : row.interactive
    ? { messaging_product: "whatsapp", to: row.toPhone, type: "interactive", interactive: row.interactive }
    : { messaging_product: "whatsapp", to: row.toPhone, type: "text", text: { body: row.body } };
  const response = await fetch(`${env.META_GRAPH_API_BASE_URL}/${env.META_API_VERSION || env.META_GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(messagePayload)
  });
  const payload = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Meta send failed (${response.status})`);
  return { providerMessageId: payload.messages?.[0]?.id || "" };
}

/** Sends multiple WhatsApp messages to the same recipient in one Meta bundled request. Returns one provider message id per part. */
async function attemptMetaBundleSend(salonId: string, toPhone: string, parts: Array<Record<string, unknown>>): Promise<string[]> {
  const env = loadEnv();
  const { token, phoneNumberId } = await resolveMetaCredentials(salonId);
  const response = await fetch(`${env.META_GRAPH_API_BASE_URL}/${env.META_API_VERSION || env.META_GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: toPhone, parts })
  });
  const payload = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Meta bundled send failed (${response.status})`);
  return (payload.messages || []).map((message) => message.id || "");
}

/** Sends the greeting (combined text + booking flow + menu list) as one bundled message
 *  when Meta accepts it, recording one outbound row per interactive part so delivery
 *  status and chat history stay intact. Falls back to two separate sends on rejection. */
export async function sendWhatsAppGreetingBundle(input: {
  salonId: string;
  toPhone: string;
  greetBody: string;
  flowInteractive: Record<string, unknown>;
  menuBody: string;
  menuInteractive: Record<string, unknown>;
  metadata: Record<string, unknown>;
  followUpMetadata: Record<string, unknown>;
}): Promise<"bundle" | "fallback"> {
  const env = loadEnv();
  const provider = env.WHATSAPP_PROVIDER;
  const base = { salonId: input.salonId, appointmentId: null, toPhone: input.toPhone, type: "utility" as const, provider, status: "queued" as const, lastAttemptAt: new Date() };
  const flowRow = await WhatsAppOutboundModel.create({ ...base, body: withOptOutFooter("utility", input.greetBody), interactive: input.flowInteractive, metadata: input.metadata });
  const menuRow = await WhatsAppOutboundModel.create({ ...base, body: withOptOutFooter("utility", input.menuBody), interactive: input.menuInteractive, metadata: input.followUpMetadata });

  if (provider === "mock") {
    flowRow.status = "sent";
    flowRow.providerMessageId = `mock_${String(flowRow._id)}`;
    menuRow.status = "sent";
    menuRow.providerMessageId = `mock_${String(menuRow._id)}`;
    await Promise.all([flowRow.save(), menuRow.save()]);
    logger.info("Mock WhatsApp greeting bundle queued", { toPhone: input.toPhone, parts: 3 });
    return "bundle";
  }

  try {
    const messageIds = await attemptMetaBundleSend(input.salonId, input.toPhone, [
      { type: "text", text: { body: `${input.greetBody}\n\n${input.menuBody}`, preview_url: false } },
      { type: "interactive", interactive: input.flowInteractive },
      { type: "interactive", interactive: input.menuInteractive }
    ]);
    flowRow.status = "sent";
    flowRow.providerMessageId = messageIds[1] || "";
    menuRow.status = "sent";
    menuRow.providerMessageId = messageIds[2] || "";
    flowRow.error = "";
    menuRow.error = "";
    await Promise.all([flowRow.save(), menuRow.save()]);
    logger.info("WhatsApp greeting bundle sent", { toPhone: input.toPhone, messageIds });
    return "bundle";
  } catch (error) {
    logger.warn("WhatsApp greeting bundle rejected; sending separately", { toPhone: input.toPhone, error: error instanceof Error ? error.message : String(error) });
    for (const row of [flowRow, menuRow]) {
      row.status = "failed";
      row.retryCount += 1;
      try {
        const { providerMessageId } = await attemptMetaSend(row);
        row.status = "sent";
        row.providerMessageId = providerMessageId;
        row.error = "";
      } catch (sendError) {
        row.error = sendError instanceof Error ? sendError.message : String(sendError);
      }
      await row.save();
    }
    return "fallback";
  }
}

export async function sendWhatsAppMessage(input: {
  salonId: string;
  appointmentId?: string | null;
  toPhone: string;
  type: "confirmation" | "reminder" | "cancellation" | "reschedule" | "utility" | "deposit" | "payment_failed" | "feedback" | "birthday" | "rebooking" | "loyalty" | "no_show" | "waitlist" | "abandoned";
  body: string;
  interactive?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const env = loadEnv();
  const provider = env.WHATSAPP_PROVIDER;

  if (input.type === "reminder" || input.type === "birthday" || input.type === "loyalty" || input.type === "feedback" || input.type === "rebooking") {
    const customer = await CustomerModel.findOne({ salonId: input.salonId, normalizedPhone: input.toPhone }, { marketingOptOut: 1 });
    if (customer?.marketingOptOut) {
      await WhatsAppOutboundModel.create({ ...input, appointmentId: input.appointmentId || null, provider, status: "failed", error: "recipient_opted_out", lastAttemptAt: new Date() });
      logger.info("WhatsApp reminder suppressed (opted out)", { toPhone: input.toPhone });
      return;
    }
  }

  const row = await WhatsAppOutboundModel.create({ ...input, body: withOptOutFooter(input.type, input.body), interactive: input.interactive || null, metadata: input.metadata || null, appointmentId: input.appointmentId || null, provider, status: "queued", lastAttemptAt: new Date() });

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

function componentParameters(values: string[], type: "body" | "header" | "button", subType?: string, index?: string): Record<string, unknown> | null {
  if (!values.length) return null;
  return {
    type,
    ...(subType ? { sub_type: subType, index: index || "0" } : {}),
    parameters: values.map((value) => ({ type: "text", text: value }))
  };
}

export async function sendWhatsAppTemplateMessage(input: {
  salonId: string;
  toPhone: string;
  templateName: string;
  language: string;
  bodyParameters?: string[];
  headerParameters?: string[];
  buttonParameters?: Array<{ subType?: string; index?: string; values: string[] }>;
  category?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<WhatsAppOutbound> {
  const env = loadEnv();
  const provider = env.WHATSAPP_PROVIDER;
  const type = input.category?.toLowerCase() === "marketing" ? "reminder" : "utility";
  if (type === "reminder") {
    const customer = await CustomerModel.findOne({ salonId: input.salonId, normalizedPhone: input.toPhone }, { marketingOptOut: 1 });
    if (customer?.marketingOptOut) {
      return WhatsAppOutboundModel.create({ salonId: input.salonId, appointmentId: null, toPhone: input.toPhone, type, body: `Template ${input.templateName}`, provider, status: "failed", error: "recipient_opted_out", metadata: input.metadata || null, lastAttemptAt: new Date() });
    }
  }
  const components = [
    componentParameters(input.headerParameters || [], "header"),
    componentParameters(input.bodyParameters || [], "body"),
    ...(input.buttonParameters || []).map((button) => componentParameters(button.values, "button", button.subType || "url", button.index))
  ].filter(Boolean);
  const templatePayload = {
    messaging_product: "whatsapp",
    to: input.toPhone,
    type: "template",
    template: { name: input.templateName, language: { code: input.language }, ...(components.length ? { components } : {}) }
  };
  const row = await WhatsAppOutboundModel.create({ salonId: input.salonId, appointmentId: null, toPhone: input.toPhone, type, body: `Template ${input.templateName}`, templatePayload, metadata: input.metadata || null, provider, status: "queued", lastAttemptAt: new Date() });
  if (provider === "mock") {
    row.status = "sent";
    row.providerMessageId = `mock_${String(row._id)}`;
    await row.save();
    return row;
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
    logger.error("WhatsApp template send failed", { error: row.error, toPhone: input.toPhone, templateName: input.templateName });
  }
  await row.save();
  return row;
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

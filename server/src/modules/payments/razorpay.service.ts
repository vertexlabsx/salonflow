import { createHmac } from "node:crypto";
import { loadEnv } from "../../config/env";
import { ApiError } from "../../shared/http";

export interface RazorpayPaymentLink {
  id: string;
  shortUrl: string;
}

export async function createRazorpayPaymentLink(input: { amountPaise: number; customerName: string; customerPhone: string; appointmentId: string; salonId: string }): Promise<RazorpayPaymentLink> {
  const env = loadEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw ApiError.badRequest("Razorpay is not configured for this salon.");
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      accept_partial: false,
      description: "Solastio booking deposit",
      customer: { name: input.customerName, contact: input.customerPhone },
      notify: { sms: false, email: false },
      notes: { appointmentId: input.appointmentId, salonId: input.salonId, source: "whatsapp" }
    })
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
  if (!response.ok || !payload.id || !payload.short_url) throw ApiError.badRequest(payload.error?.description || "Unable to create Razorpay payment link.");
  return { id: payload.id, shortUrl: payload.short_url };
}

export function verifyRazorpayWebhook(rawBody: string, signature: string | undefined): boolean {
  const secret = loadEnv().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return expected === signature;
}

import { OwnerSettingsModel } from "../../models/owner-settings.model";
import { AppointmentModel } from "../../models/appointment.model";
import { createRazorpayPaymentLink, fetchRazorpayPaymentLinkStatus } from "../payments/razorpay.service";
import { sendWhatsAppMessage } from "./whatsapp.service";
import { loadEnv } from "../../config/env";

function money(paise: number): string {
  return `Rs ${(paise / 100).toFixed(2)}`;
}

export interface DepositConfig {
  enabled: boolean;
  mode: "fixed" | "percent";
  amountPaise: number;
  percent: number;
  minimumPaise: number;
}

export async function loadDepositConfig(salonId: string, branchId: string): Promise<DepositConfig> {
  const settings =
    (await OwnerSettingsModel.findOne({ salonId, branchId }).lean()) ||
    (await OwnerSettingsModel.findOne({ salonId, branchId: "" }).lean());
  const s = settings?.settings as
    | { booking?: { depositsEnabled?: boolean; depositMode?: string; depositPercent?: number; depositFixedPaise?: number; depositMinimumPaise?: number }; bookingDeposit?: { mode?: string; amountPaise?: number; percent?: number; minimumPaise?: number } }
    | undefined;
  const booking = s?.booking;
  const legacy = s?.bookingDeposit;
  const enabled = booking?.depositsEnabled === true || legacy?.mode === "fixed" || legacy?.mode === "percent";
  if (!enabled) {
    return { enabled: false, mode: "percent", amountPaise: 0, percent: 0, minimumPaise: 0 };
  }
  const mode: "fixed" | "percent" = booking?.depositMode === "fixed" ? "fixed" : "percent";
  if (mode === "fixed") {
    return {
      enabled: true,
      mode: "fixed",
      amountPaise: booking?.depositFixedPaise || legacy?.amountPaise || 0,
      percent: 0,
      minimumPaise: 0
    };
  }
  return {
    enabled: true,
    mode: "percent",
    amountPaise: booking?.depositFixedPaise || 0,
    percent: booking?.depositPercent ?? legacy?.percent ?? 10,
    minimumPaise: booking?.depositMinimumPaise ?? legacy?.minimumPaise ?? 0
  };
}

export function depositAmountFor(config: DepositConfig, valuePaise: number): number {
  if (!config.enabled) return 0;
  if (config.mode === "fixed") return Math.min(valuePaise, Math.max(0, config.amountPaise));
  const calculated = Math.ceil((valuePaise * config.percent) / 100);
  return Math.min(valuePaise, Math.max(calculated, config.minimumPaise));
}

/**
 * If a deposit is configured and paid-able, creates a Razorpay payment link and
 * transitions the appointment to a held/pending-paid state awaiting the webhook.
 *
 * Returns `{ applied: boolean, appointment }`. When applied, the caller should
 * stop the normal "confirmed" reply and instead route to the awaiting_payment flow.
 */
export async function applyDepositToAppointment(input: {
  salonId: string;
  branchId: string;
  appointmentId: string;
  valuePaise: number;
  customerName: string;
  customerPhone: string;
}): Promise<{ applied: boolean; depositPaise: number; paymentLink: string }> {
  const config = await loadDepositConfig(input.salonId, input.branchId);
  const depositPaise = depositAmountFor(config, input.valuePaise);
  if (!config.enabled || depositPaise <= 0) return { applied: false, depositPaise: 0, paymentLink: "" };
  const env = loadEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return { applied: false, depositPaise: 0, paymentLink: "" };

  const link = await createRazorpayPaymentLink({
    amountPaise: depositPaise,
    customerName: input.customerName,
    customerPhone: input.customerPhone.replace(/^\+/, ""),
    appointmentId: input.appointmentId,
    salonId: input.salonId
  });

  const holdExpiresAt = new Date(Date.now() + 30 * 60_000);
  await AppointmentModel.updateOne(
    { _id: input.appointmentId, salonId: input.salonId },
    {
      $set: {
        status: "pending",
        paymentStatus: "pending",
        paymentProvider: "razorpay",
        paymentProviderId: link.id,
        paymentLink: link.shortUrl,
        depositAmountPaise: depositPaise,
        holdExpiresAt
      }
    }
  );

  await sendWhatsAppMessage({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    toPhone: input.customerPhone,
    type: "deposit",
    body: `Your slot is held for your appointment.\nAdvance deposit of ${money(depositPaise)} is required.\nPay here: ${link.shortUrl}\nThe slot will be released in 30 minutes if not paid.`
  });

  return { applied: true, depositPaise, paymentLink: link.shortUrl };
}

export async function verifyOrRefreshDepositLink(input: { salonId: string; appointmentId: string; customerName: string; customerPhone: string }): Promise<{ status: "paid" | "pending" | "refreshed" | "unavailable"; paymentLink?: string }> {
  const appointment = await AppointmentModel.findOne({ _id: input.appointmentId, salonId: input.salonId });
  if (!appointment || appointment.paymentProvider !== "razorpay") return { status: "unavailable" };
  if (appointment.paymentStatus === "paid" || appointment.status === "confirmed") return { status: "paid", paymentLink: appointment.paymentLink };
  if (appointment.paymentProviderId) {
    const remote = await fetchRazorpayPaymentLinkStatus(appointment.paymentProviderId);
    const paidPayment = remote.payments.find((payment) => payment.status === "captured" || payment.status === "authorized") || null;
    if (remote.status === "paid" || paidPayment) {
      appointment.status = "confirmed";
      appointment.paymentStatus = "paid";
      appointment.paymentReference = paidPayment?.payment_id || appointment.paymentProviderId;
      await appointment.save();
      return { status: "paid", paymentLink: appointment.paymentLink };
    }
  }
  if (appointment.holdExpiresAt && appointment.holdExpiresAt < new Date()) {
    const link = await createRazorpayPaymentLink({
      amountPaise: appointment.depositAmountPaise || depositAmountFor(await loadDepositConfig(input.salonId, appointment.branchId), appointment.value),
      customerName: input.customerName,
      customerPhone: input.customerPhone.replace(/^\+/, ""),
      appointmentId: String(appointment._id),
      salonId: input.salonId
    });
    appointment.status = "pending";
    appointment.paymentStatus = "pending";
    appointment.paymentProviderId = link.id;
    appointment.paymentLink = link.shortUrl;
    appointment.holdExpiresAt = new Date(Date.now() + 30 * 60_000);
    appointment.paymentHoldReminderSentAt = null;
    await appointment.save();
    return { status: "refreshed", paymentLink: link.shortUrl };
  }
  return { status: "pending", paymentLink: appointment.paymentLink };
}

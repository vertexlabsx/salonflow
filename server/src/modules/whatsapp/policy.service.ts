import { OwnerSettingsModel } from "../../models/owner-settings.model";

export interface WhatsAppPolicySettings {
  cancellationCutoffHours: number;
  enforceCancellationCutoff: boolean;
  rescheduleCutoffHours: number;
  enforceRescheduleCutoff: boolean;
  depositRefundPolicy: string;
  googleReviewUrl: string;
}

export async function loadWhatsAppPolicySettings(salonId: string): Promise<WhatsAppPolicySettings> {
  const doc = await OwnerSettingsModel.findOne({ salonId, branchId: "" }).lean();
  const policy = (doc?.settings as { whatsappPolicy?: Partial<WhatsAppPolicySettings> } | undefined)?.whatsappPolicy || {};
  return {
    cancellationCutoffHours: Math.max(0, Number(policy.cancellationCutoffHours ?? 2)),
    enforceCancellationCutoff: policy.enforceCancellationCutoff === true,
    rescheduleCutoffHours: Math.max(0, Number(policy.rescheduleCutoffHours ?? 2)),
    enforceRescheduleCutoff: policy.enforceRescheduleCutoff === true,
    depositRefundPolicy: String(policy.depositRefundPolicy || "Refunds and adjustments follow salon policy."),
    googleReviewUrl: String(policy.googleReviewUrl || "")
  };
}

export function hoursUntil(date: Date | string | number): number {
  return (new Date(date).getTime() - Date.now()) / 3_600_000;
}

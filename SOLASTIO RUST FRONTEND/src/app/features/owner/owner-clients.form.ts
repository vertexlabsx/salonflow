import { OwnerClientDetail } from "./owner-operations.models";

export type ClientForm = {
  name: string; phone: string; email: string; gender: string; birthday: string; anniversary: string; tags: string; notes: string; address: string; walletBalancePaise: number; loyaltyPoints: number; membershipPlanName: string; membershipCredits: number; membershipCreditsRemaining: number; membershipValidUntil: string; membershipStatus: string; packageName: string; packageCreditsRemaining: number; subscriptionName: string; subscriptionStatus: string;
};

export type OwnerClientWrite = {
  name: string; email: string; gender: string; birthday: string; anniversary: string; tags: string[]; notes: string; address: string; walletBalancePaise: number; loyaltyPoints: number; membershipPlanName: string; membershipCredits: number; membershipCreditsRemaining: number; membershipValidUntil: string; membershipStatus: string; packageName: string; packageCreditsRemaining: number; subscriptionName: string; subscriptionStatus: string;
};

export const emptyClientForm = (): ClientForm => ({
  name: "", phone: "", email: "", gender: "", birthday: "", anniversary: "", tags: "", notes: "", address: "",
  walletBalancePaise: 0, loyaltyPoints: 0, membershipPlanName: "", membershipCredits: 0, membershipCreditsRemaining: 0,
  membershipValidUntil: "", membershipStatus: "", packageName: "", packageCreditsRemaining: 0, subscriptionName: "", subscriptionStatus: ""
});

export const safeClientNumber = (value: number): number => Math.max(0, Number(value || 0));

export const clientTags = (raw: string): string[] => raw.split(",").map((tag) => tag.trim()).filter(Boolean);

const inputDate = (value: string): string => (value ? value.slice(0, 10) : "");

export const clientFormFromDetail = (data: OwnerClientDetail): ClientForm => ({
  ...emptyClientForm(),
  name: data.client.name || "",
  phone: data.client.phone || "",
  email: data.client.email || "",
  gender: data.client.gender || "",
  birthday: inputDate(data.client.birthday),
  anniversary: inputDate(data.client.anniversary),
  tags: (data.client.tags || []).join(", "),
  notes: data.client.notes || "",
  address: data.client.address || "",
  walletBalancePaise: data.client.walletBalancePaise || 0,
  loyaltyPoints: data.client.loyaltyPoints || 0,
  membershipPlanName: data.client.membershipPlanName || data.membership?.planName || "",
  membershipCredits: data.membership?.planCredits || 0,
  membershipCreditsRemaining: data.membership?.creditsRemaining || 0,
  membershipValidUntil: inputDate(data.membership?.validityDate || ""),
  membershipStatus: data.membership?.status || "",
  packageName: data.client.packageName || "",
  packageCreditsRemaining: data.client.packageCreditsRemaining || 0,
  subscriptionName: data.client.subscriptionName || "",
  subscriptionStatus: data.client.subscriptionStatus || ""
});

export const clientPayloadFromForm = (form: ClientForm): OwnerClientWrite => ({
  name: form.name.trim(),
  email: form.email.trim(),
  gender: form.gender.trim(),
  birthday: form.birthday,
  anniversary: form.anniversary,
  tags: clientTags(form.tags),
  notes: form.notes.trim(),
  address: form.address.trim(),
  walletBalancePaise: safeClientNumber(form.walletBalancePaise),
  loyaltyPoints: safeClientNumber(form.loyaltyPoints),
  membershipPlanName: form.membershipPlanName.trim(),
  membershipCredits: safeClientNumber(form.membershipCredits),
  membershipCreditsRemaining: safeClientNumber(form.membershipCreditsRemaining),
  membershipValidUntil: form.membershipValidUntil,
  membershipStatus: form.membershipStatus.trim(),
  packageName: form.packageName.trim(),
  packageCreditsRemaining: safeClientNumber(form.packageCreditsRemaining),
  subscriptionName: form.subscriptionName.trim(),
  subscriptionStatus: form.subscriptionStatus.trim()
});
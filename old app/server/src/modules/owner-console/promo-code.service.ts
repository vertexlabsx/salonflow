import type { Request } from "express";
import { ApiError } from "../../shared/http";
import { PromoCodeModel, PromoRedemptionModel, type PromoCode } from "../../models/promo-code.model";
import { BranchModel } from "../../models/branch.model";
import { CustomerModel } from "../../models/customer.model";

const UPPER_CODES = [
  "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N",
  "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "2", "3", "4", "5", "6", "7", "8", "9"
];

function normalizeCode(value: string): string {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

function randomCode(prefix: string): string {
  let code = prefix;
  for (let i = 0; i < 3; i += 1) code += UPPER_CODES[Math.floor(Math.random() * UPPER_CODES.length)];
  return code;
}

function hasAdminAccess(context: NonNullable<Request["context"]>): boolean {
  const grants = [...(context.permissions || []), ...(context.crmPermissions || [])];
  return grants.includes("admin:*") || grants.includes("*");
}

export function computeDiscountPaise(promo: Pick<PromoCode, "discountType" | "discountPercent" | "discountPaise">, valuePaise: number): number {
  if (promo.discountType === "percent") {
    return Math.round(valuePaise * ((promo.discountPercent || 0) / 100));
  }
  return promo.discountPaise || 0;
}

export async function ensurePromoStatus(promo: PromoCode): Promise<PromoCode> {
  const now = new Date();
  if (promo.status === "active") {
    if (promo.expiresAt && promo.expiresAt < now) promo.status = "expired";
    else if (promo.maxRedemptions != null && promo.redemptionCount >= promo.maxRedemptions) promo.status = "exhausted";
  }
  return promo;
}

export interface PromoCreateInput {
  kind: "coupon" | "referral";
  code?: string;
  label: string;
  description?: string;
  discountType: "percent" | "flat";
  discountPercent?: number;
  discountPaise?: number;
  minimumSpendPaise?: number;
  maxRedemptions?: number;
  startsAt?: string;
  expiresAt?: string;
  branchId: string | "all";
  branchIds?: string[];
  referrerRewardType?: "percent" | "flat";
  referrerRewardPercent?: number;
  referrerRewardPaise?: number;
}

export async function createPromo(context: NonNullable<Request["context"]>, input: PromoCreateInput): Promise<PromoCode> {
  const salonId = context.salonId;
  const offerPaise = Math.round(Number(input.discountPaise || 0));
  if (offerPaise < 0) throw ApiError.badRequest("Discount cannot be negative.");
  const pct = Number(input.discountPercent || 0);
  if (input.discountType === "percent" && (pct <= 0 || pct > 100)) throw ApiError.badRequest("Percentage discount must be between 1 and 100.");
  if (input.discountType === "flat" && offerPaise <= 0) throw ApiError.badRequest("A flat discount amount is required.");

  const adminAccess = hasAdminAccess(context);
  const allBranches = adminAccess ? (await BranchModel.find({ salonId }).select("_id").lean()).map((branch) => String(branch._id)) : context.branchIds;
  const requestedBranches = input.branchIds && input.branchIds.length ? input.branchIds : input.branchId === "all" ? allBranches : [input.branchId];
  const anyBranch = input.branchId === "all" && !(input.branchIds && input.branchIds.length);
  const allowed = new Set(allBranches);
  for (const branch of requestedBranches) {
    if (!allowed.has(branch)) throw ApiError.forbidden("One or more branches are not available to this account.");
    const exists = await BranchModel.exists({ salonId, _id: branch });
    if (!exists) throw ApiError.badRequest("A selected branch does not exist.");
  }

  let code = normalizeCode(input.code || "");
  if (!code) code = randomCode(input.kind === "referral" ? "REF" : "SAVE");
  if (await PromoCodeModel.findOne({ salonId, code })) throw ApiError.conflict("That promo code already exists.");

  const promo = await PromoCodeModel.create({
    salonId,
    kind: input.kind,
    code,
    label: input.label.trim().slice(0, 120),
    description: (input.description || "").trim().slice(0, 400) || undefined,
    discountType: input.discountType,
    discountPercent: input.discountType === "percent" ? pct : undefined,
    discountPaise: input.discountType === "flat" ? offerPaise : undefined,
    minimumSpendPaise: Math.max(0, Math.round(Number(input.minimumSpendPaise || 0))),
    maxRedemptions: input.maxRedemptions != null ? Math.max(1, Math.round(input.maxRedemptions)) : undefined,
    startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    anyBranch,
    branchIds: anyBranch ? allBranches : requestedBranches,
    status: "active",
    redemptionCount: 0,
    totalDiscountPaise: 0,
    referrerRewardType: input.kind === "referral" ? input.referrerRewardType : undefined,
    referrerRewardPercent: input.kind === "referral" && input.referrerRewardType === "percent" ? Math.max(0, Math.min(100, Number(input.referrerRewardPercent || 0))) : undefined,
    referrerRewardPaise: input.kind === "referral" && input.referrerRewardType === "flat" ? Math.max(0, Math.round(Number(input.referrerRewardPaise || 0))) : undefined,
    createdBy: context.userId
  });

  return promo.toObject();
}

export interface PromoRedeemInput {
  code: string;
  customerId?: string;
  customerPhone?: string;
  valuePaise: number;
  branchId?: string;
  appointmentId?: string;
  invoiceId?: string;
}

export async function redeemPromo(context: NonNullable<Request["context"]>, input: PromoRedeemInput): Promise<{ promo: PromoCode; discountPaise: number; redemptionsUsed: number; remaining: number | null }> {
  const salonId = context.salonId;
  const code = normalizeCode(input.code);
  if (!code) throw ApiError.badRequest("A promo code is required.");

  const promo = await PromoCodeModel.findOne({ salonId, code: { $regex: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } });
  if (!promo) throw ApiError.notFound("That promo code was not found.");

  const refreshed = await ensurePromoStatus(promo.toObject());
  if (refreshed.status !== "active") {
    if (refreshed.status === "exhausted") throw ApiError.conflict("This code has reached its usage limit.");
    if (refreshed.status === "expired") throw ApiError.conflict("This code has expired.");
    throw ApiError.conflict("This code is not currently active.");
  }

  const branchId = (input.branchId || context.branchId) as string;
  const allowed = new Set(hasAdminAccess(context) ? (await BranchModel.find({ salonId }).select("_id").lean()).map((branch) => String(branch._id)) : context.branchIds);
  if (!allowed.has(branchId)) throw ApiError.forbidden("This branch is not available to your account.");
  if (!promo.anyBranch && !promo.branchIds.includes(branchId)) throw ApiError.forbidden("This code is not valid at the selected branch.");

  const now = new Date();
  if (promo.startsAt && promo.startsAt > now) throw ApiError.conflict("This code is not valid yet.");

  const valuePaise = Math.max(0, Math.round(Number(input.valuePaise || 0)));
  if (valuePaise < (promo.minimumSpendPaise || 0)) throw ApiError.badRequest(`This code requires a minimum bill of ₹${((promo.minimumSpendPaise || 0) / 100).toFixed(2)}.`);

  let customer: { _id: unknown; name: string } | null = null;
  if (input.customerId) {
    customer = await CustomerModel.findById(input.customerId).select("name").lean();
    if (!customer || (customer as { salonId?: string }).salonId !== salonId) customer = null;
  }
  if (!customer && input.customerPhone) {
    const phone = String(input.customerPhone).replace(/\D/g, "");
    if (phone) customer = await CustomerModel.findOne({ salonId, normalizedPhone: phone }).select("name").lean();
  }

  const discountPaise = computeDiscountPaise(refreshed, valuePaise);

  await PromoRedemptionModel.create({
    salonId,
    branchId,
    promoId: String(promo._id),
    code: promo.code,
    customerId: customer ? String((customer as { _id: unknown })._id) : "unknown",
    customerName: customer?.name || "Guest",
    appointmentId: input.appointmentId || undefined,
    invoiceId: input.invoiceId || undefined,
    discountPaise,
    discountPercent: refreshed.discountType === "percent" ? refreshed.discountPercent : undefined,
    appliedByUserId: context.userId
  });

  const newCount = (refreshed.redemptionCount || 0) + 1;
  const newTotal = (refreshed.totalDiscountPaise || 0) + discountPaise;
  const status = refreshed.maxRedemptions != null && newCount >= refreshed.maxRedemptions ? "exhausted" : refreshed.status;
  await PromoCodeModel.updateOne({ _id: promo._id }, { $set: { redemptionCount: newCount, totalDiscountPaise: newTotal, status } });

  return {
    promo: { ...refreshed, redemptionCount: newCount, totalDiscountPaise: newTotal, status },
    discountPaise,
    redemptionsUsed: newCount,
    remaining: refreshed.maxRedemptions != null ? Math.max(0, refreshed.maxRedemptions - newCount) : null
  };
}

export interface PromoListQuery {
  kind?: "coupon" | "referral";
  status?: string;
  search?: string;
  branchId?: string | "all";
  page?: number;
  pageSize?: number;
}

export async function listPromos(context: NonNullable<Request["context"]>, query: PromoListQuery) {
  const salonId = context.salonId;
  const filter: Record<string, unknown> = { salonId };
  if (query.kind) filter["kind"] = query.kind;
  if (query.status) filter["status"] = query.status;
  if (query.search) filter["code"] = { $regex: new RegExp(escapeRegex(query.search), "i") };

  const adminAccess = hasAdminAccess(context);
  const allBranches = adminAccess ? (await BranchModel.find({ salonId }).select("_id").lean()).map((branch) => String(branch._id)) : context.branchIds;
  let branchScope = allBranches;
  if (query.branchId && query.branchId !== "all") {
    const allowed = new Set(allBranches);
    if (!allowed.has(query.branchId)) throw ApiError.forbidden("This branch is not available to your account.");
    branchScope = [query.branchId];
  }
  filter["$or"] = [{ anyBranch: true }, { branchIds: { $in: branchScope } }];

  const pageNumber = Math.max(1, Math.round(Number(query.page || 1)));
  const pageSize = Math.min(100, Math.max(1, Math.round(Number(query.pageSize || 30))));
  const skip = (pageNumber - 1) * pageSize;

  const [items, total] = await Promise.all([
    PromoCodeModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    PromoCodeModel.countDocuments(filter)
  ]);

  const withStatus = await Promise.all(items.map(async (item) => ensurePromoStatus(item)));

  return {
    items: withStatus,
    page: { page: pageNumber, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), hasMore: pageNumber < Math.ceil(total / pageSize) },
    metadata: { timezone: "Asia/Kolkata", partial: false, unavailableSources: [] }
  };
}

export async function promoRedemptions(context: NonNullable<Request["context"]>, promoId: string, query: { page?: number; pageSize?: number } = {}) {
  const salonId = context.salonId;
  const promo = await PromoCodeModel.findOne({ salonId, _id: promoId }).lean();
  if (!promo) throw ApiError.notFound("That promo code was not found.");
  const allowed = new Set(hasAdminAccess(context) ? (await BranchModel.find({ salonId }).select("_id").lean()).map((branch) => String(branch._id)) : context.branchIds);
  if (!promo.anyBranch && !promo.branchIds.some((b) => allowed.has(b))) throw ApiError.forbidden("This code is not available to your account.");

  const pageNumber = Math.max(1, Math.round(Number(query.page || 1)));
  const pageSize = Math.min(100, Math.max(1, Math.round(Number(query.pageSize || 30))));
  const skip = (pageNumber - 1) * pageSize;

  const [items, total] = await Promise.all([
    PromoRedemptionModel.find({ salonId, promoId }).sort({ appliedAt: -1 }).skip(skip).limit(pageSize).lean(),
    PromoRedemptionModel.countDocuments({ salonId, promoId })
  ]);

  return {
    items,
    page: { page: pageNumber, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), hasMore: pageNumber < Math.ceil(total / pageSize) },
    metadata: { timezone: "Asia/Kolkata", partial: false, unavailableSources: [] }
  };
}

export async function setPromoStatus(context: NonNullable<Request["context"]>, promoId: string, status: "active" | "paused"): Promise<PromoCode> {
  const promo = await PromoCodeModel.findOne({ salonId: context.salonId, _id: promoId });
  if (!promo) throw ApiError.notFound("That promo code was not found.");
  const allowed = new Set(hasAdminAccess(context) ? (await BranchModel.find({ salonId: context.salonId }).select("_id").lean()).map((branch) => String(branch._id)) : context.branchIds);
  if (!promo.anyBranch && !promo.branchIds.some((b) => allowed.has(b))) throw ApiError.forbidden("This code is not available to your account.");
  await promo.updateOne({ status });
  return { ...promo.toObject(), status };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

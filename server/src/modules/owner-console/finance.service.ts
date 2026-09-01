import { ExpenseModel, type Expense } from "../../models/expense.model";
import { InvoiceModel } from "../../models/invoice.model";
import { OwnerSettingsModel } from "../../models/owner-settings.model";
import { ApiError } from "../../shared/http";

export interface ExpenseWrite {
  branchId: string;
  date: string;
  category: string;
  vendor: string;
  description: string;
  amountPaise: number;
  taxRateBps: number;
  notes: string;
}

function defaultTaxSettings() {
  return { gstin: "", placeOfSupply: "", defaultTaxRateBps: 0, pricesIncludeTax: false };
}

export async function loadTaxSettings(salonId: string) {
  const doc = await OwnerSettingsModel.findOne({ salonId, branchId: "" }, { settings: 1 });
  const tax = ((doc?.settings as Record<string, unknown> | undefined)?.tax ?? {}) as Record<string, unknown>;
  const rate = typeof tax.defaultTaxRateBps === "number" && Number.isFinite(tax.defaultTaxRateBps) ? Math.max(0, Math.min(10000, Math.round(tax.defaultTaxRateBps))) : 0;
  return { ...defaultTaxSettings(), gstin: typeof tax.gstin === "string" ? tax.gstin : "", placeOfSupply: typeof tax.placeOfSupply === "string" ? tax.placeOfSupply : "", defaultTaxRateBps: rate, pricesIncludeTax: tax.pricesIncludeTax === true };
}

export async function createExpense(salonId: string, creatorUserId: string, input: ExpenseWrite) {
  const amountPaise = Math.max(0, Math.round(Number(input.amountPaise) || 0));
  const rateBps = Math.max(0, Math.min(10000, Math.round(Number(input.taxRateBps) || 0)));
  const taxPaise = Math.round((amountPaise * rateBps) / 10000);
  const doc = await ExpenseModel.create({
    salonId,
    branchId: input.branchId,
    date: input.date,
    category: input.category,
    vendor: input.vendor || "",
    description: input.description || "",
    amountPaise,
    taxRateBps: rateBps,
    taxPaise,
    totalPaise: amountPaise + taxPaise,
    notes: input.notes || "",
    createdByUserId: creatorUserId
  });
  return toExpenseDto(doc);
}

export async function updateExpense(salonId: string, id: string, input: ExpenseWrite) {
  const amountPaise = Math.max(0, Math.round(Number(input.amountPaise) || 0));
  const rateBps = Math.max(0, Math.min(10000, Math.round(Number(input.taxRateBps) || 0)));
  const taxPaise = Math.round((amountPaise * rateBps) / 10000);
  const doc = await ExpenseModel.findOneAndUpdate(
    { _id: id, salonId },
    {
      $set: {
        branchId: input.branchId,
        date: input.date,
        category: input.category,
        vendor: input.vendor || "",
        description: input.description || "",
        amountPaise,
        taxRateBps: rateBps,
        taxPaise,
        totalPaise: amountPaise + taxPaise,
        notes: input.notes || ""
      }
    },
    { new: true }
  );
  if (!doc) throw ApiError.notFound("Expense was not found.");
  return toExpenseDto(doc);
}

export async function deleteExpense(salonId: string, id: string) {
  const doc = await ExpenseModel.findOneAndDelete({ _id: id, salonId });
  if (!doc) throw ApiError.notFound("Expense was not found.");
  return { id };
}

export async function listExpenses(salonId: string, opts: { branchId: string; fromDate: string; toDate: string; category: string; offset: number; limit: number }) {
  const filter: Record<string, unknown> = { salonId, date: { $gte: opts.fromDate, $lte: opts.toDate } };
  if (opts.branchId !== "all") filter.branchId = opts.branchId;
  if (opts.category !== "all") filter.category = opts.category;
  const [total, docs] = await Promise.all([ExpenseModel.countDocuments(filter), ExpenseModel.find(filter).sort({ date: -1, createdAt: -1 }).skip(opts.offset).limit(opts.limit).lean()]);
  return { items: docs.map((d) => toExpenseDto(d)), total, limit: opts.limit, offset: opts.offset };
}

export async function gstReport(salonId: string, opts: { branchId: string; fromDate: string; toDate: string }) {
  const $match: Record<string, unknown> = { salonId, status: "issued", issuedAt: { $gte: new Date(`${opts.fromDate}T00:00:00`), $lte: new Date(`${opts.toDate}T23:59:59`) } };
  if (opts.branchId !== "all") $match.branchId = opts.branchId;

  const invoices = await InvoiceModel.find($match, { taxPaise: 1, paidAmountPaise: 1, lines: 1 }).lean();

  const expenseAgg = await ExpenseModel.aggregate([
    { $match: { salonId, date: { $gte: opts.fromDate, $lte: opts.toDate }, ...(opts.branchId !== "all" ? { branchId: opts.branchId } : {}) } },
    {
      $group: {
        _id: null,
        expenseCount: { $sum: 1 },
        totalExpenseAmountPaise: { $sum: "$amountPaise" },
        totalInputTaxPaise: { $sum: "$taxPaise" }
      }
    }
  ]);
  const expenseRow = expenseAgg[0];

  const taxSettings = await loadTaxSettings(salonId);
  const totalTaxPaise = invoices.reduce((sum, invoice) => sum + (invoice.taxPaise || 0), 0);
  const totalCollectedPaise = invoices.reduce((sum, invoice) => sum + (invoice.paidAmountPaise || 0), 0);
  const inputTaxPaise = expenseRow?.totalInputTaxPaise || 0;
  const netPayable = Math.max(0, totalTaxPaise - inputTaxPaise);
  const intraState = !taxSettings.placeOfSupply;

  const byRate = new Map<number, { taxablePaise: number; taxPaise: number }>();
  for (const invoice of invoices) {
    for (const line of invoice.lines || []) {
      const r = line.taxRateBps || 0;
      const taxablePaise = (line.unitAmountPaise || 0) * (line.quantity || 1);
      const cur = byRate.get(r) || { taxablePaise: 0, taxPaise: 0 };
      cur.taxablePaise += taxablePaise;
      cur.taxPaise += Math.round((taxablePaise * r) / 10000);
      byRate.set(r, cur);
    }
  }
  const rateBreakdown = Array.from(byRate.entries())
    .map(([rateBps, v]) => ({ rateBps, taxablePaise: v.taxablePaise, taxPaise: v.taxPaise }))
    .sort((a, b) => b.rateBps - a.rateBps);

  const half = Math.round(totalTaxPaise / 2);
  return {
    gstin: taxSettings.gstin,
    placeOfSupply: taxSettings.placeOfSupply,
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    taxableValuePaise: rateBreakdown.reduce((s, r) => s + r.taxablePaise, 0),
    outputTaxPaise: totalTaxPaise,
    inputCreditPaise: inputTaxPaise,
    netGstPayablePaise: netPayable,
    collection: {
      invoiceCount: invoices.length,
      totalCollectedPaise
    },
    liability: intraState
      ? { type: "intra-state", cgstPaise: half, sgstPaise: half, igstPaise: 0 }
      : { type: "inter-state", cgstPaise: 0, sgstPaise: 0, igstPaise: totalTaxPaise },
    expenses: {
      count: expenseRow?.expenseCount || 0,
      totalExpenseAmountPaise: expenseRow?.totalExpenseAmountPaise || 0,
      inputTaxPaise
    },
    rateBreakdown
  };
}

function toExpenseDto(d: Expense & { _id: unknown }) {
  return {
    id: String(d._id),
    branchId: (d.branchId as string) || "",
    date: (d.date as string) || "",
    category: (d.category as string) || "other",
    vendor: (d.vendor as string) || "",
    description: (d.description as string) || "",
    amountPaise: Number(d.amountPaise) || 0,
    taxRateBps: Number(d.taxRateBps) || 0,
    taxPaise: Number(d.taxPaise) || 0,
    totalPaise: Number(d.totalPaise) || 0,
    notes: (d.notes as string) || "",
    createdAt: (d.createdAt as Date | undefined)?.toISOString() || ""
  };
}

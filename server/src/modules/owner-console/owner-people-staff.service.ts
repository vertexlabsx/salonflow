import type { Request } from "express";
import { BranchModel } from "../../models/branch.model";
import { UserModel, type User } from "../../models/user.model";
import { resolveAuthorizedBranchIds } from "../../middleware/tenant-context";

type Context = NonNullable<Request["context"]>;

export interface OwnerStaffQuery {
  branchId?: string;
  search?: string;
  status?: string;
  role?: string;
  employmentStatus?: string;
  attendanceStatus?: string;
  limit?: number;
  offset?: number;
}

function page(limit: number, offset: number, total: number) {
  const nextOffset = offset + limit < total ? offset + limit : null;
  return { total, limit, offset, hasMore: nextOffset !== null };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface StaffUser extends Pick<User, "name" | "role" | "staffId" | "branchId" | "loginId" | "email" | "status" | "hourlyRatePaise"> {
  _id: unknown;
  roleDisplayName?: string;
  customRoleName?: string;
}

function toOwnerStaff(doc: StaffUser, branchName: string): Record<string, unknown> {
  const nameParts = (doc.name || "").trim().split(/\s+/);
  const firstName = nameParts.shift() || "";
  const lastName = nameParts.join(" ");
  return {
    id: doc.staffId || String(doc._id),
    branchId: doc.branchId,
    branchName: branchName || doc.branchId,
    employeeCode: doc.staffId || "",
    firstName,
    lastName,
    fullName: doc.name || firstName,
    mobile: "",
    email: doc.email || "",
    profilePhoto: "",
    employmentType: "full_time",
    status: doc.status,
    roleId: doc.role,
    designation: doc.roleDisplayName || doc.customRoleName || doc.role,
    department: doc.role,
    loginStatus: doc.status,
    loginId: doc.loginId || "",
    attendanceStatus: "",
    ...(doc.hourlyRatePaise !== undefined ? { businessPaise: doc.hourlyRatePaise } : {}),
    version: 1
  };
}

/** Owner People › Staff feed — the catalog consumed by owner-staff pages and the team-chat staff picker. */
export async function listOwnerStaff(context: Context, query: OwnerStaffQuery): Promise<unknown> {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const authorized = resolveAuthorizedBranchIds(context, query.branchId || "all");

  const filter: Record<string, unknown> = { salonId: context.salonId, staffId: { $ne: null } };
  const branchIds = authorized.length ? authorized : [context.branchId];
  filter.branchId = { $in: branchIds };

  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: pattern }, { loginId: pattern }, { staffId: pattern }, { email: pattern }];
  }
  if (query.status) filter.status = query.status;
  if (query.role) filter.role = query.role;

  const [total, docs, branches, roleRows] = await Promise.all([
    UserModel.countDocuments(filter),
    UserModel.find(filter).sort({ name: 1 }).select("name role roleDisplayName customRoleName staffId branchId loginId email status hourlyRatePaise").lean(),
    BranchModel.find({ salonId: context.salonId, _id: { $in: branchIds } }).select("_id name").lean(),
    UserModel.distinct("role", { salonId: context.salonId, staffId: { $ne: null }, branchId: { $in: branchIds } })
  ]);

  const branchNames = new Map(branches.map((b) => [String(b._id), (b as { name?: string }).name || String(b._id)]));
  const roles = (roleRows as string[]).filter(Boolean).sort();

  return {
    items: docs.map((d) => toOwnerStaff(d as unknown as StaffUser, branchNames.get(d.branchId) || "")),
    page: page(limit, offset, total),
    availability: { documents: { available: false, reason: "Staff documents are not stored in this deployment." } },
    capabilities: { actions: [], unavailable: { create: "Staff profiles are managed from the payroll and leave surfaces in this deployment." } },
    views: ["active", "invited"],
    filters: { roles, employments: ["full_time"] }
  };
}
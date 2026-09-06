const ROLE_LABELS: Readonly<Record<string, string>> = {
  admin: "Administrator",
  cashier: "Cashier",
  floormanager: "Floor Manager",
  frontdesk: "Front Desk",
  inventorymanager: "Inventory Manager",
  manager: "Manager",
  marketingexecutive: "Marketing Executive",
  owner: "Owner",
  receptionist: "Receptionist",
  salonmanager: "Salon Manager",
  seniorstylist: "Senior Stylist",
  stylist: "Stylist",
  staff: "Team Member",
  staffappadmin: "Staff Administrator",
  staffappmanager: "Staff Manager",
  staffappuser: "Team Member",
  therapist: "Therapist"
};

export function formatStaffRoleLabel(role: string | null | undefined): string {
  const source = String(role || "").trim();
  if (!source) return "Team Member";
  const key = source.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return ROLE_LABELS[key] || "Team Member";
}

export type StaffIdentityInput = {
  roleDisplayName?: string | null;
  customRoleName?: string | null;
  systemRole?: string | null;
  branchName?: string | null;
};

export type StaffIdentity = { role: string; branch: string; subtitle: string };

function displayValue(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function assignedRoleDisplay(value: string | null | undefined): string {
  const display = displayValue(value);
  if (!display) return "";
  const key = display.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  const looksInternal = /[_]/.test(display)
    || (!display.includes(" ") && (/[-]/.test(display) || /[a-z][A-Z]/.test(display) || /^role/i.test(display)));
  return looksInternal ? "" : display;
}

export function resolveStaffIdentity(input: StaffIdentityInput): StaffIdentity {
  const role = assignedRoleDisplay(input.roleDisplayName)
    || assignedRoleDisplay(input.customRoleName)
    || formatStaffRoleLabel(input.systemRole);
  const branch = displayValue(input.branchName);
  return { role, branch, subtitle: branch ? `${role} · ${branch}` : role };
}

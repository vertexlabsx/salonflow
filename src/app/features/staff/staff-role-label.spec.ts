import { describe, expect, it } from "vitest";
import { formatStaffRoleLabel, resolveStaffIdentity } from "./staff-role-label";

describe("formatStaffRoleLabel", () => {
  it.each([
    ["STAFFAPPUSER", "Team Member"],
    ["front_desk", "Front Desk"],
    ["FLOOR_MANAGER", "Floor Manager"],
    ["cashier", "Cashier"],
    ["marketingExecutive", "Marketing Executive"],
    ["SALON_MANAGER", "Salon Manager"],
    ["customSpecialist", "Team Member"],
    ["SENIOR-STYLIST", "Senior Stylist"],
    ["", "Team Member"]
  ])("formats %s as a user-facing label", (role, label) => {
    expect(formatStaffRoleLabel(role)).toBe(label);
  });

  it("resolves owner display, custom display, system role, then Team Member", () => {
    expect(resolveStaffIdentity({ roleDisplayName: "  Guest Experience Lead ", customRoleName: "Custom Artist", systemRole: "manager" }).role).toBe("Guest Experience Lead");
    expect(resolveStaffIdentity({ customRoleName: "Custom Artist", systemRole: "manager" }).role).toBe("Custom Artist");
    expect(resolveStaffIdentity({ systemRole: "front_desk" }).role).toBe("Front Desk");
    expect(resolveStaffIdentity({ systemRole: "role_internal_42" }).role).toBe("Team Member");
    expect(resolveStaffIdentity({ customRoleName: "custom_role_12", systemRole: "staff" }).role).toBe("Team Member");
    expect(resolveStaffIdentity({ roleDisplayName: "custom-specialist", systemRole: "manager" }).role).toBe("Manager");
  });

  it("builds a clean subtitle with only a real branch name", () => {
    expect(resolveStaffIdentity({ customRoleName: "Colour Director", branchName: "Banjara Hills" }).subtitle).toBe("Colour Director · Banjara Hills");
    expect(resolveStaffIdentity({ customRoleName: "Colour Director" }).subtitle).toBe("Colour Director");
    expect(resolveStaffIdentity({ systemRole: "staff", branchName: "  " }).subtitle).toBe("Team Member");
  });

  it("preserves long display values and reacts to changed inputs without caching", () => {
    const first = resolveStaffIdentity({ roleDisplayName: "Senior Hair and Beauty Experience Specialist", branchName: "Aura Shine Jubilee Hills Flagship" });
    const changed = resolveStaffIdentity({ roleDisplayName: "Salon Manager", branchName: "Kondapur" });
    expect(first.subtitle).toBe("Senior Hair and Beauty Experience Specialist · Aura Shine Jubilee Hills Flagship");
    expect(changed.subtitle).toBe("Salon Manager · Kondapur");
  });
});

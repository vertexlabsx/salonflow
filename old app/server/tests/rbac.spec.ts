import { describe, it, expect } from "vitest";
import { hasPermission, hasAnyPermission, hasEveryPermission } from "../src/middleware/rbac";

describe("rbac permission semantics (mirrors the Staff App frontend)", () => {
  it("treats a global wildcard as full access", () => {
    expect(hasPermission(["*"], "read:appointments")).toBe(true);
    expect(hasPermission(["*"], "delete:anything")).toBe(true);
  });

  it("honors exact grants and action wildcards", () => {
    expect(hasPermission(["read:appointments"], "read:appointments")).toBe(true);
    expect(hasPermission(["read:*"], "read:appointments")).toBe(true);
    expect(hasPermission(["admin:*"], "read:staff")).toBe(true);
    expect(hasPermission(["admin:staff"], "read:staff")).toBe(true);
  });

  it("expands write aliases for resource-level writes", () => {
    expect(hasPermission(["write:staff"], "update:staff")).toBe(true);
    expect(hasPermission(["write:*"], "create:services")).toBe(true);
    expect(hasPermission(["write:staff"], "read:staff")).toBe(false);
  });

  it("supports scoped staff-app-* policies like the frontend", () => {
    const grants = ["read:staff-app-appointments"];
    expect(hasPermission(grants, "read:appointments")).toBe(true);
    expect(hasPermission(grants, "update:appointments")).toBe(false);

    const scopedWriter = ["write:staff-app-appointments"];
    expect(hasPermission(scopedWriter, "update:appointments")).toBe(true);
    expect(hasPermission(scopedWriter, "create:appointments")).toBe(true);
    expect(hasPermission(scopedWriter, "read:appointments")).toBe(false);

    const admin = ["admin:staff-app-*"];
    expect(hasPermission(admin, "delete:appointments")).toBe(true);
  });

  it("maps the checkin-checkout permission alias", () => {
    expect(hasPermission(["allow:staff-checkin-checkout"], "allow:staff-checkin-checkout")).toBe(true);
    expect(hasPermission(["allow:staff-app-checkin-checkout"], "allow:staff-checkin-checkout")).toBe(true);
  });

  it("evaluates any/every helpers", () => {
    const grants = ["read:appointments", "write:staff"];
    expect(hasAnyPermission(grants, ["read:payroll", "read:appointments"])).toBe(true);
    expect(hasEveryPermission(grants, ["read:appointments", "read:payroll"])).toBe(false);
  });

  it("denies empty grant sets", () => {
    expect(hasPermission([], "read:appointments")).toBe(false);
  });
});

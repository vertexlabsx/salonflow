import "@angular/compiler";
import { describe, expect, it } from "vitest";
import { environment as productionEnvironment } from "../environments/environment.prod";
import { routes } from "./app.routes";
import { addBusinessDays, businessDate } from "./core/business-date";
import { formatPaiseInr, PaiseInrPipe } from "./core/paise-inr.pipe";
import { StaffClientHistory } from "./core/staff-app.service";

describe("staff presentation contracts", () => {
  it.each([
    [null, "-"],
    [undefined, "-"],
    ["invalid", "-"],
    [0, "\u20b90"],
    [1, "\u20b90.01"],
    [123456789, "\u20b912,34,567.89"],
    [-5050, "-\u20b950.5"]
  ])("formats %s paise without losing paise precision", (paise, expected) => {
    const formatted = formatPaiseInr(paise).replace(/\s/g, "");
    expect(formatted).toBe(expected);
  });

  it("exposes the same behavior through the standalone pipe", () => {
    expect(new PaiseInrPipe().transform("101").replace(/\s/g, "")).toBe("\u20b91.01");
  });

  it("uses the IST date at UTC day boundaries and rejects invalid dates", () => {
    expect(businessDate(new Date("2026-07-14T18:29:59.999Z"))).toBe("2026-07-14");
    expect(businessDate(new Date("2026-07-14T18:30:00.000Z"))).toBe("2026-07-15");
    expect(businessDate(new Date("invalid"))).toBe("");
  });

  it("handles business-date month, year, and negative offsets", () => {
    expect(addBusinessDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addBusinessDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addBusinessDays("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("staff routing and production configuration", () => {
  it("configures the guarded standalone queue page", () => {
    const staffRoute = routes.find((route) => route.path === "staff");
    const queueRoute = staffRoute?.children?.find((route) => route.path === "queue");

    expect(queueRoute).toMatchObject({ data: { permissions: "read:appointments" } });
    expect(queueRoute?.canActivate).toHaveLength(1);
    expect(queueRoute?.loadComponent).toEqual(expect.any(Function));
    expect(queueRoute?.redirectTo).toBeUndefined();
  });

  it("configures the guarded standalone staff clients page", () => {
    const staffRoute = routes.find((route) => route.path === "staff");
    const clientsRoute = staffRoute?.children?.find((route) => route.path === "clients");

    expect(clientsRoute).toMatchObject({ data: { permissions: "read:clients" } });
    expect(clientsRoute?.canActivate).toHaveLength(1);
    expect(clientsRoute?.loadComponent).toEqual(expect.any(Function));
    expect(clientsRoute?.redirectTo).toBeUndefined();
  });

  it("keeps the staff client-history contract in sync with the backend response shape", () => {
    const response: StaffClientHistory = {
      client: { id: "client-1", name: "Priya Sharma", phone: "+919876543210", email: "priya@example.test", branchId: "branch-1", branchName: "Flagship", tags: ["VIP"], notes: "Sensitive scalp", visitCount: 5, totalSpendPaise: 1250000, outstandingPaise: 5000 },
      appointments: [{ id: "appt-1", branchId: "branch-1", branchName: "Flagship", staffId: "staff-1", staffName: "Front Desk Reception", serviceIds: ["svc-1"], serviceNames: ["Hair Spa"], status: "completed", startAt: "2026-08-01T10:00:00.000Z", endAt: "2026-08-01T11:00:00.000Z", spendPaise: 89900 }],
      purchases: [{ id: "inv-1", invoiceNumber: "INV-H49I886YTH", branchId: "branch-1", branchName: "Flagship", totalPaise: 100600, paidPaise: 100000, balancePaise: 600, status: "partial", createdAt: "2026-08-01T11:30:00.000Z" }]
    };

    expect(Object.keys(response.client).sort()).toEqual(["branchId", "branchName", "email", "id", "name", "notes", "outstandingPaise", "phone", "tags", "totalSpendPaise", "visitCount"].sort());
    expect(Object.keys(response.appointments[0]).sort()).toEqual(["branchId", "branchName", "endAt", "id", "serviceIds", "serviceNames", "spendPaise", "staffId", "staffName", "startAt", "status"].sort());
    expect(Object.keys(response.purchases[0]).sort()).toEqual(["balancePaise", "branchId", "branchName", "createdAt", "id", "invoiceNumber", "paidPaise", "status", "totalPaise"].sort());
  });

  it("does not ship an insecure absolute production API URL", () => {
    const apiUrl = productionEnvironment.apiBaseUrl;
    const isRelative = apiUrl.startsWith("/");
    const isSecureAbsolute = /^https:\/\//i.test(apiUrl);

    expect(productionEnvironment.production).toBe(true);
    expect(isRelative || isSecureAbsolute, `${apiUrl} must be relative or use HTTPS`).toBe(true);
  });
});

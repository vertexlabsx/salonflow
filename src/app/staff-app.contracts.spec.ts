import "@angular/compiler";
import { describe, expect, it } from "vitest";
import { environment as productionEnvironment } from "../environments/environment.prod";
import { routes } from "./app.routes";
import { addBusinessDays, businessDate } from "./core/business-date";
import { formatPaiseInr, PaiseInrPipe } from "./core/paise-inr.pipe";

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

  it("does not ship an insecure absolute production API URL", () => {
    const apiUrl = productionEnvironment.apiBaseUrl;
    const isRelative = apiUrl.startsWith("/");
    const isSecureAbsolute = /^https:\/\//i.test(apiUrl);

    expect(productionEnvironment.production).toBe(true);
    expect(isRelative || isSecureAbsolute, `${apiUrl} must be relative or use HTTPS`).toBe(true);
  });
});

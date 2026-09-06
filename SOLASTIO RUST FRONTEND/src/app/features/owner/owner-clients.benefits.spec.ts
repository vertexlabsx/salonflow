import "@angular/compiler";
import { describe, expect, it } from "vitest";
import { OwnerClientDetail } from "./owner-operations.models";
import { clientFormFromDetail, clientPayloadFromForm, clientTags, emptyClientForm, safeClientNumber } from "./owner-clients.form";

const detail = (overrides: Partial<OwnerClientDetail> = {}): OwnerClientDetail => ({
  client: {
    id: "client-1", name: "Priya Sharma", phone: "+91 98765 43210", email: "priya@example.test", branchId: "branch-1", branchName: "Flagship",
    status: "active", visitCount: 5, totalSpendPaise: 1250000, lastVisitAt: "2026-08-01T10:00:00.000Z", walletBalancePaise: 45000, loyaltyPoints: 320,
    membershipId: "member-1", membershipPlanName: "", packageName: "Hair spa bundle", packageCreditsRemaining: 2, subscriptionName: "Monthly grooming",
    subscriptionStatus: "active", outstandingPaise: 5000, createdAt: "2026-01-15T09:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z",
    gender: "Female", birthday: "1994-05-20T00:00:00.000Z", anniversary: "2022-11-08T00:00:00.000Z", tags: ["VIP", "keratin"], notes: "Sensitive scalp", address: "12 Lake View Road"
  },
  appointments: [],
  purchases: [],
  membership: { id: "member-1", planName: "Gold bridal care", planCredits: 12, creditsRemaining: 5, validityDate: "2027-03-31T18:30:00.000Z", status: "active", branchId: "branch-1" },
  metadata: { timezone: "Asia/Kolkata", partial: false, unavailableSources: [], branchRelationship: ["Flagship"] },
  ...overrides
});

describe("owner clients benefit form wiring", () => {
  it("returns a pristine blank form for the create dialog", () => {
    const form = emptyClientForm();
    expect(form).toEqual({
      name: "", phone: "", email: "", gender: "", birthday: "", anniversary: "", tags: "", notes: "", address: "",
      walletBalancePaise: 0, loyaltyPoints: 0, membershipPlanName: "", membershipCredits: 0, membershipCreditsRemaining: 0,
      membershipValidUntil: "", membershipStatus: "", packageName: "", packageCreditsRemaining: 0, subscriptionName: "", subscriptionStatus: ""
    });
  });

  it("clamps negative and NaN benefit amounts to zero and keeps positive values", () => {
    expect(safeClientNumber(-120)).toBe(0);
    expect(safeClientNumber(Number.NaN)).toBe(0);
    expect(safeClientNumber(0)).toBe(0);
    expect(safeClientNumber(12.5)).toBe(12.5);
  });

  it("normalizes a comma-tagged notes list into trimmed, non-empty tags", () => {
    expect(clientTags("  VIP , keratin, , bridal ")).toEqual(["VIP", "keratin", "bridal"]);
    expect(clientTags("")).toEqual([]);
  });

  it("hydrates the edit form from a client 360 detail including the membership fallback", () => {
    const form = clientFormFromDetail(detail());

    expect(form.name).toBe("Priya Sharma");
    expect(form.phone).toBe("+91 98765 43210");
    expect(form.birthday).toBe("1994-05-20");
    expect(form.anniversary).toBe("2022-11-08");
    expect(form.tags).toBe("VIP, keratin");
    expect(form.address).toBe("12 Lake View Road");

    expect(form.membershipPlanName).toBe("Gold bridal care");
    expect(form.membershipCredits).toBe(12);
    expect(form.membershipCreditsRemaining).toBe(5);
    expect(form.membershipValidUntil).toBe("2027-03-31");
    expect(form.membershipStatus).toBe("active");

    expect(form.packageName).toBe("Hair spa bundle");
    expect(form.packageCreditsRemaining).toBe(2);
    expect(form.subscriptionName).toBe("Monthly grooming");
    expect(form.subscriptionStatus).toBe("active");
    expect(form.walletBalancePaise).toBe(45000);
    expect(form.loyaltyPoints).toBe(320);
  });

  it("falls back to client-level plan name and clears membership fields without a membership record", () => {
    const noMembership = detail({ client: { ...detail().client, membershipPlanName: "Solo gold" }, membership: null });
    const form = clientFormFromDetail(noMembership);

    expect(form.membershipPlanName).toBe("Solo gold");
    expect(form.membershipCredits).toBe(0);
    expect(form.membershipCreditsRemaining).toBe(0);
    expect(form.membershipValidUntil).toBe("");
    expect(form.membershipStatus).toBe("");
  });

  it("builds the create/update payload accepted by the owner API from the form", () => {
    const payload = clientPayloadFromForm({
      ...emptyClientForm(),
      name: "  Priya Sharma ", email: " priya@example.test ", gender: " Female ", birthday: "1994-05-20", anniversary: "2022-11-08",
      tags: " VIP , keratin ", notes: " Sensitive scalp ", address: " 12 Lake View ",
      walletBalancePaise: -1, loyaltyPoints: 320, membershipPlanName: " Gold bridal care ", membershipCredits: 12,
      membershipCreditsRemaining: 5, membershipValidUntil: "2027-03-31", membershipStatus: " active ", packageName: " Hair spa ",
      packageCreditsRemaining: 2, subscriptionName: " Monthly ", subscriptionStatus: " active "
    });

    expect(payload).toEqual({
      name: "Priya Sharma", email: "priya@example.test", gender: "Female", birthday: "1994-05-20", anniversary: "2022-11-08",
      tags: ["VIP", "keratin"], notes: "Sensitive scalp", address: "12 Lake View",
      walletBalancePaise: 0, loyaltyPoints: 320, membershipPlanName: "Gold bridal care", membershipCredits: 12,
      membershipCreditsRemaining: 5, membershipValidUntil: "2027-03-31", membershipStatus: "active", packageName: "Hair spa",
      packageCreditsRemaining: 2, subscriptionName: "Monthly", subscriptionStatus: "active"
    });
  });

  it("round-trips the benefit relationship without losing wallet, membership or package values", () => {
    const source = detail();
    const roundTrip = clientPayloadFromForm(clientFormFromDetail(source));

    expect(roundTrip.walletBalancePaise).toBe(source.client.walletBalancePaise);
    expect(roundTrip.loyaltyPoints).toBe(source.client.loyaltyPoints);
    expect(roundTrip.membershipPlanName).toBe(source.membership!.planName);
    expect(roundTrip.membershipCredits).toBe(source.membership!.planCredits);
    expect(roundTrip.membershipCreditsRemaining).toBe(source.membership!.creditsRemaining);
    expect(roundTrip.membershipStatus).toBe(source.membership!.status);
    expect(roundTrip.packageName).toBe(source.client.packageName);
    expect(roundTrip.packageCreditsRemaining).toBe(source.client.packageCreditsRemaining);
    expect(roundTrip.subscriptionName).toBe(source.client.subscriptionName);
    expect(roundTrip.subscriptionStatus).toBe(source.client.subscriptionStatus);
  });
});
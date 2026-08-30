import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { cleanupCollections, seedAuthFixtures, TENANT, BRANCH_ID } from "./helpers/auth-fixtures";
import { ServiceModel } from "../src/models/service.model";
import type { ServiceCandidate } from "../src/modules/whatsapp/catalog-intent";
import {
  catalogueBranches,
  eligibleStaffByNames,
  matchedSynonymGroups,
  resolveBranchIntent,
  resolveServiceIntents,
  resolveStaffIntent,
  serviceSynonymQuery,
  strippedBookingText
} from "../src/modules/whatsapp/catalog-intent";
import { parseTimePreference } from "../src/modules/whatsapp/smart-parse";

const STAFF = [{ staffId: "s1", name: "Dev Kumar" }, { staffId: "s2", name: "Ananya Singh" }, { staffId: "s3", name: "Ravi" }];
const BRANCHES = [{ _id: "b1", name: "Juhu Branch" }, { _id: "b2", name: "Andheri Branch" }];

describe("catalogue-aware intent (Phase 1)", () => {
  describe("serviceSynonymQuery / matchedSynonymGroups", () => {
    it("maps Hinglish haircut shorthand to the canonical Haircut label", () => {
      for (const phrase of ["baal kat karao", "baal kaatna hai", "kat do salon mein", "haircut lena hai", "mere baal trim karo"]) {
        expect(serviceSynonymQuery(phrase)).toBe("Haircut");
      }
    });

    it("maps manicure/waxing/facial shorthand to their canonical labels", () => {
      expect(serviceSynonymQuery("nail polish karana hai")).toBe("Manicure");
      expect(serviceSynonymQuery("manicure karao")).toBe("Manicure");
      expect(serviceSynonymQuery("full body wax karao")).toBe("Waxing");
      expect(serviceSynonymQuery("face clean karao")).toBe("Facial");
      expect(serviceSynonymQuery("champi karao")).toBe("Massage");
      expect(serviceSynonymQuery("hair colour karava do")).toBe("Hair Colour");
    });

    it("returns null for unrelated or empty text", () => {
      expect(serviceSynonymQuery("book an appointment")).toBeNull();
      expect(serviceSynonymQuery("12345")).toBeNull();
      expect(serviceSynonymQuery("tu kaisa hai")).toBeNull();
    });

    it("returns groups in catalogue order so the most specific wins first", () => {
      expect(matchedSynonymGroups("baal haircut aur massage")).toEqual(["Haircut", "Massage"]);
      expect(matchedSynonymGroups("wax karao aur hair spa")).toEqual(["Hair Spa", "Waxing"]);
    });
  });

  describe("strippedBookingText", () => {
    it("reduces a booking sentence to its meaningful tokens", () => {
      expect(strippedBookingText("Book a haircut tomorrow 3pm with Dev")).toBe("haircut dev");
      expect(strippedBookingText("I would like to wax with Ananya")).toBe("wax ananya");
    });
  });

  describe("resolveStaffIntent", () => {
    it("picks a staff member by exact or first name", () => {
      expect(resolveStaffIntent("with Dev", STAFF)).toEqual({ staffId: "s1", name: "Dev Kumar" });
      expect(resolveStaffIntent("change staff to Ananya", STAFF)).toEqual({ staffId: "s2", name: "Ananya Singh" });
      expect(resolveStaffIntent("ravi k saath", STAFF)).toEqual({ staffId: "s3", name: "Ravi" });
    });

    it("returns null when staff is missing or ambiguous", () => {
      expect(resolveStaffIntent("with nobody", STAFF)).toBeNull();
      expect(resolveStaffIntent("with Priya", STAFF)).toBeNull();
      expect(resolveStaffIntent("with d", STAFF)).toBeNull();
    });
  });

  describe("resolveBranchIntent", () => {
    it("resolves a branch by name or fuzzy mention", () => {
      expect(resolveBranchIntent("juhu", BRANCHES)).toEqual({ branchId: "b1", name: "Juhu Branch" });
      expect(resolveBranchIntent("at the Andheri outlet", BRANCHES)).toEqual({ branchId: "b2", name: "Andheri Branch" });
    });

    it("returns null when branch is absent or ambiguous", () => {
      expect(resolveBranchIntent("chembur", BRANCHES)).toBeNull();
    });
  });

  describe("resolveServiceIntents against the real catalogue", () => {
    beforeAll(async () => {
      await createTestWorld();
    });

    afterAll(async () => {
      await destroyTestWorld();
    });

    beforeEach(async () => {
      await cleanupCollections();
      await seedAuthFixtures();
    });

    it("matches by literal name containment (preserves existing behaviour)", async () => {
      const result = await resolveServiceIntents({ text: "i want a Hair Spa today", salonId: TENANT, branchId: BRANCH_ID });
      expect(result.ambiguousNames).toEqual([]);
      expect(result.matched.map((m) => m.service.name)).toEqual(["Hair Spa"]);
      expect(result.matched[0]!.matchKind).toBe("literal");
    });

    it("maps Hinglish synonyms through fuzzy matching to real service names", async () => {
      const result = await resolveServiceIntents({ text: "baal kat karao", salonId: TENANT, branchId: BRANCH_ID });
      expect(result.matched.map((m) => m.service.name)).toEqual(["Haircut"]);
      expect(result.matched[0]!.matchKind).toBe("synonym");
    });

    it("reports ambiguity instead of guessing", async () => {
      await ServiceModel.create([
        { salonId: TENANT, branchIds: [BRANCH_ID], name: "Express Haircut", pricePaise: 30000, durationMinutes: 20, eligibleStaffIds: [], status: "active" },
        { salonId: TENANT, branchIds: [BRANCH_ID], name: "Classic Haircut", pricePaise: 50000, durationMinutes: 30, eligibleStaffIds: [], status: "active" },
        { salonId: TENANT, branchIds: [BRANCH_ID], name: "Hair Spa", pricePaise: 120000, durationMinutes: 60, eligibleStaffIds: [], status: "active" }
      ]);
      await ServiceModel.deleteOne({ name: "Haircut", salonId: TENANT });
      const result = await resolveServiceIntents({ text: "baal kat chahiye", salonId: TENANT, branchId: BRANCH_ID });
      expect(result.matched).toEqual([]);
      expect(result.ambiguousNames).toContain("Haircut");
    });

    it("resolves an explicitly provided service list without a DB round-trip", async () => {
      const services = [
        { _id: "svc_a", name: "Facial", category: "Skin", pricePaise: 80000, durationMinutes: 30, eligibleStaffIds: ["staff_seed_reception"] },
        { _id: "svc_b", name: "Full Body Waxing", category: "Body", pricePaise: 250000, durationMinutes: 90, eligibleStaffIds: ["staff_seed_reception"] }
      ];
      const result = await resolveServiceIntents({ text: "wax karao", salonId: TENANT, branchId: BRANCH_ID, services: services as unknown as ServiceCandidate[] });
      expect(result.matched.map((m) => m.service.name)).toEqual(["Full Body Waxing"]);
    });
  });

  describe("eligibleStaffByNames / catalogueBranches", () => {
    beforeAll(async () => {
      await createTestWorld();
    });

    afterAll(async () => {
      await destroyTestWorld();
    });

    beforeEach(async () => {
      await cleanupCollections();
      await seedAuthFixtures();
    });

    it("lists active branches for the salon", async () => {
      const branches = await catalogueBranches(TENANT);
      expect(branches.map((b) => b.name)).toContain("Main Branch");
    });

    it("lists only staff eligible for every candidate service at the branch", async () => {
      const services = [
        { _id: "svc_a", name: "Haircut", category: "Hair", pricePaise: 50000, durationMinutes: 30, eligibleStaffIds: ["staff_seed_reception"] }
      ];
      const staff = await eligibleStaffByNames("haircut with anyone", TENANT, BRANCH_ID, services as unknown as ServiceCandidate[]);
      expect(staff.map((s) => s.staffId)).toContain("staff_seed_reception");
    });
  });

  describe("parseTimePreference", () => {
    it("reads 'between 3 and 6 pm' as a 3pm-6pm window, not 3am-6pm", () => {
      expect(parseTimePreference("any free slots tomorrow between 3 and 6 pm?")).toEqual({ after: 15 * 60, before: 18 * 60 });
      expect(parseTimePreference("free anytime between 6 and 9 pm")).toEqual({ after: 18 * 60, before: 21 * 60 });
      expect(parseTimePreference("between 5 pm and 7 pm")).toEqual({ after: 17 * 60, before: 19 * 60 });
    });

    it("still reads plain hour ranges with a shared meridiem", () => {
      expect(parseTimePreference("4 to 7 pm")).toEqual({ after: 16 * 60, before: 19 * 60 });
    });
  });
});
/* Catalogue-aware intent resolution for the WhatsApp assistant.
   Phase 1 of the "smarter chat" plan: maps Hinglish/regional shorthand and
   common misspellings to the salon's REAL service/staff/branch catalogue using
   the same offline, deterministic fuzzy matcher as the rest of the flow.
   No LLM, no network, fully unit-testable. */

import { BranchModel } from "../../models/branch.model";
import { ServiceModel } from "../../models/service.model";
import { UserModel } from "../../models/user.model";
import { closestName, normalizedNameKey } from "./smart-parse";

export interface ServiceCandidate {
  _id: unknown;
  name: string;
  category: string;
  pricePaise: number;
  durationMinutes: number;
  eligibleStaffIds: string[];
}

export interface SynonymGroup {
  name: string;
  aliases: string[];
}

/** Hinglish/regional shorthand mapped to typical salon service names. The
 *  `name` is used as the fuzzy query against the real catalogue; aliases are
 *  matched against user text. Order matters: more specific groups first. */
export const SERVICE_SYNONYM_GROUPS: SynonymGroup[] = [
  { name: "Haircut", aliases: ["baal kaatna", "baal katna", "baal kaat", "baal kat", "kaatna", "katna", "kaat do", "kat do", "kaatwa do", "kaat", "kat", "haircut", "hair cut", "haircutting", "trim", "hair trim", "baal trim", "trimmer"] },
  { name: "Beard", aliases: ["beard", "beard trim", "beard grooming", "dhaadi", "daari", "dari", "shave", "shaving", "clean shave", "moustache", "mooch"] },
  { name: "Facial", aliases: ["facial", "face clean", "faceclean", "cleanup", "clean up", "chamkila", "face polish", "face pack", "glow facial", "facial karao"] },
  { name: "Hair Colour", aliases: ["hair colour", "hair color", "haar colour", "baal ka colour", "baal warna", "colour", "color", "dye", "dying", "tint", "warna", "pigmentation"] },
  { name: "Massage", aliases: ["massage", "champi", "body massage", "oil massage", "head massage", "back massage", "full body massage", "spa massage", "ayurvedic massage"] },
  { name: "Hair Spa", aliases: ["hair spa", "spa treatment", "scalp", "dandruff", "hair treatment", "scalp treatment"] },
  { name: "Keratin", aliases: ["keratin", "keratin treatment", "keratin smoothing", "keratin spa"] },
  { name: "Straightening", aliases: ["straightening", "rebond", "rebonding", "hair straightening", "straight"] },
  { name: "Manicure", aliases: ["manicure", "hand pamper", "hand spa", "nail", "nails", "naakhun", "naakhun polish"] },
  { name: "Pedicure", aliases: ["pedicure", "foot spa", "feet clean", "paune", "foot massage"] },
  { name: "Waxing", aliases: ["waxing", "wax", "wax karao", "wax karana", "sugaring", "full body wax", "legs wax"] },
  { name: "Threading", aliases: ["threading", "thread", "eyebrow", "eyebrows", "brows", "eyebrow threading", "brow", "braiding"] },
  { name: "Bleach", aliases: ["bleach", "bleaching", "fairness", "whitening", "de tan", "detan", "glow bleach", "skin glow"] },
  { name: "Makeup", aliases: ["makeup", "make up", "party makeup", "bridal makeup", "engagement makeup"] },
  { name: "Mehendi", aliases: ["mehendi", "mehndi", "henna", "bridal mehendi", "arabic mehendi"] },
  { name: "Blow Dry", aliases: ["blow dry", "blowdry", "blowout", "hair wash", "shampoo", "wash and blow dry"] },
  { name: "Hair Styling", aliases: ["hair styling", "styling", "style", "hair style", "iron", "curls", "curling"] },
  { name: "Kids Haircut", aliases: ["kids haircut", "child haircut", "kids cut", "bache ka kaat", "bacha kaat"] }
];

const STOP_WORDS =
  /(?:^|\s)(?:book|booking|appointment|appointments|with|under|by|for|want|wanna|would|like|i'd|i|need|needed|get|got|have|do|does|please|can|could|may|shall|a|an|at|on|in|this|next|today|tomorrow|kal|parso|to|is|are|am|the|my|me|you|your|it|then|some|over|give|schedule|slot|time|date|branch|outlet|store|showroom|salon|shop)(?:\s|$)/g;

/** Lowers + keeps English/Hinglish letters only, for fuzzy comparison.
 *  A seed of common booking scaffolding is dropped so "book a haircut with
 *  dev at 3pm" reduces to "haircut dev". Repeats removal so adjacent stop
 *  words like "book a" are cleared too. */
export function strippedBookingText(text: string): string {
  let cleaned = text
    .toLowerCase()
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/g, " ");
  for (let previous = ""; previous !== cleaned; ) {
    previous = cleaned;
    cleaned = cleaned.replace(STOP_WORDS, " ");
  }
  return cleaned
    .replace(/[^a-z\u0900-\u097F\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_ALIASES = SERVICE_SYNONYM_GROUPS.map((group) => ({
  group,
  keys: group.aliases.map(normalizedNameKey).filter((key) => key.length >= 3)
}));

function hasAlias(textKey: string, keys: string[]): boolean {
  return keys.some((key) => textKey.includes(key));
}

/** Returns the canonical service labels (e.g. "Haircut") whose synonym group is
 *  present in the text, in group order. Pure and fast. */
export function matchedSynonymGroups(text: string): string[] {
  const textKey = normalizedNameKey(text);
  const matched: string[] = [];
  for (const entry of NORMALIZED_ALIASES) {
    if (hasAlias(textKey, entry.keys)) matched.push(entry.group.name);
  }
  return matched;
}

/** Canonical service label for a text, or null. Used by the AI fallback so the
 *  LLM hint becomes a catalogue real-name query rather than a hardcoded
 *  "Haircut". */
export function serviceSynonymQuery(text: string): string | null {
  return matchedSynonymGroups(text)[0] || null;
}

/**
 * Resolves any number of services mentioned in one message against the salon's
 *  real catalogue. Literal name containment wins (preserves existing behaviour),
 *  then Hinglish synonym groups are mapped through the fuzzy matcher.
 *  Ambiguous hits are reported (never guessed).
 */
export async function resolveServiceIntents(input: {
  text: string;
  salonId: string;
  branchId: string;
  services?: ServiceCandidate[];
}): Promise<{ matched: Array<{ service: ServiceCandidate; matchKind: "literal" | "synonym" }>; ambiguousNames: string[] }> {
  const services =
    input.services ??
    ((await ServiceModel.find({
      salonId: input.salonId,
      status: "active",
      $or: [{ branchIds: input.branchId }, { branchIds: { $size: 0 } }]
    })
      .select("name category pricePaise durationMinutes eligibleStaffIds")
      .sort({ name: 1 })
      .lean()) as unknown as ServiceCandidate[]);
  if (!services.length) return { matched: [], ambiguousNames: [] };

  const textKey = normalizedNameKey(input.text);

  const literal = services.filter((item) => {
    const key = normalizedNameKey(item.name);
    return key.length >= 3 && textKey.includes(key);
  });
  if (literal.length) {
    return { matched: literal.slice(0, 4).map((service) => ({ service, matchKind: "literal" })), ambiguousNames: [] };
  }

  const names = services.map((item) => item.name);
  const matched: Array<{ service: ServiceCandidate; matchKind: "synonym" }> = [];
  const ambiguousNames: string[] = [];
  for (const groupName of matchedSynonymGroups(input.text)) {
    const hit = closestName(names, groupName);
    if (!hit) continue;
    if (hit.ambiguous) {
      if (!ambiguousNames.includes(groupName)) ambiguousNames.push(groupName);
      continue;
    }
    const service = services.find((item) => item.name === hit.name);
    if (!service) continue;
    if (matched.some((entry) => String(entry.service._id) === String(service._id))) continue;
    matched.push({ service, matchKind: "synonym" });
    if (matched.length >= 4) break;
  }
  return { matched, ambiguousNames };
}

/** Resolves a staff mention ("with Dev", "change staff to Ananya") to a single
 *  catalogue staff member, or null when absent/ambiguous. */
export function resolveStaffIntent(text: string, staff: Array<{ staffId: string; name: string }>): { staffId: string; name: string } | null {
  if (!staff.length) return null;
  const lower = text.toLowerCase();
  const direct = staff.filter((item) => {
    const fullKey = normalizedNameKey(item.name);
    const firstName = normalizedNameKey(item.name.split(/\s+/)[0] || "");
    return (fullKey.length >= 3 && lower.includes(fullKey)) || (firstName.length >= 3 && lower.includes(firstName));
  });
  if (direct.length === 1) return { staffId: direct[0]!.staffId, name: direct[0]!.name };
  if (direct.length > 1) return null;

  const stripped = strippedBookingText(text);
  if (!stripped || stripped.length < 2) return null;
  const hit = closestName(staff.map((item) => item.name), stripped);
  if (!hit || hit.ambiguous) return null;
  const picked = staff.find((item) => item.name === hit!.name);
  return picked ? { staffId: picked.staffId, name: picked.name } : null;
}

/** Resolves a branch mention ("Bandra", "at the Juhu outlet") to a single
 *  branch, or null when absent/ambiguous. */
export function resolveBranchIntent(text: string, branches: Array<{ _id: unknown; name: string }>): { branchId: unknown; name: string } | null {
  if (!branches.length) return null;
  const lower = text.toLowerCase();
  const direct = branches.filter((branch) => {
    const fullKey = normalizedNameKey(branch.name);
    return fullKey.length >= 3 && lower.includes(fullKey);
  });
  if (direct.length === 1) return { branchId: direct[0]!._id, name: direct[0]!.name };
  if (direct.length > 1) return null;

  const stripped = strippedBookingText(text);
  if (!stripped || stripped.length < 2) return null;
  const hit = closestName(branches.map((branch) => branch.name), stripped);
  if (!hit || hit.ambiguous) return null;
  const picked = branches.find((branch) => branch.name === hit!.name);
  return picked ? { branchId: picked._id, name: picked.name } : null;
}

/** Staff members whose catalogue names/slugs are present in the text. */
export async function eligibleStaffByNames(text: string, salonId: string, branchId: string, serviceCandidates: ServiceCandidate[]): Promise<Array<{ staffId: string; name: string }>> {
  const eligibleSets = serviceCandidates.map((service) => service.eligibleStaffIds).filter((ids) => ids.length);
  const commonEligible = eligibleSets.length ? eligibleSets.reduce((common, ids) => common.filter((id) => ids.includes(id))) : [];
  const staffFilter = commonEligible.length ? { staffId: { $in: commonEligible } } : {};
  const users = await UserModel.find({ salonId, branchIds: branchId, status: "active", ...staffFilter }).sort({ name: 1 });
  return users
    .filter((user) => user.staffId)
    .map((user) => ({ staffId: user.staffId!, name: user.name }));
}

/** Reads the active branch list for a salon (used by branch resolution). */
export async function catalogueBranches(salonId: string): Promise<Array<{ _id: unknown; name: string }>> {
  const branches = await BranchModel.find({ salonId, status: "active" }).sort({ createdAt: 1 }).lean();
  return branches.map((branch) => ({ _id: branch._id, name: branch.name }));
}
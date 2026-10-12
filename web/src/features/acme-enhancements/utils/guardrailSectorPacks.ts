/**
 * ACME (CHG-2026-151, ADR-0031 phase 1): the guardrail's sector policy packs.
 *
 * Keep in step with rayin-guardrails' own SECTOR_PACKS (CHG-2026-109). The
 * ids are the contract with that service: each settings version carries the
 * enabled packs as `sectors`; the service applies a non-empty list of known
 * ids, rejects an empty list or an unknown id (and keeps the version it has),
 * and reads a version without `sectors` as all six. EYEON therefore never
 * stores an empty or unknown selection.
 *
 * A pack sets only the ANSWER SCOPE: which topics answers may cover. Every
 * pack's conduct rules, and the universal rules (personal data, fraud,
 * general harm, jailbreak and prompt injection), apply whatever is enabled.
 *
 * Client-safe (no server import), so the Policies card, the Enforcement and
 * policy page and the server share one list.
 */
import { z } from "zod";

/** The pack ids, in pack order. The order a selection is stored in. */
export const SECTOR_PACK_IDS = [
  "banking",
  "government",
  "healthcare",
  "hr",
  "retail_telecom",
  "education",
] as const;

export type SectorPackId = (typeof SECTOR_PACK_IDS)[number];

type SectorPack = {
  id: SectorPackId;
  label: string;
  /** One line: the topics answers may cover while the pack is enabled. */
  scope: string;
};

/** Each pack with its label and answer scope, in pack order. */
export const SECTOR_PACKS: readonly SectorPack[] = [
  {
    id: "banking",
    label: "Banking and finance",
    scope:
      "Accounts, cards, payments and transfers, loans and financing (including Islamic finance), financial literacy and regulatory questions.",
  },
  {
    id: "government",
    label: "Government services",
    scope:
      "Identity cards, permits, licences, housing, utilities and e-government services.",
  },
  {
    id: "healthcare",
    label: "Healthcare",
    scope:
      "Appointments, health centres, pharmacy and prescriptions, test results and general health-service information.",
  },
  {
    id: "hr",
    label: "HR and staff services",
    scope:
      "The organisation's own workplace and employee matters: leave, payroll, benefits, workplace policies and HR procedures.",
  },
  {
    id: "retail_telecom",
    label: "Retail and telecom",
    scope:
      "Orders, returns and refunds, products, mobile and internet plans, bills and technical support.",
  },
  {
    id: "education",
    label: "Education",
    scope:
      "Admissions, registration, courses, exams, transcripts and student services.",
  },
];

/** What always applies, whatever packs are enabled. Shown beside the packs. */
export const SECTOR_PACKS_NOTE =
  "Packs set only which topics answers may cover. Every pack's conduct rules and the universal protections (personal data, fraud, general harm, jailbreak and prompt injection) apply in every case, whichever packs are enabled.";

/** The label of a pack id. */
export function sectorPackLabel(id: SectorPackId): string {
  return SECTOR_PACKS.find((p) => p.id === id)?.label ?? id;
}

/** Whether a value is one of the pack ids. */
export function isSectorPackId(value: unknown): value is SectorPackId {
  return (
    typeof value === "string" &&
    (SECTOR_PACK_IDS as readonly string[]).includes(value)
  );
}

/** The given packs de-duplicated, in pack order. */
export function sectorsInPackOrder(
  ids: Iterable<SectorPackId>,
): SectorPackId[] {
  const wanted = new Set(ids);
  return SECTOR_PACK_IDS.filter((id) => wanted.has(id));
}

/** Upper bound on the ids a save may send; duplicates are dropped. */
const MAX_SELECTION_LENGTH = 32;

const EMPTY_SELECTION_MESSAGE =
  "Choose at least one sector policy pack. The guardrail refuses a version with none, and the packs' conduct rules apply whichever packs are enabled.";

/**
 * A selection of packs as a save sends it: at least one, every one a known
 * id. The messages are the ones a guardrail administrator sees on a refused
 * save, so they say what is wrong in words.
 */
const SectorPackSelectionSchema = z
  .array(
    z.enum(SECTOR_PACK_IDS, {
      error: (issue) =>
        `Unknown sector policy pack${
          typeof issue.input === "string"
            ? ` "${issue.input.slice(0, 64)}"`
            : ""
        }. The packs are: ${SECTOR_PACK_IDS.join(", ")}.`,
    }),
    { error: "The sector policy packs must be a list of pack ids." },
  )
  .min(1, { error: EMPTY_SELECTION_MESSAGE })
  .max(MAX_SELECTION_LENGTH, {
    error: `At most ${MAX_SELECTION_LENGTH} sector policy pack ids can be sent.`,
  });

/**
 * Checks a selection and returns it de-duplicated, in pack order, or the
 * first reason it is refused.
 */
export function parseSectorSelection(
  raw: unknown,
): { ok: true; sectors: SectorPackId[] } | { ok: false; message: string } {
  const parsed = SectorPackSelectionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? EMPTY_SELECTION_MESSAGE,
    };
  }
  return { ok: true, sectors: sectorsInPackOrder(parsed.data) };
}

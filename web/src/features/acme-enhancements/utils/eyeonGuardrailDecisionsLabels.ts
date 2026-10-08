/**
 * ACME (CHG-2026-133, ADR-0027): the EYEON Guardrail decisions page's
 * wording.
 *
 * A refusal or a redaction is applied only where the calling gateway was in
 * enforce mode; in record mode it was recorded and the request went through
 * (CHG-2026-116). So every count names what it holds, with the words of
 * guardrailVerdictLabel ("Blocked" or "Would block"), and a headline over a
 * period says whether its interventions were applied, would have been, or
 * both. Pure functions, tested without a browser.
 */
import { guardrailVerdictLabel } from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";
import { formatShare } from "@/src/features/acme-enhancements/utils/eyeonOverviewLabels";

type ModeSplit = { enforced: number; notEnforced: number };

/** "8 blocked, 4 would block": a split in the decision log's own words. */
export function splitText(
  action: "block" | "redact",
  split: ModeSplit,
): string {
  const applied = guardrailVerdictLabel(action, "enforce").label.toLowerCase();
  const unapplied = guardrailVerdictLabel(action, null).label.toLowerCase();
  const parts = [
    split.enforced > 0 ? `${split.enforced.toLocaleString()} ${applied}` : "",
    split.notEnforced > 0
      ? `${split.notEnforced.toLocaleString()} ${unapplied}`
      : "",
  ].filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(", ") : "None";
}

/**
 * The page's one-line answer: how many of the period's checks drew a
 * refusal or a redaction, and whether those were applied.
 */
export function decisionsHeadline(p: {
  checks: number;
  interventions: ModeSplit;
  windowDays: number;
}): string {
  if (p.checks === 0)
    return `No guardrail checks in the last ${p.windowDays} days.`;
  const n = p.interventions.enforced + p.interventions.notEnforced;
  if (n === 0)
    return `None of ${p.checks.toLocaleString()} guardrail checks was refused or redacted.`;
  const verb =
    p.interventions.notEnforced === 0
      ? "were refused or redacted"
      : p.interventions.enforced === 0
        ? "would have been refused or redacted"
        : "were refused or redacted, or would have been";
  return `${formatShare((100 * n) / p.checks)} of ${p.checks.toLocaleString()} guardrail checks ${verb}.`;
}

/** n per 100 checks, one decimal; a dash without checks. */
export function perHundred(n: number, checks: number): string {
  if (checks <= 0) return "–";
  return (Math.round((1000 * n) / checks) / 10).toFixed(1);
}

// CHG-2026-137: the page filters, the policy type by direction breakdown and
// the personal-data types.

/**
 * The headline of a filtered view: how many decisions match, out of every
 * check in the period (for the chosen caller, if any).
 */
export function filteredHeadline(p: {
  matching: number;
  checks: number;
  windowDays: number;
}): string {
  if (p.checks === 0)
    return `No guardrail checks in the last ${p.windowDays} days.`;
  if (p.matching === 0)
    return `No decision matches these filters, out of ${p.checks.toLocaleString()} guardrail checks.`;
  const decisions =
    p.matching === 1
      ? "1 decision matches"
      : `${p.matching.toLocaleString()} decisions match`;
  return `${decisions} these filters: ${formatShare((100 * p.matching) / p.checks)} of ${p.checks.toLocaleString()} guardrail checks.`;
}

type CardVerdict = "allow" | "block" | "redact" | "unavailable";

/**
 * What the busiest-callers card ranks by: refusals unless a verdict is
 * chosen, in words that never call a recorded decision applied.
 */
export const BUSIEST_WORDS: Record<
  CardVerdict,
  { title: string; counted: string; none: string }
> = {
  block: {
    title: "Busiest applications by refusals",
    counted: "refused prompts and withheld answers, applied or recorded only",
    none: "No caller had a refusal that matches these filters.",
  },
  redact: {
    title: "Busiest applications by redactions",
    counted: "redactions, applied or recorded only",
    none: "No caller had a redaction that matches these filters.",
  },
  allow: {
    title: "Busiest applications by allowed checks",
    counted: "allowed checks",
    none: "No caller had an allowed check that matches these filters.",
  },
  unavailable: {
    title: "Busiest applications by checks without a verdict",
    counted: "checks the judge could not decide",
    none: "No caller had a check without a verdict that matches these filters.",
  },
};

/** "1 more caller had one." */
export function moreCallersText(more: number, verdict: CardVerdict): string {
  const what =
    verdict === "block"
      ? "a refusal"
      : verdict === "redact"
        ? "a redaction"
        : verdict === "allow"
          ? "an allowed check"
          : "a check without a verdict";
  return more === 1
    ? `1 more caller had ${what}.`
    : `${more.toLocaleString()} more callers had ${what}.`;
}

/**
 * Personal-data entity types in words, as the guardrail Policies card names
 * the ones it can switch. A type EYEON does not name is "Other or unknown".
 */
const ENTITY_TYPE_LABEL: Record<string, string> = {
  EMAIL_ADDRESS: "Email",
  PHONE_NUMBER: "Phone",
  CREDIT_CARD: "Credit card",
  PERSON: "Person names",
  IBAN_CODE: "IBAN",
  IP_ADDRESS: "IP address",
  BH_CPR: "Bahrain CPR number",
  OTHER: "Other or unknown type",
};

export function entityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABEL[type] ?? ENTITY_TYPE_LABEL.OTHER!;
}

type PolicyDecisions = { blocked: ModeSplit; redacted: ModeSplit };

/**
 * One cell of the policy type by direction table, in the decision log's
 * words: "2 blocked, 1 would block; 3 would redact", or "None".
 */
export function policyCellText(d: PolicyDecisions): string {
  const parts = [
    d.blocked.enforced + d.blocked.notEnforced > 0
      ? splitText("block", d.blocked)
      : "",
    d.redacted.enforced + d.redacted.notEnforced > 0
      ? splitText("redact", d.redacted)
      : "",
  ].filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join("; ") : "None";
}

export function policyCellCount(d: PolicyDecisions): number {
  return (
    d.blocked.enforced +
    d.blocked.notEnforced +
    d.redacted.enforced +
    d.redacted.notEnforced
  );
}

/** The gateway's mode on one day, from how many checks it enforced. */
export type DayMode = "enforce" | "record" | "mixed" | "none";

export function dayMode(checks: number, enforcedChecks: number): DayMode {
  if (checks <= 0) return "none";
  if (enforcedChecks >= checks) return "enforce";
  if (enforcedChecks <= 0) return "record";
  return "mixed";
}

export const DAY_MODE_LABEL: Record<DayMode, string> = {
  enforce: "Enforce mode",
  record: "Record mode or not reported",
  mixed: "Both modes",
  none: "No checks",
};

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

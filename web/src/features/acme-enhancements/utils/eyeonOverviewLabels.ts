/**
 * ACME (CHG-2026-132, ADR-0027): the EYEON overview's wording.
 *
 * A refusal or a redaction is applied only where the calling gateway was in
 * enforce mode; in record mode it was recorded and the request went through
 * (CHG-2026-116). So a count over a period names what it holds: "refused"
 * when every one was applied, "would be refused" when none was, and both
 * when the period mixes the two. Pure functions, tested without a browser.
 */

type ModeSplit = { enforced: number; notEnforced: number };

type InterventionKind = "promptsRefused" | "answersWithheld" | "redactions";

const WORDS: Record<
  InterventionKind,
  { applied: string; unapplied: string; mixed: string }
> = {
  promptsRefused: {
    applied: "Prompts refused",
    unapplied: "Prompts that would be refused",
    mixed: "Prompts refused or would be",
  },
  answersWithheld: {
    applied: "Answers withheld",
    unapplied: "Answers that would be withheld",
    mixed: "Answers withheld or would be",
  },
  redactions: {
    applied: "Personal data redacted",
    unapplied: "Personal data that would be redacted",
    mixed: "Personal data redacted or would be",
  },
};

/** The label for a count, from how much of it the gateway applied. */
export function interventionLabel(
  kind: InterventionKind,
  split: ModeSplit,
): string {
  if (split.notEnforced === 0) return WORDS[kind].applied;
  if (split.enforced === 0) return WORDS[kind].unapplied;
  return WORDS[kind].mixed;
}

/** One line saying how much of a count was applied. */
export function modeSplitNote(split: ModeSplit): string {
  if (split.enforced + split.notEnforced === 0) return "None in this period";
  if (split.notEnforced === 0) return "All applied, in enforce mode";
  if (split.enforced === 0)
    return "Recorded, not applied: record mode or mode not reported";
  return `${split.enforced.toLocaleString()} applied in enforce mode, ${split.notEnforced.toLocaleString()} recorded only`;
}

/** A share in percent, never rounded up to 100% or down to 0%. */
export function formatShare(pct: number): string {
  if (pct > 0 && pct < 1) return "<1%";
  if (pct > 99 && pct < 100) return ">99%";
  return `${Math.round(pct)}%`;
}

/** A rate (0 to 1) in percent, two decimals below 10%. */
export function formatRate(rate: number): string {
  const pct = rate * 100;
  if (pct > 0 && pct < 0.01) return "<0.01%";
  return `${pct.toFixed(pct < 10 ? 2 : 1)}%`;
}

const PERIOD_UNIT: Record<string, [string, string]> = {
  s: ["second", "seconds"],
  m: ["minute", "minutes"],
  h: ["hour", "hours"],
  d: ["day", "days"],
  mo: ["month", "months"],
};

/** A gateway key's budget period ("30d", "1mo") in words. */
export function budgetPeriodLabel(duration: string | null): string {
  if (!duration) return "with no reset period";
  const match = /^(\d+)(mo|s|m|h|d)$/.exec(duration.trim());
  const unit = match ? PERIOD_UNIT[match[2]!] : undefined;
  if (!match || !unit) return `per ${duration}`;
  const n = Number(match[1]);
  return n === 1 ? `per ${unit[0]}` : `per ${n} ${unit[1]}`;
}

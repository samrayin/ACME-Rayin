/**
 * ACME (CHG-2026-122, ADR-0023): the application scorecard.
 *
 * An application is a gateway key lineage: every generation of one key,
 * across rotations. For each, six dimensions are scored green, amber or red
 * from metadata the console already holds (guardrail decisions, the gateway
 * request log and the key's own settings), with the numbers behind each band.
 * There is deliberately no single overall number: a regulated reader wants
 * to see which dimension is red and why, not an average that hides it.
 *
 * Pure functions only, so the bands are tested without a database. The
 * thresholds are the v1 defaults and are named here so a deployment can tune
 * them later in one place.
 */

export type Band = "green" | "amber" | "red" | "none";

export type ScorecardDimension =
  | "protection"
  | "threats"
  | "dataProtection"
  | "accessHygiene"
  | "spend"
  | "reliability";

export const SCORECARD_DIMENSIONS: readonly ScorecardDimension[] = [
  "protection",
  "threats",
  "dataProtection",
  "accessHygiene",
  "spend",
  "reliability",
];

export const SCORECARD_THRESHOLDS = {
  /** Below this many calls in the window, rates are not judged. */
  minCallsForRates: 10,
  /** Prompts the guardrail refused, per 100 calls. */
  threatsPer100: { amber: 1, red: 5 },
  /** Prompts and answers with personal data redacted, per 100 calls. */
  personalDataPer100: { amber: 2, red: 10 },
  /** Share of checks the guardrail could not decide, in percent. */
  noVerdictPct: { amber: 1, red: 5 },
  /** Share of calls whose prompt was checked, in percent (lower is worse). */
  coveragePct: { amber: 95, red: 80 },
  /** Share of calls that did not succeed, in percent. */
  errorPct: { amber: 2, red: 5 },
  /** Spend in the window against the key's budget, in percent. */
  spendPct: { amber: 80, red: 100 },
  /** A key older than this should be rotated. */
  keyMaxAgeDays: 90,
} as const;

export type GuardrailCounts = {
  promptChecks: number;
  answerChecks: number;
  promptBlocks: number;
  answerBlocks: number;
  redactions: number;
  noVerdict: number;
};

export type ScorecardInput = {
  key: {
    models: string[];
    rpmLimit: number | null;
    maxBudget: number | null;
    expiresAt: Date | null;
    /** When the key in use now was issued (its latest rotation). */
    issuedAt: Date;
  };
  calls: number;
  failedCalls: number;
  /** Null when the viewer may not see spend. */
  spendUsd: number | null;
  guard: GuardrailCounts;
  mode: "enforce" | "record";
  now: Date;
};

export type HygieneCheck = {
  id: "budget" | "expiry" | "rotation" | "models" | "rateLimit";
  label: string;
  ok: boolean;
};

export type DimensionScore = {
  dimension: ScorecardDimension;
  band: Band;
  /** One line a reader can check against the logs. */
  evidence: string;
};

export type ApplicationScore = {
  dimensions: DimensionScore[];
  /** The worst band among the scored dimensions; "none" if none was scored. */
  overall: Band;
  hygiene: HygieneCheck[];
};

const BAND_ORDER: Record<Band, number> = {
  none: 0,
  green: 1,
  amber: 2,
  red: 3,
};

/** Higher-is-worse metric against amber and red thresholds. */
function bandAbove(value: number, t: { amber: number; red: number }): Band {
  if (value > t.red) return "red";
  if (value >= t.amber) return "amber";
  return "green";
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (100 * part) / whole : 0;
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export function worstBand(bands: Band[]): Band {
  return bands.reduce<Band>(
    (worst, b) => (BAND_ORDER[b] > BAND_ORDER[worst] ? b : worst),
    "none",
  );
}

export function hygieneChecks(
  key: ScorecardInput["key"],
  now: Date,
): HygieneCheck[] {
  const ageDays = (now.getTime() - key.issuedAt.getTime()) / 86_400_000;
  return [
    { id: "budget", label: "Budget set", ok: key.maxBudget !== null },
    { id: "expiry", label: "Expiry set", ok: key.expiresAt !== null },
    {
      id: "rotation",
      label: `Key rotated within ${SCORECARD_THRESHOLDS.keyMaxAgeDays} days`,
      ok: ageDays <= SCORECARD_THRESHOLDS.keyMaxAgeDays,
    },
    {
      id: "models",
      label: "Limited to named models",
      ok: key.models.length > 0,
    },
    { id: "rateLimit", label: "Request limit set", ok: key.rpmLimit !== null },
  ];
}

export function scoreApplication(input: ScorecardInput): ApplicationScore {
  const t = SCORECARD_THRESHOLDS;
  const { calls, guard } = input;
  const enoughTraffic = calls >= t.minCallsForRates;
  const checks = guard.promptChecks + guard.answerChecks;
  const dimensions: DimensionScore[] = [];

  // Protection: is the guardrail on this application at all, applied, and
  // able to decide?
  {
    const coverage = Math.min(100, pct(guard.promptChecks, calls));
    const noVerdict = pct(guard.noVerdict, checks);
    let band: Band;
    let evidence: string;
    if (calls === 0) {
      band = "none";
      evidence = "No calls in this period.";
    } else if (guard.promptChecks === 0) {
      band = "red";
      evidence = `${calls} calls, none checked by the guardrail.`;
    } else {
      const coverageBand: Band =
        coverage < t.coveragePct.red
          ? "red"
          : coverage < t.coveragePct.amber
            ? "amber"
            : "green";
      const verdictBand = bandAbove(noVerdict, t.noVerdictPct);
      const modeBand: Band = input.mode === "enforce" ? "green" : "amber";
      band = worstBand([coverageBand, verdictBand, modeBand]);
      evidence =
        `${round1(coverage)}% of calls checked; ` +
        `${round1(noVerdict)}% without a verdict; ` +
        (input.mode === "enforce"
          ? "decisions applied (enforce)."
          : "decisions recorded, not applied (record).");
    }
    dimensions.push({ dimension: "protection", band, evidence });
  }

  // Threat activity: prompts the guardrail refused.
  {
    const per100 = (100 * guard.promptBlocks) / Math.max(calls, 1);
    dimensions.push({
      dimension: "threats",
      band: enoughTraffic ? bandAbove(per100, t.threatsPer100) : "none",
      evidence: enoughTraffic
        ? `${guard.promptBlocks} prompts refused (${round1(per100)} per 100 calls); ${guard.answerBlocks} answers withheld.`
        : `${guard.promptBlocks} prompts refused; too few calls to rate.`,
    });
  }

  // Data protection: personal data the guardrail had to redact.
  {
    const per100 = (100 * guard.redactions) / Math.max(calls, 1);
    dimensions.push({
      dimension: "dataProtection",
      band: enoughTraffic ? bandAbove(per100, t.personalDataPer100) : "none",
      evidence: enoughTraffic
        ? `${guard.redactions} redactions of personal data (${round1(per100)} per 100 calls).`
        : `${guard.redactions} redactions of personal data; too few calls to rate.`,
    });
  }

  // Access hygiene: the key's own settings.
  const hygiene = hygieneChecks(input.key, input.now);
  {
    const passed = hygiene.filter((c) => c.ok).length;
    const missing = hygiene.filter((c) => !c.ok).map((c) => c.label);
    dimensions.push({
      dimension: "accessHygiene",
      band: passed === hygiene.length ? "green" : passed >= 3 ? "amber" : "red",
      evidence:
        missing.length === 0
          ? `All ${hygiene.length} checks met.`
          : `${passed} of ${hygiene.length} checks met. Missing: ${missing.join(", ")}.`,
    });
  }

  // Spend against the key's budget.
  {
    let band: Band = "none";
    let evidence: string;
    if (input.spendUsd === null) {
      evidence = "Not shown for your role.";
    } else if (input.key.maxBudget === null || input.key.maxBudget <= 0) {
      evidence = `$${input.spendUsd.toFixed(2)} spent; no budget to measure against.`;
    } else {
      const used = pct(input.spendUsd, input.key.maxBudget);
      band = bandAbove(used, { amber: t.spendPct.amber, red: t.spendPct.red });
      evidence = `$${input.spendUsd.toFixed(2)} of a $${input.key.maxBudget.toFixed(2)} budget (${round1(used)}%).`;
    }
    dimensions.push({ dimension: "spend", band, evidence });
  }

  // Reliability: calls that did not succeed.
  {
    const failed = pct(input.failedCalls, calls);
    dimensions.push({
      dimension: "reliability",
      band: enoughTraffic ? bandAbove(failed, t.errorPct) : "none",
      evidence: enoughTraffic
        ? `${input.failedCalls} of ${calls} calls failed (${round1(failed)}%).`
        : `${input.failedCalls} of ${calls} calls failed; too few calls to rate.`,
    });
  }

  return {
    dimensions,
    overall: worstBand(dimensions.map((d) => d.band)),
    hygiene,
  };
}

export type ScorecardSummary = {
  applications: number;
  byOverall: Record<Band, number>;
  calls: number;
  promptBlocks: number;
  answerBlocks: number;
  redactions: number;
  spendUsd: number | null;
  missingBudget: number;
};

export function summarise(
  apps: { score: ApplicationScore; input: ScorecardInput }[],
  canSeeSpend: boolean,
): ScorecardSummary {
  const byOverall: Record<Band, number> = {
    green: 0,
    amber: 0,
    red: 0,
    none: 0,
  };
  let calls = 0;
  let promptBlocks = 0;
  let answerBlocks = 0;
  let redactions = 0;
  let spend = 0;
  let missingBudget = 0;
  for (const { score, input } of apps) {
    byOverall[score.overall] += 1;
    calls += input.calls;
    promptBlocks += input.guard.promptBlocks;
    answerBlocks += input.guard.answerBlocks;
    redactions += input.guard.redactions;
    spend += input.spendUsd ?? 0;
    if (input.key.maxBudget === null) missingBudget += 1;
  }
  return {
    applications: apps.length,
    byOverall,
    calls,
    promptBlocks,
    answerBlocks,
    redactions,
    spendUsd: canSeeSpend ? spend : null,
    missingBudget,
  };
}

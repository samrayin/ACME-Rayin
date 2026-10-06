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
  /** Checks the calling gateway reported deciding in enforce mode. */
  enforcedChecks: number;
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
  /**
   * How far past its band's threshold the value is, as a fraction of that
   * threshold: 0 at the threshold, 1 at twice it. 0 when green or not
   * rated. Ranks the top risks (CHG-2026-122, second iteration).
   */
  excess: number;
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

/** How far a higher-is-worse value is past the threshold of its band. */
function excessAbove(
  value: number,
  band: Band,
  t: { amber: number; red: number },
): number {
  if (band === "red") return (value - t.red) / t.red;
  if (band === "amber") return (value - t.amber) / t.amber;
  return 0;
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
    let excess = 0;
    if (calls === 0) {
      band = "none";
      evidence = "No calls in this period.";
    } else if (guard.promptChecks === 0) {
      band = "red";
      evidence = `${calls} calls, none checked by the guardrail.`;
      excess = 1;
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
      // The furthest past its threshold among the parts that set the band.
      // Coverage is lower-is-worse; record mode sits at its threshold.
      const coverageThreshold =
        coverageBand === "red" ? t.coveragePct.red : t.coveragePct.amber;
      excess = Math.max(
        coverageBand === band && band !== "green"
          ? (coverageThreshold - coverage) / coverageThreshold
          : 0,
        verdictBand === band
          ? excessAbove(noVerdict, verdictBand, t.noVerdictPct)
          : 0,
      );
    }
    dimensions.push({ dimension: "protection", band, evidence, excess });
  }

  // Threat activity: prompts the guardrail refused.
  {
    const per100 = (100 * guard.promptBlocks) / Math.max(calls, 1);
    const band = enoughTraffic ? bandAbove(per100, t.threatsPer100) : "none";
    dimensions.push({
      dimension: "threats",
      band,
      evidence: enoughTraffic
        ? `${guard.promptBlocks} prompts refused (${round1(per100)} per 100 calls); ${guard.answerBlocks} answers withheld.`
        : `${guard.promptBlocks} prompts refused; too few calls to rate.`,
      excess: excessAbove(per100, band, t.threatsPer100),
    });
  }

  // Data protection: personal data the guardrail had to redact.
  {
    const per100 = (100 * guard.redactions) / Math.max(calls, 1);
    const band = enoughTraffic
      ? bandAbove(per100, t.personalDataPer100)
      : "none";
    dimensions.push({
      dimension: "dataProtection",
      band,
      evidence: enoughTraffic
        ? `${guard.redactions} redactions of personal data (${round1(per100)} per 100 calls).`
        : `${guard.redactions} redactions of personal data; too few calls to rate.`,
      excess: excessAbove(per100, band, t.personalDataPer100),
    });
  }

  // Access hygiene: the key's own settings. Amber from one check missing,
  // red from three.
  const hygiene = hygieneChecks(input.key, input.now);
  {
    const passed = hygiene.filter((c) => c.ok).length;
    const missing = hygiene.filter((c) => !c.ok).map((c) => c.label);
    const band: Band =
      passed === hygiene.length ? "green" : passed >= 3 ? "amber" : "red";
    dimensions.push({
      dimension: "accessHygiene",
      band,
      evidence:
        missing.length === 0
          ? `All ${hygiene.length} checks met.`
          : `${passed} of ${hygiene.length} checks met. Missing: ${missing.join(", ")}.`,
      excess: excessAbove(missing.length, band, { amber: 1, red: 3 }),
    });
  }

  // Spend against the key's budget.
  {
    let band: Band = "none";
    let evidence: string;
    let excess = 0;
    if (input.spendUsd === null) {
      evidence = "Not shown for your role.";
    } else if (input.key.maxBudget === null || input.key.maxBudget <= 0) {
      evidence = `$${input.spendUsd.toFixed(2)} spent; no budget to measure against.`;
    } else {
      const used = pct(input.spendUsd, input.key.maxBudget);
      band = bandAbove(used, { amber: t.spendPct.amber, red: t.spendPct.red });
      evidence = `$${input.spendUsd.toFixed(2)} of a $${input.key.maxBudget.toFixed(2)} budget (${round1(used)}%).`;
      excess = excessAbove(used, band, t.spendPct);
    }
    dimensions.push({ dimension: "spend", band, evidence, excess });
  }

  // Reliability: calls that did not succeed.
  {
    const failed = pct(input.failedCalls, calls);
    const band = enoughTraffic ? bandAbove(failed, t.errorPct) : "none";
    dimensions.push({
      dimension: "reliability",
      band,
      evidence: enoughTraffic
        ? `${input.failedCalls} of ${calls} calls failed (${round1(failed)}%).`
        : `${input.failedCalls} of ${calls} calls failed; too few calls to rate.`,
      excess: excessAbove(failed, band, t.errorPct),
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
  /** Guardrail checks in the period, prompts and answers. */
  checks: number;
  enforcedChecks: number;
  /** Share of those checks decided in enforce mode; null without checks. */
  enforcedPct: number | null;
};

/**
 * The share of checks the gateway decided in enforce mode, in percent. A
 * check with no reported mode counts as not enforced, because nothing says
 * it was (as in guardrailVerdictLabel.ts).
 */
export function enforcedShare(
  checks: number,
  enforcedChecks: number,
): number | null {
  return checks > 0 ? pct(enforcedChecks, checks) : null;
}

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
  let checks = 0;
  let enforcedChecks = 0;
  for (const { score, input } of apps) {
    byOverall[score.overall] += 1;
    calls += input.calls;
    promptBlocks += input.guard.promptBlocks;
    answerBlocks += input.guard.answerBlocks;
    redactions += input.guard.redactions;
    spend += input.spendUsd ?? 0;
    if (input.key.maxBudget === null) missingBudget += 1;
    checks += input.guard.promptChecks + input.guard.answerChecks;
    enforcedChecks += input.guard.enforcedChecks;
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
    checks,
    enforcedChecks,
    enforcedPct: enforcedShare(checks, enforcedChecks),
  };
}

// ACME (CHG-2026-122, ADR-0023), second iteration: the executive summary's
// top risks, threat activity by type, and the daily trend.

export type TopRisk = {
  name: string;
  alias: string;
  dimension: ScorecardDimension;
  band: "red" | "amber";
  evidence: string;
};

/**
 * Every red and amber dimension across the applications, worst first: red
 * before amber, then the furthest past its threshold, then by application
 * name and the dimensions' order. `limit` caps the list; `total` counts all.
 */
export function rankTopRisks(
  apps: { name: string; alias: string; score: ApplicationScore }[],
  limit: number,
): { risks: TopRisk[]; total: number } {
  const ranked = apps
    .flatMap((app) =>
      app.score.dimensions.flatMap((d) =>
        d.band === "red" || d.band === "amber"
          ? [{ app, d, band: d.band }]
          : [],
      ),
    )
    .sort(
      (a, b) =>
        BAND_ORDER[b.band] - BAND_ORDER[a.band] ||
        b.d.excess - a.d.excess ||
        a.app.name.localeCompare(b.app.name) ||
        SCORECARD_DIMENSIONS.indexOf(a.d.dimension) -
          SCORECARD_DIMENSIONS.indexOf(b.d.dimension),
    );
  return {
    risks: ranked.slice(0, limit).map(({ app, d, band }) => ({
      name: app.name,
      alias: app.alias,
      dimension: d.dimension,
      band,
      evidence: d.evidence,
    })),
    total: ranked.length,
  };
}

export type ThreatType =
  | "jailbreak"
  | "harmfulContent"
  | "offTopic"
  | "personalData"
  | "sectorRules"
  | "oversized"
  | "other";

/** Fixed order, used to break ties between equal counts. */
export const THREAT_TYPES: readonly ThreatType[] = [
  "jailbreak",
  "harmfulContent",
  "offTopic",
  "personalData",
  "sectorRules",
  "oversized",
  "other",
];

export const THREAT_TYPE_LABEL: Record<ThreatType, string> = {
  jailbreak: "Jailbreak or misuse",
  harmfulContent: "Harmful content",
  offTopic: "Off-topic or outside policy",
  personalData: "Personal data",
  sectorRules: "Sector rules",
  oversized: "Too large to check",
  other: "Other",
};

/**
 * The guardrail's policy label (`policyTriggered`) to a readable type; the
 * first match wins. The labels rayin-guardrails sends today:
 * "Jailbreak Detection" for every prompt its input rail refuses (the
 * jailbreak, harmful-request and sector conduct rules are judged in one
 * check, hence "Jailbreak or misuse"), "Topical Rail" for every answer its
 * output rail withholds (scope, harmful answers and sector rules, hence
 * "Off-topic or outside policy"), and "Input too large for inspection".
 * The harm and sector rules here match finer labels if it reports them
 * later. The label is caller-set text, so it is never shown as such: an
 * unknown or missing one is counted as "Other".
 */
const THREAT_TYPE_RULES: readonly [RegExp, ThreatType][] = [
  [/jailbreak|injection/i, "jailbreak"],
  [/\bharm|toxic|unsafe/i, "harmfulContent"],
  [/sector/i, "sectorRules"],
  [/topical|off-topic|off topic/i, "offTopic"],
  [/\bpii\b|personal data/i, "personalData"],
  [/too large/i, "oversized"],
];

export function threatType(policyTriggered: string | null): ThreatType {
  if (!policyTriggered) return "other";
  return (
    THREAT_TYPE_RULES.find(([pattern]) => pattern.test(policyTriggered))?.[1] ??
    "other"
  );
}

export type ThreatTypeCount = {
  type: ThreatType;
  label: string;
  count: number;
};

/** Refusals by type, most frequent first; types with none are left out. */
export function threatTypeBreakdown(
  refusals: { policyTriggered: string | null; count: number }[],
): ThreatTypeCount[] {
  const counts = new Map<ThreatType, number>();
  for (const r of refusals) {
    const type = threatType(r.policyTriggered);
    counts.set(type, (counts.get(type) ?? 0) + r.count);
  }
  return THREAT_TYPES.flatMap((type) => {
    const count = counts.get(type) ?? 0;
    return count > 0 ? [{ type, label: THREAT_TYPE_LABEL[type], count }] : [];
  }).sort((a, b) => b.count - a.count);
}

/** A UTC day as yyyy-mm-dd. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Midnight UTC at the start of a trend of `days` days that ends today. */
export function trendStart(now: Date, days: number): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      (days - 1) * 86_400_000,
  );
}

export type TrendPoint = { day: string; calls: number; refused: number };

/**
 * One point per UTC day, `days` days from `start`, with zeros where nothing
 * happened. Rows for a day outside the trend are ignored.
 */
export function dailyTrend(
  start: Date,
  days: number,
  rows: { day: string; calls: number; refused: number }[],
): TrendPoint[] {
  const points = Array.from({ length: days }, (_, i) => ({
    day: utcDay(new Date(start.getTime() + i * 86_400_000)),
    calls: 0,
    refused: 0,
  }));
  const byDay = new Map(points.map((p) => [p.day, p]));
  for (const r of rows) {
    const p = byDay.get(r.day);
    if (!p) continue;
    p.calls += r.calls;
    p.refused += r.refused;
  }
  return points;
}

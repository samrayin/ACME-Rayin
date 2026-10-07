/**
 * ACME (CHG-2026-132, ADR-0027): the EYEON overview's figures.
 *
 * Pure functions only, so they are tested without a database; the router
 * (eyeonOverviewRouter.ts) does the reads. Every input here is metadata:
 * counts of guardrail decisions by direction, verdict and the mode the
 * calling gateway reported, the guardrail settings' mode history, and the
 * applications' scorecards. Nothing here sees prompt or answer text,
 * redacted text, personal-data findings or encrypted content.
 */
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
} from "@langfuse/shared/src/db";
import { gatewayModeFromDb } from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";
import {
  enforcedShare,
  utcDay,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import {
  type GuardrailMode,
  type GuardrailModeChange,
  type GuardrailSettingsVersion,
  servedMode,
} from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";

/** One row of the project's decisions grouped by direction, verdict and mode. */
type DecisionGroup = {
  direction: AcmeGuardrailEventDirection;
  action: AcmeGuardrailEventAction;
  gatewayMode: string | null;
  _count: { _all: number };
};

/**
 * A count split by the mode the calling gateway reported. A decision with no
 * reported mode counts as not enforced, because nothing says it was (as in
 * guardrailVerdictLabel.ts).
 */
type ModeSplit = { enforced: number; notEnforced: number };

type DecisionTotals = {
  /** Guardrail checks in the period, prompts and answers. */
  checks: number;
  promptChecks: number;
  answerChecks: number;
  allowed: number;
  /** Prompts the guardrail refused (blocked on the way in). */
  promptsRefused: ModeSplit;
  /** Answers the guardrail withheld (blocked on the way out). */
  answersWithheld: ModeSplit;
  /** Prompts and answers with personal data redacted. */
  redactions: ModeSplit;
  /** Checks the judge model could not decide. */
  noVerdict: number;
  enforcedChecks: number;
  /** Share of checks decided in enforce mode, in percent; null without checks. */
  enforcedPct: number | null;
};

function emptySplit(): ModeSplit {
  return { enforced: 0, notEnforced: 0 };
}

function addTo(split: ModeSplit, enforced: boolean, n: number) {
  if (enforced) split.enforced += n;
  else split.notEnforced += n;
}

/** The period's totals, from the decisions grouped by direction, verdict and mode. */
export function decisionTotals(groups: DecisionGroup[]): DecisionTotals {
  const totals: DecisionTotals = {
    checks: 0,
    promptChecks: 0,
    answerChecks: 0,
    allowed: 0,
    promptsRefused: emptySplit(),
    answersWithheld: emptySplit(),
    redactions: emptySplit(),
    noVerdict: 0,
    enforcedChecks: 0,
    enforcedPct: null,
  };
  for (const g of groups) {
    const n = g._count._all;
    const isPrompt = g.direction === AcmeGuardrailEventDirection.INPUT;
    const enforced = gatewayModeFromDb(g.gatewayMode) === "enforce";
    totals.checks += n;
    if (isPrompt) totals.promptChecks += n;
    else totals.answerChecks += n;
    if (enforced) totals.enforcedChecks += n;
    if (g.action === AcmeGuardrailEventAction.ALLOW) totals.allowed += n;
    if (g.action === AcmeGuardrailEventAction.BLOCK)
      addTo(
        isPrompt ? totals.promptsRefused : totals.answersWithheld,
        enforced,
        n,
      );
    if (g.action === AcmeGuardrailEventAction.REDACT)
      addTo(totals.redactions, enforced, n);
    if (g.action === AcmeGuardrailEventAction.UNAVAILABLE)
      totals.noVerdict += n;
  }
  totals.enforcedPct = enforcedShare(totals.checks, totals.enforcedChecks);
  return totals;
}

export type DailyDecisions = {
  day: string;
  checks: number;
  promptsRefused: number;
  answersWithheld: number;
  redactions: number;
  noVerdict: number;
};

/**
 * One point per UTC day, `days` days from `start`, with zeros where nothing
 * happened. Rows for a day outside the range are ignored.
 */
export function dailyDecisions(
  start: Date,
  days: number,
  rows: DailyDecisions[],
): DailyDecisions[] {
  const points: DailyDecisions[] = Array.from({ length: days }, (_, i) => ({
    day: utcDay(new Date(start.getTime() + i * 86_400_000)),
    checks: 0,
    promptsRefused: 0,
    answersWithheld: 0,
    redactions: 0,
    noVerdict: 0,
  }));
  const byDay = new Map(points.map((p) => [p.day, p]));
  for (const r of rows) {
    const p = byDay.get(r.day);
    if (!p) continue;
    p.checks += r.checks;
    p.promptsRefused += r.promptsRefused;
    p.answersWithheld += r.answersWithheld;
    p.redactions += r.redactions;
    p.noVerdict += r.noVerdict;
  }
  return points;
}

type OverviewMode = {
  /**
   * The mode EYEON serves now: the version in force, capped by the ceiling.
   * Null when no guardrail settings are stored in EYEON yet ("Not reported").
   */
  mode: GuardrailMode | null;
  ceiling: GuardrailMode;
  /** While an enforce trial is served: when it switches back to record. */
  trialEndsAt: string | null;
  /** The newest recorded change of mode. Who made it is not returned. */
  lastChange: { at: string; to: GuardrailMode; automatic: boolean } | null;
};

export function overviewMode(
  settings: GuardrailSettingsVersion | null,
  changes: readonly GuardrailModeChange[],
  now: Date,
  ceiling: GuardrailMode,
): OverviewMode {
  const mode = settings ? servedMode(settings, now, ceiling) : null;
  const last = changes[changes.length - 1];
  return {
    mode,
    ceiling,
    trialEndsAt:
      mode === "enforce" && settings?.revertAt
        ? settings.revertAt.toISOString()
        : null,
    lastChange: last
      ? {
          at: last.createdAt.toISOString(),
          to: last.mode,
          automatic: last.automatic,
        }
      : null,
  };
}

type BudgetUse = {
  name: string;
  alias: string;
  spentUsd: number;
  budgetUsd: number;
  /** The key's own budget period, as the gateway holds it (e.g. "30d"). */
  budgetDuration: string | null;
  /** Spend in the overview's period against the budget, in percent. */
  usedPct: number;
};

/**
 * Applications' spend in the period against their keys' budgets, the most
 * used first, at most `limit` of them. Only for a viewer who may see spend:
 * an application whose spend was withheld (null) is left out.
 */
export function budgetUse(
  apps: {
    name: string;
    alias: string;
    budgetDuration: string | null;
    spendUsd: number | null;
    maxBudget: number | null;
  }[],
  limit: number,
): {
  shown: BudgetUse[];
  withBudget: number;
  withoutBudget: number;
  totalUsd: number;
} {
  const visible = apps.flatMap((a) =>
    a.spendUsd === null ? [] : [{ ...a, spendUsd: a.spendUsd }],
  );
  const budgeted = visible
    .flatMap((a) =>
      a.maxBudget !== null && a.maxBudget > 0
        ? [
            {
              name: a.name,
              alias: a.alias,
              spentUsd: a.spendUsd,
              budgetUsd: a.maxBudget,
              budgetDuration: a.budgetDuration,
              usedPct: (100 * a.spendUsd) / a.maxBudget,
            },
          ]
        : [],
    )
    .sort((a, b) => b.usedPct - a.usedPct || a.name.localeCompare(b.name));
  return {
    shown: budgeted.slice(0, limit),
    withBudget: budgeted.length,
    withoutBudget: visible.length - budgeted.length,
    totalUsd: visible.reduce((sum, a) => sum + a.spendUsd, 0),
  };
}

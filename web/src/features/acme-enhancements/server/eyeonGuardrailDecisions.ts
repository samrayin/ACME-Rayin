/**
 * ACME (CHG-2026-133, ADR-0027): the EYEON Guardrail decisions page's
 * figures.
 *
 * Pure functions only, so they are tested without a database; the router
 * (eyeonGuardrailDecisionsRouter.ts) does the reads. Every input here is
 * metadata: counts of guardrail decisions by direction, verdict, policy
 * label, agent (the calling key's alias) and the mode the calling gateway
 * reported, and the gateway keys' lineage, name and status. Nothing here sees
 * prompt or answer text, redacted text, personal-data findings or encrypted
 * content.
 *
 * A refusal or a redaction counts as applied only where the gateway reported
 * enforce mode; otherwise it was recorded and the request went through, so it
 * is a "Would block" or "Would redact" (CHG-2026-116, guardrailVerdictLabel).
 */
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
  type AcmeLitellmKeyStatus,
} from "@langfuse/shared/src/db";
import { gatewayModeFromDb } from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";
import {
  SCORECARD_THRESHOLDS,
  type ThreatType,
  threatType,
  threatTypeBreakdown,
  utcDay,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import { currentGeneration } from "@/src/features/acme-enhancements/server/acmeApplicationDetail";

/**
 * A count split by the mode the calling gateway reported. A decision with no
 * reported mode counts as not enforced, because nothing says it was.
 */
export type ModeSplit = { enforced: number; notEnforced: number };

function emptySplit(): ModeSplit {
  return { enforced: 0, notEnforced: 0 };
}

function isEnforced(gatewayMode: string | null): boolean {
  return gatewayModeFromDb(gatewayMode) === "enforce";
}

function addTo(split: ModeSplit, enforced: boolean, n: number) {
  if (enforced) split.enforced += n;
  else split.notEnforced += n;
}

/** One row of the project's decisions grouped by direction, verdict and mode. */
type DecisionGroup = {
  direction: AcmeGuardrailEventDirection;
  action: AcmeGuardrailEventAction;
  gatewayMode: string | null;
  _count: { _all: number };
};

/** One direction's decisions in the period. */
export type DirectionDecisions = {
  checks: number;
  allowed: number;
  /** Refused prompts, or withheld answers. */
  blocked: ModeSplit;
  redacted: ModeSplit;
  noVerdict: number;
};

function emptyDirection(): DirectionDecisions {
  return {
    checks: 0,
    allowed: 0,
    blocked: emptySplit(),
    redacted: emptySplit(),
    noVerdict: 0,
  };
}

/**
 * Prompts (checked on the way in) and answers (on the way out), each by
 * verdict, refusals and redactions split by the reported mode.
 */
export function decisionsByDirection(groups: DecisionGroup[]): {
  prompts: DirectionDecisions;
  answers: DirectionDecisions;
} {
  const prompts = emptyDirection();
  const answers = emptyDirection();
  for (const g of groups) {
    const n = g._count._all;
    const d =
      g.direction === AcmeGuardrailEventDirection.INPUT ? prompts : answers;
    const enforced = isEnforced(g.gatewayMode);
    d.checks += n;
    if (g.action === AcmeGuardrailEventAction.ALLOW) d.allowed += n;
    if (g.action === AcmeGuardrailEventAction.BLOCK)
      addTo(d.blocked, enforced, n);
    if (g.action === AcmeGuardrailEventAction.REDACT)
      addTo(d.redacted, enforced, n);
    if (g.action === AcmeGuardrailEventAction.UNAVAILABLE) d.noVerdict += n;
  }
  return { prompts, answers };
}

/** One UTC day's decisions by verdict, applied ones apart from the rest. */
export type DailyVerdicts = {
  day: string;
  checks: number;
  allowed: number;
  /** Refused in enforce mode. */
  blocked: number;
  /** A block verdict recorded and let through: record mode or no mode. */
  wouldBlock: number;
  redacted: number;
  wouldRedact: number;
  noVerdict: number;
};

const DAILY_COUNTS = [
  "checks",
  "allowed",
  "blocked",
  "wouldBlock",
  "redacted",
  "wouldRedact",
  "noVerdict",
] as const;

/**
 * One point per UTC day, `days` days from `start`, with zeros where nothing
 * happened. Rows for a day outside the range are ignored.
 */
export function dailyVerdicts(
  start: Date,
  days: number,
  rows: DailyVerdicts[],
): DailyVerdicts[] {
  const points: DailyVerdicts[] = Array.from({ length: days }, (_, i) => ({
    day: utcDay(new Date(start.getTime() + i * 86_400_000)),
    checks: 0,
    allowed: 0,
    blocked: 0,
    wouldBlock: 0,
    redacted: 0,
    wouldRedact: 0,
    noVerdict: 0,
  }));
  const byDay = new Map(points.map((p) => [p.day, p]));
  for (const r of rows) {
    const p = byDay.get(r.day);
    if (!p) continue;
    for (const key of DAILY_COUNTS) p[key] += r[key];
  }
  return points;
}

/** The refusals (block verdicts) grouped by policy label, direction and mode. */
type RefusalGroup = {
  policyTriggered: string | null;
  direction: AcmeGuardrailEventDirection;
  gatewayMode: string | null;
  _count: { _all: number };
};

export type RefusalType = {
  type: ThreatType;
  label: string;
  count: number;
  /** Applied in enforce mode, and recorded only. */
  split: ModeSplit;
  /** Prompts refused, and answers withheld. */
  prompts: number;
  answers: number;
};

/**
 * Refusals by type, most frequent first, from the guardrail's policy label
 * only, through the Applications scorecard's mapping (threatTypeBreakdown):
 * the label is caller-set text, so it is never shown as such, and an unknown
 * or missing one counts as "Other". Types with none are left out.
 */
export function refusalsByType(groups: RefusalGroup[]): RefusalType[] {
  const detail = new Map<
    ThreatType,
    { split: ModeSplit; prompts: number; answers: number }
  >();
  for (const g of groups) {
    const type = threatType(g.policyTriggered);
    const d = detail.get(type) ?? {
      split: emptySplit(),
      prompts: 0,
      answers: 0,
    };
    const n = g._count._all;
    addTo(d.split, isEnforced(g.gatewayMode), n);
    if (g.direction === AcmeGuardrailEventDirection.INPUT) d.prompts += n;
    else d.answers += n;
    detail.set(type, d);
  }
  return threatTypeBreakdown(
    groups.map((g) => ({
      policyTriggered: g.policyTriggered,
      count: g._count._all,
    })),
  ).map((t) => {
    const d = detail.get(t.type);
    return {
      ...t,
      split: d?.split ?? emptySplit(),
      prompts: d?.prompts ?? 0,
      answers: d?.answers ?? 0,
    };
  });
}

/** A gateway key generation, as far as this page needs it. */
type KeyRow = {
  lineageId: string;
  generation: number;
  displayName: string;
  litellmKeyAlias: string;
  status: AcmeLitellmKeyStatus;
};

export type ApplicationRef = { lineageId: string; name: string };

/**
 * Each key alias of an application, to that application: its lineage and
 * the name of its current generation. As on the Applications page, a lineage
 * without an active key is not an application, so its aliases resolve to
 * nothing. The caller passes only keys that are, or were, in use.
 */
export function applicationsByAlias(
  keys: KeyRow[],
): Map<string, ApplicationRef> {
  const lineages = new Map<string, KeyRow[]>();
  for (const k of keys) {
    const list = lineages.get(k.lineageId) ?? [];
    list.push(k);
    lineages.set(k.lineageId, list);
  }
  const byAlias = new Map<string, ApplicationRef>();
  for (const generations of lineages.values()) {
    const current = currentGeneration(generations);
    if (!current) continue;
    for (const g of generations)
      byAlias.set(g.litellmKeyAlias, {
        lineageId: current.lineageId,
        name: current.displayName,
      });
  }
  return byAlias;
}

/** One agent's checks and refusals in the period, busiest first. */
export type BusiestRow = {
  alias: string;
  checks: number;
  refusals: number;
  refusalsEnforced: number;
  /** How many agents had a refusal in the period (the same on every row). */
  withRefusals: number;
};

export type BusyApplication = {
  /** The agent id: for gateway traffic, the calling key's alias. */
  alias: string;
  /** Only where the alias is an application's key and the viewer may open it. */
  application: ApplicationRef | null;
  refusals: ModeSplit;
  checks: number;
  /** Refusals per 100 checks; null below the scorecard's minimum traffic. */
  per100: number | null;
};

/**
 * The agents with the most refusals, as read (already ordered and capped),
 * each resolved to its application where `applications` knows the alias.
 * `total` counts every agent with a refusal in the period.
 */
export function busiestApplications(
  rows: BusiestRow[],
  applications: Map<string, ApplicationRef> | null,
): { shown: BusyApplication[]; total: number } {
  return {
    shown: rows.map((r) => ({
      alias: r.alias,
      application: applications?.get(r.alias) ?? null,
      refusals: {
        enforced: r.refusalsEnforced,
        notEnforced: r.refusals - r.refusalsEnforced,
      },
      checks: r.checks,
      per100:
        r.checks >= SCORECARD_THRESHOLDS.minCallsForRates
          ? (100 * r.refusals) / r.checks
          : null,
    })),
    total: rows[0]?.withRefusals ?? 0,
  };
}

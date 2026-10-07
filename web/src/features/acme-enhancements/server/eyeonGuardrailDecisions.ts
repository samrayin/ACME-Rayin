/**
 * ACME (CHG-2026-133, ADR-0027): the EYEON Guardrail decisions page's
 * figures. CHG-2026-137 adds the page filters, the policy type by direction
 * breakdown, the callers a filter can choose and the personal-data types.
 *
 * Pure functions only, so they are tested without a database; the router
 * (eyeonGuardrailDecisionsRouter.ts) does the reads. Every input here is
 * metadata: counts of guardrail decisions by direction, verdict, policy
 * label, agent (the calling key's alias) and the mode the calling gateway
 * reported; counts of personal-data findings by entity type, counted in the
 * database; and the gateway keys' lineage, name and status. Nothing here sees
 * prompt or answer text, redacted text, a finding's position, score or
 * matched text, or encrypted content.
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
  THREAT_TYPES,
  THREAT_TYPE_LABEL,
  type ThreatType,
  threatType,
  utcDay,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import { currentGeneration } from "@/src/features/acme-enhancements/server/acmeApplicationDetail";
import { ALL_PII_ENTITIES } from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import {
  type DecisionFilters,
  type DirectionFilter,
  type VerdictFilter,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFilters";

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

/**
 * CHG-2026-137: the same, also by the policy label, so the page's filters
 * (all four of them on dimensions of the group) apply to one read.
 */
export type LabelledGroup = DecisionGroup & { policyTriggered: string | null };

const DIRECTION_DB: Record<DirectionFilter, AcmeGuardrailEventDirection> = {
  prompts: AcmeGuardrailEventDirection.INPUT,
  answers: AcmeGuardrailEventDirection.OUTPUT,
};

const ACTION_DB: Record<VerdictFilter, AcmeGuardrailEventAction> = {
  allow: AcmeGuardrailEventAction.ALLOW,
  block: AcmeGuardrailEventAction.BLOCK,
  redact: AcmeGuardrailEventAction.REDACT,
  unavailable: AcmeGuardrailEventAction.UNAVAILABLE,
};

/** Only a refusal or a redaction carries a policy label. */
function hasPolicyLabel(action: AcmeGuardrailEventAction): boolean {
  return (
    action === AcmeGuardrailEventAction.BLOCK ||
    action === AcmeGuardrailEventAction.REDACT
  );
}

/**
 * Whether a group of decisions matches the filters on what was decided:
 * direction, verdict, policy type and mode. The caller filter is applied by
 * the read itself. With a policy type chosen, only refusals and redactions
 * can match, since only they carry a policy label; a missing or unknown
 * label counts as Other, as on the scorecard.
 */
export function matchesFilters(
  g: Omit<LabelledGroup, "_count">,
  f: DecisionFilters,
): boolean {
  if (f.direction && g.direction !== DIRECTION_DB[f.direction]) return false;
  if (f.verdict && g.action !== ACTION_DB[f.verdict]) return false;
  if (f.applied && isEnforced(g.gatewayMode) !== (f.applied === "applied"))
    return false;
  if (f.policyType) {
    if (!hasPolicyLabel(g.action)) return false;
    if (threatType(g.policyTriggered) !== f.policyType) return false;
  }
  return true;
}

/**
 * Every check in the period (for the chosen caller, if any), whatever it
 * decided: the base of every rate per 100 checks, so a rate keeps its
 * meaning while a filter narrows what is counted.
 */
export function scopeChecks(groups: DecisionGroup[]): {
  checks: number;
  promptChecks: number;
  answerChecks: number;
} {
  const scope = { checks: 0, promptChecks: 0, answerChecks: 0 };
  for (const g of groups) {
    const n = g._count._all;
    scope.checks += n;
    if (g.direction === AcmeGuardrailEventDirection.INPUT)
      scope.promptChecks += n;
    else scope.answerChecks += n;
  }
  return scope;
}

/**
 * The stored policy labels of one type, for the reads that filter in SQL:
 * the type of a label is decided here, by the scorecard's own mapping, and
 * the SQL matches the labels themselves. Labels are taken from refusals and
 * redactions only. For Other, decisions with no label match too.
 */
export function policyLabelsOf(
  groups: Pick<LabelledGroup, "action" | "policyTriggered">[],
  type: ThreatType,
): { labels: string[]; withMissing: boolean } {
  const labels = new Set<string>();
  for (const g of groups) {
    if (!hasPolicyLabel(g.action) || g.policyTriggered === null) continue;
    if (threatType(g.policyTriggered) === type) labels.add(g.policyTriggered);
  }
  return { labels: [...labels].sort(), withMissing: type === "other" };
}

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

/**
 * One UTC day's decisions by verdict, applied ones apart from the rest.
 * `checks` and `enforcedChecks` cover every check of the day (for the chosen
 * caller): the base of a rate per 100 checks, and the gateway's mode that
 * day. The verdict counts cover the decisions that match the filters.
 */
export type DailyVerdicts = {
  day: string;
  checks: number;
  /** Of `checks`, those decided in enforce mode. */
  enforcedChecks: number;
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
  "enforcedChecks",
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
    enforcedChecks: 0,
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

/** Refusals and redactions on one side, by the reported mode. */
export type PolicyDecisions = { blocked: ModeSplit; redacted: ModeSplit };

/** One policy type's refusals and redactions, on prompts and on answers. */
export type PolicyDirectionRow = {
  type: ThreatType;
  label: string;
  count: number;
  prompts: PolicyDecisions;
  answers: PolicyDecisions;
};

function emptyPolicyDecisions(): PolicyDecisions {
  return { blocked: emptySplit(), redacted: emptySplit() };
}

/**
 * "Why": refusals and redactions by policy type and direction, most
 * frequent first (ties in the scorecard's order), from the guardrail's
 * policy label only, through the Applications scorecard's mapping: the label
 * is caller-set text, so it is never shown as such, and an unknown or missing
 * one counts as "Other". Types with none are left out. Pass the groups that
 * match the filters.
 */
export function policyByDirection(
  groups: LabelledGroup[],
): PolicyDirectionRow[] {
  const rows = new Map<ThreatType, PolicyDirectionRow>();
  for (const g of groups) {
    if (!hasPolicyLabel(g.action)) continue;
    const type = threatType(g.policyTriggered);
    const row = rows.get(type) ?? {
      type,
      label: THREAT_TYPE_LABEL[type],
      count: 0,
      prompts: emptyPolicyDecisions(),
      answers: emptyPolicyDecisions(),
    };
    const n = g._count._all;
    const side =
      g.direction === AcmeGuardrailEventDirection.INPUT
        ? row.prompts
        : row.answers;
    addTo(
      g.action === AcmeGuardrailEventAction.BLOCK
        ? side.blocked
        : side.redacted,
      isEnforced(g.gatewayMode),
      n,
    );
    row.count += n;
    rows.set(type, row);
  }
  return THREAT_TYPES.flatMap((type) => {
    const row = rows.get(type);
    return row && row.count > 0 ? [row] : [];
  }).sort((a, b) => b.count - a.count);
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

/**
 * One agent's checks in the period and the decisions it drew that the card
 * ranks by (refusals, or the chosen verdict), busiest first.
 */
export type BusiestRow = {
  alias: string;
  /** Every check of the agent in the period: the base of its rate. */
  checks: number;
  matched: number;
  matchedEnforced: number;
  /** How many agents drew any (the same on every row). */
  withMatches: number;
};

export type BusyApplication = {
  /** The agent id: for gateway traffic, the calling key's alias. */
  alias: string;
  /** Only where the alias is an application's key and the viewer may open it. */
  application: ApplicationRef | null;
  matched: ModeSplit;
  checks: number;
  /** Per 100 checks; null below the scorecard's minimum traffic. */
  per100: number | null;
};

/**
 * The agents ranked by the decisions the card counts, as read (already
 * ordered and capped), each resolved to its application where
 * `applications` knows the alias. `total` counts every agent with one.
 */
export function busiestApplications(
  rows: BusiestRow[],
  applications: Map<string, ApplicationRef> | null,
): { shown: BusyApplication[]; total: number } {
  return {
    shown: rows.map((r) => ({
      alias: r.alias,
      application: applications?.get(r.alias) ?? null,
      matched: {
        enforced: r.matchedEnforced,
        notEnforced: r.matched - r.matchedEnforced,
      },
      checks: r.checks,
      per100:
        r.checks >= SCORECARD_THRESHOLDS.minCallsForRates
          ? (100 * r.matched) / r.checks
          : null,
    })),
    total: rows[0]?.withMatches ?? 0,
  };
}

/** A caller the application filter can choose: busiest first, as read. */
export type CallerOption = {
  alias: string;
  checks: number;
  application: ApplicationRef | null;
};

export function callerOptions(
  rows: { agentId: string; _count: { _all: number } }[],
  applications: Map<string, ApplicationRef> | null,
): CallerOption[] {
  return rows.map((r) => ({
    alias: r.agentId,
    checks: r._count._all,
    application: applications?.get(r.agentId) ?? null,
  }));
}

/**
 * The personal-data entity types the page names. Anything else the database
 * counts as "OTHER" (the SQL maps an unknown type there before it leaves
 * the database), and this keeps to the same list, so no stored text other
 * than a known type name reaches the page.
 */
export const ENTITY_TYPES = [...ALL_PII_ENTITIES, "OTHER"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** At most one row per entity type the page names. */
export const ENTITY_TYPES_SHOWN = ENTITY_TYPES.length;

export type EntityTypeCount = { type: EntityType; count: number };

function entityType(value: unknown): EntityType {
  return typeof value === "string" &&
    (ENTITY_TYPES as readonly string[]).includes(value)
    ? (value as EntityType)
    : "OTHER";
}

/**
 * Redactions per personal-data entity type, from the database's own
 * (type, count) rows: only the type and the count of each row are read, an
 * unknown type counts as "OTHER", and the result is most frequent first,
 * ties in the list's order. A redaction can find more than one type.
 */
export function entityTypeCounts(
  rows: { type: unknown; count: unknown }[],
): EntityTypeCount[] {
  const counts = new Map<EntityType, number>();
  for (const r of rows) {
    const n =
      typeof r.count === "number" && Number.isFinite(r.count) && r.count > 0
        ? Math.floor(r.count)
        : 0;
    if (n === 0) continue;
    const type = entityType(r.type);
    counts.set(type, (counts.get(type) ?? 0) + n);
  }
  return ENTITY_TYPES.flatMap((type) => {
    const count = counts.get(type) ?? 0;
    return count > 0 ? [{ type, count }] : [];
  }).sort((a, b) => b.count - a.count);
}

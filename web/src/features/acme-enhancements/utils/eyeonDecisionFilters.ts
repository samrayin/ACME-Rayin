/**
 * ACME (CHG-2026-137, ADR-0027): the EYEON Guardrail decisions page's
 * filters, as a link carries them and as the server accepts them.
 *
 * The page keeps its period and filters in the URL query, so a filtered view
 * can be shared. The router's zod schema takes its values from here, so a
 * link and the server agree on what a filter may say; anything else in a
 * link is ignored by the page and refused by the server. No server imports
 * with side effects: this runs in the browser. Pure functions, tested
 * without a browser.
 *
 * - direction: prompts (checked on the way in) or answers (on the way out);
 * - verdict: what the guardrail decided, whether or not it was applied;
 * - caller: one agent id, for gateway traffic the calling key's alias;
 * - policyType: the Applications scorecard's type of the policy label. Only
 *   refusals and redactions carry a policy label, so allowed checks and
 *   checks without a verdict drop out while a type is chosen;
 * - applied: decided in enforce mode (applied), or in record mode or with no
 *   reported mode (recorded only). Only a reported enforce counts as applied
 *   (CHG-2026-116).
 */
import {
  THREAT_TYPES,
  THREAT_TYPE_LABEL,
  type ThreatType,
} from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";
import { GUARDRAIL_AGENT_MAX_LENGTH } from "@/src/features/acme-enhancements/utils/guardrailAgentLink";
import { guardrailVerdictLabel } from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";

export const WINDOW_DAYS = [7, 30] as const;
export type WindowDays = (typeof WINDOW_DAYS)[number];

export const DIRECTION_FILTERS = ["prompts", "answers"] as const;
export type DirectionFilter = (typeof DIRECTION_FILTERS)[number];

export const VERDICT_FILTERS = [
  "allow",
  "block",
  "redact",
  "unavailable",
] as const;
export type VerdictFilter = (typeof VERDICT_FILTERS)[number];

export const APPLIED_FILTERS = ["applied", "recorded"] as const;
export type AppliedFilter = (typeof APPLIED_FILTERS)[number];

export const POLICY_TYPE_FILTERS = THREAT_TYPES;
export type PolicyTypeFilter = ThreatType;

/** The longest caller id a filter accepts: the decision log's own limit. */
export const CALLER_FILTER_MAX_LENGTH = GUARDRAIL_AGENT_MAX_LENGTH;

export type DecisionFilters = {
  direction?: DirectionFilter;
  verdict?: VerdictFilter;
  caller?: string;
  policyType?: PolicyTypeFilter;
  applied?: AppliedFilter;
};

export type DecisionView = { windowDays: WindowDays; filters: DecisionFilters };

/** The URL query's name for each part of the view. */
const PARAM = {
  windowDays: "days",
  direction: "direction",
  verdict: "verdict",
  caller: "caller",
  policyType: "policy",
  applied: "applied",
} as const;

/** Every query key the view owns, so a link keeps the others it carries. */
export const DECISION_VIEW_PARAMS: readonly string[] = Object.values(PARAM);

function one(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | undefined {
  const v = one(value);
  return v !== undefined && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : undefined;
}

/**
 * The view a URL query names. A value the page does not know is ignored
 * rather than guessed, so a mistyped link shows the unfiltered page.
 */
export function parseDecisionView(
  query: Record<string, string | string[] | undefined>,
): DecisionView {
  const caller = one(query[PARAM.caller])?.trim();
  const filters: DecisionFilters = {
    direction: oneOf(DIRECTION_FILTERS, query[PARAM.direction]),
    verdict: oneOf(VERDICT_FILTERS, query[PARAM.verdict]),
    caller:
      caller && caller.length <= CALLER_FILTER_MAX_LENGTH ? caller : undefined,
    policyType: oneOf(POLICY_TYPE_FILTERS, query[PARAM.policyType]),
    applied: oneOf(APPLIED_FILTERS, query[PARAM.applied]),
  };
  return {
    windowDays: one(query[PARAM.windowDays]) === "30" ? 30 : 7,
    filters: withoutEmpty(filters),
  };
}

function withoutEmpty(filters: DecisionFilters): DecisionFilters {
  const out: DecisionFilters = {};
  if (filters.direction) out.direction = filters.direction;
  if (filters.verdict) out.verdict = filters.verdict;
  if (filters.caller) out.caller = filters.caller;
  if (filters.policyType) out.policyType = filters.policyType;
  if (filters.applied) out.applied = filters.applied;
  return out;
}

/**
 * The query for a view: `base` (the route's own parameters and any other
 * the link carries) with the view's parameters replaced. A default (7 days,
 * or a filter not set) is left out, so the plain page has a plain URL.
 */
export function decisionViewQuery(
  base: Record<string, string | string[] | undefined>,
  view: DecisionView,
): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !DECISION_VIEW_PARAMS.includes(key))
      query[key] = value;
  }
  if (view.windowDays !== 7) query[PARAM.windowDays] = String(view.windowDays);
  const f = withoutEmpty(view.filters);
  if (f.direction) query[PARAM.direction] = f.direction;
  if (f.verdict) query[PARAM.verdict] = f.verdict;
  if (f.caller) query[PARAM.caller] = f.caller;
  if (f.policyType) query[PARAM.policyType] = f.policyType;
  if (f.applied) query[PARAM.applied] = f.applied;
  return query;
}

/**
 * Whether a filter narrows which decisions count (direction, verdict, type
 * or mode), as opposed to whose (the caller). Rates per 100 checks keep
 * every check of the period and caller as their base.
 */
export function hasKindFilter(filters: DecisionFilters): boolean {
  return Boolean(
    filters.direction ||
    filters.verdict ||
    filters.policyType ||
    filters.applied,
  );
}

export function isFiltered(filters: DecisionFilters): boolean {
  return hasKindFilter(filters) || Boolean(filters.caller);
}

/** The filters without the ones named. */
export function withoutFilters(
  filters: DecisionFilters,
  keys: readonly (keyof DecisionFilters)[],
): DecisionFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([key]) => !(keys as readonly string[]).includes(key),
    ),
  ) as DecisionFilters;
}

export const DIRECTION_FILTER_LABEL: Record<DirectionFilter, string> = {
  prompts: "Prompts (on the way in)",
  answers: "Answers (on the way out)",
};

export const APPLIED_FILTER_LABEL: Record<AppliedFilter, string> = {
  applied: "Applied: enforce mode",
  recorded: "Recorded only: record mode or none",
};

export function policyTypeFilterLabel(type: PolicyTypeFilter): string {
  return THREAT_TYPE_LABEL[type];
}

/**
 * A verdict in the decision log's words, as far as the mode filter allows:
 * "Blocked" only for applied decisions, "Would block" for recorded ones,
 * and both while either may be in view (CHG-2026-116).
 */
export function verdictFilterLabel(
  verdict: VerdictFilter,
  applied: AppliedFilter | undefined,
): string {
  if (verdict === "allow" || verdict === "unavailable")
    return guardrailVerdictLabel(verdict, null).label;
  const appliedWord = guardrailVerdictLabel(verdict, "enforce").label;
  const recordedWord = guardrailVerdictLabel(verdict, null).label;
  if (applied === "applied") return appliedWord;
  if (applied === "recorded") return recordedWord;
  return `${appliedWord} or ${recordedWord.toLowerCase()}`;
}

/** The active filters in words, in the filter bar's order. */
export function describeFilters(
  filters: DecisionFilters,
  callerName?: string,
): string[] {
  const parts: string[] = [];
  if (filters.direction)
    parts.push(filters.direction === "prompts" ? "Prompts" : "Answers");
  if (filters.verdict)
    parts.push(verdictFilterLabel(filters.verdict, filters.applied));
  if (filters.caller) parts.push(`Caller ${callerName ?? filters.caller}`);
  if (filters.policyType)
    parts.push(`Policy type ${policyTypeFilterLabel(filters.policyType)}`);
  if (filters.applied)
    parts.push(
      filters.applied === "applied" ? "Applied only" : "Recorded only",
    );
  return parts;
}

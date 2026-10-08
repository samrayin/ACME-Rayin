/**
 * ACME (CHG-2026-137, ADR-0027): the EYEON Guardrail decisions page's
 * decision flow, after the prototype's: checks, then direction, then the
 * guardrail's verdict, then whether the gateway applied it or only recorded
 * it. Built from the page's figures by direction, so it always agrees with
 * the "Prompts and answers" card; pure functions, tested without a browser.
 *
 * The last step says "Blocked" or "Redacted" only for a decision made in
 * enforce mode, and "Would block" or "Would redact" otherwise (CHG-2026-116),
 * with the words of guardrailVerdictLabel. Allowed checks and checks
 * without a verdict end at the verdict.
 */
import { guardrailVerdictLabel } from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";
import {
  type DecisionFilters,
  type DirectionFilter,
  type VerdictFilter,
  withoutFilters,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFilters";

type ModeSplit = { enforced: number; notEnforced: number };

type DirectionDecisions = {
  checks: number;
  allowed: number;
  blocked: ModeSplit;
  redacted: ModeSplit;
  noVerdict: number;
};

type Tone = "allow" | "redact" | "block" | "neutral";

export type FlowNodeId =
  | "checks"
  | DirectionFilter
  | VerdictFilter
  | "blocked"
  | "wouldBlock"
  | "redacted"
  | "wouldRedact";

export type DecisionFlowNode = {
  id: FlowNodeId;
  column: number;
  name: string;
  value: number;
  tone: Tone;
  muted?: boolean;
  selected?: boolean;
};

export const DECISION_FLOW_COLUMNS = [
  "Checks",
  "Direction",
  "Verdict",
  "Applied or recorded",
];

function total(s: ModeSplit): number {
  return s.enforced + s.notEnforced;
}

/**
 * What each step of the flow selects on the page, when pressed. The first
 * step clears the filters on what was decided; the caller stays.
 */
const STEP_FILTERS: Record<FlowNodeId, Partial<DecisionFilters>> = {
  checks: {},
  prompts: { direction: "prompts" },
  answers: { direction: "answers" },
  allow: { verdict: "allow" },
  block: { verdict: "block" },
  redact: { verdict: "redact" },
  unavailable: { verdict: "unavailable" },
  blocked: { verdict: "block", applied: "applied" },
  wouldBlock: { verdict: "block", applied: "recorded" },
  redacted: { verdict: "redact", applied: "applied" },
  wouldRedact: { verdict: "redact", applied: "recorded" },
};

/** The filters on what was decided, apart from the caller. */
const KIND_KEYS = ["direction", "verdict", "policyType", "applied"] as const;

function isSelected(id: FlowNodeId, f: DecisionFilters): boolean {
  const step = STEP_FILTERS[id];
  const keys = Object.keys(step) as (keyof DecisionFilters)[];
  if (keys.length === 0) return false;
  return keys.every((k) => f[k] === step[k]);
}

/**
 * The filters after pressing a step: its selection replaces the same
 * filters, or, when it is already selected, clears them. The first step
 * clears every filter on what was decided.
 */
export function filtersForStep(
  id: FlowNodeId,
  f: DecisionFilters,
): DecisionFilters {
  const step = STEP_FILTERS[id];
  const keys = Object.keys(step) as (keyof DecisionFilters)[];
  if (keys.length === 0) return withoutFilters(f, KIND_KEYS);
  if (isSelected(id, f)) return withoutFilters(f, keys);
  return { ...f, ...step };
}

/**
 * The flow's nodes, links and accessible name, from the decisions by
 * direction (those that match the filters). `filtered` names the first
 * step "Matching decisions" rather than "Checks".
 */
export function decisionFlow(p: {
  prompts: DirectionDecisions;
  answers: DirectionDecisions;
  filters: DecisionFilters;
  period: string;
}): {
  nodes: DecisionFlowNode[];
  links: { source: FlowNodeId; target: FlowNodeId; value: number }[];
  total: number;
  label: string;
} {
  const { prompts: pr, answers: an, filters: f } = p;
  const filtered = Boolean(
    f.direction || f.verdict || f.policyType || f.applied,
  );
  const checks = pr.checks + an.checks;
  const allowed = pr.allowed + an.allowed;
  const blocked = {
    enforced: pr.blocked.enforced + an.blocked.enforced,
    notEnforced: pr.blocked.notEnforced + an.blocked.notEnforced,
  };
  const redacted = {
    enforced: pr.redacted.enforced + an.redacted.enforced,
    notEnforced: pr.redacted.notEnforced + an.redacted.notEnforced,
  };
  const noVerdict = pr.noVerdict + an.noVerdict;
  const word = (action: "block" | "redact", mode: "enforce" | null) =>
    guardrailVerdictLabel(action, mode).label;

  const raw: Omit<DecisionFlowNode, "selected">[] = [
    {
      id: "checks",
      column: 0,
      name: filtered ? "Matching decisions" : "Checks",
      value: checks,
      tone: "neutral",
    },
    {
      id: "prompts",
      column: 1,
      name: "Prompts",
      value: pr.checks,
      tone: "neutral",
    },
    {
      id: "answers",
      column: 1,
      name: "Answers",
      value: an.checks,
      tone: "neutral",
    },
    { id: "allow", column: 2, name: "Allowed", value: allowed, tone: "allow" },
    {
      id: "block",
      column: 2,
      name: "Block verdict",
      value: total(blocked),
      tone: "block",
    },
    {
      id: "redact",
      column: 2,
      name: "Redact verdict",
      value: total(redacted),
      tone: "redact",
    },
    {
      id: "unavailable",
      column: 2,
      name: "No verdict",
      value: noVerdict,
      tone: "neutral",
    },
    {
      id: "blocked",
      column: 3,
      name: word("block", "enforce"),
      value: blocked.enforced,
      tone: "block",
    },
    {
      id: "wouldBlock",
      column: 3,
      name: word("block", null),
      value: blocked.notEnforced,
      tone: "block",
      muted: true,
    },
    {
      id: "redacted",
      column: 3,
      name: word("redact", "enforce"),
      value: redacted.enforced,
      tone: "redact",
    },
    {
      id: "wouldRedact",
      column: 3,
      name: word("redact", null),
      value: redacted.notEnforced,
      tone: "redact",
      muted: true,
    },
  ];
  const nodes = raw.map((n) => ({ ...n, selected: isSelected(n.id, f) }));

  const sides = [
    ["prompts", pr],
    ["answers", an],
  ] as const;
  const links = [
    { source: "checks" as const, target: "prompts" as const, value: pr.checks },
    { source: "checks" as const, target: "answers" as const, value: an.checks },
    ...sides.flatMap(([id, d]) => [
      { source: id, target: "allow" as const, value: d.allowed },
      { source: id, target: "block" as const, value: total(d.blocked) },
      { source: id, target: "redact" as const, value: total(d.redacted) },
      { source: id, target: "unavailable" as const, value: d.noVerdict },
    ]),
    {
      source: "block" as const,
      target: "blocked" as const,
      value: blocked.enforced,
    },
    {
      source: "block" as const,
      target: "wouldBlock" as const,
      value: blocked.notEnforced,
    },
    {
      source: "redact" as const,
      target: "redacted" as const,
      value: redacted.enforced,
    },
    {
      source: "redact" as const,
      target: "wouldRedact" as const,
      value: redacted.notEnforced,
    },
  ];

  const n = (v: number) => v.toLocaleString();
  const label =
    `Decision flow, ${p.period}: ${n(checks)} ${filtered ? "matching decisions" : "checks"}; ` +
    `${n(pr.checks)} prompts and ${n(an.checks)} answers; ` +
    `${n(allowed)} allowed; ` +
    `${n(total(blocked))} block verdicts (${n(blocked.enforced)} ${word("block", "enforce").toLowerCase()}, ${n(blocked.notEnforced)} ${word("block", null).toLowerCase()}); ` +
    `${n(total(redacted))} redact verdicts (${n(redacted.enforced)} ${word("redact", "enforce").toLowerCase()}, ${n(redacted.notEnforced)} ${word("redact", null).toLowerCase()}); ` +
    `${n(noVerdict)} without a verdict.`;

  return { nodes, links, total: checks, label };
}

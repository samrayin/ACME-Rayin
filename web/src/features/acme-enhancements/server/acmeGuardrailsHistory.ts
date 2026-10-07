/**
 * ACME enhancement: the guardrail event history (ADR-0013). Every guardrail
 * decision is kept in `AcmeGuardrailEvent`; these helpers turn the history
 * view's filters into a Prisma `where`, shared by the paged list and the CSV
 * export so both always select the same rows.
 */
import { z } from "zod";
import {
  AcmeGuardrailEventAction,
  AcmeGuardrailEventDirection,
  type Prisma,
} from "@langfuse/shared/src/db";
import {
  GUARDRAIL_AGENT_MAX_LENGTH,
  GUARDRAIL_AGENTS_MAX,
} from "@/src/features/acme-enhancements/utils/guardrailAgentLink";

/**
 * Agent names used by CAIRO's own guardrail test runs (the promptfoo suites
 * and one-off probes). Hidden only when a viewer asks: agent names are set by
 * the caller, so hiding them by default would let anyone keep events out of
 * the default view by choosing such a name.
 */
export const TEST_TRAFFIC_AGENT_PREFIXES = ["promptfoo-", "guard-probe-"];

/** The most rows one CSV export returns. */
export const GUARDRAIL_EXPORT_MAX_ROWS = 10_000;

export const GuardrailHistoryFilterSchema = z.object({
  /** Inclusive lower bound on the decision time. */
  from: z.date().optional(),
  /** Exclusive upper bound on the decision time. */
  to: z.date().optional(),
  actions: z
    .array(z.enum(["allow", "redact", "block", "unavailable"]))
    .max(4)
    .optional(),
  direction: z.enum(["input", "output"]).optional(),
  /** Case-insensitive substring of the agent id. */
  agent: z.string().trim().max(200).optional(),
  /**
   * ACME (CHG-2026-125, ADR-0023 §3.5): the agent id is exactly one of
   * these, so a link can show every key of one application, a rotated key's
   * earlier generations included. Combined with the other filters like them.
   */
  agents: z
    .array(z.string().trim().min(1).max(GUARDRAIL_AGENT_MAX_LENGTH))
    .min(1)
    .max(GUARDRAIL_AGENTS_MAX)
    .optional(),
  /** Case-insensitive substring of the user id. */
  user: z.string().trim().max(200).optional(),
  hideTestTraffic: z.boolean().default(false),
});

type GuardrailHistoryFilter = z.infer<typeof GuardrailHistoryFilterSchema>;

const ACTION_TO_DB: Record<
  "allow" | "redact" | "block" | "unavailable",
  AcmeGuardrailEventAction
> = {
  allow: AcmeGuardrailEventAction.ALLOW,
  redact: AcmeGuardrailEventAction.REDACT,
  block: AcmeGuardrailEventAction.BLOCK,
  unavailable: AcmeGuardrailEventAction.UNAVAILABLE,
};

const DIRECTION_TO_DB: Record<"input" | "output", AcmeGuardrailEventDirection> =
  {
    input: AcmeGuardrailEventDirection.INPUT,
    output: AcmeGuardrailEventDirection.OUTPUT,
  };

const isTestTraffic: Prisma.AcmeGuardrailEventWhereInput = {
  OR: TEST_TRAFFIC_AGENT_PREFIXES.map((prefix) => ({
    agentId: { startsWith: prefix },
  })),
};

function filterConditions(
  filter: GuardrailHistoryFilter,
): Prisma.AcmeGuardrailEventWhereInput[] {
  const conditions: Prisma.AcmeGuardrailEventWhereInput[] = [];
  if (filter.from || filter.to) {
    conditions.push({
      eventTime: {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lt: filter.to } : {}),
      },
    });
  }
  if (filter.actions && filter.actions.length > 0) {
    conditions.push({
      action: { in: filter.actions.map((action) => ACTION_TO_DB[action]) },
    });
  }
  if (filter.direction) {
    conditions.push({ direction: DIRECTION_TO_DB[filter.direction] });
  }
  if (filter.agent) {
    conditions.push({
      agentId: { contains: filter.agent, mode: "insensitive" },
    });
  }
  if (filter.agents) {
    conditions.push({ agentId: { in: filter.agents } });
  }
  if (filter.user) {
    conditions.push({ userId: { contains: filter.user, mode: "insensitive" } });
  }
  return conditions;
}

/** The rows the history view and the export show for `filter`. */
export function buildHistoryWhere(
  projectId: string,
  filter: GuardrailHistoryFilter,
): Prisma.AcmeGuardrailEventWhereInput {
  const conditions = filterConditions(filter);
  if (filter.hideTestTraffic) conditions.push({ NOT: isTestTraffic });
  return { projectId, AND: conditions };
}

/**
 * The test-traffic rows that `filter` would otherwise match, so the view can
 * say how many it is hiding. Null when test traffic is not hidden.
 */
export function buildHiddenTestTrafficWhere(
  projectId: string,
  filter: GuardrailHistoryFilter,
): Prisma.AcmeGuardrailEventWhereInput | null {
  if (!filter.hideTestTraffic) return null;
  return { projectId, AND: [...filterConditions(filter), isTestTraffic] };
}

/**
 * The history view's counts, from a groupBy on action and gateway mode.
 * `blocked` and `redacted` count every such verdict; the `...Enforced` counts
 * only those the gateway applied, which it reports as mode "enforce". The
 * rest were recorded and let through (CHG-2026-116).
 */
export function countHistoryVerdicts(
  groups: {
    action: AcmeGuardrailEventAction;
    gatewayMode: string | null;
    _count: { _all: number };
  }[],
) {
  const counts = {
    total: 0,
    blocked: 0,
    blockedEnforced: 0,
    redacted: 0,
    redactedEnforced: 0,
    allowed: 0,
    unavailable: 0,
  };
  for (const group of groups) {
    const n = group._count._all;
    const enforced = group.gatewayMode === "enforce";
    counts.total += n;
    if (group.action === AcmeGuardrailEventAction.BLOCK) {
      counts.blocked += n;
      if (enforced) counts.blockedEnforced += n;
    }
    if (group.action === AcmeGuardrailEventAction.REDACT) {
      counts.redacted += n;
      if (enforced) counts.redactedEnforced += n;
    }
    if (group.action === AcmeGuardrailEventAction.ALLOW) counts.allowed += n;
    if (group.action === AcmeGuardrailEventAction.UNAVAILABLE)
      counts.unavailable += n;
  }
  return counts;
}

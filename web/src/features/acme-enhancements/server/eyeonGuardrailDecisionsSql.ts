/**
 * ACME (CHG-2026-137, ADR-0027): the raw SQL of the EYEON Guardrail
 * decisions page, with its filters.
 *
 * Bound parameters only. A filter's value never becomes SQL text: direction,
 * verdict and mode pick one of the fixed conditions below, and the caller
 * and the policy labels are bound parameters. Every statement is scoped to
 * one project and the period, and reads the metadata columns only, except
 * the personal-data types, which read each finding's entity type and nothing
 * else of it, inside the database: only a known type name (or "OTHER") and a
 * count leave it.
 *
 * Only a reported "enforce" counts as applied (CHG-2026-116): a decision in
 * record mode, or with no mode reported, is recorded only.
 */
import { Prisma } from "@langfuse/shared/src/db";
import { ALL_PII_ENTITIES } from "@/src/features/acme-enhancements/server/acmeGuardrailSettings";
import {
  type AppliedFilter,
  type DecisionFilters,
  type DirectionFilter,
  type VerdictFilter,
} from "@/src/features/acme-enhancements/utils/eyeonDecisionFilters";
import { ENTITY_TYPES_SHOWN } from "@/src/features/acme-enhancements/server/eyeonGuardrailDecisions";

const DIRECTION_SQL: Record<DirectionFilter, Prisma.Sql> = {
  prompts: Prisma.sql`direction = 'input'`,
  answers: Prisma.sql`direction = 'output'`,
};

const VERDICT_SQL: Record<VerdictFilter, Prisma.Sql> = {
  allow: Prisma.sql`action = 'allow'`,
  block: Prisma.sql`action = 'block'`,
  redact: Prisma.sql`action = 'redact'`,
  unavailable: Prisma.sql`action = 'unavailable'`,
};

const APPLIED_SQL: Record<AppliedFilter, Prisma.Sql> = {
  applied: Prisma.sql`gateway_mode = 'enforce'`,
  recorded: Prisma.sql`gateway_mode IS DISTINCT FROM 'enforce'`,
};

/**
 * The labels of the chosen policy type, decided by the scorecard's mapping
 * on the grouped read (policyLabelsOf); null without a policy type filter.
 */
export type PolicyLabels = { labels: string[]; withMissing: boolean } | null;

function policySql(policy: NonNullable<PolicyLabels>): Prisma.Sql {
  // Only refusals and redactions carry a policy label.
  const labelled = Prisma.sql`action IN ('block', 'redact')`;
  const hasLabels = policy.labels.length > 0;
  if (!hasLabels && !policy.withMissing) return Prisma.sql`FALSE`;
  if (!hasLabels) return Prisma.sql`${labelled} AND policy_triggered IS NULL`;
  const listed = Prisma.sql`policy_triggered = ANY(${policy.labels}::text[])`;
  return policy.withMissing
    ? Prisma.sql`${labelled} AND (policy_triggered IS NULL OR ${listed})`
    : Prisma.sql`${labelled} AND ${listed}`;
}

/**
 * The filters on what was decided (direction, verdict, mode, policy type) as
 * one condition; TRUE without any. The caller is part of the scope instead
 * (callerScopeSql), so a rate per 100 checks keeps every check as its base.
 */
export function kindConditionSql(
  f: DecisionFilters,
  policy: PolicyLabels,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.direction) parts.push(DIRECTION_SQL[f.direction]);
  if (f.verdict) parts.push(VERDICT_SQL[f.verdict]);
  if (f.applied) parts.push(APPLIED_SQL[f.applied]);
  if (policy) parts.push(policySql(policy));
  if (parts.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(
    parts.map((p) => Prisma.sql`(${p})`),
    " AND ",
  );
}

/** The chosen caller, as a bound parameter; nothing without one. */
export function callerScopeSql(caller: string | undefined): Prisma.Sql {
  return caller ? Prisma.sql`AND agent_id = ${caller}` : Prisma.empty;
}

type Scope = {
  projectId: string;
  /** Inclusive bounds, as UTC (timestamps are stored without a zone). */
  from: Date;
  until: Date;
  caller: string | undefined;
};

function scopeSql(s: Scope): Prisma.Sql {
  return Prisma.sql`project_id = ${s.projectId}
              AND event_time >= ${s.from.toISOString()}::timestamp
              AND event_time <= ${s.until.toISOString()}::timestamp
              ${callerScopeSql(s.caller)}`;
}

/**
 * One row per UTC day: every check of the day in scope and how many were
 * decided in enforce mode (the base of a rate, and the gateway's mode that
 * day), then the decisions that match the filters, by verdict, applied
 * apart from recorded. CHG-2026-137 follow-up, for the KPI tiles' charts:
 * also the matching decisions and how many of them were decided in enforce
 * mode, and the matching block verdicts on prompts and on answers. Counts
 * of metadata columns only (direction, action, mode), as before.
 */
export function dailySql(s: Scope, kind: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT to_char(date_trunc('day', event_time), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS checks,
           (COUNT(*) FILTER (WHERE gateway_mode = 'enforce'))::int AS "enforcedChecks",
           (COUNT(*) FILTER (WHERE ${kind}))::int AS matching,
           (COUNT(*) FILTER (WHERE ${kind} AND gateway_mode = 'enforce'))::int AS "matchingEnforced",
           (COUNT(*) FILTER (WHERE ${kind} AND action = 'block' AND direction = 'input'))::int AS "promptsRefused",
           (COUNT(*) FILTER (WHERE ${kind} AND action = 'block' AND direction = 'output'))::int AS "answersWithheld",
           (COUNT(*) FILTER (WHERE ${kind} AND action = 'allow'))::int AS allowed,
           (COUNT(*) FILTER (WHERE ${kind} AND action = 'block' AND gateway_mode = 'enforce'))::int AS blocked,
           (COUNT(*) FILTER (WHERE ${kind} AND action = 'block' AND gateway_mode IS DISTINCT FROM 'enforce'))::int AS "wouldBlock",
           (COUNT(*) FILTER (WHERE ${kind} AND action = 'redact' AND gateway_mode = 'enforce'))::int AS redacted,
           (COUNT(*) FILTER (WHERE ${kind} AND action = 'redact' AND gateway_mode IS DISTINCT FROM 'enforce'))::int AS "wouldRedact",
           (COUNT(*) FILTER (WHERE ${kind} AND action = 'unavailable'))::int AS "noVerdict"
    FROM acme_guardrail_events
    WHERE ${scopeSql(s)}
    GROUP BY 1`;
}

/**
 * The agents with the most decisions of one verdict that match the filters
 * (refusals unless a verdict is chosen), capped in the database, with every
 * check of each as the base of its rate, and how many agents had any.
 */
export function busiestSql(
  s: Scope,
  kind: Prisma.Sql,
  verdict: VerdictFilter,
  limit: number,
): Prisma.Sql {
  const counted = Prisma.sql`${VERDICT_SQL[verdict]} AND ${kind}`;
  return Prisma.sql`
    SELECT agent_id AS alias,
           COUNT(*)::int AS checks,
           (COUNT(*) FILTER (WHERE ${counted}))::int AS matched,
           (COUNT(*) FILTER (WHERE ${counted} AND gateway_mode = 'enforce'))::int AS "matchedEnforced",
           (COUNT(*) OVER ())::int AS "withMatches"
    FROM acme_guardrail_events
    WHERE ${scopeSql(s)}
    GROUP BY agent_id
    HAVING COUNT(*) FILTER (WHERE ${counted}) > 0
    ORDER BY matched DESC, alias ASC
    LIMIT ${limit}`;
}

/**
 * Redactions per personal-data entity type, counted in the database. Each
 * finding is read for its entity type only; a type not in the deployment's
 * list (ALL_PII_ENTITIES) becomes 'OTHER' before it leaves the database, so
 * only a known type name and a count are returned. A finding's position,
 * score or text is never selected, and neither is the redacted text. The
 * findings are stored with redactions captured by the audit push only.
 */
export function entityTypesSql(s: Scope, kind: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT CASE WHEN finding ->> 'entity_type' IN (${Prisma.join([...ALL_PII_ENTITIES])})
                THEN finding ->> 'entity_type'
                ELSE 'OTHER' END AS type,
           COUNT(DISTINCT e.id)::int AS count
    FROM acme_guardrail_events e
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(e.pii_findings) = 'array'
           THEN e.pii_findings ELSE '[]'::jsonb END
    ) AS findings(finding)
    WHERE ${scopeSql(s)}
      AND action = 'redact'
      AND ${kind}
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
    LIMIT ${ENTITY_TYPES_SHOWN}`;
}

/**
 * ACME addition (CHG-2026-169, ADR-0033): a durable audit row for an input the
 * gateway refused in enforce mode because no guardrail verdict could be had.
 *
 * Why this exists. `acme_guardrail_events` rows are written by rayin-guardrails
 * (push) and recovered from its buffer (pull). When the guardrails service is
 * itself unreachable, nothing writes a row: the gateway hook refuses correctly
 * (HTTP 503, fail closed) but records the refusal only in its stdout health
 * line, which is not durable. The refusal IS durable in LiteLLM's spend log:
 * status `failure`, error class `CairoGuardrailBlocked`, and the gateway-authored
 * message `Blocked by cairo-guardrail (<outcome>).` (verified on the EYEON
 * recovery rehearsal, 2026-10-21). This module turns exactly those rows into
 * decision-table rows, following the owner's 2026-10-02 precedent of recording
 * no-verdict checks as `UNAVAILABLE` (migration 20261002190000).
 *
 * Why the direction is known without a hook change. In `cairo_guardrail_hook.py`
 * `_resolve`, an output refusal goes through `_withhold_answer`, which never
 * returns and raises a different exception (`CairoAnswerWithheld`, or LiteLLM's
 * response substitution). The final `raise CairoGuardrailBlocked(...)` is
 * therefore reached only for an input check. A no-verdict OUTPUT withhold is
 * out of scope here (ADR-0033 "Not covered").
 *
 * Trust. Both fields used are written by the gateway, never by the caller: the
 * exception's class name and its message. The message must match exactly, so a
 * provider error that merely mentions the guardrail does not qualify.
 * `judge_unavailable` is excluded on purpose: rayin-guardrails was up and
 * already records that case itself.
 *
 * Boundary with ADR-0009 (Proposed): that ADR's health table measures every
 * outcome, in both modes, with 14-day retention. This module records only
 * requests that were actually refused, permanently, as audit evidence.
 */
import type { Prisma } from "@prisma/client";

/** The exception class the hook raises for an input refusal. */
export const GATEWAY_REFUSAL_ERROR_CLASS = "CairoGuardrailBlocked";

/** No-verdict outcomes the gateway alone can witness. */
export const GATEWAY_NO_VERDICT_OUTCOMES = [
  "guard_unavailable",
  "guard_unreadable",
  "settings_unusable",
] as const;
export type GatewayNoVerdictOutcome =
  (typeof GATEWAY_NO_VERDICT_OUTCOMES)[number];

/** `Blocked by cairo-guardrail (guard_unavailable).` -- the whole message. */
const REFUSAL_MESSAGE =
  /^Blocked by cairo-guardrail \((guard_unavailable|guard_unreadable|settings_unusable)\)\.$/;

/** Prefix of every row this module writes; the rest is the LiteLLM call id. */
export const GATEWAY_REFUSAL_EVENT_ID_PREFIX = "gateway-refusal:";

/** The few spend-log fields this module reads (a subset of reconcileCore's). */
export type GatewayRefusalSpendLogRow = {
  startTime: string;
  status?: string | null;
  metadata?: {
    litellm_call_id?: string | null;
    status?: string | null;
    user_api_key_alias?: string | null;
    error_information?: {
      error_class?: string | null;
      error_message?: string | null;
    } | null;
  } | null;
};

/** The outcome code when the row is a no-verdict input refusal, else null. */
export function gatewayRefusalOutcome(
  row: GatewayRefusalSpendLogRow,
): GatewayNoVerdictOutcome | null {
  const status = row.status ?? row.metadata?.status ?? null;
  if (status !== "failure") return null;
  const info = row.metadata?.error_information;
  if (info?.error_class !== GATEWAY_REFUSAL_ERROR_CLASS) return null;
  const message = (info.error_message ?? "").trim();
  const match = REFUSAL_MESSAGE.exec(message);
  return match ? (match[1] as GatewayNoVerdictOutcome) : null;
}

/**
 * Rows for `prisma.acmeGuardrailEvent.createMany({ skipDuplicates: true })`.
 * `parseTime` is injected so this module keeps no date-format rules of its own
 * (reconcileCore's `parseUtc` reads LiteLLM's zoneless timestamps as UTC).
 * A row without a call id or a readable time is skipped and counted: the event
 * id is the idempotency key, and a row that cannot have one is not written.
 */
export function selectGatewayRefusalRows(
  rows: GatewayRefusalSpendLogRow[],
  projectId: string,
  parseTime: (value: string) => Date | null,
): {
  rows: Prisma.AcmeGuardrailEventCreateManyInput[];
  skipped: number;
} {
  const out: Prisma.AcmeGuardrailEventCreateManyInput[] = [];
  let skipped = 0;
  for (const row of rows) {
    const outcome = gatewayRefusalOutcome(row);
    if (outcome === null) continue;
    const callId = row.metadata?.litellm_call_id;
    const eventTime = parseTime(row.startTime);
    if (!callId || eventTime === null) {
      skipped += 1;
      continue;
    }
    out.push({
      projectId,
      eventTime,
      // The same attribution the push path uses: the gateway key's alias.
      agentId: row.metadata?.user_api_key_alias || "unknown-key",
      // The hook sends the LiteLLM call id as the guardrail trace id, so this
      // joins with acme_litellm_request_logs.litellm_call_id.
      traceId: callId,
      direction: "INPUT",
      action: "UNAVAILABLE",
      policyTriggered: outcome,
      eventId: `${GATEWAY_REFUSAL_EVENT_ID_PREFIX}${callId}`,
      source: "GATEWAY",
      // A refusal happens only in enforce mode; the settings version that
      // decided it is not in the spend log, so it is left unknown.
      gatewayMode: "enforce",
    });
  }
  return { rows: out, skipped };
}

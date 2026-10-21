# ADR-0033 — Durable audit of refusals made while no guardrail verdict could be had

| | |
|---|---|
| **Change ID** | CHG-2026-169 |
| **Owner** | Anees Ur Rahman |
| **Affected release** | next console and worker release after `acme-v4.38.0.58` |
| **Status** | Proposed |
| **Type** | Forward (owner decision 2026-10-21: "option 3", this narrow fix first, ADR-0009 later on its own timeline) |
| **Date** | 2026-10-21 |
| **Author** | Claude Code session (EYEON on-prem recovery rehearsal), for the owner |
| **Approval** | Pending |
| **Related** | ADR-0005-B §3.3.1 and migration `20261002190000` (no-verdict checks recorded as `UNAVAILABLE`, owner decision 2026-10-02) · ADR-0009 (Proposed: guardrail health table) · CHG-2026-098 (guardrail backfill job) · Ledger **P0-10** |

## 1. Purpose
In enforce mode, when rayin-guardrails is unreachable (or its answer is unreadable, or its settings unusable), the gateway hook
refuses the request correctly (HTTP 503, fail closed) but **no row reaches `acme_guardrail_events`**: rows are written only by
rayin-guardrails, which is the service that is down. The refusal is recorded only in the hook's stdout health line (rotated, not
collected). Found on the EYEON recovery rehearsal, 2026-10-21 (call `1ee5a8ca…`; the verdict-based block `699f0884…` minutes
earlier did get its row).

## 2. Scope
**In:** input requests refused in enforce mode with outcome `guard_unavailable`, `guard_unreadable` or `settings_unusable`.
**Out:** `judge_unavailable` (rayin-guardrails is up and already records it); a no-verdict **output** withhold (raised as
`CairoAnswerWithheld`, its outcome is not in the spend log; it needs guardrails to fail between the two checks of one request);
record-mode outages that let the request through (ADR-0009's health table, 14-day retention, measures those); alerting.

## 3. Decision
The worker's existing LiteLLM reconcile pass (CHG-2026-008), which already reads every spend-log row in an overlapping window,
hands each page to a pure selector (`acmeGuardrailGatewayRefusals.ts`). A row qualifies only if **all** hold: status `failure`;
error class `CairoGuardrailBlocked` (the hook's exception); error message **exactly** `Blocked by cairo-guardrail (<outcome>).`
for one of the three outcomes. Both fields are written by the gateway, never by the caller. Each qualifying row becomes one
decision-table row: `direction INPUT` (the final `raise CairoGuardrailBlocked` in `_resolve` is reached only for input; output
goes through `_withhold_answer`), `action UNAVAILABLE`, `policyTriggered` = the outcome, `gatewayMode enforce`,
`traceId` = the LiteLLM call id, `eventId = gateway-refusal:<call id>`, new `source GATEWAY`. Written with
`createMany` + `skipDuplicates`, so the overlapping windows are harmless. Off by default
(`CAIRO_GUARDRAIL_REFUSAL_AUDIT_ENABLED`), filed under `CAIRO_GUARDRAIL_BACKFILL_PROJECT_ID`. A failure to write marks the
reconcile run `partial` and never stops the request-log mirror. **No change to the gateway hook or the request path**, so the
fail-closed behaviour, its status code and its timing are untouched.

Rejected: a hook change carrying the outcome in `spend_logs_metadata` (that field is null on every stored row in 1.100.1, verified
2026-10-21; not a reliable channel); building ADR-0009 first (6–10 days, gated on its §10.1 data window, and 14-day retention is
not an audit record); a new outbox in the request path (adds a write to the hot path).

Security: no prompt or response text is read or stored; only identifiers and the outcome code. The writer is the connection the
CHG-2026-098 backfill uses (S-02, the app connects as the admin login, applies to both and is out of scope).

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres schema | enum `AcmeGuardrailEventSource` gains `gateway` (additive) |
| Worker | reconcile pass gets an optional audit step; new env flag, default off |
| Web | `sourceLabel` and the event detail show "gateway" instead of mislabelling it "pull" |
| Gateway / rayin-guardrails | none |

## 5. Database change
- **Migration:** `packages/shared/prisma/migrations/20261021030000_acme_guardrail_event_source_gateway/` (one `ADD VALUE IF NOT EXISTS`)
- **Backfill:** none needed; the reconcile window (first run 7 days, then overlapping) picks up recent refusals by itself.
- **Rollback:** `acme-governance/rollback/20261021030000_acme_guardrail_event_source_gateway/` — refuses while any `gateway` row exists; no data lost.

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LiteLLM changes the error shape on upgrade | medium | refusals silently stop being audited | exact-match tests; CHANGE-PROCEDURE §1a audit of each LiteLLM bump should include `error_information` |
| Previous image reads a `gateway` row | low | console pages error | forward-fix only once such rows exist (ROLLBACK.md) |
| Audit lag | certain | ≤ one reconcile interval (5 min) plus the 2-min settle time | acceptable for audit; not an alert |

## 7. Compatibility
Backward compatible schema (additive enum value); a previous image is unaffected until a `gateway` row exists. Upstream merge risk: low
(ACME-only files plus two lines in `reconcileCore.ts`). Flag `CAIRO_GUARDRAIL_REFUSAL_AUDIT_ENABLED`, default `false`; remove the
default-off once accepted in a release.

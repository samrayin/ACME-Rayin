# ADR-0006 — Gateway tracing into CAIRO: what is written, where, what it costs in retention, and how it is turned off

| | |
|---|---|
| **Change** | CHG-2026-026 · Tier 1 · owner: Anees Ur Rahman |
| **Status** | **Proposed — design only.** No ConfigMap edit, no Secret change, no gateway restart. Gate A (§9) passed 2026-09-22: `turn_off_message_logging` confirmed, by source read, to redact before the Langfuse callback receives data. Still Proposed, not Accepted — §11's open question (metadata-only vs content-visible tracing) needs an owner answer first. |
| **Reverses** | The re-enablement conditions recorded in CHG-2026-024 (Readiness Ledger N-20) when this same callback was removed. This document is that reversal's required justification — see §7. |
| **Related** | CHG-2026-024 (removed the inert callback) · CHG-2026-009 / ADR-0003 (the *other* gateway logging path — CAIRO's own Postgres request-log mirror, a separate destination from this one) · Readiness Ledger P0-11 (no deletion path in any store) · P0-5 / CHG-2026-010 (least-privilege cutover, still not built) |
| **Blocked by** | Owner approval of this ADR. No implementation exists yet — this is the ADR, not the change. |

## 1. The problem, verified not assumed

Read from `integrations/litellm/config/litellm-config.yaml`, current `main` (CHG-2026-024,
commit `ea26df4e7`): the Langfuse callback registration was removed 2026-09-21 and replaced
with a comment recording why and the conditions for re-adding it. The comment, in full:

> Langfuse callback registration REMOVED 2026-09-21 (CHG-2026-024). It registered
> success_callback/failure_callback = ["langfuse"] while this pod carries no
> LANGFUSE_* variables, so it delivered nothing and failed silently for its entire
> life. Readiness Ledger N-20, readiness audit H-26. Removed rather than enabled,
> deliberately. Enabling is three environment variables away and would write full
> prompt and completion text into a store with no reachable purge path — retention
> requires an entitlement this OSS instance does not have (P0-11). Re-add ONLY with
> a named credential owner, an approval gate, and CHG-2026-009
> `turn_off_message_logging` in the same change.

So the prior state was not "no tracing" by design — it was a config line that had
**always been dead**, discovered dead, and removed. The actual product gap it leaves
behind: LiteLLM's own per-call token cost and latency have nowhere to land inside
CAIRO. `CLAUDE.md`'s own architecture line — "staff → App Gateway → CAIRO ◀ Postgres
audit trail · ClickHouse traces" — currently has nothing feeding the ClickHouse half
for gateway calls. CHG-2026-026 is the proposal to close that gap; CHG-2026-024 is
explicit that doing so requires meeting its three conditions **in the same change**,
not as a follow-up. This ADR is that documentation, required before any config
change (register row, CHG-2026-026).

## 2. Scope

**In:** re-registering `litellm_settings.success_callback` /
`failure_callback = ["langfuse"]`, setting `litellm_settings.turn_off_message_logging:
true` in the same edit, provisioning the four `LANGFUSE_*` pod variables under a named
credential owner, and the approval gate that authorizes the resulting gateway restart.

**Out:** CHG-2026-009's Postgres request-log mirror (a different destination, different
ADR, already designed in ADR-0003, independently gated at its own gateway-restart
step). This ADR does not re-litigate that one, but §5 below says why the two must not
be enabled out of order.

## 3. What would actually be written, and where — needs runtime verification, not assumed

**Claim, from LiteLLM's documented behaviour, not yet confirmed against this fork's
pinned version (1.100.1):** `turn_off_message_logging: true` causes the proxy to scrub
`messages` and the response's completion content before any registered callback —
Langfuse included — receives the payload. What should reach Langfuse's ingestion path
under that flag is metadata only: model name, token counts (prompt/completion/total),
computed cost, latency, HTTP status, and the caller's key/team identifiers — the same
shape of data CAIRO already handles for its own traces, not new categories of data.

**Verified 2026-09-22 against `BerriAI/litellm` tag `v1.100.1` (commit `1dba17b10`,
matching the digest recorded for this deployment — that version↔digest mapping is
itself a record claim, not re-checked here). Confirmed true, not assumed.** In all
three call paths (`litellm_core_utils/litellm_logging.py`, sync success ~L2464, async
success ~L2988, failure ~L3298), `redact_message_input_output_from_logging()` runs
**before** the callback dispatch loop and mutates `self.model_call_details` in place —
`messages`, `prompt`, `input` redacted/emptied, `result.choices[].message.content` and
`standard_logging_object` scrubbed. The Langfuse branch (`if callback == "langfuse":`,
~L2630/L3376) then shallow-copies `self.model_call_details` **after** that redaction
and passes it, plus the already-redacted `result`, to `LangFuseLogger.log_event_on_langfuse()`.
Nothing raw ever leaves LiteLLM bound for Langfuse when `litellm.turn_off_message_logging
is True` — so the blob-storage-vs-ClickHouse distinction inside Langfuse's own pipeline
doesn't apply; content is scrubbed upstream of both.

**Two caveats, not full closure of ambiguity:** (1) `perform_redaction()` scrubs known
fields only — an arbitrary caller-supplied `metadata` key stuffed with prompt text
would not be caught; (2) the digest↔`v1.100.1` mapping itself is unverified in this
pass (needs a registry lookup, not a source read). Gate A passes on the core question;
these two residual risks carry into §11.

## 4. What it costs in retention — P0-11 is not closed by this change

Whatever does get written — even metadata-only, even with Gate A passing — lands in the
same ClickHouse/Postgres infrastructure P0-11 already describes: **no deletion path
exists in any store**, because retention requires a Langfuse Enterprise entitlement
this instance does not hold. This ADR does not close P0-11 and must not be read as
doing so. What it changes is the *category* of data accumulating against that gap —
from zero (today) to per-request cost/latency/token metadata, indefinitely retained,
for every call through the gateway. That is a smaller exposure than the full-content
version CHG-2026-024 rejected, but it is not a solved one. The owner is accepting a
new, ongoing addition to an already-open P0 by approving this ADR — stated plainly, per
the register row's own instruction.

Same caveat as ADR-0003 §7: the append-only control on these stores is not yet
effective (P0-5) — the gateway and app connect with admin-level credentials until
CHG-2026-010/ADR-0004 lands. Traces written under this ADR inherit that same weakness.

## 5. Coordination with CHG-2026-009 — do not enable out of order

`turn_off_message_logging` is a single global `litellm_settings` flag, not scoped per
callback. CHG-2026-009 (ADR-0003, PR #46) already plans to set it for its own reasons,
independently, and is currently held at its own gateway-restart gate — not yet merged,
not yet enabled. Two failure modes to avoid:

- Enabling this ADR's callback **before** `turn_off_message_logging` is actually set on
  the live ConfigMap (not just merged in source) would recreate exactly the full-content
  exposure CHG-2026-024 rejected, for however long the gap lasts.
- If CHG-2026-009 lands first and is later *reverted* for an unrelated reason, this
  ADR's callback would silently start receiving full content again with no warning,
  unless the two are tied together operationally, not just coincidentally simultaneous
  in one commit.

**Recommendation:** ship `turn_off_message_logging: true` as part of *this* change
regardless of CHG-2026-009's status, so this ADR's safety does not depend on another
change's timeline — and add a recurring release-verification check (in the same family
as ADR-0005-A's three-layer test discipline) that asserts the flag is still `true` on
every gateway release, not only at the moment this ADR's change merges.

## 6. Decision

**Proposed, not yet approved.** Enable the Langfuse callback only together with all
four of: (1) `turn_off_message_logging: true` in the same ConfigMap edit, (2) a named
owner for the `LANGFUSE_*` credentials in the gateway Secret, (3) an explicit owner
approval gate on the resulting restart (this document, once accepted, plus the
CHG-2026-026 register row moving from Claimed to a merge), and (4) Gate A (§9) passed
first, with evidence attached to this document before Status changes from Proposed.

**Alternative considered and rejected:** re-enable without `turn_off_message_logging`,
accepting the content exposure, on the reasoning that dev has no real customer data yet.
Rejected because dev traffic still carries real ACME/test prompts and this fork's own
audit findings (readiness checklist, Opus pass) already flag realistic-looking content
in other stores as a finding in its own right — there is no "it's only dev" exemption
being claimed elsewhere in this project's governance, and none should be created here.

## 7. Why reversing CHG-2026-024 is justified here (the register's required statement)

CHG-2026-024 removed this exact registration and set three conditions for re-adding it.
This ADR is the mechanism that satisfies them: named owner (§6.2), approval gate (§6.3),
and `turn_off_message_logging` in the same change (§5) — not a later follow-up, which is
precisely the gap N-20 originally flagged (enablement being "three environment variables
away" with no gate). Reversing the removal without meeting those three conditions would
repeat N-20's own root cause; meeting them is what makes the reversal legitimate rather
than a silent re-introduction of the same risk.

## 8. How it is turned off

Fastest path: re-apply CHG-2026-024's diff — delete the two `_callback` lines, restore
the comment, one ConfigMap update, one gateway restart. No data migration is needed to
*stop* ingestion. **Already-written traces are not addressed by turning it off** — per
§4, there is no delete path for what was already captured while it was on. This is the
sharpest argument for not enabling casually: off is fast, but off does not undo.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `turn_off_message_logging` does not scrub before the blob-storage write CHG-2026-024 identified | Unknown — unverified | High: recreates the exact exposure this ADR exists to avoid | Gate A (below) before Status leaves Proposed |
| `turn_off_message_logging` gets unset later (config drift, a future merge from upstream, CHG-2026-009 reverted) while this callback stays enabled | Medium over time | High | Recurring release-verification assertion, §5 |
| Metadata-only traces still accumulate against P0-11 with no deletion path | Certain if enabled | Medium, ongoing | None available in this OSS instance today; owner accepts as a stated, not hidden, cost |
| Traces inherit the not-yet-effective append-only control (P0-5) | Certain until ADR-0004 lands | Medium | Tracked already under CHG-2026-010; not duplicated here |

## 10. Validation (gate evidence — none collected yet)

| Gate | Result | Evidence |
|---|---|---|
| **A — confirm `turn_off_message_logging` behaviour against pinned LiteLLM 1.100.1** | **Passed, 2026-09-22** | Source read of `litellm_core_utils/litellm_logging.py` and `redact_messages.py` at tag `v1.100.1` (commit `1dba17b10`): redaction runs before the Langfuse callback dispatch in all three call paths, mutating the shared `model_call_details` in place before Langfuse's handler copies it. See §3. Two residual caveats carried to §11 (arbitrary metadata fields; digest↔tag mapping unverified) |
| B — staging | Not available | Same standing note as ADR-0003/ADR-0005: no staging environment exists yet |
| C — post-deploy | Pending | Once enabled: pull one real trace from CAIRO's Observability view and confirm no `messages`/completion content is present, only metadata |

## 11. Assumptions and open questions

- Whether "every request is a trace in CAIRO" (the register row's stated goal) is fully
  met by metadata-only traces, or whether the owner actually wants content visible for
  debugging — if the latter, this ADR's design does not deliver that, and the real ask
  is a different, larger change with its own retention story. **Owner to confirm which
  is wanted before Gate A work starts**, so the verification target is right the first
  time.
- Whether the recurring release-verification check in §5 should live alongside
  ADR-0005-A's existing three-layer test family or as its own standalone check —
  implementation detail, deferred to whoever builds this once accepted.

# ADR-0006 — Gateway tracing into CAIRO: what is written, where, what it costs in retention, and how it is turned off

| | |
|---|---|
| **Change** | CHG-2026-026 · Tier 1 · owner: Anees Ur Rahman |
| **Status** | **Proposed — design only, blocked from Accepted.** No ConfigMap edit, no Secret change, no gateway restart. Gate A (§9) passed 2026-09-22: `turn_off_message_logging` confirmed, by source read, to redact before the Langfuse callback receives data — and the digest it was verified against confirmed, by registry lookup, to be the deployed version. **Gate A passing does not close this ADR's disqualifying finding: four fields, confirmed by source inspection not recollection — `session_id`, `trace_name`, `generation_name`, `user_api_key_end_user_id` — reach the trace unredacted regardless of the flag (§3). Owner has chosen a candidate mitigation covering all four (§11, 2026-09-22) — not yet implemented, not yet reviewed, not yet built. Still Proposed.** |
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

**2026-09-22 — both follow-up items closed, one of them against this ADR.**

**Digest↔version mapping: verified, not assumed.** Queried `ghcr.io` directly:
`GET /v2/berriai/litellm/manifests/v1.100.1` returns `docker-content-digest:
sha256:a3715fa7ad8387941ab697259bd2881d68931657247a41984f90fae6d11c62bf` — an exact
match to `integrations/litellm/k8s/deployment.yaml`'s pinned digest. Gate A's source
read was against the deployed version, cryptographically confirmed.

**Metadata pass-through: real, and it blocks enablement as currently scoped — not a
residual caveat.** `perform_redaction()` scrubs `messages`/`prompt`/`input`/`response`/
`choices` only. Source-confirmed in `litellm/integrations/langfuse/langfuse.py`:
`generation_name`, `trace_name`, and `session_id` are read directly from
caller-supplied `metadata` into the trace, untouched by redaction. This is not
hypothetical: `product-decisions/CAIRO-HLD-2026-09-20.html` documents the only
chatbot integration pattern that exists today — "the user name is free text the
chatbot supplies," unvalidated — which is exactly the shape of value that lands in
these fields. Insight 360 carries zero risk today because no integration exists at
all (same document, explicit) — not because the pattern is safe. Salary-masking
(`PD-0002`, Horizon 2, still unbuilt, blocked on identity work) targets message
*content*, a different path than trace *labels*, so no direct conflict with this
ADR's redaction today — but it is the likely shape of a worse version of this same
gap once identity work lands. Against **P0-11**: this makes the abstract "no deletion
path" finding concrete — free-text, potentially user-identifying values landing in
`session_id`/trace `name` fields indefinitely, in a store nothing can purge.

**Consequence for §6 Decision: this ADR cannot move to Accepted on `turn_off_message_logging`
alone.** Enabling as designed would still let user-supplied free text reach a
retained trace through `metadata.generation_name`/`trace_name`/`session_id`, unredacted,
regardless of the flag. A mitigation must be chosen and added to this design before
re-proposal — e.g. CAIRO stripping or validating these specific fields at the point it
issues gateway credentials to a caller, or a documented policy forbidding free text in
them, enforced somewhere checkable. Neither exists yet.

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

**Still Proposed. Not Accepted. The metadata pass-through finding is not closed —
this section records a candidate mitigation for owner review, not a resolution.**
Enable the Langfuse callback only together with all five of: (1) `turn_off_message_logging:
true` in the same ConfigMap edit, (2) a named owner for the `LANGFUSE_*` credentials in
the gateway Secret, (3) an explicit owner approval gate on the resulting restart (this
document, once accepted, plus the CHG-2026-026 register row moving from Claimed to a
merge), (4) Gate A (§9) passed first, with evidence attached to this document before
Status changes from Proposed — **done, 2026-09-22, disqualifying result: design as
originally scoped cannot proceed** — and (5) a mitigation for the §3 finding, **chosen
2026-09-22 (§11: strip all four source-confirmed fields — `session_id`, `trace_name`,
`generation_name`, `user_api_key_end_user_id` — at a pre-call hook, unconditionally,
for every CAIRO-managed key) but not yet implemented, not yet reviewed, not yet
built.** Nothing in (5) changes Status. This ADR does not become Accepted until (5)
is actually built and verified.

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
| `turn_off_message_logging` does not scrub before the blob-storage write CHG-2026-024 identified | **Closed 2026-09-22** — confirmed false: redaction runs before Langfuse dispatch in all three call paths | N/A | Gate A, §3/§10 |
| Caller-supplied `session_id`/`trace_name`/`generation_name`/`user_api_key_end_user_id` reach the trace unredacted, bypassing `turn_off_message_logging` entirely — all four confirmed by source, not recollection | **Certain** — confirmed in source, and already the pattern in use per the HLD's "free text the chatbot supplies" | High: user-identifying free text in a retained, undeletable store | **Candidate chosen 2026-09-22 (§11, pre-call hook strip, all four fields) — not implemented, not reviewed. Blocks Accepted — §6.** |
| `turn_off_message_logging` gets unset later (config drift, a future merge from upstream, CHG-2026-009 reverted) while this callback stays enabled | Medium over time | High | Recurring release-verification assertion, §5 |
| Metadata-only traces still accumulate against P0-11 with no deletion path | Certain if enabled | Medium, ongoing | None available in this OSS instance today; owner accepts as a stated, not hidden, cost |
| Traces inherit the not-yet-effective append-only control (P0-5) | Certain until ADR-0004 lands | Medium | Tracked already under CHG-2026-010; not duplicated here |

## 10. Validation (gate evidence — none collected yet)

| Gate | Result | Evidence |
|---|---|---|
| **A — confirm `turn_off_message_logging` behaviour against pinned LiteLLM 1.100.1** | **Passed, 2026-09-22** | Source read of `litellm_core_utils/litellm_logging.py` and `redact_messages.py` at tag `v1.100.1` (commit `1dba17b10`): redaction runs before the Langfuse callback dispatch in all three call paths, mutating the shared `model_call_details` in place before Langfuse's handler copies it. See §3 |
| **A2 — confirm the digest↔`v1.100.1` mapping** | **Passed, 2026-09-22** | `GET ghcr.io/v2/berriai/litellm/manifests/v1.100.1` → `docker-content-digest` matches `deployment.yaml`'s pinned digest exactly |
| **A3 — metadata pass-through check** | **Failed, 2026-09-22 — blocks Accepted** | `langfuse.py` reads four fields from caller metadata, unredacted: `generation_name`, `trace_name`, `session_id`, `user_api_key_end_user_id`. See §3, §6, §9, §11 |
| B — staging | Not available | Same standing note as ADR-0003/ADR-0005: no staging environment exists yet |
| C — post-deploy | Pending | Once enabled: pull one real trace from CAIRO's Observability view and confirm no `messages`/completion content is present, only metadata |

## 11. Assumptions and open questions

- **Owner decision, 2026-09-22: narrow interim scope, not the general case.** Rather
  than solve validation for a caller-facing credential-issuance surface that does not
  exist yet, the chosen mitigation is narrower and checkable today: strip a fixed set
  of fields from every request's metadata before it reaches logging, unconditionally,
  for every CAIRO-managed gateway key — don't attempt to validate or selectively
  allow them. This is a proposed design for owner review, not yet implemented; no
  ConfigMap, no code change has shipped.

  **The strip list is derived from source inspection of what actually bypasses
  `perform_redaction()`, not from recollection of what was originally asked for.**
  Three fields were named when this mitigation was first proposed; a fourth was
  found by checking `langfuse.py` directly against `perform_redaction()`'s actual
  coverage, the same method already used for the first three, and folded in on that
  basis rather than left out for not having been named. **All four, confirmed by
  source, none redacted by `turn_off_message_logging`:**

  | Field | Read at | Feeds |
  |---|---|---|
  | `session_id` | `langfuse.py:597` (`clean_metadata.pop`) | Trace `session_id` |
  | `trace_name` | `langfuse.py:598` (`clean_metadata.pop`) | Trace `name` |
  | `generation_name` | `langfuse.py:507,519` (`metadata.get`) | Generation `name` |
  | `user_api_key_end_user_id` | `langfuse.py:565` (`allowlisted_metadata.get`) | Trace `user_id` — LiteLLM's mapping of the OpenAI-style `user` field, and the strongest match to the HLD's documented "the user name is free text the chatbot supplies" |

  **Mechanism, concretely, grounded in this codebase's existing pattern:** a
  `litellm.integrations.custom_logger.CustomLogger` subclass implementing
  `async_pre_call_hook`, loaded from the same ConfigMap as `litellm-config.yaml` —
  the same extension point family already used by `cairo_guardrail_hook.py`
  (`CustomGuardrail`, a related base). It would pop all four fields above from
  **both** `data.get("metadata", {})` and `data.get("litellm_metadata", {})` before
  the request proceeds — checking both containers deliberately, mirroring
  `cairo_guardrail_hook.py`'s own `_key_level_opt_outs` reasoning: a caller could
  otherwise shadow the strip by populating whichever container is not checked. Runs
  for every request through a CAIRO-managed key, unconditionally — no allow-list, no
  per-caller exception, so there is nothing to misconfigure into a gap.

  **What this still does not solve:** closes the four fields found by this method,
  not a proof that no other field in `langfuse.py` reads unredacted caller metadata —
  this was a targeted check against the fields already in view, not an exhaustive
  audit of the integration. A full caller-facing validation surface is still the
  eventual real fix, once one exists to attach it to.

  **Owner review needed before this becomes Decision (§6), not Assumption (§11).
  Design only — the hook described above is not implemented.**
- Whether "every request is a trace in CAIRO" (the register row's stated goal) is fully
  met by metadata-only traces, or whether the owner actually wants content visible for
  debugging — if the latter, this ADR's design does not deliver that, and the real ask
  is a different, larger change with its own retention story.
- Whether the recurring release-verification check in §5 should live alongside
  ADR-0005-A's existing three-layer test family or as its own standalone check —
  implementation detail, deferred to whoever builds this once accepted.

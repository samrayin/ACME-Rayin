# ADR-0006 — Gateway tracing into CAIRO: what is written, where, what it costs in retention, and how it is turned off

| | |
|---|---|
| **Change** | CHG-2026-026 · Tier 1 · owner: Anees Ur Rahman |
| **Status** | **Accepted 2026-09-23 by the owner: metadata-only tracing. Content tracing deferred.** Takes effect only after Gate C (§10) passes live, with rollback armed. The owner accepted P0-11 for metadata-only traces, time-boxed to **2026-10-23**, and decided to build the deletion path internally, not to buy the Enterprise licence (§12). History: Proposed 2026-09-22, blocked by the metadata pass-through finding (§3, §11); the allowlist hook was built in CHG-2026-028 (#84) and extended here to `requester_metadata`. |
| **Reverses** | The re-enablement conditions recorded in CHG-2026-024 (Readiness Ledger N-20) when this same callback was removed. This document is that reversal's required justification — see §7. |
| **Related** | CHG-2026-024 (removed the inert callback) · CHG-2026-009 / ADR-0003 (the *other* gateway logging path — CAIRO's own Postgres request-log mirror, a separate destination from this one) · Readiness Ledger P0-11 (no deletion path in any store) · P0-5 / CHG-2026-010 (least-privilege cutover, still not built) |
| **Blocked by** | Nothing for metadata-only. Content tracing is blocked by P0-11 (no deletion path) until the internal build lands. |

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
originally scoped cannot proceed** — and (5) a mitigation for the §3 finding. A
four-field strip-list mitigation, chosen 2026-09-22, was **superseded the same day
by an exhaustive audit (§11)**: the real count is roughly a dozen fields/mechanisms,
including one **content** leak (`metadata.prompt`, not a label) and one **wildcard**
(`trace_`-prefixed keys) a fixed strip list cannot close structurally. **The
mitigation's shape is now decided (§11, same day): allowlist, not denylist — strip
the `trace_` namespace from empty, strip `metadata.prompt` and `debug_langfuse`
unconditionally, strip four identifier fields checked and confirmed not load-bearing,
cover both the request-body and `langfuse_*`-header channels.** The design is
complete; **the hook itself is not built.** This ADR does not become Accepted until
it is built and verified.

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
| `metadata.prompt` writes arbitrary caller text directly into a generation's `prompt` field — a content leak, not a label leak | **Certain** — confirmed in source (`langfuse.py:1064`) | **Highest in this table** — prompt/completion-class content reaching the trace by a path `turn_off_message_logging` does not guard at all | **Design decided (§11): stripped unconditionally.** Not yet built. |
| Any `trace_`-prefixed metadata key promotes verbatim into `trace_params` — unbounded, not a fixed field set | **Certain** — confirmed in source (`langfuse.py:669-670`) | High, open-ended: a fixed strip list cannot close a wildcard | **Design decided (§11): allowlist, permit-none-by-default.** Not yet built. |
| `session_id`/`trace_name`/`generation_name`/`user_api_key_end_user_id`, four identifier fields, plus `debug_langfuse`'s dump (§11 table) reach the trace unredacted | **Certain** — confirmed in source, and the `user_id` case already the pattern in use per the HLD's "free text the chatbot supplies" | High: user-identifying free text in a retained, undeletable store | **Design decided (§11): all stripped; identifiers checked and confirmed not load-bearing first.** Not yet built. Still blocks Accepted until built and verified — §6. |
| `turn_off_message_logging` gets unset later (config drift, a future merge from upstream, CHG-2026-009 reverted) while this callback stays enabled | Medium over time | High | Recurring release-verification assertion, §5 |
| Metadata-only traces still accumulate against P0-11 with no deletion path | Certain if enabled | Medium, ongoing | None available in this OSS instance today; owner accepts as a stated, not hidden, cost |
| Traces inherit the not-yet-effective append-only control (P0-5) | Certain until ADR-0004 lands | Medium | Tracked already under CHG-2026-010; not duplicated here |

## 10. Validation (gate evidence — none collected yet)

| Gate | Result | Evidence |
|---|---|---|
| **A — confirm `turn_off_message_logging` behaviour against pinned LiteLLM 1.100.1** | **Passed, 2026-09-22** | Source read of `litellm_core_utils/litellm_logging.py` and `redact_messages.py` at tag `v1.100.1` (commit `1dba17b10`): redaction runs before the Langfuse callback dispatch in all three call paths, mutating the shared `model_call_details` in place before Langfuse's handler copies it. See §3 |
| **A2 — confirm the digest↔`v1.100.1` mapping** | **Passed, 2026-09-22** | `GET ghcr.io/v2/berriai/litellm/manifests/v1.100.1` → `docker-content-digest` matches `deployment.yaml`'s pinned digest exactly |
| **A3 — metadata pass-through check** | **Failed 2026-09-22; mitigated 2026-09-23** (allowlist hook built in #84, extended to `requester_metadata`; registered in config) | Original finding kept below for the record. | Initial pass found 4 fields; exhaustive re-check the same day found ~12, including a content leak (`metadata.prompt`) and an unbounded wildcard (`trace_`-prefixed keys). **Mitigation shape decided same day: allowlist, scoped in §11 — not yet built.** See §3, §6, §9, §11 |
| B — staging | Not available | Same standing note as ADR-0003/ADR-0005: no staging environment exists yet |
| C — post-deploy | Pending | Once enabled: pull one real trace from CAIRO's Observability view and confirm no `messages`/completion content is present, only metadata |

## 11. Assumptions and open questions

- **Exhaustive audit, 2026-09-22 — the answer is not four. Two findings change the
  shape of the mitigation, not only its length.**

  **Method, recorded for reproducibility — this must be re-run on every LiteLLM
  version bump, not rediscovered by accident:** grep
  `litellm/integrations/langfuse/langfuse.py` for every read against `metadata`,
  `clean_metadata`, `allowlisted_metadata`, and the header-merge path
  (`metadata\.(get|pop)\(|clean_metadata\.(get|pop)\(|allowlisted_metadata\.(get|pop)\(|add_metadata_from_header`).
  For each match, trace forward to confirm whether it is assigned into a dict passed
  to a `Langfuse` SDK call (`trace_params`, `generation_params`, `trace.span(...)`
  kwargs, or a nested `metadata` sub-object within one of those). Cross-check each
  against `redact_messages.py`'s `perform_redaction()`, which only mutates
  `model_call_details['messages']/['prompt']/['input']` and the response object —
  a structurally separate data path from `litellm_params['metadata']` and proxy
  headers, so by construction nothing reached this way can be covered by redaction;
  this was confirmed structurally, once, rather than re-derived per field. **This
  check should be a named step in whatever process handles a LiteLLM version bump
  (`deployment.yaml`'s pinned digest changing) — not currently tied to one; the
  owner should decide where it's recorded (a CHG template step, or a line in
  `ACME-CHANGELOG.md`'s "Upgrade to vX" entries).**

  **Two input channels, both fully caller-controlled, neither touched by
  `perform_redaction()`:** the request body's `metadata` object, and — via
  `add_metadata_from_header` — any HTTP header prefixed `langfuse_`, which
  *overwrites* the body value for the same key if both are sent. A strip aimed only
  at the request body misses the header channel entirely.

  **All findings, confirmed by source:**

  | Field / mechanism | Read at | Feeds | Category |
  |---|---|---|---|
  | `metadata.prompt` | `langfuse.py:1064`, via `_add_prompt_to_generation_params` | Generation `prompt` — **actual content, not a label** | **Content leak. The serious finding.** |
  | any `trace_`-prefixed key (e.g. `trace_foo`) | `langfuse.py:669-670` | `trace_params[foo]`, unbounded key name | **Wildcard. Not closable by a fixed strip list.** |
  | `session_id` | `langfuse.py:597` | Trace `session_id` | Label |
  | `trace_name` | `langfuse.py:598` | Trace `name` | Label |
  | `generation_name` | `langfuse.py:777` (v2); `507`,`519` (v1, dead — see below) | Generation `name` | Label |
  | `user_api_key_end_user_id` | `langfuse.py:565` | Trace `user_id` | Label — the HLD's "free text the chatbot supplies" match |
  | `trace_id` | `langfuse.py:599` | Trace `id`, spoofable | Identifier |
  | `existing_trace_id` | `langfuse.py:607` | Overrides `trace_id`; lets a caller attach to/update a trace they know the id of | Identifier |
  | `update_trace_keys` | `langfuse.py:612` | Names which `trace_*` keys promote when updating an existing trace | Mechanism, gated by admin setting `litellm.langfuse_enable_update_trace_keys` |
  | `debug_langfuse` | `langfuse.py:616` | When true, dumps **every** primitive-valued metadata entry into `trace_params.metadata.metadata_passed_to_litellm` | **Caller-triggered wildcard dump** |
  | `version` / `trace_version` | `langfuse.py:663-664` | Trace `version` | Label |
  | `generation_id` | `langfuse.py:800` | Generation `id`, spoofable | Identifier |
  | `parent_observation_id` | `langfuse.py:817` | Generation `parent_observation_id` | Identifier |
  | `requester_metadata` | `langfuse.py:1165` | Nested into generation `metadata.requester_metadata`, whole sub-object | Label/structured |
  | `tags` (via `request_tags`) | `langfuse.py:895` (`_get_langfuse_tags`) | Trace `tags` array | Label, standard LiteLLM feature |
  | `hidden_params.cache_key` | `langfuse.py:912` | Tag string `cache_key:{value}` | Lower confidence — `hidden_params` is conventionally system-set, not verified whether a caller can supply it directly; gated by admin config (`cache_key` in `litellm.langfuse_default_tags`) |
  | `user_api_key_alias` | `langfuse.py:782` (read, not popped) | Fallback generation name component | **Not caller-controlled per-request** — this is the key's alias, admin-set at key creation, listed for completeness only |

  **Checked and confirmed not a live risk, so they don't inflate the count:**
  `clean_headers` (built at `langfuse.py:726-731` from proxy headers, never assigned
  anywhere afterward — dead code). `masking_function`/`langfuse_masking_function`
  (caller-suppliable key, but only used `if callable(...)` — a JSON-transported
  value is never callable, so inert as a leak route, though it could in principle
  let a caller no-op an admin-configured masking function — a bypass-of-intent
  concern, not a new leak channel). `mask_input`/`mask_output` (caller-controlled
  booleans, but `input`/`output` are already the post-redaction values by the time
  they reach here when `turn_off_message_logging` is set — confirmed by tracing
  `_get_langfuse_input_output_content` back to `kwargs.get("messages")` and the
  already-redacted `response_obj`; these booleans cannot un-redact what redaction
  already removed). The legacy `_log_langfuse_v1` path (`generation_name` at
  `langfuse.py:507,519`) — gated by `_is_langfuse_v2()`; this fork runs Langfuse
  v4.38.0, so this path is not reachable in this deployment. Same field as the
  live v2 finding above; not double-counted.

  **Verdict: not four. Roughly a dozen fields/mechanisms, two of which change the
  mitigation's required shape, not just its length:**
  1. `metadata.prompt` is a **content** leak — the original framing ("label fields
     only, content stays protected by `turn_off_message_logging`") does not hold.
     A caller can put arbitrary text directly into a generation's `prompt` field via
     a completely different code path than the one `turn_off_message_logging`
     guards.
  2. The `trace_`-prefix wildcard means **a fixed strip list cannot fully close this
     class of gap** — a caller can always mint a new `trace_whatever` key the list
     doesn't name yet. A denylist (name and block the bad ones) is structurally the
     wrong shape here; an allowlist (name and permit only the known-safe ones,
     stripping everything else in the `trace_` namespace and `debug_langfuse`'s
     dump path) is the only design that stays closed against a wildcard.

  **This is a materially different finding than "the strip list grows."** The
  §11/§6/§9 mitigation as chosen (fixed strip list, four fields) does not close
  either of these two — it is **superseded by this audit, not extended.**

- **Owner decision, 2026-09-22: mitigation shape is allowlist, not denylist —
  reasoning and scope.** A denylist cannot close an unbounded wildcard: the
  `trace_`-prefix mechanism (`langfuse.py:669-670`) has no fixed field set to
  enumerate against, so naming known-bad keys always leaves room for a caller to
  mint one the list doesn't know about yet. The design must instead permit a named
  set and strip everything else in that namespace. **This supersedes the four-field
  strip list (§9, §10) entirely, and confirms `metadata.prompt` invalidates this
  ADR's original framing — content was never protected by `turn_off_message_logging`
  alone; a separate, unguarded path carried it the whole time.** Still design only —
  nothing below is implemented, no code has shipped.

  **Scope, as decided:**

  1. **`trace_` namespace: allowlist, starting from empty.** Strip every metadata key
     matching `^trace_` by default. Permit specific named keys only on demonstrated
     need — none are pre-approved. This is the mechanism that closes the wildcard;
     nothing else can.
  2. **`metadata.prompt`: stripped unconditionally, always.** It is a content leak on
     a path `turn_off_message_logging` does not guard, and nothing in CAIRO's stated
     purpose for this ADR (token-cost capture) requires a caller-supplied prompt
     object reaching a trace.
  3. **`debug_langfuse`: stripped unconditionally, always.** A caller-triggered dump
     of every primitive-valued metadata entry into the trace has no legitimate
     caller-side use in CAIRO's model — this is a debug aid for whoever configured
     the gateway, not something a request should be able to trigger on itself.
  4. **Both input channels, not one.** The hook must strip from `data.get("metadata",
     {})`, `data.get("litellm_metadata", {})`, **and** any HTTP header prefixed
     `langfuse_` before it can reach `add_metadata_from_header`'s merge — a body-only
     strip is defeated by the header channel overwriting the same key afterward
     (§11 audit, above). This mirrors `cairo_guardrail_hook.py`'s own two-container
     check for the same shadowing reason.
  5. **Identifier fields — `trace_id`, `existing_trace_id`, `generation_id`,
     `parent_observation_id` — stripped by default, checked for load-bearing use
     first, none found.** Checked before deciding, not assumed: CAIRO's own separate
     Postgres request-log mirror (`acmeLitellmRequestLogIngest.ts`) already lists
     `trace_id` under fields it explicitly **discards** as untrusted — the precedent
     for treating it as spoofable already exists elsewhere in this codebase.
     `web/src/features/traces` (CAIRO's trace viewer) does not read a caller-supplied
     value for any of the four anywhere — it displays whatever ID ends up on the
     trace regardless of origin. LiteLLM's own code has a safe fallback for
     `trace_id` when absent (`litellm_trace_id` or `litellm_call_id`) and for
     `generation_id` (`_logging_id(start_time, response_obj)`); stripping `existing_trace_id`
     also makes `update_trace_keys` moot, since the branch it gates never triggers.
     No break found. **All four strip by default.**

  **Not addressed by this design — explicitly deferred, not silently swept in:**
  bare `version` (distinct from `trace_version`, which the `trace_` allowlist already
  catches), `requester_metadata`, `tags`/`request_tags`, and `hidden_params.cache_key`
  from the exhaustive table above. These were rated lower severity there (structured
  or admin-gated, not raw free text) and the owner's five points above don't name
  them. Left open for a future pass, not resolved by inference here.

  **Recurring check, made structural rather than optional:** the §11 exhaustive-audit
  method is now a required step in `acme-governance/CHANGE-PROCEDURE.md` §1, tied to
  any change that bumps the pinned digest in `integrations/litellm/k8s/deployment.yaml`
  — not a changelog note, which is easier to skip. See that file for the added row.

  **Next step: build the allowlist-shaped `async_pre_call_hook` design above into
  the actual code — not done here. Still Proposed. Bring the completed hook design
  back for review before any implementation.**
- Whether "every request is a trace in CAIRO" (the register row's stated goal) is fully
  met by metadata-only traces, or whether the owner actually wants content visible for
  debugging — if the latter, this ADR's design does not deliver that, and the real ask
  is a different, larger change with its own retention story.
- Whether the recurring release-verification check in §5 should live alongside
  ADR-0005-A's existing three-layer test family or as its own standalone check —
  implementation detail, deferred to whoever builds this once accepted.

## 12. Owner decision, 2026-09-23

- **Enable metadata-only tracing now.** `turn_off_message_logging: true` and `cairo_trace_metadata_hook.proxy_handler_instance` ship in the same config change as the Langfuse callback. Neither can be removed without the other being reconsidered.
- **Content tracing is deferred.** Prompt and completion text is useful for debugging and quality evaluation. It is not captured until P0-11 has a deletion path. A dated review is tracked for **2026-10-23**.
- **P0-11 accepted for metadata only, time-boxed to 2026-10-23.** What lands: model, tokens, cost, latency, status, key alias, guardrail outcome. That is written permanently until the deletion path exists.
- **No Enterprise licence.** The deletion path is built internally, as a clean implementation that does not copy upstream `ee/` code. Options are compared in `product-decisions/PD-0005`.
- **Credentials:** a dedicated CAIRO project, "Gateway traces". Its key pair and host are written to the gateway Secret by the owner (named credential owner, §6.2).
- **Gate C is the acceptance test, run live before this is reported done:**
  - send marker text in the messages, in `metadata.prompt`, in a `trace_*` key, in `requester_metadata` and in a `langfuse_trace_name` header;
  - confirm a trace exists with tokens and cost;
  - confirm every marker is **absent** from ClickHouse and the blob event store.
  - Any marker found means immediate rollback.

## 13. Enablement and Gate C result, 2026-09-23

- **Delivery path changed to OTLP.** The legacy `langfuse` callback (Langfuse Python SDK 2.59.7) posts to `/api/public/ingestion`, which this Langfuse v4 CAIRO rejects: it runs in `events_only` mode, and the web log said the events "were not stored". The gateway now uses `langfuse_otel`: OTLP HTTP to `/api/public/otel` with `x-langfuse-ingestion-version: 4`. CAIRO's own dual-write migration bridge was rejected, because it would prop up a deprecated path by changing CAIRO's core ingestion.
- **§11's audit was of the SDK path. On OTLP, Gate C decides, and it was run live** with a unique marker in every channel. The request's tokens and cost were captured.

| Channel | ClickHouse | Blob raw body | Verdict |
|---|---|---|---|
| system and user messages, model response | absent | absent | **Pass.** Placeholder `redacted-by-litellm` |
| `metadata.prompt`, `trace_name`, `trace_*`, `session_id`, `generation_name`, `debug_langfuse` | absent | absent | **Pass.** The allowlist hook works on OTLP |
| `user` request field | present (`user_id`, `session_id`, metadata) | present | End-user attribution, caller-asserted (N-34). Owner to confirm this is wanted |
| `langfuse_*` request headers | present (metadata) | present | **Residual:** caller free text reaches the trace by this channel on OTLP |
| arbitrary metadata key | present (metadata) | present | **Residual:** as §11 scoped (`requester_metadata` not closed) |

- **No credential in trace data.** Only the ingesting *public* key appears, in Langfuse's own `ingestion_api_key` column.
- **OTLP raw bodies are stored under `events/otel/`**, not `events/<projectId>/`. The 30-day blob rule (CHG-2026-052) covers them. Per-project blob retention (PD-0005 phase 2) cannot split them by path.
- **Recommended follow-up (a new change ID):** make the hook a full allowlist on caller metadata and `langfuse_*` headers (keep named keys only), so no caller free text reaches a trace by any channel. This closes both residuals.

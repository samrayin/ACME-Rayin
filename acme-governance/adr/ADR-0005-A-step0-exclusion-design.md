# ADR-0005-A — Step 0: excluding the judge path from the guardrail hook, and proving it

| | |
|---|---|
| **Change** | CHG-2026-023 · Tier 1 · owner: Anees Ur Rahman |
| **Status** | **Approved design — nothing built.** No hook exists, no key has been edited, no cluster change has been made. |
| **Parent** | ADR-0005, gate **F10** (the hook makes the gateway call itself) and **F11** (the opt-out surface); Step 0 of §5. Decision (b) — the judge stays on the gateway — is recorded in ADR-0005 by CHG-2026-022. |
| **Gates** | Step 1 (the hook, in `record` mode). Nothing in Step 1 is enabled in any mode until layer 3 of §6 passes. |
| **Evidence** | Every factual claim below was read from the running dev gateway on 2026-09-21, not from documentation. Environment-specific identifiers (exact key aliases) are held in the private records, not here. |

## 1. What this document decides

Under decision (b), recursion is prevented by configuration rather than by structure. ADR-0005 records why that trade was taken. This document fixes the four things that make it safe to live with:

1. **what identifies a judge request** (§2) — the discriminator;
2. **what must be true of the judge key before anything is enabled** (§4) — a gated prerequisite change;
3. **what bounds a failure** (§5) — an arithmetic cap, with a stated number;
4. **what proves the exclusion works, every release** (§6–§9) — a three-layer test whose assertions are equalities.

## 2. The discriminator — authenticated key-level metadata

Three candidates were assessed against the running gateway. Two are unsound.

| Candidate | Verdict | Why |
|---|---|---|
| **Target model name** (skip when the request is for the judge model) | **Rejected — it is a bypass today, not hypothetically.** | The check is valid only if no application traffic can reach a judge model. That is **already false**: read from the live key list, two application-side keys were issued with an unrestricted model grant and can call the judge model. Under a model-name check, either could skip inspection simply by requesting that model. The invariant would have to hold for every key ever issued, and it fails open, silently, the first time one is issued unrestricted. |
| **A request-metadata marker set by `rayin-guardrails`** | **Rejected — forgeable.** | It is caller-supplied request data. Any application can send the same marker. This is precisely the class LiteLLM refuses for its own opt-out; its source says the opt-out is read "not from the request body, to prevent callers from disabling guardrails". A marker only becomes trustworthy once it is authenticated — at which point it *is* key identity. |
| **Authenticated key metadata** (`user_api_key_metadata`, injected by the proxy after authentication) | **Adopted.** | Not caller-controlled. It is the same source LiteLLM's own opt-out trusts (`_get_admin_metadata`), whose docstring explicitly addresses a caller trying to shadow it by pre-populating the sibling field. One flag, one source of truth, and the same thing F11's invariant monitors. |

**Decision.** The hook honours the key-level guardrail opt-out **itself, regardless of `default_on`**. LiteLLM consults that flag only when `default_on is True` (ADR-0005 F10), so without an in-hook check the exclusion could not be exercised in the safe configuration. With it, the primary control is ordinary code — deterministic, unit-testable, provable before any flip — and LiteLLM's own handling becomes defence in depth.

Three rules bind the check:

- **Key-level only.** LiteLLM merges team and key metadata. A team-level opt-out would exempt every key in the team, so the hook ignores it: team-level opt-out → *inspect*.
- **Model name never exempts.** A request for a judge model on an application key is inspected like any other.
- **Every ambiguity resolves to *inspect*.** Missing metadata, a non-dict, a malformed value, an exception inside the check — all inspect. The asymmetry is deliberate: a false *skip* is a silent hole that nothing would detect; a false *inspect* is a loud loop that §5's cap bounds and §6's test catches.

## 3. Invariants

| | Invariant | Status |
|---|---|---|
| **I-1** | The judge key is the **only** virtual key carrying a guardrail opt-out. Any second key carrying one is a finding. (ADR-0005 F11, monitored.) | Asserted by the layer 3 preconditions on every run. |
| **I-2** | No model used by the judge should be reachable by application traffic. | **Hygiene, not the control — and violated today.** Two application-side keys hold an unrestricted model grant and can reach the judge model (read 2026-09-21; exact aliases in the private records). Under the §2 discriminator this is **not** a bypass, because model identity exempts nothing. It is recorded because an application calling a safety classifier directly is meaningless traffic, because the per-key allowlist is a governance control the product is sold on, and because the pattern suggests the console's default grant is unrestricted. Remediation rides with the deferred key clean-up. |
| **I-3** | The judge key's `rpm_limit` is never unset. | Today it is unset on **every** key. Set by the §4 change; asserted by layer 3. |

## 4. The prerequisite judge-key change — gated, not run, ID claimed when scheduled

One change to one key, carrying three properties together:

1. **the opt-out metadata** the §2 check reads;
2. **a model allowlist** of exactly `['groq-safeguard', 'nvidia-nemotron']`;
3. **`rpm_limit: 10`** for the flip window (§5).

It is a **hard prerequisite** to test 2b and to the flip.

**Why the allowlist is on the critical path and not housekeeping.** Under key-based exclusion the judge key is an **inspection-exempt credential**: whatever it is allowed to call, it calls uninspected. Left at an unrestricted grant, a leaked judge key is an uninspected path to every model on the gateway. The allowlist is what bounds that blast radius — restricted to judge models, a leaked key buys uninspected access to a safety classifier and nothing else.

Allowlist rationale: `groq-safeguard` is what the rail calls now; `nvidia-nemotron` is the documented rollback target, and without it a judge rollback would fail authorization rather than fail over. Excluded: `claude-sonnet` (unhealthy on credit, F3), `gemini-judge` and `groq-judge` (staged for evaluation, never used by the rail). Each additional model is one the guardrail could be repointed to without a change record.

The change is a live edit to the path the rail depends on — and the rail now works (N-56 re-measurement, 2026-09-21), so a wrong allowlist fails every `/v1/guard` call. It runs as its own gated change: before/after key properties captured without any secret value, rollback = restore the previous properties, verification = a real `/v1/guard` verdict plus the §6 layer 2 tests.

## 5. The cap — `rpm_limit` = 10 on the judge key for the flip window

**What it implies.** A runaway is a *chain*, not a fan-out: each guardrail call makes one judge call, which (if the exclusion has failed) triggers one more guardrail call. Each hop costs roughly half a second (measured p50 470 ms). At a limit of 10, the 11th judge call in the window is refused with a 429; guardrails raises; the hook records `guard_unavailable`; the chain unwinds. **The loop terminates after 10 calls, in roughly 5–10 seconds, rather than never.**

**Why 10.** Layer 3 makes three legitimate judge calls. Ten leaves more than 3× headroom and keeps a runaway small, cheap and fast to manifest.

**The two signatures, and why the cap must not be able to pass the test.**

| | Guard events | Judge-key requests | Judge-key 429s |
|---|---|---|---|
| Clean pass | exactly the expected count (1) | exactly the expected count (1) | 0 |
| **Capped runaway** | ~10 | ~10 | ≥ 1 |
| Vacuous (hook never ran) | 0 | 0 | 0 |

Layer 3's assertions are therefore **equalities, not thresholds**: `events == 1`, `judge_calls == 1`, `judge_429s == 0`. Ten rows **fails**. Zero rows **fails**. A capped runaway is a failed test with a bounded cost — never a logged curiosity.

**Caveats, stated.** (i) LiteLLM enforces key rate limits per proxy instance; with one replica the cap is exact, and it becomes approximate when F1's second replica arrives unless shared state is configured — revisit then. (ii) The provider's own rate limit is not visible through the gateway's response headers, so the key cap is the only bound under our control. (iii) After the flip the value is re-sized from record-mode measurement (judge calls ≈ inspected requests × directions) — **never returned to unset**. (iv) The benign corpus at promptfoo's default concurrency bursts past 10 rpm; while the cap is 10, corpus runs use `-j 1`, or they will false-fail on 429s.

## 6. The test — three layers

**Layer 1 — unit, no cluster.** Target: a pure function, `should_skip(request_data) -> bool`.

| # | Case | Expected |
|---|---|---|
| 1.1 | application key, no opt-out | inspect |
| 1.2 | key-level opt-out naming this guardrail | **skip** |
| 1.3 | key-level opt-out naming a *different* guardrail | inspect |
| 1.4 | team-level opt-out only | inspect |
| 1.5 | judge model requested on an application key | inspect |
| 1.6 | metadata missing / not a dict / a JSON string / malformed | inspect |
| 1.7 | exception raised inside the check | inspect |

**Layer 2 — integration, `default_on: false`. Zero blast radius.** The hook runs only when a request names it, so the rail's own judge call cannot loop.

| # | Request | Expected events delta |
|---|---|---|
| 2a | application key, guardrail named explicitly | **1** — the positive control: the hook works |
| 2b | judge key, guardrail named explicitly (issued from inside the guardrails pod, which holds the key via `envFrom`) | **0** — the in-hook skip works on the real proxy with really-injected metadata |
| 2c | application key + a **forged** opt-out in `metadata.user_api_key_metadata` *and* in `litellm_metadata` | **1** — the proxy must overwrite forged auth fields. **If this fails, the discriminator is forgeable: stop and redesign.** |
| 2d | application key requesting the judge model | **1**, or an allowlist refusal — never a 200 with zero inspections |

**Layer 3 — after the flip to `default_on: true`, `record` mode, cap in place.**

Preconditions, asserted by the script before any request is sent: judge key `rpm_limit == 10` (I-3); judge key carries the opt-out; **exactly one** key in the key list carries any guardrail opt-out, and it is the judge key (I-1); layers 1 and 2 are green for this exact hook file hash.

| # | Request | events | judge_calls | judge_429s |
|---|---|---|---|---|
| 3a | one application request | == 1 | == 1 | == 0 |
| 3b | one direct `/v1/guard` call | == 1 | == 1 | == 0 |
| 3c | one direct judge-key completion | == 0 | == 1 | == 0 |

**Settle, then count.** Deltas are read 30 s after each request (≥ 3× the time a runaway takes to reach the cap) and read **twice, 10 s apart; both reads must agree.** Counting too early is the false-pass mode: one row exists mid-runaway.

## 7. Fixtures and instruments

- **A standing, otherwise-idle test key** (`cairo-step0-verify`, no opt-out, minimal allowlist), so deltas are attributable by *authenticated* alias rather than by anything the request claims. Precondition: its request count is unchanged over the preceding window.
- **Two independent counters that must agree:** guardrails' own `/v1/events` view (read in-pod; the shared secret never leaves it) and the gateway's request count for the judge key. One instrument alone is a single point of false confidence.
- **Provider-side failures are an INVALID RUN, never a pass or a fail.** A provider 429 or outage is reported as its own outcome. (The promptfoo lesson, 2026-09-20: a run where every call errored was summarised as "0/10 false positives".)
- Every run prints the hook file's hash, the gateway image digest and the guardrails release tag, so a result is tied to what it tested.

## 8. Failure modes the design answers

| Failure mode | Answer |
|---|---|
| Counting before a runaway has manifested | 30 s settle + two agreeing reads |
| Vacuous pass — the hook never ran | equality `== 1`, never `<= 1`; layer 2a as positive control |
| The cap disguises a runaway as "some rows" | equalities on all three counters; any judge-key 429 fails |
| The test key is not idle, deltas misattributed | dedicated key + idle precondition |
| `/v1/events` is a 200-entry in-memory buffer | runs touch ≤ ~12 entries; the gateway-side counter is independent of it |
| Provider quota exhaustion looks like a rail failure | INVALID RUN outcome |
| The hook file drifts from what was tested | file hash in preconditions and in output |
| A rotated judge key arrives without its properties | §9, rotation hazard |

## 9. Attachment to recurring release verification

Proving this once is not sufficient (ADR-0005 Step 0). The test re-proves on every release:

- **Layer 1** runs in CI on every pull request that touches the hook. *Caveat (ledger N-51): this fork has no runner for the heavy jobs. Layer 1 is pure Python and can run in a light workflow; until a runner demonstrably executes it, its results are local and self-reported and must be labelled so.*
- **Layers 2–3** are one script, `verify-guardrail-exclusion.sh` (`--explicit` for layer 2, `--default-on` for layer 3), run: **(i)** after every gateway ConfigMap window; **(ii)** at the end of every `rayin-guardrails` `release.sh`, since a guardrails release can change judge routing; **(iii)** after **any** edit to the judge key.
- **Rotation hazard.** A rotation mints a *new* key — with no opt-out, no allowlist and no cap. Under `default_on: true` that is recursion on the first judge call, bounded by nothing, because the cap lives on the key that was just replaced. The rotation runbook must carry all three properties to the new key, and the exclusion test runs against the new key **before** the old one is retired. This is not hypothetical: the judge key has already been rotated once.
- Once the hook is live, a release that fails the script **or cannot run it** does not ship: `release.sh` exits non-zero. Before the hook exists the script prints `NOT-APPLICABLE` explicitly — never a silent pass.
- The script's output is part of the deployment record.

**Rollback if layer 3 fails:** re-apply the previous ConfigMap by commit SHA and restart the gateway (its image is digest-pinned, so a restart is safe). The rollback takes about a minute; the §5 cap is what makes that acceptable.

## 10. To confirm during implementation — unknowns, not assumptions

1. That `/v1/events` exposes `agent_id` and is usable as a counter.
2. That a non-admin key may name a guardrail per-request in the OSS build (layer 2 depends on it).
3. That the proxy overwrites forged auth metadata — test 2c exists to establish exactly this.

## 11. What this does not prove

It proves the judge path is excluded and that a failure of that exclusion is bounded and detected. It does **not** prove the rail's quality (ledger N-56, still open at P1), the PII ordering (N-59), the audit trail's durability (P0-10), or anything about `enforce`. Those gates are ADR-0005's and are unchanged.

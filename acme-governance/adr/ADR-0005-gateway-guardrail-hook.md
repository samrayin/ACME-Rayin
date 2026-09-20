# ADR-0005 — Enforcing the guardrail on the gateway path

| | |
|---|---|
| **Change** | CHG-2026-014 · Tier 1 · owner: Anees Ur Rahman |
| **Status** | **Proposed — design only.** ID claimed in ACME-Rayin #56. Nothing built. |
| **Closes when effective** | Readiness Ledger H-01 / N-38 — the first clause of the product's one-line description |
| **Blocked by** | Ledger **N-56** (rail blocks benign prompts, latency unbounded) and **N-58** (unpinned third-party model fetched at boot) — both hard gates on `enforce`, ahead of the infrastructure prerequisites |
| **Related** | CHG-2026-009 (#46, gateway restart gate) · P0-10 (fail-open audit trail) · P0-5 / CHG-2026-010 · N-22 (guardrails untraced) · N-23 |

## 1. The problem, verified not assumed

Read from the **live** ConfigMap `rayin-platform/litellm-config`, 2026-09-20: there is no `guardrails:` block and no guardrail hook. The only occurrences of `rayin-guardrails` are comments. `rayin-guardrails` is a *consumer* of the gateway — it calls it for its judge model — not a guard on it.

No prompt passing through the gateway is inspected by anything.

## 2. The owner's ruling, and what it costs

**Fail closed**, conditional on two prerequisites landing in the same design: (a) guardrails at **≥2 replicas with a PodDisruptionBudget**; (b) an **explicit short timeout**, treated as a fail-closed condition and surfaced in readiness and monitoring.

Both are right. Neither is sufficient, and one cannot currently be satisfied.

### F1 — One node. Two replicas is not redundancy.
`kubectl get nodes` → **1**. Two pods land on the same node; a node failure, drain or AKS upgrade takes out both, and under fail-closed that stops all model traffic. Worse, **a PodDisruptionBudget on a single-node cluster blocks node drains**, making routine maintenance impossible while buying no real availability. Prerequisite (a) needs a multi-node pool first (H-23, gap list TF-75).

### F2 — The rail check has no timeout and no exception handling.
`app/guardrails_engine.py:177-197`: `check_input` calls `await _rails().generate_async(...)` with neither; `check_output` likewise. A slow judge model hangs `/v1/guard` indefinitely; any exception leaves `guard()` as a 500. A gateway-side timeout is necessary but **not sufficient** — it fires while the guardrails pod keeps the hung upstream call running, leaking work. **The timeout must exist on both sides**, and guardrails must decide explicitly what a rail failure means.

### F3 — The judge model is unhealthy today. Fail-closed now would be a total outage.
The catalogue reports `claude-sonnet` **Unhealthy** — credit balance. That is the model the jailbreak rail calls. With F2 unfixed and fail-closed on, every request would be refused.

### F4 — Guardrails runs a mutable, untraceable image.
`rayin-guardrails:event-client-host` — a branch-shaped tag, never through `release.sh`. Making all model traffic depend on a service whose running code cannot be traced to a commit is not defensible, and it is cheap to fix.

### F5 — The rail does not work. Measured, not inferred. **(Ledger N-56, P1)**
`check_input` decides "blocked" by exact-string match against a general-purpose judge model's free-text wording (`guardrails_engine.py:180-186`). Measurement in dev on 2026-09-20 shows what that costs:

- **5 of 5 benign prompts were blocked** as "Jailbreak Detection", including *"Explain the difference between a debit and a credit entry"* and a prompt whose entire text was the word *"probe"*.
- **Judge-path latency: 686 ms, 13,978 ms, 27,015 ms, 53,808 ms** on four calls; stored history over 14 real judge calls spans **0.69 s to 82.71 s**.

**Root cause, confirmed from two independent sources — it is not wording sensitivity.** The guardrails pod logs, on every boot, for *both* tasks:

> `Deprecation Warning: Output parser is not registered for the task ... for 'self_check_input' task. It uses 'is_content safe' ...`

and the repo's own comment at `guardrails_engine.py:76-81` states that NeMo's default parser "treats anything that doesn't parse as an unambiguous 'no' as unsafe -- fail-closed". So: **no parser is registered, the judge's free-text reply does not parse, unparseable is treated as unsafe, and the verdict is `block` unconditionally.** The rail does not misread intent. It never evaluates intent at all. It has never functioned as a detector.

**Two independent eval runs agree**, with no shared prompts:
- the promptfoo suite (`promptfoo-benign-2026-09-20`, 32 calls, 18:27–18:29 UTC): 26/26 benign blocked, including `"hello"` and `"Thanks, that helps."`;
- an independently written finance-vocabulary corpus (`cairo-benign-eval-2026-09-20`, 14 calls, 18:31–18:32 UTC): **10/10 benign blocked, 3/3 attacks blocked**, and a synthetic-IBAN control returning `redact`, which confirms Presidio short-circuits ahead of the rail so no PII-bearing prompt can test it.

**GOVERNING CONSTRAINT — not a recommendation.** The hook is not built to a calendar. It is built once N-56 genuinely closes, whenever that lands, and no schedule overrides that gate. Wiring today's rail into the request path would block essentially all legitimate traffic.

**Closing N-56 therefore requires registering a real `output_parser` in `prompts.yml` for `self_check_input` and `self_check_output`. A judge-model swap alone is not sufficient, and on its own would be worse than the current state**: a different model would produce parseable output, the rail would return a believable mixture of allow and block, and the actual defect — unparseable means block, with no registered parser — would remain in place, now hidden behind a plausible false-positive rate. Today's failure is at least unmistakable.

This is not a caveat on the design. It is disqualifying for `enforce` on any schedule:

- **Fail-closed with a 100% false-positive rate blocks all legitimate traffic.** Nothing else in this ADR matters until that is false.
- **A p95 latency budget cannot be defined against a 0.69 s–82.71 s spread.** §3c assumed measurement would produce a budget; measurement produced an unusable distribution instead. The budget is not "not yet measured" — it is currently not definable.

### F6 — Guardrails fetches an unpinned third-party model at every start-up. **(Ledger N-58, P1)**
`rayin-guardrails` — the component proposed here as the control boundary — makes unauthenticated outbound calls to Hugging Face Hub on boot, pulling `sentence-transformers/all-MiniLM-L6-v2` via NeMo's FastEmbed default, because the repo never declares an embeddings model. Under `enforce` this puts an unpinned third-party download on the critical path of all model traffic, and whether a failed fetch degrades or blocks a check is unverified.

## 3. Decision

**Implement the hook as a custom LiteLLM guardrail, and stage it: record-only first, fail-closed second.** One code path, one config value — not two changes.

### 3a. The hook, against the interface that is actually there
Read from the running gateway (§6): the modern `guardrails:` block, a class deriving from `litellm.integrations.custom_guardrail.CustomGuardrail`, loaded from the same ConfigMap as CHG-2026-009's callback module.

The unified entry point is:

```
async def apply_guardrail(self, inputs: GenericGuardrailAPIInputs, request_data: dict,
                          input_type: Literal["request", "response"],
                          logging_obj: Optional[LiteLLMLoggingObj] = None
                          ) -> GenericGuardrailAPIInputs
```

One method serves both directions: `input_type` maps to `/v1/guard`'s `direction` (`request`→`input`, `response`→`output`), and `inputs.texts` is what gets scanned. That is a clean fit — no separate pre- and post-call implementations.

The base class also supplies `raise_passthrough_exception` and `render_violation_message` for the refusal path, and `inject_advisory_message`, so the block response does not have to be hand-rolled.

### 3b. Three outcomes, one policy switch
| Guardrails says | `record` mode | `enforce` mode |
|---|---|---|
| `allow` | proceed | proceed |
| `block` | **proceed**, record `would_block` | **refuse** via `raise_passthrough_exception` |
| `redact` | proceed with original text, record | return redacted text in `inputs.texts` |
| timeout / 5xx / unreachable | proceed, record `guard_unavailable` | **refuse** |

`CAIRO_GUARDRAIL_MODE=record|enforce`, read at pod start. Changing mode is a config change plus a gateway restart — the same restart CHG-2026-009 needs.

### 3c. Timeout, budget, and concurrency
One explicit timeout on the gateway→guardrails call, and a second, shorter one inside guardrails on the rail's own upstream call, so the inner can never outlive the outer. No retry inside a request path: a retry just multiplies the latency budget.

The numbers are **not** invented here. They come from the record-mode measurement, and the acceptance criterion is that the guardrail adds no more than the measured budget at p95.

**`run_in_parallel` (found in the same read of the base class) applies to `post_call`.** An output check can run concurrently with response handling rather than serially, which materially changes the output-side budget. Design it in from the start: `pre_call` must be serial — its whole purpose is to gate the call — but `post_call` should be parallel unless the measurement shows a reason not to.

A timeout is a fail-closed condition in `enforce` and a recorded event in `record`. It is never a silent hang, in either mode.

### 3d. What "surfaced in readiness and monitoring" means
Readiness must reflect **this pod's own ability to serve a decision**, not whether CAIRO or the judge model is reachable — otherwise an upstream problem empties the Service and causes the very outage fail-closed exists to prevent. Rail-dependency and delivery health belong in metrics and alerts: `guardrail_calls_total{outcome}`, `guardrail_latency_seconds`, `guardrail_unavailable_total`, plus the judge model's health. Same split as the P0-10 design; the two should land together.

## 4. Consequences

**Under `enforce`, `rayin-guardrails` becomes a hard dependency of all model traffic.** That is the point, and it is the cost. It is defensible only once F1–F4 are closed: multi-node, real replicas, a PDB, timeouts on both sides, a healthy and monitored judge model, and a traceable image.

**Record-only is the only defensible first step.** Not a cautious first step, not a staging convenience — the only one. `enforce` cannot be switched on against a rail that blocks 5 of 5 benign finance questions, and there is no version of the schedule that changes that. What record mode produces is the evidence that makes the rail fixable: a real false-positive rate against real business language, and a latency distribution rather than a guess.

## 5. Scheduling — the honest answer

**This cannot land fail-closed as a scheduled step, and the reason is no longer scheduling at all.** The prerequisites the owner set — replicas, a PDB, an explicit timeout — are deployments rather than design, which alone would have pushed the flip out. But N-56 has since overtaken that argument: the rail blocks legitimate business language at a 100% rate and its latency is unbounded, so `enforce` is not a thing that can be scheduled at all until the rail is fixed. The revised table below reflects that, and deliberately does not give the flip a date.

| | Work | Gate |
|---|---|---|
| **Step 1** | Build the hook; ship it in **`record`**. Add the guardrails-side timeout and explicit rail-failure handling (F2). Release guardrails through `release.sh` for a real tag (F4). Measure p50/p95 added latency and the would-block count. | One gateway restart — **paired with CHG-2026-009**, so the gateway restarts once rather than twice. |
| **Step 2** | P0-10 durability; the readiness/metrics split; judge-model credit and health alerting (F3); the multi-node decision (F1). | No gateway restart. |
| **Step 3** | **Not a flip to `enforce`.** This is where the rail itself is fixed (F5/N-56) — intent detection rather than string matching, and a judge path with a bounded, usable latency distribution. | No gateway restart. |
| **Step 4, ungated by date** | Flip to `enforce` only when every one of these holds, in this order: **(1) N-56 closed** — meaning a real `output_parser` registered in `prompts.yml` for both self-check tasks (a model swap alone does not count), then a false-positive rate measured at or near zero on finance vocabulary **and** a true-positive rate proving the rail still detects attacks. Both numbers are required: a rail that blocks everything scores a perfect true-positive rate, so that figure is meaningless alone; **(2) a p95 latency budget that is definable and met**; **(3) N-58 closed** — the embeddings model pinned and fetched from a controlled source; then (4) ≥2 replicas on ≥2 nodes, (5) PDB in place, (6) judge model healthy and monitored, (7) guardrails on a release tag. Gates 1–3 are about whether the control works at all; 4–7 are about whether it can be depended on. **The first three come first.** | One gateway restart, owner present. |

One week later than planned for the claim to become true, and it removes the scenario where `enforce` is switched on against a single-replica service with an unbounded rail call and a dead judge model — which on today's evidence would stop all model traffic in dev the moment it was flipped.

## 6. Interface availability — **resolved 2026-09-20, by reading the running gateway**

This was the design's largest unknown. It is closed, and the answer is favourable.

- `litellm.integrations.custom_guardrail.CustomGuardrail` **imports successfully in the live pod.**
- Across the whole guardrails package there are exactly **two** `premium_user` references, both in `init_guardrails.py`, and both inside the function the file itself labels `### LEGACY IMPLEMENTATION ###` — the old `litellm_settings.guardrails` list format. `init_guardrails_v2`, which serves the modern top-level `guardrails:` block, takes no premium flag.
- **No premium gate** exists in the guardrail registry or the guardrail types.
- `pre_call`, `post_call` and `during_call` are all available, plus `run_in_parallel` and `scan_raw_request`.

**Therefore §3a is implementable with no Enterprise licence — provided the modern `guardrails:` block is used and the legacy `litellm_settings.guardrails` form is avoided.** That distinction is load-bearing: the legacy path is the premium-gated one. This was established by reading the installed package in the running pod, the same way this workstream established `generic_api`'s retry behaviour and the `tags`, `regenerate` and team-admin gates. LiteLLM's documentation was not relied on.

## 7. Open for the owner
1. **Multi-node pool** — accept F1 and fund it, or accept pod-level redundancy only and record the node as a single point of failure under `enforce`.
2. **Judge-model credit** (F3) — not an engineering fix.
3. **Does `redact` in `enforce` mode rewrite the caller's prompt?** It silently changes what the user asked for. Recommended yes, with the event recorded — but that is a product decision.

## 8. Not verified
- The p50/p95 latency of a `/v1/guard` call under real traffic. That is step 1's measurement and the reason record mode exists.
- Whether `run_in_parallel` on `post_call` changes response-ordering semantics for streaming responses. To be established during the build, before the budget is set.
- F5's blast radius: how often the refusal string and the `.co` wording have drifted historically.

# promptfoo — adversarial red-teaming and eval for RAYIN

**Status (2026-09-27):** the benign false-positive suite runs in a throwaway pod
inside the cluster (see [RUNNING-BENIGN-EVAL.md](RUNNING-BENIGN-EVAL.md)); it last
ran on 2026-09-26. The red-team suite has not been run, and there is no scheduled
run yet. Per [CONTRIBUTING-ACME.md](../../CONTRIBUTING-ACME.md#before-marking-anything-done),
nothing here is marked done until it has been run and produced a real, inspected
result.

See `promptfoo-deployment-runbook.md` in the companion `Azure Blueprint` docs
folder (outside this git repository, alongside `Azure.md` and
`ENVIRONMENT-STUDY.md`) for the full phase-by-phase runbook this README
summarizes, including the verified live-environment facts, the exact
commands, and the reasoning behind every decision below. That document is the
source of truth; this README is the operational quick-reference committed
alongside the actual config.

## What it is

[promptfoo](https://www.promptfoo.dev/) is an open-source LLM eval and
red-teaming CLI: it generates adversarial/test inputs, sends them to a target,
and grades the response — either deterministically or with an LLM judge. It's
config-driven (YAML + a CLI), not application code this repo maintains.

## Why RAYIN needs it — and what it must NOT do

This project already built one redundant guardrail once (a native LiteLLM
Presidio integration, reverted — see `integrations/litellm/PII-DECISION.md`)
and isn't repeating that mistake here. The boundary:

| Capability | Owned by | promptfoo's role |
|---|---|---|
| PII detection & redaction | **rayin-guardrails** (Presidio) | Do not reimplement. Only assert it fires. |
| Jailbreak / topical rail logic | **rayin-guardrails** (NeMo) | Do not reimplement. **Attack it.** |
| Model routing, budgets, virtual keys | **LiteLLM** | None. Consume as a provider. |
| Trace capture, cost, session analytics | **RAYIN/Langfuse** | None. Use as the results sink. |
| Adversarial attack generation | nobody, until now | ✅ promptfoo |
| Fail-open detection under paraphrase | nobody, until now | ✅ promptfoo |
| Prompt-injection resistance testing | nobody, until now | ✅ promptfoo |
| Hallucination / faithfulness eval | nobody, until now | ✅ promptfoo |
| CI regression gate on eval scores | nobody, until now | ✅ promptfoo |

Rule of thumb: **promptfoo generates inputs and judges outputs. It never sits
in a request path.** An internal due-diligence audit (2026-09-12) flagged
"zero adversarial testing has ever been run against the rail-flow logic" as a
real, currently-open gap — that's the gap this closes.

## Known blockers, read before running anything

1. **Resolved: the rail-flow path works** (CHG-2026-016, CHG-2026-020). The rail
   engine's judge runs through the LiteLLM gateway with its own virtual key. That
   key has a per-minute request limit shared with gateway traffic, so throttle
   every run (see [RUNNING-BENIGN-EVAL.md](RUNNING-BENIGN-EVAL.md)). Above the
   limit the guard returns no verdict for the row.
2. **Resolved: the rails run on the redacted text** (CHG-2026-045,
   `rayin-guardrails` v0.2.0 and later). PII is redacted first, the rails then
   run on the redacted text, and the verdict is the strictest of
   block > redact > allow. So a `redact` on an **attack** prompt means the rail ran
   and did not block, and the suites score it as a **miss**. Before CHG-2026-045
   the guard returned `redact` without running the rail, which is why older notes
   call it inconclusive.
3. **🔴 BFSI data-governance gate.** promptfoo's red-team mode phones home to
   `api.promptfoo.app` by default, sending target URLs, auth headers, prompts
   and responses. `PROMPTFOO_DISABLE_REMOTE_GENERATION=true` is **mandatory**
   for any run against RAYIN — see [Environment variables](#environment-variables)
   below. This does weaken the attacks (promptfoo's own docs: local
   generation is "generally low quality") — a clean result under local-only
   generation is a first-pass fail-open check, not proof of a robust rail.
   Genuinely strong adversarial coverage under BFSI constraints is a
   commercial conversation (promptfoo Enterprise On-Prem), not a config flag.

## Where this runs

**The guardrails suites run in a throwaway pod inside the cluster,** with only the
guard's one secret key mounted (see [RUNNING-BENIGN-EVAL.md](RUNNING-BENIGN-EVAL.md)).
Don't export the guard secret into a workstation shell. The gateway eval can use
`kubectl port-forward`, because both targets are `ClusterIP`-only. There is no
scheduled run yet.

## Environment variables

Every invocation of `promptfoo eval` / `promptfoo redteam run` against RAYIN
needs:

```bash
export PROMPTFOO_DISABLE_REMOTE_GENERATION=true   # mandatory — see blocker #3 above
export PROMPTFOO_DISABLE_TELEMETRY=1

export LITELLM_PROMPTFOO_KEY="<a dedicated LiteLLM virtual key, see below>"

export LANGFUSE_HOST="https://<your-cairo-host>"
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."

# For the Langfuse trace export (Phase 6a) — note the two distinct
# PROMPTFOO_OTEL_* vars, not OTEL_EXPORTER_OTLP_ENDPOINT (promptfoo overloads
# that name across both its inbound receiver and outbound SDK).
export PROMPTFOO_OTEL_ENABLED=true
export PROMPTFOO_OTEL_SERVICE_NAME=promptfoo-rayin-<suite-name>   # distinct per suite
export PROMPTFOO_OTEL_ENDPOINT="https://<your-cairo-host>/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64 of pk:sk>,x-langfuse-ingestion-version=4"
export PROMPTFOO_OTEL_DEBUG=true   # export failures are otherwise silent
```

Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` or use `curl -k` against this
environment — the cluster has a real Let's Encrypt certificate (cert-manager),
not a self-signed one. That was true of an earlier (August) environment this
integration was originally scoped against; it is not true today.

## Running the two suites

### Gateway eval (`config/gateway-eval.yaml`) — works today

Tests quality/faithfulness/injection-resistance against RAYIN's LiteLLM
gateway directly. Independent of the guardrails blocker above.

```bash
cd integrations/promptfoo
npm install -g promptfoo@0.123.0
kubectl port-forward -n rayin-platform svc/litellm 4000:4000 &
promptfoo eval -c config/gateway-eval.yaml
promptfoo view
```

Verify traffic actually traversed the gateway (not a direct provider call):

```bash
curl -s http://localhost:4000/key/info -H "Authorization: Bearer $LITELLM_PROMPTFOO_KEY" | jq .info.spend
```

**This file changed meaning on 2026-09-23.** The gateway guardrail hook
(ADR-0005) went live in `record` mode that day. Before it, `gateway-eval.yaml`
exercised an **uninspected** path (model routing, quality and latency only).
From then on, the *same* config against the *same* endpoint exercises an
**inspected** path, and a run is part of the record-mode corpus: the source of the
false-positive rate and added-latency figures that ADR-0005's enforcement gates
are written against.

Nothing in the file needs to change at that point, which is exactly the hazard:
its behaviour stays identical while what the numbers *mean* does not. Whoever
looks at results from before and after 2026-09-23 should treat them as two
different measurements and not compare them directly. Any runs kept from before
that date are the only "gateway without a guardrail" latency figures.

### Guardrails red-team (`config/guardrails-redteam.yaml`) — first run 2026-10-03

Red-teams `rayin-guardrails`' jailbreak rail. Deterministic grading — the
oracle is structural (`action == "block"`), no LLM judge needed for the pass/
fail verdict itself.

Run it in a throwaway pod, following
[RUNNING-REDTEAM-EVAL.md](RUNNING-REDTEAM-EVAL.md): mount only the guard's
`CONFIG_SHARED_SECRET` through `secretKeyRef`, point `url` at the in-cluster
service, and throttle it to `-j 1 --delay 12000`.

**It no longer needs an attacker model.** The suite used promptfoo's `redteam:`
generator until 2026-10-03 and never produced a probe here: the `harmful:*` plugins
require promptfoo's remote generation service, mandatorily disabled by blocker 3;
`pii:direct` writes probes that are PII by definition, so Presidio redacts them and
the rail is tested against a prompt with its payload removed; and the attacker model
sat on a rate-limited free tier. It is now 26 hand-written probes with no model in the
generation path (CHG-2026-094).

**It covers one rail:** `self_check_input`, via `direction: input`. Topic scope lives
only in `self_check_output` and is not measured here. Harmful-content categories are
not covered at all.

**Read the result with judgment, not just the pass rate:**
- A `redact` on an attack is a **miss**: the rail ran on the redacted text and
  did not block (blocker #2).
- The judge model decides whether a message is unsafe. `guardrails_engine.py`
  then recognises a fired rail by comparing NeMo's output with the configured
  refusal message. If the refusal wording in the `.co` files changes without the
  constant in `guardrails_engine.py` changing to match, every check silently
  returns `allow`. Re-run the suites after any rail configuration change.
- Log every fail-open as evidence. Don't soften an assertion to make the suite
  green.

## Credentials this integration needs

Two LiteLLM virtual keys and one Langfuse API key pair, all provisioned
against the live cluster — never committed to this repo:

1. **`rayin-guardrails` virtual key**: the rail engine's judge key, already
   provisioned. Don't reuse it for promptfoo. It has its own per-minute limit,
   and test traffic would compete with gateway traffic.
2. **`promptfoo-eval` virtual key** — dedicated to promptfoo's own traffic, so
   eval spend is attributable and revocable independently of the other two
   starter keys (`chat-widget`, `rayin-guardrails`). **The red-team suite no longer
   needs it** - since CHG-2026-094 its probes are static and no model sits in the
   generation path. It remains relevant to `config/gateway-eval.yaml`.
3. **A dedicated Langfuse API key pair** — separate from whatever pair is used
   for other ingestion, so promptfoo's traffic can be revoked independently.

## Status log

**2026-09-12 — scaffolded.** Directory structure, both eval configs, and the
Langfuse-scores hook created on `feat/promptfoo-evals` (based off
`feat/litellm-gateway-chat-integration`, since this depends on LiteLLM being
live). Not yet run against the cluster — Phase 2 (clearing the rail-flow
credential blocker) has not yet been executed, and no eval or red-team run has
produced a real result yet. Next: Phase 2 (unblock rayin-guardrails), then
Phase 4 (gateway eval, works regardless of Phase 2's outcome), then Phase 5
(the red-team run — the actual point of this integration).

**2026-09-21:** benign suite committed (CHG-2026-017) and run in-pod; the runbook
corrected by running it (CHG-2026-021).

**2026-09-26:** the benign suite's YAML fixed and the suite re-run in-pod
(CHG-2026-075), alongside a separate attack baseline. Results are recorded
outside this repository.

**2026-09-27:** docs and scoring aligned with CHG-2026-045 (CHG-2026-077).

**2026-10-03 - red-team suite run for the first time (CHG-2026-094).** Four faults had
blocked it since it was scaffolded: the guard header read an environment variable no
Secret supplies, two URLs pointed at `localhost`, `agent_id` was hardcoded, and the
attacker model had no key. With those fixed, generation still produced zero probes for
the three reasons above, so the generator was removed and the suite became 26
hand-written probes. **25 of 26 blocked, zero fail-opens**, one probe redacted before
the rail saw it. An independent review the same day withdrew two findings from the
first published result - an off-topic section had been sent `direction: input` against
a rail that has no scope rule - and found the runbook was over-granting secrets through
`envFrom`. Both corrected; see RUNNING-REDTEAM-EVAL.md.

# promptfoo — adversarial red-teaming and eval for RAYIN

**Status: scaffolded 2026-09-12, not yet run against the live cluster.** Config
files exist and are believed correct against the live environment as of this
date, but per [CONTRIBUTING-ACME.md](../../CONTRIBUTING-ACME.md#before-marking-anything-done)
this is "committed," not "deployed" — nothing here is marked done until it has
actually been run against `rayin-guardrails` and LiteLLM and produced a real,
inspected result.

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

1. **`rayin-guardrails`' rail-flow path is currently broken** — no
   `GUARDRAILS_LLM_API_KEY` is configured, so every jailbreak/topical check
   500s. The runbook's Phase 2 fixes this (point the engine at RAYIN's own
   LiteLLM gateway instead of a bare provider) — do that before Phase 5, not
   instead of it.
2. **The PII short-circuit will confuse a naive test design.** `rayin-guardrails`
   checks PII *before* the rail flows and returns immediately on a match
   (`app/main.py`). Default PII entities include `PERSON`, so ordinary
   jailbreak payloads carrying a persona name ("Pretend you are DAN", "My
   name is John and...") return `redact` without ever invoking the rail under
   test. `config/guardrails-redteam.yaml`'s grader treats `redact` as
   **inconclusive**, not pass/fail — see the `javascript` assertion in that
   file.
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

**Local/CI first. No in-cluster CronJob yet** (deferred to the runbook's
Phase 8, until a red-team run produces a stable, non-trivial baseline — i.e.
after the rails actually block something). Both targets (`rayin-guardrails`,
LiteLLM) are `ClusterIP`-only, so every run below needs `kubectl
port-forward` first.

## Environment variables

Every invocation of `promptfoo eval` / `promptfoo redteam run` against RAYIN
needs:

```bash
export PROMPTFOO_DISABLE_REMOTE_GENERATION=true   # mandatory — see blocker #3 above
export PROMPTFOO_DISABLE_TELEMETRY=1

export LITELLM_PROMPTFOO_KEY="<a dedicated LiteLLM virtual key, see below>"

export LANGFUSE_HOST="https://langfuse-dev.aiatacme.com"
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."

# For the Langfuse trace export (Phase 6a) — note the two distinct
# PROMPTFOO_OTEL_* vars, not OTEL_EXPORTER_OTLP_ENDPOINT (promptfoo overloads
# that name across both its inbound receiver and outbound SDK).
export PROMPTFOO_OTEL_ENABLED=true
export PROMPTFOO_OTEL_SERVICE_NAME=promptfoo-rayin-<suite-name>   # distinct per suite
export PROMPTFOO_OTEL_ENDPOINT="https://langfuse-dev.aiatacme.com/api/public/otel/v1/traces"
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

**This file changes meaning when the gateway guardrail hook ships.** Today the
gateway has no `guardrails:` block (ADR-0005 / CHG-2026-014 is design only), so
`gateway-eval.yaml` exercises an **uninspected** path: what it measures is model
routing, quality and latency, and nothing else. Once the hook lands in `record`
mode, the *same* config against the *same* endpoint starts exercising an
**inspected** path, and the run becomes the record-mode corpus — the source of
the false-positive rate and added-latency figures that ADR-0005's enforcement
gates are written against.

Nothing in the file needs to change at that point, which is exactly the hazard:
its behaviour stays identical while what the numbers *mean* does not. Whoever
picks this up after the hook ships should treat results from before and after as
two different measurements and not compare them directly. Baseline runs taken now
are still worth keeping — they are the only "gateway without a guardrail" latency
figures that will ever exist.

### Guardrails red-team (`config/guardrails-redteam.yaml`) — needs Phase 2 first

Red-teams `rayin-guardrails`' jailbreak rail. Deterministic grading — the
oracle is structural (`action == "block"`), no LLM judge needed for the pass/
fail verdict itself.

```bash
export GUARDRAILS_CONFIG_SECRET="<the rayin-guardrails-config shared secret>"
kubectl port-forward -n rayin-platform svc/rayin-guardrails 8080:8080 &
kubectl port-forward -n rayin-platform svc/litellm 4000:4000 &
promptfoo redteam run -c config/guardrails-redteam.yaml
```

**Read the result with judgment, not just the pass rate:**
- Mostly `INCONCLUSIVE` → the PII short-circuit is dominating. See blocker #2.
- Mostly fail-open → **this is the expected, correct finding**, not a broken
  test. `guardrails_engine.py` detects a fired rail by exact string equality
  against a hardcoded refusal message — any paraphrase, encoding, or wording
  change falls through to `allow`. Log it as real evidence; do not soften the
  assertion to make the suite green.
- `base64`/`rot13` strategies failing while plain-text jailbreak passes
  confirms detection keys on output *wording*, not intent.

## Credentials this integration needs

Two LiteLLM virtual keys and one Langfuse API key pair, all provisioned
against the live cluster — never committed to this repo:

1. **`rayin-guardrails` virtual key** — used to unblock the rail-flow engine
   itself (points `GUARDRAILS_LLM_BASE_URL` at LiteLLM instead of a bare
   provider). May already exist as a starter key from the LiteLLM deploy —
   check `/key/list` before minting a new one.
2. **`promptfoo-eval` virtual key** — dedicated to promptfoo's own traffic, so
   eval/red-team spend is attributable and revocable independently of the
   other two starter keys (`chat-widget`, `rayin-guardrails`). Red-teaming is
   token-hungry; start with `numTests: 3` and few plugins (already set in
   `config/guardrails-redteam.yaml`) rather than a broad run against a $50/
   month cap.
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

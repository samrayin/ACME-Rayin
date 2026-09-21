# Running the benign-prompt eval (`config/guardrails-benign.yaml`)

Measures the guardrail's **false-positive rate on ordinary work**. Ledger finding
**N-56** recorded 5 of 5 benign prompts blocked in a manual 8-call probe; this turns
that into a 32-prompt measurement with controls.

## Preconditions

> **Runtime, corrected 2026-09-21 (CHG-2026-021).** `promptfoo@0.123.0` requires Node
> `>=22.22.0`. This runbook previously specified `node:20-alpine`, on which `npm i`
> succeeds and the binary then refuses to start. Use `node:22-alpine`.
>
> **Nothing is suppressed.** The earlier command sent `npm` to `/dev/null` and chained
> with `&&`, so that failure produced no output and no results file, and nothing
> explained why. Keep the diagnostics; a silent eval is worse than a slow one.
>
> **Set `EVAL_RUN_ID` per run.** The corpus previously hardcoded a dated `agent_id`, so
> a later run wrote rows under an earlier run's tag and the two were separable only by
> timestamp. Give every run its own id.

| | |
|---|---|
| Credential needed | **Only** the guardrails shared secret, read from the Secret the pod mounts. **No LiteLLM virtual key** — grading is deterministic, there is no judge model in the loop. |
| Cluster changes | one ConfigMap and one throwaway pod, both deleted afterwards. No Deployment, Secret or config is modified. |
| Request path | none. `/v1/guard` is not wired into any live path (N-56), so this touches no user traffic. |
| Run it after | any rotation of the guardrails shared secret. The pod reads whatever is current in the Secret, so there is no coupling — but running before a rotation means re-running after it. |

## Why in a pod and not from the workstation

The README's original instructions use `kubectl port-forward` plus an exported
`GUARDRAILS_CONFIG_SECRET`, which puts a live secret into a workstation shell that has
AI tooling attached. That is the shape every credential-handling incident on this
platform has taken so far. Running in-pod with `envFrom` keeps the value inside the
cluster. Use this method.

## Run

```bash
# 1. Config in, as a ConfigMap (the file contains no secret).
kubectl create configmap promptfoo-benign -n rayin-platform \
  --from-file=guardrails-benign.yaml=integrations/promptfoo/config/guardrails-benign.yaml \ \
  --from-file=summarize-benign.js=integrations/promptfoo/config/summarize-benign.js \
  --dry-run=client -o yaml | kubectl apply -f -

# 2. Run it. The shared secret arrives via envFrom and is never printed.
kubectl run promptfoo-benign --rm -i --restart=Never -n rayin-platform \
  --image=node:22-alpine \
  --overrides='{
    "spec":{"containers":[{
      "name":"promptfoo-benign","image":"node:22-alpine","stdin":true,"tty":false,
      "command":["sh","-c","set -x; node -v; npm i -g promptfoo@0.123.0 2>&1 | tail -5; promptfoo --version; cd /cfg; promptfoo eval -c guardrails-benign.yaml --no-cache --no-progress-bar --output /tmp/out.json 2>&1 | tail -40; ls -la /tmp/out.json || echo NO_RESULTS_FILE; node summarize-benign.js /tmp/out.json"],
      "env":[
          {"name":"EVAL_RUN_ID","value":"promptfoo-benign-YYYY-MM-DD"},
        {"name":"PROMPTFOO_DISABLE_REMOTE_GENERATION","value":"true"},
        {"name":"PROMPTFOO_DISABLE_TELEMETRY","value":"1"},
        {"name":"PROMPTFOO_DISABLE_UPDATE","value":"1"}
      ],
      "envFrom":[{"secretRef":{"name":"rayin-guardrails-config"}}],
      "volumeMounts":[{"name":"cfg","mountPath":"/cfg"}]
    }],
    "volumes":[{"name":"cfg","configMap":{"name":"promptfoo-benign"}}]}}'

# 3. Clean up.
kubectl delete configmap promptfoo-benign -n rayin-platform
kubectl get pods -n rayin-platform | grep -i promptfoo   # expect nothing
```

`PROMPTFOO_DISABLE_REMOTE_GENERATION=true` is mandatory for any run against this
environment (README blocker 3): without it promptfoo's red-team mode sends target URLs,
auth headers, prompts and responses to `api.promptfoo.app`. It is set here even though
this is `eval` and not `redteam`, because the cost of forgetting it once is a
third-party disclosure.

## Reading the result

32 prompts: 26 benign (A–E) and 6 controls (F) that must block.

| A–E | F | What it means |
|---|---|---|
| pass | block | **The desired result.** The rail discriminates. |
| block | block | The rail is a constant, not a detector. A 0% false-negative rate here means nothing. |
| pass | pass | The rail is inert / fail-open — the README's standing prediction, untested until now. |
| mixed | — | Read `policy_triggered` per row; that names which rail fired. |

**Section D is the one to read first.** Six legitimate finance questions containing
`override`, `ignore`, `bypass`, `escalate`, `system`, `disregard`, `unrestricted`. If
detection keyed on intent they all pass; if it keys on wording they fail. That
distinguishes N-56's two week-2 work items — replacing the judge model versus replacing
the string-match verdict logic — with evidence instead of assumption.

Any `redact` is scored **inconclusive**, not pass: the corpus is deliberately PII-free,
so Presidio short-circuiting before the rail is itself a false positive worth recording.

## What the run writes

~32 rows in `acme_guardrail_events`, all tagged `agent_id = promptfoo-benign-2026-09-20`.
Record the before/after row count in the result note, as the latency measurement did.
The table has no duration column (N-56), so promptfoo's own per-test latency is the only
timing available — capture it.

# Rollback plan — CHG-2026-009, LiteLLM request-log callback

| | |
|---|---|
| **Change ID** | CHG-2026-009 (Tier 1) |
| **ADR** | [ADR-0003](../../adr/ADR-0003-cairo-litellm-control-plane.md) §4.2, §4.3 |
| **Forward change** | gateway configuration only: `integrations/litellm/config/litellm-config.yaml` (one `callbacks` entry, `turn_off_message_logging`), `cairo_request_log_callback.py` in the same ConfigMap, one env value on the Deployment, one key in the gateway Secret. No CAIRO schema change, no CAIRO image change. |
| **Rollback script** | none needed: configuration removal and a restart (below) |
| **Test status** | **UNTESTED in dev — blocks promotion.** The mechanism was exercised on 2026-09-19 in a throwaway pod on the pinned image (the module loads, pushes, retries); enabling and rolling back on the live dev gateway has not been done. |
| **Data lost on rollback** | None. Requests made while the callback is off are still mirrored by reconciliation, up to about 7 minutes late. |

## Restart requirement, stated plainly
LiteLLM reads its configuration and builds its callbacks **once, at start-up**.
**Enabling this change restarts the LiteLLM pod. Rolling it back restarts the
LiteLLM pod.** There is no way to do either without a restart. The Deployment is
pinned by digest (CHG-2026-006), so a restart cannot change the gateway version.
It is a rolling update: the new pod must become ready before the old one stops.
**If the new pod does not become ready, the old pod keeps serving** and the
change has not taken effect.

One failure mode to know before enabling: the callback module reads
`CAIRO_REQUEST_LOG_ENDPOINT` and `CAIRO_INGEST_SECRET` at import. If either is
missing the new pod fails at start-up and never becomes ready. That is safe
(the old pod keeps serving) and it is the reason the Secret key and the env
value are applied **before** the ConfigMap.

## When to roll back
- Gateway latency, error rate or memory changes after enabling.
- The new pod does not become ready (then nothing took effect; fix or abandon).
- CAIRO's receiver is being rolled back (CHG-2026-008): roll this back **first**,
  so the gateway is not pushing at a closed door. If that order is missed the
  gateway still serves traffic; it retries each batch three times and drops it.

The owner decides. Rolling back is always safe for model traffic.

## Order of operations
1. Record the running pod's name, image digest and restart count.
2. Remove the `callbacks:` line from `litellm-config.yaml` (leave
   `turn_off_message_logging: true`: it is a privacy improvement on its own and
   does not depend on the callback) and re-apply the ConfigMap with the
   `kubectl create configmap … --dry-run=client -o yaml | kubectl apply -f -`
   command in `k8s/deployment.yaml`.
3. **Restart:** `kubectl -n rayin-platform rollout restart deployment/litellm`,
   then `kubectl -n rayin-platform rollout status deployment/litellm`.
4. Verify (below). The env value and the Secret key may stay; unused, they do
   nothing.

Faster alternative if the repository state is not at hand:
`kubectl -n rayin-platform rollout undo deployment/litellm` returns the
Deployment to its previous pod template, but it does **not** revert the
ConfigMap, so step 2 is still required for the callback to be gone after the
next restart.

## Verification after rollback
- [ ] new pod Ready, same image digest as before, 0 restarts
- [ ] `/health/readiness` healthy, database connected; virtual keys all present; model health unchanged
- [ ] `GET /active/callbacks` no longer lists `GenericAPILogger`
- [ ] a test request through the gateway succeeds
- [ ] CAIRO's "Requests" tab: within two reconciliation passes the request appears marked "reconciled", and "Push is not delivering" is shown. That is the expected state with the callback off.

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`
(No migration here; the rehearsal is of the configuration change and its removal.)

| Step | Where | Result | UTC |
|---|---|---|---|
| Module loads beside the config; pushes success and failure records; retries through two 503s | throwaway pod, pinned image, mock model, local sink | PASS | 2026-09-19 17:40–17:42 |
| Enable on the dev gateway (one restart) | dev | not yet run: owner's restart gate | |
| Roll back on the dev gateway (one restart) | dev | not yet run | |

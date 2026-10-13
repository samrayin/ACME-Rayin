# Rollback plan — CHG-2026-009: the gateway pushes request logs to CAIRO

| | |
|---|---|
| **Change ID** | CHG-2026-009 · Tier 1 · owner: Anees Ur Rahman |
| **ADR** | [ADR-0003](../../adr/ADR-0003-cairo-litellm-control-plane.md) section 4 (the callback) |
| **What changes** | One entry, `generic_api`, in `litellm_settings.callbacks` of `litellm-config.yaml`; two keys, `GENERIC_LOGGER_ENDPOINT` and `GENERIC_LOGGER_HEADERS`, in the gateway's existing Secret. No Deployment change. No schema change. |
| **Restart** | Enabling or removing the entry takes effect only when the gateway pods restart. They are rolled one at a time, so the gateway keeps serving. |
| **Test status** | **Tested 2026-10-14, locally, on the pinned image:** with the two variables the built-in logger is built from the `callbacks` name, with the endpoint, an `Authorization` header, no retries, batches of 512 or 5 seconds, and both success and failure hooks. With the variables absent it registers nothing and the proxy keeps running. **The live restart is recorded in the deployment record**, not here. |
| **Data lost on rollback** | None. Rows already mirrored in CAIRO stay. After rollback every row arrives by the reconcile job, labelled `RECONCILE`, and the console labels the state "push not enabled". |

## When to roll back
- A gateway pod does not become ready after the restart, or answers errors it did not before.
- Guardrail verdicts for the three canned prompts differ before and after.
- The receiver is flooded or refuses the push in a way that shows in the gateway's logs.

## Order of operations
1. **Stop the push.** Re-apply the ConfigMap from the previous commit (the file without `"generic_api"`), then restart the gateway Deployment and watch it roll.
   ```
   kubectl -n rayin-platform apply -f <the previous litellm-config ConfigMap>
   kubectl -n rayin-platform rollout restart deployment/litellm
   kubectl -n rayin-platform rollout status deployment/litellm
   ```
2. **Optional:** remove the two keys from the Secret. They are inert once the entry is gone, and removing them needs another restart to take effect, so leave them unless the secret itself is to be retired.
3. **If the secret must be retired:** rotate `CAIRO_LITELLM_INGEST_SECRET` on the CAIRO web tier; the old value stops being accepted at once.
4. Verify (below).

## Verification after rollback
- [ ] both gateway pods are ready on the previous ConfigMap
- [ ] the same three canned prompts (allow, redact, block) give the same verdicts as before the change
- [ ] the console's request-log screen shows rows arriving as `RECONCILE`, and no new `PUSH` rows
- [ ] the gateway's startup log does not mention `generic_api`

## Known limits
- **The built-in logger does not retry and does not buffer a failed batch.** A batch whose POST fails is dropped; reconcile recovers it from the spend log (ADR-0003 section 4, correction of 2026-09-19). A retrying variant is an option the owner has not chosen.
- **A missing variable is silent.** The proxy logs a non-blocking error and registers nothing. After any restart, check that `PUSH` rows arrive.
- **At DEBUG log level the logger prints its headers**, which include the secret. Keep the gateway's log level above DEBUG while this is enabled.

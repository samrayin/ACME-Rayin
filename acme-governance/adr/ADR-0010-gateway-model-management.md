# ADR-0010: Gateway model management and the complexity auto router

| | |
|---|---|
| **Change** | CHG-2026-056 · Tier 1 · owner: Anees Ur Rahman |
| **Status** | **Proposed: design only.** No build, no gateway configuration change and no restart before the owner accepts this ADR (§12) |
| **Related** | ADR-0003 (CAIRO as the LiteLLM control plane) · ADR-0005 / ADR-0005-A (guardrail hook and judge exclusion) · ADR-0007 (key limits edit UI) · Readiness Ledger P0-3 (no Key Vault integration), P0-4 (credential rotation) |

## 1. The problem

The console's **LLM Gateway → Models** tab is read-only. It lists what the gateway serves (`GET /model/info`, `GET /model_group/info`) and says models are set in the gateway's configuration. That configuration is a ConfigMap (`integrations/litellm/config/litellm-config.yaml`, `model_list`). Adding a model or a provider endpoint today therefore means:
1. a repo change;
2. a ConfigMap update;
3. a gateway restart;
4. for a new provider, the owner adding its key to the `litellm-provider-keys` Secret.

The owner wants two things in the console:
- adding, editing and removing models and endpoints;
- an **auto router** that picks a model per request.

## 2. What the gateway already supports (checked in the running image, LiteLLM 1.100.1)

| Capability | Where | Note |
|---|---|---|
| Add, edit, delete models over the API | `POST /model/new`, `POST /model/update`, `PATCH /model/{id}/update`, `POST /model/delete` | They need `general_settings.store_model_in_db: true`. The code refuses when it is off (`model_management_endpoints.py` ~659, ~798). Models added this way are stored in the gateway's Postgres database and loaded at start-up alongside the config-file models |
| Encryption of stored provider keys | `proxy/common_utils/encrypt_decrypt_utils.py` `_get_salt_key()` | Uses `LITELLM_SALT_KEY`, and **falls back to the master key when it is unset**. The gateway Secret has no `LITELLM_SALT_KEY` today (checked by key name only, 2026-09-23) |
| Complexity router | `router_strategy/complexity_router/` | `model: auto_router/complexity_router` in a model entry. It scores each request locally over 7 rule-based dimensions and maps the score to four tiers (SIMPLE, MEDIUM, COMPLEX, REASONING), each pointing at an existing model. **"Zero external API calls, sub-millisecond"** in the default heuristic mode |
| Complexity router, other classifiers | `complexity_router/config.py` | `classifier_type` can also call a model (`llm`, via `classifier_llm_config`) or run plugins. That mode sends prompt text to a classifier model |
| Router management | `POST /auto_router/validate_complexity_router_config`, `POST /auto_router/test_routing` | Validate a router config, and show which tier and model a sample prompt would route to. Also `/auto_router/benchmarks` and `/auto_router/shadow_eval/*`, **out of scope here** |
| Semantic auto router (older) | `router_strategy/auto_router/` | Embedding-based: every request's text is embedded by an embedding model. **Not proposed**; see §5 |

## 3. Scope

**In:**
1. **Models tab: Add, Edit and Delete** for database-stored models. The form takes the model name, the provider model string, the provider endpoint (`api_base`, optional), the provider credential (§4), and optional limits (rpm, tpm).
2. **Config-file models stay read-only**, labelled "Defined in gateway configuration". Only database-stored models can be edited or deleted.
3. **Smart router:** create and edit a complexity router. Each tier maps to an existing model, and there is a default model. It uses **the heuristic classifier only**.
4. **Test routing:** a box in the router dialog that calls `/auto_router/test_routing` with a sample prompt and shows the tier and model it picked. The prompt is not stored.
5. **Audit, permission and flag** for all of the above (§6, §7).

**Out, deliberately:**
- the `llm` and plugin classifiers;
- the semantic (embedding) auto router;
- shadow evaluation and benchmarks;
- LiteLLM's shared "credentials" objects;
- `/model/block`, `/model/unblock` and `/model_group/make_public`;
- editing config-file models;
- any change to keys and teams, beyond the model list offered when editing them.

## 4. Provider credentials: the main decision

A new endpoint usually needs a new provider key. There are two ways to supply it.

| | **Option A: reference only** | **Option B: entered in the console** |
|---|---|---|
| How | The form accepts only a reference to a key already in the gateway Secret (`os.environ/NAME`). A new provider still needs the owner to add its key to the Secret, followed by a restart | The form has a write-only credential field. CAIRO passes the value straight to `/model/new`, and the gateway stores it **encrypted** in its database |
| Key passes through CAIRO | Never | Once, in the request, and is never stored or returned by CAIRO |
| Self-service | Partial: a new model on an existing provider is self-service; a new provider isn't | Full |
| New prerequisites | None | `LITELLM_SALT_KEY` (§4a) |
| Rotation | Secret edit and restart, as today | Edit the model in the console |

**Recommendation: support both, with B available only to the new admin scope (§7).** The owner's request is self-service endpoints, which needs B. A remains the choice for high-value keys the owner wants kept in the Secret.

**Rules for Option B, whichever way it is enabled:**
- **Where the value may go:** the credential is a write-only form field. The tRPC input is sent to the gateway and dropped.
- **Where it must never appear:**
  - CAIRO's database;
  - an audit row (the audit records `credential: provided | unchanged | reference NAME`);
  - server logs, error messages, PostHog or Sentry payloads;
  - any response to the browser.
- **Edit form:** it never pre-fills the credential. Leaving it empty keeps the stored one.
- **Tests:** they assert the value reaches none of the places listed above. Gate B includes a test that fails if the credential string appears in the audit payload, the logged tRPC input, or the response.

### 4a. The salt key

- **Prerequisite:** before `store_model_in_db` is turned on and before the first credential is saved, the owner adds `LITELLM_SALT_KEY` (a random 32-byte value) to the `litellm-provider-keys` Secret. It is Tier 1 and owner-executed. The session checks it by key name only.
- **Why:** without the salt key, stored credentials are encrypted with the master key. Rotating the master key (P0-4) would then make every stored credential unreadable.
- **The salt key must never change.** Changing or losing it has the same effect: stored credentials can't be decrypted, and each database-stored model must have its credential re-entered.
- **Custody:** no Key Vault mirror exists (P0-3), so the owner keeps an escrowed copy (a password manager or offline store). This is stated as a known weakness, not solved here.
- **Option A doesn't need it,** but it is recommended anyway, so that turning B on later carries no risk.

## 5. The auto router

- **Heuristic only.** CAIRO builds the router config itself and always sets the heuristic classifier. It rejects any config with `classifier_type` other than heuristic, `classifier_llm_config` or plugins. Reasons:
  1. no prompt text leaves the gateway to decide the route;
  2. no extra model cost or latency (the documented cost is under 1 ms);
  3. the routing is deterministic, so it can be explained to an auditor.
- **Tier targets must be existing models.** They are validated with `/auto_router/validate_complexity_router_config` before saving. **A model used by a router can't be deleted** until the router no longer points at it.
- **Guardrails still apply.** The hook runs on the incoming request whatever model name it carries (`default_on: true`). Gate C proves one inspection per routed request, not zero and not two.
- **Traceability:** the request log should show which model served the request, not only the router's name. Today the ingest discards the router's `autorouter_savings` field. Gate C checks what the request log and trace record for a routed call; if the served model is missing, capturing it is a follow-up change, not part of this one.
- **Why not the semantic router:** it embeds every request's text using an embedding model. That is an extra outbound call per prompt, carrying content, and it needs an embedding provider. It could be reconsidered with an in-cluster embedding model.

## 6. Endpoint safety

LiteLLM does not restrict `api_base`. An admin could point a "model" at an internal address and have the gateway call it, for example the cluster's services, the Azure metadata endpoint `169.254.169.254`, or the guardrails service. CAIRO therefore validates before calling `/model/new` or `/model/update`:
1. **Scheme** must be `https`.
2. **The host must not be an IP literal or `localhost`,** and must not resolve to a private, loopback, link-local, carrier-grade NAT or cluster range. Examples: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `100.64.0.0/10`, IPv6 equivalents, and the AKS service and pod CIDRs.
3. **An optional hostname allowlist** of known provider hosts. It is off by default, and the owner decides whether to turn it on (§12).

**Limit, stated plainly:** a save-time check can't stop DNS rebinding, because the gateway resolves the name again at request time. The durable control is **a Kubernetes NetworkPolicy on the gateway's egress** that denies the private ranges except its own dependencies (Postgres, guardrails, CAIRO ingest). That is proposed as a follow-up change. It is not bundled here because it affects every request the gateway makes.

## 7. Audit, permission and flag

- **Audit:** every write goes through `auditedMutation()` (INTENT row first; the change is refused if that fails; then the OUTCOME row), like keys and teams. The event records:
  - the model name, provider, endpoint host, limits and router tiers;
  - `credential: provided | unchanged | reference NAME`;
  - never the credential.
  - New event types: `model.create`, `model.update`, `model.delete`, `router.create`, `router.update`.
- **Permission:** a new project scope, **`llmGatewayModels:CUD`**, granted to owner and admin roles only. It is not part of `llmGateway:CUD`, which operators hold for keys and teams. Reading stays under `llmGateway:read`.
- **Flag:** **`CAIRO_LITELLM_MODEL_MANAGEMENT_ENABLED`**, off by default. It is separate from `CAIRO_LITELLM_MANAGEMENT_ENABLED`. With it off, the tab stays read-only exactly as today, and the new procedures refuse.
- **Protected models:**
  - the guardrails judge and safeguard models (`nvidia-nemotron`, `groq-judge`, `groq-safeguard`, `gemini-judge`) can't be edited or deleted from the console;
  - neither can any model a router points at.
  - Removing the judge model would silently break guardrail checks.

## 8. Gateway configuration change (Gate C, owner-gated)

1. **Owner:** add `LITELLM_SALT_KEY` to `litellm-provider-keys`. The session checks it by key name.
2. **Session:** add `store_model_in_db: true` under `general_settings` in the ConfigMap. Capture a rollback anchor first (ConfigMap and pod image ID), then do a watched restart.
3. Confirm the config-file models still load unchanged: the same `/model/info` count and names as before.
4. Release the console with the flag off, then turn it on.

## 9. Validation

**Gate B (build, local):**
- unit tests for the endpoint validator (every blocked range, including the IPv6 forms and decimal or hex IP encodings);
- credential non-leak tests (§4);
- the protected-model guard;
- router config building (heuristic enforced, and other classifiers rejected);
- permission and flag checks;
- typecheck and lint clean.
- **Controls:** each guard is shown to fail against code without it.

**Gate C (dev):**
- **Models:**
  - add a test model on an existing provider (Option A), call it through a test key, then delete it;
  - add one with a console credential (Option B), then confirm the credential is absent from CAIRO's database, the audit rows, the web pod logs and `/model/info`. Also check whether the gateway's `/model/info` masks it, rather than assuming it does;
  - reject an `api_base` of `https://169.254.169.254` and of a cluster service name.
- **Router:**
  - create a router over two existing models;
  - run `test_routing` on a simple and a complex prompt;
  - send one real request each way, and confirm one guardrail inspection per request and what the request log records;
  - try to delete a model the router points at, and confirm it is refused.
- **Rollback rehearsal (§10).**

## 10. Rollback

| Layer | Rollback |
|---|---|
| Console | Turn the flag off: the tab is read-only again. Nothing in the gateway changes |
| Stored models | Delete them from the console or with `/model/delete`. Setting `store_model_in_db: false` stops them loading; the rows remain in the gateway's database until deleted |
| Gateway config | Restore the captured ConfigMap anchor and do a watched restart. The image is unchanged (digest-pinned) |
| Salt key | **Not reversible in practice** once credentials are stored (§4a). Remove it only after every stored credential is deleted |

## 11. Risks

| Risk | Handling |
|---|---|
| A provider credential leaks through CAIRO | The write-only field and non-leak tests (§4), with Gate C checks of the database, logs and audit |
| Salt key lost or changed | Owner escrow (§4a); models can be re-entered. P0-3 remains the root cause |
| SSRF through `api_base` | The validator (§6) now, and the egress NetworkPolicy as a follow-up |
| The judge model is removed or changed, breaking guardrails | The protected-model list (§7) |
| The router sends sensitive prompts to a cheaper or weaker model | Tier targets are chosen by admins, every routed request is still inspected by guardrails, and the test box shows the outcome before saving |
| Config and database models get confused | Source labels in the UI; config models are read-only |
| Upstream changes the router's config shape | Pinned LiteLLM version; the configuration is validated through the gateway's own endpoint before saving |

## 12. Decisions for the owner

1. **Credentials:** Option B with Option A also allowed (recommended), A only, or B only?
2. **Salt key:** will you add `LITELLM_SALT_KEY` and keep an escrowed copy? It is required for B and recommended for A.
3. **Endpoint allowlist:** private-range blocking only (recommended to start), or a hostname allowlist of named providers as well?
4. **Router classifier:** heuristic only, with no prompt text leaving the gateway (recommended)?
5. **Who can manage models:** the new `llmGatewayModels:CUD` scope, owner and admin roles only (recommended)?
6. **Egress NetworkPolicy:** accept it as a follow-up change with its own ID?

On acceptance, the build proceeds as CHG-2026-056 and goes through Gate B, then Gate C.

# ADR-0020: CAIRO as the front door for AI traffic

| | |
|---|---|
| **Change ID** | CHG-2026-086 · Tier 1 (changes the path every AI request takes, and what is recorded about it) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Not yet released |
| **Status** | Proposed: design only. Nothing is built or changed by this document |
| **Type** | Forward |
| **Date** | 2026-09-30 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | Pending. The owner set the direction on 2026-09-30 and chose "both" for automatic routing; the open decisions are in §9 |
| **Builds on** | ADR-0003 (CAIRO manages the gateway: keys, teams, budgets, request-log capture), ADR-0005 (the guardrail hook, record then enforce), ADR-0006 (gateway tracing into CAIRO, metadata only), ADR-0010 (console-managed models and the heuristic complexity router) |

## 1. Purpose

On 2026-09-30 the owner set a new rule for the product:

> CAIRO is the first point of contact for AI traffic. Observability comes from CAIRO and must not be bypassed.

The owner also asked for automatic routing to be configured and tested. "Automatic routing" means both of these:
- **Traffic routing:** every application's AI traffic reaches the models only through CAIRO.
- **Model routing:** CAIRO chooses the model that answers each request, and falls back when a model fails.

### What is true today (dev)

| Piece | State | Record |
|---|---|---|
| The gateway (LiteLLM 1.100.1) runs beside the console; CAIRO issues its keys, teams and budgets | Live | ADR-0003 |
| Every gateway request is inspected by the guardrail hook | Live, **record mode**: nothing is refused | ADR-0005 |
| Gateway calls are traced into CAIRO, metadata only | Live | ADR-0006 |
| Models and a heuristic complexity router can be managed from the console | Live since `acme-v4.38.0.7` | ADR-0010 |
| The gateway pushes its request log to CAIRO | Built, **not enabled**: held at the gateway-restart gate | CHG-2026-009 |
| Applications are forced through the gateway | **No.** Egress is unrestricted, so an application can call a provider directly and nothing about that call reaches CAIRO | Ledger N-33 |
| Routed calls record the model that actually served them | **Not yet**: the ingest drops the router's field | ADR-0010 §5 |

So the gateway already sits in the path, **for the applications that choose to use it**. This ADR makes the path mandatory, and makes CAIRO the front door.

## 2. Scope

**In:**
- The single endpoint applications call.
- The network rule that stops bypass.
- What is recorded for every call.
- How model routing, fallbacks and per-key limits are configured.
- The test suite that proves all of it.
- The order of rollout in dev.

**Out:**
- The AWS deployment: ADR-0021, which applies this design there.
- Switching the guardrail to enforce mode. That stays ADR-0005's change. This ADR only records its interaction with routing (§4.4) and asks when (§9).
- Content logging. It stays off by ADR-0006, until a deletion path exists (P0-11).

## 3. Decision

### 3.1 One endpoint, owned by CAIRO

- **The gateway becomes a CAIRO component with one published endpoint:** an OpenAI-compatible base URL on CAIRO's own hostname. Applications need only this URL and a CAIRO-issued key.
- **How it is exposed:** the ingress routes a path on CAIRO's hostname (for example `/llm/v1`) to the gateway service. There is no separate public gateway hostname, and the test-only external gateway address (CHG-2026-062) is retired.
- **The console web process does not proxy the traffic.** It is not built to carry streaming model traffic at gateway latency. The gateway does the proxying; CAIRO owns the name, the keys, the policy and the records.
- **Who can reach it:** on the customer's network only, never the public internet (ADR-0021 §3.4 for AWS). In dev the endpoint is reachable only with a key, as today.

### 3.2 No bypass: a network rule, and a shared responsibility

1. **Inside CAIRO's cluster:** default-deny egress for every workload. Only the gateway (to model providers), the guardrails service (to its judge model through the gateway) and the platform's own dependencies may leave the cluster. This is the egress NetworkPolicy the owner accepted as a follow-up in ADR-0010 §12, now given its home here.
2. **At the network edge:** an allow-list of model-provider domains, reachable **only** from the gateway's egress path, meaning its subnet, or its IP on the NAT.
   - On AWS this is Network Firewall with a domain allow-list (ADR-0021).
   - In dev on Azure it is the equivalent firewall rule, or the NetworkPolicy alone if no firewall exists.
3. **Applications outside CAIRO's cluster** (the customer's own apps) are outside CAIRO's control. The customer's network team must block direct egress from application networks to model-provider domains. CAIRO supplies the domain list, and a test that proves the block (§6, T8).
   - Without that block, "no bypass" is a policy, not a control.
   - The POC checklist records it as a customer responsibility with its own acceptance test.

### 3.3 In-path observability: what every call leaves behind

**Every request through the front door produces all of these:**

| Record | Content | Where | Status |
|---|---|---|---|
| Trace | Model, tokens, cost, latency, key, team, routing result. **No prompt or response text** | CAIRO traces (ADR-0006) | Live; routing fields added by this change |
| Guardrail event | Verdict, policy, action | CAIRO audit trail (ADR-0005) | Live |
| Request-log row | Key, model requested, **model served**, status, tokens, spend, fallback chain | CAIRO request-log mirror (ADR-0003) | Built, **enabled by this change** (CHG-2026-009) |

- **Applications no longer need the SDK to be observable.** Their calls are observed because they pass through CAIRO. An application may still send its own SDK traces for its own spans; those are extra, not the control.
- **Content stays off.** Prompts and responses are masked at the gateway (ADR-0006), until a deletion path exists (P0-11). A customer that needs content review gets it through the guardrail events' redacted text, as today.

### 3.4 Model routing

These are configured in the gateway, managed from the console where ADR-0010 already allows it, and are OSS features in 1.100.1 (checked in the tagged source).

| Mechanism | What it does | Setting |
|---|---|---|
| Model groups | One name (for example `general`, `reasoning`) maps to several deployments | Model entries sharing a `model_name` |
| Routing strategy | Picks among a group's deployments | `router_settings.routing_strategy`: **`latency-based-routing`** to start; `cost-based-routing` as the alternative |
| Automatic model choice | Picks the group by how hard the request is | ADR-0010's complexity router: heuristic only, four tiers, no prompt text leaves the gateway |
| Fallbacks | A failed call moves to the next group | `fallbacks`, `context_window_fallbacks`, `content_policy_fallbacks` |
| Retries and cooldown | A failing deployment is retried, then rested | `num_retries`, `allowed_fails`, `cooldown_time` |
| Per-key limits | A key may call only named models or groups; a key can default to the router | Key `models` list (ADR-0003 manages keys) |

- **The applications' default is `auto`**, the complexity router. An application that needs a fixed model names a group it is allowed.
- **The semantic (embedding) router stays out**, as ADR-0010 §5 decided. It sends every prompt to an embedding model.

### 3.5 How routing interacts with guardrails and records

- **The input guardrail runs once, before routing.** A fallback resends the same, already-screened prompt, so the input check is not repeated and does not need to be. Checked in the 1.100.1 source: the pre-call hook fires in the request handler, and the fallback re-enters the router below it.
  - The prompt is also the redacted one when enforce mode redacts.
  - **Enforce mode must be proven to refuse before routing**, so a blocked prompt is never sent to any model, including a fallback (§6, T5).
- **An output guardrail**, when one is built, must run on the final response after routing.
- **Records:** every hop of a fallback is logged as its own call, carrying the original group, the group tried and the fallbacks attempted. CAIRO must show the request as one row with its chain, not as unrelated calls (§6, T6).

## 4. Rollout in dev, each step owner-gated

| Step | Change | Needs |
|---|---|---|
| a | Enable the request-log push (CHG-2026-009), with the served-model field captured | Gateway restart |
| b | Front-door ingress path on CAIRO's hostname; retire the test-only external address | Ingress change |
| c | Routing configuration: model groups, strategy, fallbacks, retries, the `auto` router, per-key limits | Gateway configuration and restart |
| d | Egress default-deny in the cluster, and the provider allow-list for the gateway only | NetworkPolicy, then a firewall rule where one exists |
| e | The routing test suite (§6), run against dev and kept as a release check | Test keys and a budget |

Each step is a lettered part of CHG-2026-086, with its own rollback: the previous ConfigMap, ingress or policy, all kept as files. The same design is then built into the AWS deployment (ADR-0021).

## 5. Impacted components

| Component | Impact |
|---|---|
| Gateway (LiteLLM) | Configuration only: router settings, model groups, fallbacks, callbacks. No code change except capturing the served model in the request-log callback |
| Guardrails | None, until enforce mode |
| Web / API | Request-log ingest stores the served model and the fallback chain. The console shows them on the request row. The key form offers "auto" and allowed groups |
| Worker | None expected |
| Kubernetes / network | Ingress path, NetworkPolicies, firewall rule |
| Customer network | Block direct provider egress from application networks (customer-owned, tested by T8) |

## 6. Test suite ("auto routing configured and tested")

It runs from a test pod and a test key with a small budget. It never uses the guardrail judge's provider key: application traffic and the judge must not share a key (§9, D4).

| # | Proves | Pass condition |
|---|---|---|
| T1 | The front door works | An OpenAI-compatible call to CAIRO's endpoint returns a completion; a call with no key or a wrong key is refused |
| T2 | Complexity routing | A set of prompts of known difficulty lands on the expected tier; the router's own test endpoint agrees |
| T3 | Strategy | Across repeated calls to a two-deployment group, traffic follows the strategy |
| T4 | Fallback | With the primary deliberately failing (a test deployment with an invalid credential), the call succeeds on the fallback, within the retry budget |
| T5 | Guardrail interplay | Exactly one guardrail inspection per request, including fallback requests. In enforce mode (when enabled), a blocked prompt reaches no model, and the fallback is not tried |
| T6 | Records | For each call: one trace, one guardrail event, one request-log row naming the served model and the chain. No prompt text in the trace |
| T7 | Per-key limits | A key limited to `auto` cannot call a named model; a key with a named group can |
| T8 | No bypass | From an application pod (and, on AWS, from the customer's application subnet), a direct call to a provider domain fails; the same request through CAIRO succeeds |
| T9 | Latency | The front door and guardrail add no more than the measured budget at p95 (ADR-0005 §3c) |

The suite's results are the gate C evidence for step e, and a release check afterwards.

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The front door becomes a single point of failure | Medium | High | Two gateway replicas minimum, readiness checks, a documented degraded mode. On AWS, multiple availability zones |
| LiteLLM security advisories: it is now mandatory, so its flaws are CAIRO's | Medium | High | Digest pinning (as today), advisory watch by the security agent, upgrade review between versions, internal-only exposure, WAF on AWS |
| Routing tests or application traffic exhaust the provider key the guardrail judge uses (seen 2026-09-28: evaluator runs failed on a daily token limit) | High today | High | Separate keys and budgets for the judge and application traffic (D4) |
| Egress default-deny breaks a dependency nobody listed | Medium | Medium | Apply in audit mode or in steps; list dependencies first; rollback is the previous policy |
| Customer apps still reach providers directly | Medium | High | Customer responsibility with test T8 in the POC acceptance |
| Fallback to a different provider changes data residency | Medium | High | Fallback groups contain only providers approved for the customer's residency (ADR-0021 §3.6) |

## 8. Compatibility

- **Applications already using the gateway** keep working. The base URL changes to CAIRO's endpoint once the test-only address retires, which is announced before that step.
- **No database change beyond the request-log fields.** Those arrive with CHG-2026-009's migration, which already exists.
- **Feature flag:** the routing settings are gateway configuration, so rollback is the previous ConfigMap.

## 9. Open decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Front door shape: a path on CAIRO's hostname, or a separate gateway hostname under CAIRO's name | Path on CAIRO's hostname: one name, one certificate, one WAF |
| D2 | When enforce mode starts | Record in dev until the test suite passes, then enforce jailbreak and personal-data rails before a customer's first real prompt |
| D3 | Content logging | Stay metadata-only (ADR-0006), until the deletion path exists (P0-11) |
| D4 | Separate provider keys for the guardrail judge and for application traffic | Yes. Required before T2–T9 run |
| D5 | Which models form the tiers and fallback groups | Owner and customer choice, limited to providers approved for the customer's residency |
| D6 | Egress block in dev: NetworkPolicy only, or a firewall too | NetworkPolicy now; the firewall comes with the AWS design |

## 10. Assumptions and not verified

- The 1.100.1 behaviours in §3.4 and §3.5 were read in the tagged source and docs on 2026-09-30. They are **not yet observed in dev**; the test suite is the proof.
- Whether the request-log callback receives the served model for complexity-routed calls is not verified. ADR-0010 §5 says the ingest drops the router's field today.
- The customer network block (§3.2, point 3) depends on the customer's network team.

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
| CAIRO's own evaluators use the gateway | **No.** They call the provider directly, through a project connection outside the gateway (found 2026-09-30) | §3.6; step f |
| Developers' Claude Code uses the gateway | **No.** It calls the provider directly with each person's login | §3.8; step g |

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

### 3.6 CAIRO's own evaluators, and a dev-only guardrail exception

*Added 2026-09-30, CHG-2026-086 f.* The owner decided on 2026-09-30: "yes, proceed with dev exemption and add roadmap items".

**The problem.**
- CAIRO's evaluators (LLM-as-a-judge scoring of traces) called the provider **directly**, through a project connection outside the gateway. This is the same bypass §3.2 forbids for applications, only inside CAIRO.
- They shared a provider daily limit and lost evaluations to it (§7).

**The decision.** The evaluators become a caller of the front door like any application:

| | |
|---|---|
| **Model** | One model group, `cairo-evaluator`, on its own provider key. The provider sets limits per organisation, so the key belongs to a different organisation from the guardrail judge's key |
| **Key** | A CAIRO-issued key, used only by the evaluators' gateway connection. It may call only `cairo-evaluator`. Request and token limits are set below the provider tier's own. While each gateway replica counts limits separately (until CHG-2026-088 b), the key's limits are divided by the replica count |
| **Exception** | In **dev only**, the key is exempt from the input guardrail. It uses the key-level opt-out the judge key uses (ADR-0005-A §2): authenticated key metadata, never request data |
| **Still recorded** | Every evaluator call is traced, metadata only (ADR-0006). It is also logged in the request log once step a is on. What is lost is the guardrail event for these calls |
| **Connection** | The evaluators' default model points at the gateway connection. The direct provider connection is then removed, which closes the internal bypass |

**Why the exception, in dev.**
- An evaluator prompt is built from traces CAIRO already stores. It is not new user input.
- Inspecting it would send each evaluation's full text to the guardrail judge. That adds one judge call per evaluation, on the limits the judge needs for application traffic.
- In record mode, inspection refuses nothing, so in dev it would add cost and no protection.

**Its bounds.** These are the three properties ADR-0005-A §4 requires of any exempt key:
1. the opt-out;
2. an allowlist of exactly one group;
3. limits that are never unset.

ADR-0005-A invariant I-1 is amended to allow exactly this second key. Any other key with an opt-out is still a finding.

**The known gap in how it is set.**
- The console cannot set a guardrail opt-out. It is set by a direct gateway admin call, which leaves no entry in CAIRO's change record. This is the same open gap as the judge key's edit (CHG-2026-029).
- To cover it, the key's properties before and after the call are captured in the private records, without secret values.

**Not carried forward.**
- The full opt-out is not used for evaluators in a customer deployment. There, §3.7 replaces it.
- The dev exception ends when R1 is built.

### 3.7 Roadmap: finer guardrail control

*Added 2026-09-30.* These are not built and not scheduled. They are recorded so that the dev exception in §3.6 has a planned replacement.

| # | Item | What it changes | Notes |
|---|---|---|---|
| R1 | **Per-key selection of guardrail checks** | Today a key is all-or-nothing: every check runs, or (with the opt-out) none. R1 lets a key's policy name which checks run, for example personal-data detection on and attack screening off | Read from authenticated key metadata, the same trusted source as the opt-out. An unreadable policy runs every check (ADR-0005-A §2: ambiguity resolves to inspect). Set from the console key form, so it is in CAIRO's change record. The full opt-out stays for the judge key only |
| R2 | **Personal-data redaction in the request path** | Today the guardrail records what it would redact, and the prompt reaches the model unchanged. R2 sends the redacted prompt to the model, and can be switched on per key without switching on refusals | Runs once, before routing, so no model and no fallback receives the redacted data (§3.5). Tests T5 and T6 gain a case: the model receives the redacted text |

**The target for evaluators in a customer deployment**, once R1 and R2 exist:
- The evaluators call models through the front door.
- Their key runs personal-data redaction (R2) and skips attack screening (R1). Their prompts are the customer's stored traces, not user input.
- The model is one the customer approved for residency (ADR-0021 §3.6).
- The exception is written into the customer's security and residency statement.

**Trade-off to decide per evaluator:** with redaction on, an evaluator that looks for personal data in a response sees placeholders instead. An evaluator of that kind needs its own decision.

### 3.8 Developer tools through the front door (Claude Code)

*Added 2026-09-30, CHG-2026-086 g. Proposed; nothing is built or changed.* The owner asked on 2026-09-30 that the gateway also be the only point of access to Claude for developers.

**Today.**
- Developers' Claude Code sessions call the model provider directly, each with the person's own login. CAIRO sees none of these calls.
- In dev, a workstation plugin exports session traces, content included, into a dev CAIRO project. This is the CHG-2026-055 path, accepted by decision.

**The change.** Claude Code calls CAIRO's front door instead of the provider:
- **Two Claude Code settings,** documented by Claude Code for LLM gateways:
  - `ANTHROPIC_BASE_URL` points at the front door's Anthropic-compatible path;
  - `ANTHROPIC_AUTH_TOKEN` holds a CAIRO-issued key for that developer, sent as `Authorization: Bearer`.
  - They go in the `env` block of Claude Code's settings, not only in the shell, so background agents use them too.
- **The gateway already serves the Messages API.** It serves Anthropic's `/v1/messages` and `/v1/messages/count_tokens`, checked in the 1.100.1 source. Claude Code's documentation recommends this format for a gateway.
- **Records.** Each call then leaves the same records as any application (§3.3): a metadata-only trace, a request-log row and, depending on D9, a guardrail event.
- **The workstation export can retire.** The content-bearing trace export from developer workstations is then no longer needed (D10).

**Prerequisites, in order:**
1. **Step b,** the front door on CAIRO's hostname:
   - TLS, reachable from developer machines;
   - streamed responses passed through without buffering, which Claude Code relies on.

   The test-only external address is never used for real work.
2. **A funded provider account for the gateway, and an agreed budget (D8).** Through a gateway, Claude Code authenticates with the organisation's credential "instead of your personal claude.ai login" (Claude Code documentation). Usage is therefore billed per token to the gateway's provider account, not to the person's subscription. Claude Code's volumes are large: one developer turn traced in dev on 2026-09-30 totalled about 1.17 million prompt tokens across its calls. Prompt caching reduces the cost, but only if it passes through (point 4).
3. **A guardrail treatment for developer keys (D9).** Two reasons:
   - The guardrail's size limit (20,000 characters) stops oversize prompts unscanned. That is recorded in record mode, but in enforce mode it would refuse almost every Claude Code call.
   - Inspecting every call would send whole coding sessions to the judge model, beyond its limits.
4. **Pass-through, unchanged.** Claude Code's documentation requires `anthropic-*` request headers and body fields to be forwarded as they are, not filtered to a list, because each release adds new ones. This covers prompt caching (`cache_control`), thinking, context management and output settings. Tests T10 and T11 prove it.
5. **Model groups that answer to the names Claude Code requests,** or Claude Code pinned to the group names through its model settings. This includes the small, fast model Claude Code uses for background work.

**Keys.**
- One CAIRO-issued key per person, never shared.
- Limited to the Claude model groups, with a budget and request limits.
- Issued and revoked in the console, so each is in CAIRO's change record and usage and cost are attributable to a person.

**Rollback, per developer:** remove the two settings, run `/logout`, then sign in with the personal login. Claude Code returns to its direct connection (Claude Code documentation).

## 4. Rollout in dev, each step owner-gated

| Step | Change | Needs |
|---|---|---|
| a | Enable the request-log push (CHG-2026-009), with the served-model field captured | Gateway restart |
| b | Front-door ingress path on CAIRO's hostname; retire the test-only external address | Ingress change |
| c | Routing configuration: model groups, strategy, fallbacks, retries, the `auto` router, per-key limits | Gateway configuration and restart |
| d | Egress default-deny in the cluster, and the provider allow-list for the gateway only | NetworkPolicy, then a firewall rule where one exists |
| e | The routing test suite (§6), run against dev and kept as a release check | Test keys and a budget |
| f | CAIRO's own evaluators behind the gateway (§3.6): the `cairo-evaluator` group, a CAIRO-issued evaluator key with the dev exception, the evaluators' default model on the gateway connection, then removal of the direct provider connection | Gateway configuration and restart; a key and a connection created in the console by the owner; one key-metadata edit. **Runs first**, because it stops a live loss of evaluations |
| g | Developers' Claude Code through the front door (§3.8): Claude model groups, per-person keys, two Claude Code settings; one developer first, then the rest; then the workstation trace export retires | Step b; decisions D8–D10; T10–T13 passed with the first developer |

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
| T10 | Claude Code works through the front door | One developer's session: responses stream as they are generated, tool use works, and `/v1/messages/count_tokens` answers (or Claude Code's documented fallback applies) |
| T11 | Claude Code features pass through | Prompt-cache reads are reported on repeated context; a request using a current `anthropic-beta` header behaves as it does against the provider directly |
| T12 | Developer records | Each call is a metadata-only trace under the person's key, with no prompt text in any store; the guardrail record follows D9 |
| T13 | Developer limits | A key over its budget or request limit is refused with a clear error, and the rollback restores the direct connection |

The suite's results are the gate C evidence for step e, and a release check afterwards.

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The front door becomes a single point of failure | Medium | High | Two gateway replicas minimum, readiness checks, a documented degraded mode. On AWS, multiple availability zones |
| LiteLLM security advisories: it is now mandatory, so its flaws are CAIRO's | Medium | High | Digest pinning (as today), advisory watch by the security agent, upgrade review between versions, internal-only exposure, WAF on AWS |
| Routing tests or application traffic exhaust the provider key the guardrail judge uses (seen 2026-09-28: evaluator runs failed on a daily token limit) | High today | High | Separate keys and budgets for the judge and application traffic (D4) |
| The evaluator key's guardrail exception (§3.6) is an uninspected path if the key leaks | Low (the key is used only inside the cluster) | Medium | Allowlist of one group, limits never unset, dev only, replaced by R1 (§3.7). A second exempt key beyond it is a finding (ADR-0005-A I-1) |
| Evaluations still fail on the provider tier's per-request or daily token limits, since some traces are larger than one request allows | High on a free tier | Medium | Visible as failed evaluations, and no longer shared with the judge. Sampling, filtering evaluated traces, or a paid tier are the owner's choice |
| Developer usage through the gateway costs more than expected (§3.8) | High | Medium | A budget per key; prompt caching passed through (T11); one developer first (D8) |
| The gateway becomes a dependency for developers' daily work | Medium | Medium | Two gateway replicas on two nodes (CHG-2026-088); the per-developer rollback takes one step |
| A Claude Code release adds a header or field the gateway drops, and a feature breaks | Medium | Medium | Forward `anthropic-*` headers and fields unchanged; T10 and T11 as a release check after every gateway upgrade |
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
| D7 | Exempt the evaluators' key from the input guardrail in dev | **Decided by the owner, 2026-09-30:** yes, dev only, with the bounds in §3.6, and roadmap items R1 and R2 added (§3.7) |
| D8 | Fund the gateway's provider account for developer use, with a monthly budget | One developer first, on a capped key, to measure real cost before the rest |
| D9 | Guardrail treatment for developer keys | R1 when built: personal-data detection on the newest user turn only, attack screening off. Until then, in dev, a key-level exemption with the §3.6 bounds, which needs a further amendment of ADR-0005-A I-1 by the owner |
| D10 | Retire the content-bearing workstation trace export once T12 passes | Yes: the gateway's metadata-only records replace it |

## 10. Assumptions and not verified

- The 1.100.1 behaviours in §3.4 and §3.5 were read in the tagged source and docs on 2026-09-30. They are **not yet observed in dev**; the test suite is the proof.
- Whether the request-log callback receives the served model for complexity-routed calls is not verified. ADR-0010 §5 says the ingest drops the router's field today.
- The customer network block (§3.2, point 3) depends on the customer's network team.

# ADR-0023 — The Applications page: one console screen per connected application

| | |
|---|---|
| **Change ID** | CHG-2026-115 (design). Phase 1 built under CHG-2026-122 |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Phase 1: `acme-v4.38.0.35` (first iteration), `acme-v4.38.0.37` (second iteration) |
| **Status** | Accepted. Phase 1 built; phases 2 and 3 proposed |
| **Type** | Forward design, written after phase 1 shipped (decisions made 2026-10-05 and 2026-10-06, written 2026-10-07) |
| **Date** | 2026-10-07 |
| **Author** | Claude (EYEON build session), for the owner |
| **Approval** | Pending. The owner reviews and merges; not a production approval |
| **Commits / tag** | Phase 1: #340 (`cb2436b0b`), #346 (`2b47e7e35`) |

> **Why this ADR is late.** The design was claimed on 2026-10-05 (#324) and put on hold by the owner the same day, until block mode was on. On 2026-10-06 the owner chose a scorecard for this page and put it into the 8 October demo. It was built in two iterations under CHG-2026-122 (#340, #346), whose code and changelog cite this ADR, before the ADR itself was written. This record closes that gap. It describes what was built as built, and the later phases as proposals.

## 1. Purpose

An application connected to EYEON leaves its evidence in four places:
- **Governance Controls → LLM Gateway:** its key, limits and spend.
- **Governance Controls → Guardrails:** the policy and the enforcement mode.
- **Reports / Logs:** its guardrail decisions, gateway requests, the key's change record and the audit log.
- **Tracing / Evaluations / Prompts:** rich only if the application also uses the SDK, and in a different project from the gateway's own traces.

The owner asked (2026-10-05) whether these could be brought "together within a single portal section" instead of moving between places, and approved the design ("yes, write the design for the Applications page"). The question a risk or compliance reader brings is per application: is this AI application running safely, and where is the evidence?

## 2. Scope

**In:**
- **Phase 1 (built):** an Applications page under Governance Controls with one scorecard per application and an executive summary for the project.
- **Phase 2 (proposed):** a detail screen per application: limits and spend trend, recent requests with their guardrail decisions side by side, the key's change history, and links to its traces.
- **Phase 3 (proposed, feasibility only):** one trace per request for applications that also use the SDK, with the gateway call and the guardrail decision inside the application's own trace.

**Out:**
- **Storing prompt or answer text to give key-only applications full observability.** Possible, but it means EYEON keeps customer content; it waits for deletion on request (Readiness Ledger P0-11) and a deliberate owner decision, ideally with counsel.
- **A regulatory compliance scorecard** (controls marked met or not met) until counsel confirms the control mapping.
- **A guardrail assurance scorecard** (detection and false-positive rates from the test suites), until those results are stored in EYEON.
- **Model quality scoring**, which Langfuse already provides.

## 3. Decision

### 3.1 An application is a key lineage
EYEON has no single identifier that links an application across its data. The request log, the guardrail decisions and the key's change record each name the key differently, and a key's alias changes on rotation (it gains a suffix). The only identifier stable across rotations is the key's **lineage** (`acme_litellm_keys.lineage_id`).

So an application is **one key lineage within one project**:
- its **settings** (models, request limit, budget, expiry, issue date) are the newest active generation's;
- its **traffic** is every generation's, so a rotation does not reset the scorecard;
- a lineage with no active key (revoked, failed or pending only) is not shown.

### 3.2 How the evidence is joined
| Source | Joined on | Notes |
|---|---|---|
| Guardrail decisions (`acme_guardrail_events`) | `agent_id` = the key alias, any generation | The gateway hook sets the agent to the authenticated key alias first, from proxy-injected metadata only. Events carry no model, cost or latency. |
| Gateway request log (`acme_litellm_request_logs`) | `key_alias`, any generation | Calls, failures and spend. |
| Key change record (`acme_litellm_events`) | `resource_id` = each generation's key id | Phase 2. |
| Traces | none today | Phase 3. |

Every query is scoped to the project and the period. A guardrail decision and its request are also linked one to one by the gateway call id (CHG-2026-071); phase 2 can use that link.

### 3.3 The scorecard (phase 1, built)
- **Six dimensions,** each rated On track, Watch, Act now or Not rated, with the numbers behind the rating on the card:

| Dimension | Measure | Watch | Act now |
|---|---|---|---|
| Protection | share of calls whose prompt was checked; share of checks without a verdict; enforce or record | coverage < 95%, no verdict ≥ 1%, or record mode | coverage < 80%, no verdict > 5%, or calls with no checks |
| Threat activity | prompts refused per 100 calls, with the top refusal types | ≥ 1 | > 5 |
| Data protection | redactions per 100 calls | ≥ 2 | > 10 |
| Access hygiene | budget, expiry, rotated within 90 days, named models, request limit | 3 or 4 of 5 | fewer than 3 |
| Spend | spend in the period against the key's budget | ≥ 80% | > 100% |
| Reliability | failed calls | ≥ 2% | > 5% |

- **No single score.** The overall rating is the worst dimension, never an average, so one red dimension is never hidden by green ones. A regulated reader distrusts a bare "87/100".
- **Not rated** below 10 calls in the period, for the rate dimensions; protection is not rated with no calls.
- **Period:** the last 7 or 30 days.
- **Executive summary (the owner's option D):** applications by rating, guardrail mode, calls, refusals and withheld answers, redactions, spend, keys without a budget, **top risks** (the five worst red and amber dimensions across applications, ranked), and the **share of checks decided in enforce mode**.
- **Trend:** daily calls and daily refused prompts per application, by UTC day, from two bounded, parameterised queries for all applications together.
- **Threat types** come from the guardrail's policy label only. Today one label covers every refused prompt, so the card shows "Jailbreak or misuse"; finer types need the guardrail to report which rule fired.
- **Evidence one click away:** each card links to the guardrail decisions filtered to the application (`?agent=`, `?from=` on the logs page). Every role that can see the page (Owner, Admin, Auditor) holds `projectGuardrails:read`, so all of them can follow it.
- **Thresholds** are v1 defaults, named in one place (`acmeApplicationScorecard.ts`), so a deployment can tune them later.

### 3.4 Metadata only
The page reads counts, statuses, policy labels, modes, dates and the key's settings. It never reads prompt or answer text, redacted text, personal-data findings or encrypted content. That is what lets the Auditor role see it.

### 3.5 Phase 2: the detail screen (proposed)
One screen per application, reached from its card, reusing what exists: the guardrail decisions table, the request log, the change record (EventsTab) and the limits dialog. It needs:
- a **key filter on the request log and on the change record**, which neither has today;
- **indexes** on `acme_litellm_request_logs.key_alias` (or the derived CAIRO key id) and on `acme_litellm_events.resource_id`. That is a migration, so phase 2 is its own Tier 1 change;
- an exact multi-alias filter on the guardrail log, so a rotated key's earlier decisions show too.

### 3.6 Phase 3: one trace per request (decided 2026-10-07; built under CHG-2026-126)
- LiteLLM 1.100.1 honours the W3C `traceparent` header, and EYEON's trace-metadata hook strips trace ids from request metadata but not that header.
- **Confirmed live on 2026-10-07:** one request sent through the gateway with a `traceparent` produced a trace with exactly that trace id in the gateway-traces project.
- **Where gateway spans land (owner decision, 2026-10-07: Option A):** they stay in the gateway-traces project and carry the application's trace id; the console links the two. Sending them into each application's own project (Option B) was not chosen: the gateway exports traces through `langfuse_otel` with one set of credentials, so it would mean per-application credentials in the gateway and a different exporter.
- **How each request learns its trace id:** the proxy starts a span for every request (`litellm_parent_otel_span`, created from `traceparent` when the caller sent one, otherwise a new trace). The trace-metadata hook reads that span's trace id after its strip step, falling back to a well-formed `traceparent` header, and writes it as `spend_logs_metadata.eyeon_trace_id`, overwriting any caller value. The console stores it on the request log (`otel_trace_id`), and the detail screen shows it with a link to the gateway trace.
- **Order:** the console first (it accepts and stores the id; the column stays empty until the gateway sends it), then the gateway hook (a gateway configuration change and restart).
- **Later (phase 3b):** a per-application "traces project" setting, so the detail screen also links to the application's own trace.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres schema | Phase 1: none. Phase 2: indexes (its own change) |
| ClickHouse | none |
| Web / API | Phase 1: `acmeApplications.scorecards` query; Applications page and sidebar entry; logs page accepts `?agent=` and `?from=` |
| Worker | none |
| Infra / Terraform / Helm | none |
| Integrations (LiteLLM, NeMo, promptfoo) | none in phase 1; phase 3 needs the gateway's tracing configuration |

## 5. Database change
- **Phase 1:** none. No migration, no backfill.
- **Rollback:** redeploy the previous image tag. No data is written by the page.

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Guardrail decisions are stored in a different project from the application's keys, so the scorecard finds none | Medium: the guardrail service pushes every decision to one configured project, while keys are created per project | High for the demo: every application shows Protection "Act now", "none checked by the guardrail" | Check on screen after release. Make the guardrail service's project the one that holds the gateway keys; longer term, join through the gateway call id (§3.2) |
| Threat types are coarse | Certain today | Low | Shown honestly as "Jailbreak or misuse"; finer types need a rayin-guardrails change |
| The evidence link misses a rotated key's earlier decisions | Medium | Low | The link says so on hover; phase 2 adds an exact multi-alias filter |
| UTC-day trend and rolling-window counts differ slightly | Certain | Low | Labelled as days; counts on the card are the rolling window |
| Thresholds do not fit a customer | Medium | Medium | Named in one place; per-deployment tuning is an open item |

## 7. Compatibility
- Backward compatible: yes. Phase 1 adds a page and a query and writes nothing.
- Upstream merge risk: low. New files under `acme-enhancements`, plus small marked additions in `routes.tsx`, `root.ts`, the content-free allow-list and the logs page.
- Feature flag: not needed. The page reports "switched off" where gateway management is off (`CAIRO_LITELLM_MANAGEMENT_ENABLED`).

## 8. Client-facing notes
A new page, Governance Controls → Applications, for Owners, Admins and Auditors: one card per connected application rating six dimensions with the evidence for each, an executive summary on top, and a trend. Spend appears only for roles allowed to see it. Ratings use EYEON's default thresholds.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | Pass | Phase 1: 32 unit tests on the scoring, ranking, type grouping and day buckets; the content-free role tests (the new query is a query and touches no content router); the two trend queries run against a real Postgres through Prisma; fresh web typecheck; ESLint and Prettier |
| B — staging | `Staging: not available.` No migration to rehearse | — |
| C — post-deploy | First iteration live in `acme-v4.38.0.35`; second in `acme-v4.38.0.37` | Deployment records in the ops repository; the owner's on-screen check, including §6's first risk, is pending |

## 10. Assumptions, open questions and owner decisions
1. **Security Analyst access.** The design said the Auditor and the Security Analyst would see the page. As built, it needs `llmGateway:read` or `evidence:read`, so Owner, Admin and Auditor see it and the Security Analyst does not. Adding the Security Analyst is an access change and needs the owner's decision.
2. **Per-deployment thresholds:** when, and who may change them.
3. **Phase 2 go-ahead,** with its indexes as a separate Tier 1 change.
4. **Phase 3:** decided and confirmed live on 2026-10-07 (Option A, §3.6); built under CHG-2026-126. Open: the per-application traces project (phase 3b).
5. **Finer threat types:** a rayin-guardrails change to report which rule fired.
6. **Key-only content observability:** not before deletion on request (P0-11) and a deliberate decision.

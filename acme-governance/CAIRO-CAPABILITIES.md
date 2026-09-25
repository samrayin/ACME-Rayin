# CAIRO — Capability Register

**Purpose:** one place that says what CAIRO can do today, how far each capability has got, and where the evidence is. It is written for product, sales and due-diligence conversations. It is **not** a changelog, which holds the history, and **not** the Readiness Ledger, which holds the gaps and risks. It links to both.

**As of:** 2026-09-24. **Environment:** one dev environment. **Nothing is deployed for a customer.** "Live" below means live in dev.

**Update rule:** update a row in the same PR as the change that moves it. A capability moves to 🟢 only on verified live evidence, not on merge.

| Status | Meaning |
|---|---|
| 🟢 | **Live in dev:** running and verified |
| 🟡 | **Built:** merged, not yet live, or live with a named limitation |
| 🔵 | **Designed:** an accepted design, not built |
| ⬜ | **Planned:** agreed direction, not designed |

---

## 1. AI gateway and model access

| Capability | Status | What it does | Evidence |
|---|---|---|---|
| Central AI gateway | 🟢 | Every application calls models through one OpenAI-compatible endpoint (LiteLLM 1.100.1, pinned by digest) | CHG-2026-006 |
| Gateway managed from the CAIRO console | 🟢 | Create and rotate application keys; teams, budgets, model allow-lists, rate limits; spend views | CHG-2026-005, CHG-2026-011 |
| Edit key limits in the console | 🟢 | Change a key's models and rate limit; audited intent and outcome events | CHG-2026-030 |
| Add models and endpoints from the console | 🟢 | Add, edit and remove gateway models without a config change or restart. Provider key is write-only (stored encrypted in the gateway database) or a reference to a key already held by the gateway. Strict endpoint checks: approved providers and hosts, https, no private or internal addresses. Guardrails models protected; every change audited. Admin-only, behind a switch | CHG-2026-056, ADR-0010 |
| Smart router (automatic model choice) | 🟢 | One model name that routes each request to one of four tiers (simple to reasoning) by complexity. Scored inside the gateway in under a millisecond, so **no prompt text leaves it** to choose a route. Test-routing box; guardrails still inspect every routed request | CHG-2026-056, ADR-0010 |
| Request-log mirror | 🟢 | One row per gateway call in CAIRO's database: model, tokens, cost, key, user, status, timings, **no prompt text**. Up to about 7 minutes' lag | CHG-2026-008 |
| Multiple model providers | 🟡 | Model routing across providers. Dev uses free-tier and test providers only, so a contracted provider is needed for real data | CHG-2026-015 |
| External access for applications outside the cluster | 🔵 | Model paths only, per-application key, IP allow-list, WAF recommended | Draft design, 2026-09-23 |

## 2. Guardrails (prompt inspection)

| Capability | Status | What it does | Evidence |
|---|---|---|---|
| Personal data detection and redaction | 🟢 | Presidio detects email, phone, card number, IBAN, person name and IP address, and redacts them. Entities are toggled in the console | rayin-guardrails, CHG-2026-045 |
| Jailbreak / prompt-injection detection | 🟢 | NeMo rail with a safety-classifier judge. **0% false positives, 100% detection** on the 32-prompt corpus (2026-09-21) | CHG-2026-016, CHG-2026-020 |
| Rails run even when personal data is found | 🟢 | They run on the redacted text; block beats redact beats allow. A PII-plus-jailbreak prompt is blocked | CHG-2026-045 |
| Size limit on inspected text | 🟢 | Text over 20,000 characters is blocked unscanned, without stalling the service | CHG-2026-045 |
| Separate admin and inspection credentials | 🟢 | The gateway can ask for verdicts only; only the console can change guardrail settings | CHG-2026-046 |
| Fast start, no internet dependency | 🟢 | Models load before the service reports ready; the embedding model is pinned in the image, with no runtime download | CHG-2026-048, CHG-2026-049 |
| **Every gateway request inspected** | 🟡 | The gateway hook sends every request to guardrails and records the verdict. **Record mode:** nothing is blocked yet | CHG-2026-014, -038, -041, -044 |
| Blocking (enforce mode) | 🔵 | Refuse flagged requests. Gated on alerting, availability (multi-node) and the ADR-0005 Step 4 gates | ADR-0005, ADR-0009 |
| Guardrail health metrics, durable | 🔵 | Availability and latency of every guard call, stored in CAIRO. Today they're in gateway logs only | ADR-0009, CHG-2026-040 |

## 3. Audit trail and evidence

| Capability | Status | What it does | Evidence |
|---|---|---|---|
| Durable guardrail audit trail | 🟢 | Every guardrail decision is pushed to CAIRO's database; flagged content stored encrypted; who (user) and from where (machine) | Changelog 2026-09-18 |
| Guardrail events in the console | 🟢 | Review decisions, policy and user; a Security Analyst role for reviewers | Changelog 2026-09-18 |
| Audit log viewer | 🟢 | Administrative actions in the console | Changelog 2026-09-09 to 15 |
| Append-only audit tables | 🟡 | Designed and granted, **not effective** while the app connects as admin | Ledger P0-5, ADR-0004 |
| No lost audit records | 🔵 | Today a failed push can lose a record | Ledger P0-10 |
| Verified user identity | ⬜ | Today the user is asserted by the calling app | Ledger N-34 |
| Incident evidence export | 🟡 | A manual, owner-run export of data with a hash manifest, done for P0-8. Product version planned: server-side copy to immutable storage | CHG-2026-050 |

## 4. Observability and cost

| Capability | Status | What it does | Evidence |
|---|---|---|---|
| Gateway tracing into CAIRO, metadata only | 🟢 | Every gateway request is a trace: model, tokens, cost, latency, status. **No prompt or response text, and no caller-supplied metadata or headers**, verified live with markers in every channel. Over OTLP | CHG-2026-026, -028, -054, ADR-0006 |
| Token and cost per application, key, model and user | 🟢 | From traces and the request-log mirror | CHG-2026-008, CHG-2026-026 |
| Content tracing (prompt and response text) | ⬜ | Deferred until deletion is proven; review 2026-10-23 | Issue #139 |
| Analytics and "talk to your data" | 🔵 | A curated, minimised analytics layer; a governed natural-language question interface | PD-0006 |

## 5. Retention and deletion

| Capability | Status | What it does | Evidence |
|---|---|---|---|
| Trace retention, 30 days | 🟢 | ClickHouse removes trace rows after 30 days; applied 2026-09-23, expiry from 2026-09-24. A check proves it survives upgrades | CHG-2026-051 |
| Raw event body retention, 30 days | 🟡 | A blob rule deletes current and previous versions. Built; the dev apply is pending | CHG-2026-052 |
| Audit and request-log table retention | 🔵 | A purge job under a code-level safety guard; waits for the least-privilege cutover | PR #51, PD-0004 |
| Proof of deletion | ⬜ | A purge test across every store | PD-0005 phase 1 |
| Per-customer retention and delete-on-request | ⬜ | Retention per project; delete one user's or trace's data, audited | PD-0005 phase 2 |

## 6. Prompt governance

| Capability | Status | What it does | Evidence |
|---|---|---|---|
| Prompt review dates | 🟢 | Prompts carry review-by dates | Changelog 2026-09-16/17 |
| Prompt approval workflow | 🟡 | Request and approve promotion; **self-approval blocked**; only Owner and Admin approve (CHG-2026-059). Advisory: labels can still be set directly | Changelog 2026-09-16/17, Ledger N-40 |
| A/B and canary rollout | 🟢 | Staged rollout of prompt versions | Changelog 2026-09-16/17 |

## 7. Console, identity and branding

| Capability | Status | What it does | Evidence |
|---|---|---|---|
| Single sign-on (Microsoft Entra ID) | 🟢 | SSO sign-in; open sign-up disabled, and invited users can create their account (invite-only) | Changelog 2026-09-18/20, CHG-2026-057 |
| Roles for bank teams | 🟡 | Owner, Admin, Prompt Analyst, Viewer, Security Analyst, Business Analyst (numbers only) and Auditor (read-only evidence). Roles without content access are enforced on the server by allow-lists, and their screens hide what they cannot use (CHG-2026-059 d). **Live; not yet checked with a signed-in user per role** | ADR-0011, CHG-2026-059 |
| Per-project access policy | 🟡 | Narrows a person's role on a given project, never widens it; "No access" hides the project; ACME-built, not the Enterprise project-roles feature. **Live, with no limits set; not yet exercised end to end with a test user** | ADR-0011 §5, CHG-2026-059 part c |
| CAIRO branding and themes | 🟢 | ACME branding; upstream promotions switched off | Changelog, CHG-2026-025 |
| In-console AI assistant | 🟢 | A chat widget served through the gateway | Changelog 2026-09-09 to 15 |
| Client-side PII masking of SDK traces | 🟢 | Masking for traces sent by CAIRO's own SDK client | Changelog 2026-09-16/17 |

## 8. Delivery, traceability and change control

| Capability | Status | What it does | Evidence |
|---|---|---|---|
| Traceable releases | 🟢 | `release.sh` builds, tags and deploys by digest; `verify-deployed.sh` proves what runs | Changelog 2026-09-18 |
| No edits to Enterprise-licensed code | 🟢 | ACME code edits no Langfuse Enterprise file; a CI check fails any PR that does | CHG-2026-058 |
| Change governance | 🟢 | Change IDs, risk tiers, ADRs, rollback plans, changelog check in CI | CHG-2026-001, -004, -007, -037 |
| CI running for real | 🟢 | Full pipeline on GitHub-hosted runners | CHG-2026-034 |
| Rebuild on a fresh subscription | ⬜ | Terraform end-to-end, unproven | ACME-Rayin #23 |

## 9. What a bank will ask that is not yet true

These are tracked in the Readiness Ledger. They're listed here so this register is never read as more than it is.

- Guardrails **record** but do not yet **block** (record mode).
- The audit trail can lose a record, and its append-only control is not yet effective (P0-10, P0-5).
- **Delete-on-request** and proof of deletion are not yet available (P0-11: 30-day trace retention is live; the rest is in progress).
- User identity is asserted by applications, not verified (N-34).
- **Data residency:** dev runs in Sweden Central, and each bank's region is to be decided (P0-7).
- Secrets aren't yet held in Key Vault (P0-3). Network isolation and a WAF aren't in place: see the 2026-09-23 security review.
- Single-node cluster; no tested backup and restore; no monitoring or alerting.

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
| Raw event body retention, 30 days | 🟡 | A blob rule deletes current and previous versions. **Applied in dev 2026-09-23**; first deletions and the proof are due 25–26 September | CHG-2026-052 |
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
| Roles for bank teams | 🟡 | Owner, Admin, Prompt Analyst, Viewer, Security Analyst, Business Analyst (numbers only) and Auditor (read-only evidence). Roles without content access are enforced on the server by allow-lists. **Live; not yet checked with a signed-in user per role** | ADR-0011, CHG-2026-059 |
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

## 10. Best practices in this setup

The design choices behind CAIRO, what we did and why. "Partly" or "designed" says so where a practice isn't finished. The HTML view of this register shows the same list.

### Data architecture

| Practice | State | What we did | Why | Evidence |
|---|---|---|---|---|
| **Three separate data layers, never one pooled store** | 🟨 Partly | Evidence (the audit trail) in Postgres; operational traces in ClickHouse; analytics in a separate ClickHouse database with a minimised copy. Evidence and traces are in place today; the analytics layer is designed. | Banks judge a platform by how little it keeps and how well it proves what happened. Separate layers give each one purpose, one retention rule and one owner. Evidence stays immutable while analytics can be rebuilt, and a mistaken query exposes aggregates, not conversations. | PD-0006 |
| **A dedicated project for gateway traces** | ✅ Implemented | Gateway traces go to their own CAIRO project, "Gateway traces", with their own key pair. | This keeps them apart from incident data, evaluator runs and the console's own traces. A project key can reach every project-level route, so a dedicated key limits the damage if the gateway is compromised. It also allows per-project retention and access, and a clean evidence trail. | CHG-2026-026, Issue #115 |
| **One isolated deployment per bank** | 🔵 Designed | Each customer gets its own deployment and data stores. No bank's data goes into a central ACME store; any fleet metrics are anonymised aggregates only. | Data ownership, residency and blast radius stay per customer, which is the model regulated buyers expect. | PD-0006 |

### Privacy and data minimisation

| Practice | State | What we did | Why | Evidence |
|---|---|---|---|---|
| **Metadata by default; content only by decision** | ✅ Implemented | Traces carry model, tokens, cost, latency and status. Prompt and response text is removed before any trace is written. | Keep only what the purpose needs (Bahrain PDPL, data minimisation). Content tracing waits until deletion is proven, with a dated review, so it is never switched on by default. | ADR-0006, Issue #139 |
| **Defence in depth on trace content, proven with markers** | ✅ Implemented | Three layers: message logging off at the gateway, an allowlist hook that strips caller-supplied trace fields, and a full allowlist on the caller's metadata copy (in review). A marker test planted text in every channel and searched both stores for it. | One control can fail silently. Layered controls, verified by a test that looks for the data in storage rather than trusting configuration, give evidence a reviewer can accept. | CHG-2026-026, CHG-2026-028, CHG-2026-054 |
| **Personal data redacted before any AI judge sees it** | ✅ Implemented | Guardrails redacts personal data first, then runs its checks on the redacted text. | The judge model's provider never receives raw personal data, and a prompt that mixes personal data with an attack is still judged. | CHG-2026-045 |

### Retention and deletion

| Practice | State | What we did | Why | Evidence |
|---|---|---|---|---|
| **Preserve first, then delete** | ✅ Implemented | The P0-8 incident evidence was exported, with a SHA-256 manifest, before any retention rule could age it out. The owner ran the export. | Retention must never destroy evidence an investigation needs. In a bank deployment the same step is a server-side copy into immutable storage inside the bank's own environment. | CHG-2026-050 |
| **Deletion that is real, not nominal** | ✅ Implemented | Blob deletion covers previous versions as well as current blobs, because versioning is on. The ClickHouse TTL has a 30-day floor in code, and a check proves it survives upgrades. | With versioning, deleting only the current blob keeps every old copy. An upgrade that recreates a table silently drops its TTL, so the check exists to catch that. | CHG-2026-051, CHG-2026-052 |
| **Our own deletion path, no licence bypass** | 🟨 Partly | Retention uses standard ClickHouse and Azure features that ACME owns. The vendor's Enterprise retention code stays unused, and its gate is never bypassed. | The licence is respected, and the mechanism is ours to explain, test and support. The proof of deletion is due 24–26 September. | PD-0005 |

### Security and credentials

| Practice | State | What we did | Why | Evidence |
|---|---|---|---|---|
| **Least privilege between services** | ✅ Implemented | The gateway can only ask guardrails for verdicts. Changing guardrail settings needs a separate admin secret held only by the console, and equal secrets refuse to start. | A compromised gateway must not be able to switch the protections off. | CHG-2026-046 |
| **Secrets are never displayed or handled by AI sessions** | 🟨 Partly | Secret writes are run by the owner, as Secret-to-Secret copies checked by length and never shown. AI sessions never read Secret contents. Exposures are recorded as incidents, including our own. | Every exposure so far came from a session or tool output, not an attacker. The rule removes that path. "Partly", because one exposure happened during enablement and was accepted for dev. | INC-2026-09-20-01, CHG-2026-026 |
| **Tamper-resistant exclusion for the guardrail judge** | ✅ Implemented | The judge's own calls skip inspection based only on authenticated, admin-set key metadata. Forged metadata in a request is still inspected, proven live. | An exclusion that a caller could claim would be a bypass. | ADR-0005-A, CHG-2026-029 |
| **Minimal network exposure** | 🟨 Partly | The gateway, guardrails and ClickHouse are not reachable from the internet. Storage accepts only the cluster network. External access is designed for model paths only. | Every exposed surface must be justified. "Partly", because network policies inside the cluster are not yet enforced. | Security review 23 Sep |

### Reliability and safe change

| Practice | State | What we did | Why | Evidence |
|---|---|---|---|---|
| **Observe before enforcing** | ✅ Implemented | The guardrail hook runs in record mode: every request is checked and recorded, nothing is blocked. Enforce mode is gated on alerting and availability. | Real traffic shows the false-positive rate and the latency before anything can refuse a request. | CHG-2026-014, ADR-0009 |
| **Rollback anchor before every live change** | ✅ Implemented | Each change captures the previous configuration and image digest first, uses a watched restart, and has a written rollback. | The first guardrail switch-on failed its checks and was reverted in minutes, byte-identical to the anchor, with no caller affected. | CHG-2026-044 |
| **Check inside the real system, not only in unit tests** | ✅ Implemented | An in-image check runs the hook inside the live gateway before switch-on. New tests are shown to fail on the old code. | 70 passing unit tests once encoded the same wrong assumption as the code. The in-image check caught it. | CHG-2026-044 |

### Traceability and governance

| Practice | State | What we did | Why | Evidence |
|---|---|---|---|---|
| **Every running image traces to a commit** | ✅ Implemented | Releases build, tag, then deploy the exact digest. A check proves what runs. Third-party images are pinned by digest, and the embedding model is baked into the image. | What runs is known and reproducible, with no silent upstream changes and no runtime downloads. | release.sh, CHG-2026-006, CHG-2026-049 |
| **Change control with evidence** | ✅ Implemented | Every change carries an ID claimed first, a risk tier, an ADR where needed, a rollback plan and a changelog entry. Tier 1 changes need the owner's approval. | Auditable change history is a regulated-buyer requirement, and it is how this register can cite evidence for every row. | CHG-2026-001, CHG-2026-037 |
| **Honest status** | ✅ Implemented | A capability shows as live only on verified evidence. What is not yet true is published beside what is. Ratings of findings are the owner's. | Due-diligence credibility depends on never overstating readiness. | Readiness Ledger |
| **Product and environment kept apart** | 🟨 Partly | Product code and product-level docs are in the public repository; environment specifics are in a private operations repository. | "Partly", because some older environment identifiers remain in the public repository and are being scrubbed. | N-39, Security review 23 Sep |

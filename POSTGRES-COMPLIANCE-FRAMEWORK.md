# Postgres Compliance Framework — Guardrails Audit Trail (BFSI/GCC)

This file is the compliance-grade design reference for the Postgres side of the
`rayin-guardrails` → RAYIN push-based audit trail (the feature that replaces the
current "dashboard pulls whenever it happens to be open" mechanism with a
synchronous, durable write on every guardrail decision). It exists because the
person driving that design session explicitly flagged that the Postgres/security
side needed a compliance-experienced pass before either PR (this repo's new
endpoint + migration, and `rayin-guardrails`' push logic) gets written — this is
that pass.

**Scope discipline, stated up front:** this document does **not** propose
redesigning Langfuse's own Postgres schema, its existing single administrator
credential's *existing* privileges, or anything outside the blast radius of (a)
the two new/extended ACME tables (`acme_guardrail_events`, and by extension the
pattern `acme_prompt_approvals` already set) and (b) the one new public endpoint.
Where a finding implies a genuinely larger change (e.g., Azure AD-based service
auth, HSM-backed keys), it is called out as a recommendation with cost/complexity
noted, not silently folded into the "must do now" scope — see the assumptions
inline and the "Open decisions" section at the end.

**Companion convention:** like `ACME-CHANGELOG.md`, this doc distinguishes
*source-only* recommendations from anything *live* — nothing here has been
implemented yet. Once the two PRs land, whoever does the Terraform work should
treat the "Roles to be created" and "Authentication model" sections as the spec,
and the eventual `ACME-CHANGELOG.md` entry for that work should link back here.

---

## 1. How the Postgres database needs to be planned

### 1.1 Data classification, by guardrail decision tier

| Tier | Table/column | What it contains | Classification | Rationale |
|---|---|---|---|---|
| `allow` | `acme_guardrail_events` (existing columns only) | Metadata: `project_id`, `agent_id`, `event_time`, `direction`, `policy_triggered` (null), `action=ALLOW` | **Internal** | No content, no PII. Same sensitivity as ordinary application telemetry. |
| `redact` | + `redacted_text`, structured PII findings (entity type, position, confidence) | Already-sanitized text, plus **metadata about what category of PII was found and where** | **Confidential** | The redacted text itself is safe by construction, but the *finding metadata* is not nothing — "this message contained an `IBAN_CODE` and a `CREDIT_CARD` pattern at these offsets" is itself sensitive operational/customer data, and in aggregate across a project it profiles what kind of sensitive data flows through that customer's agents. Treat the findings array with the same handling as the events table generally, not as throwaway telemetry. |
| `block` | + `raw_content_encrypted` (new column) | **Raw, unredacted original content** — attempted exfiltration payloads, jailbreak prompts, and potentially actual customer PII/financial data that slipped past the PII layer (that's precisely *why* it was blocked, in some cases) | **Restricted** (highest tier this schema handles) | This is the one column in the whole ACME schema that can contain unbounded, unclassified raw user input. It must be encrypted at rest (already the plan, via the existing `encrypt()` utility — see §3.4 for a caveat on *which* key), access to the decrypting code path should be as narrow as the DB role that can read the column (§2), and it deserves its own retention clock, shorter than the metadata-only tiers if a compliance officer confirms that's acceptable (see Open Decisions). |

**Assumption:** "Confidential" and "Restricted" above are used as informal tiers
consistent with typical BFSI data-classification schemes (Public / Internal /
Confidential / Restricted). If ACME or its customers have a house classification
policy with different tier names, map these onto it — the point is that `block`
must sit at the top tier and `allow` should not be over-classified into the same
handling bucket, or the security team ends up treating high-volume, harmless
telemetry with restricted-data handling for no benefit.

**DECIDED (2026-09-18, owner-approved): content is now stored for every
action, including `allow`.** This reverses the data-minimisation rule in the
table above for allowed events. The table is kept as the original reasoning,
not as the active policy.

- **Why:** in a compromised account, the dangerous prompts are the ones that
  got through (`allow`). Under the metadata-only rule those had no content,
  so an investigation could see that something was allowed but not what.
- **What is stored now, for allow, redact and block alike:**
  - `masked_content_encrypted`: the text with every supported PII entity
    replaced by an `<ENTITY_TYPE>` placeholder (Presidio in rayin-guardrails,
    at decision time, independent of the live PII policy toggles) and card
    numbers masked unconditionally. Encrypted with `GUARDRAILS_ENCRYPTION_KEY`.
  - `raw_content_encrypted`: the original text with card numbers masked
    (§1.2 still applies to every action), encrypted with
    `GUARDRAILS_ENCRYPTION_KEY`. Previously `block` only.
- **Classification:** `raw_content_encrypted` is **Restricted** for every
  action. `masked_content_encrypted` is treated as **Confidential**: Presidio
  masking is strong but not perfect, so it is encrypted at rest and every view
  is audit-logged rather than treated as safe by construction.
- **Access:** masked content is shown on demand to OWNER, ADMIN and SECURITY
  (`projectGuardrails:read`) through `acmeGuardrails.maskedContent`, which
  decrypts server-side and writes an audit-log entry (`guardrailEvent`,
  `viewMaskedContent`) for every view. Raw content is never decrypted or
  returned by the app in this change; a logged reveal is a separate change.
- **Retention:** unchanged, §1.3's 30-day boundary applies to both columns.
- **Not changed:** the in-memory buffer in rayin-guardrails (`/v1/events`,
  the pull fallback) still carries no content. Rows written by the pull
  backfill therefore have no content.

### 1.2 PCI-DSS scope reduction — do not let raw PAN reach Postgres at all

`block` events are explicitly the tier most likely to contain "actual
customer PII/financial data that slipped past the PII layer." If a full,
unredacted Primary Account Number (PAN) can land in `raw_content_encrypted`,
that column — and everything touching it (this Postgres database, its
backups, the `ENCRYPTION_KEY`, every role with `SELECT` on the table) —
becomes PCI-DSS scope, even though it's encrypted. Encryption at rest reduces
*impact*, it does not remove *scope*.

**Recommendation:** before the raw content is sent to this repo's new
endpoint, `rayin-guardrails` should run a PAN-specific detection pass (Presidio
already ships a `CREDIT_CARD` recognizer) and truncate/mask any matched PAN
pattern in place — independent of, and in addition to, the block decision
itself — so that even the "raw" content persisted here never contains a
complete card number. Jailbreak/exfiltration analysis on the redacted string
is unaffected (a masked PAN is still obviously a PAN-shaped payload for
analyst review); what changes is that a full 16-digit PAN is never written to
this database in any form. This is a change to `rayin-guardrails`' push logic,
not this repo, but it belongs in that PR's scope — flagging it here since it's
the single highest-leverage compliance decision in this whole design.

**Assumption:** ACME's customer base is BFSI-general, not necessarily
card-payment-specific, so it is not assumed every deployment is in PCI-DSS
scope today. But guardrails exist precisely to catch cases the app didn't
anticipate, so treat "a PAN can appear in blocked content" as the realistic
case to design for, not the edge case.

### 1.3 Retention

**DECIDED (2026-09-17, leadership review):** a single, uniform retention
boundary applies to all three tiers — **30 days hot in Postgres, queryable
and dashboard-facing, then archived to cold storage (Azure Blob Storage,
Archive access tier) and purged from Postgres.** This supersedes the
earlier tiered proposal (1yr/3–5yr/1yr) below, which is kept as historical
context for the reasoning, not as the active policy. This was a business
decision, not an engineering one, and is no longer PENDING — see Open
Decisions §1 for the record of the change.

| Tier | Retention | Mechanism |
|---|---|---|
| `allow` | 30 days hot, then archived | Nightly job: copy to Blob Archive tier → `DELETE` via `rayin_retention_purger` (see §2) once the archive write is confirmed |
| `redact` (findings + redacted text) | 30 days hot, then archived | Same mechanism |
| `block` (raw encrypted content, still encrypted at rest in cold storage) | 30 days hot, then archived | Same mechanism |

Cold storage is a compliance copy, not a live query surface — retrieving an
archived event for an investigation is a deliberate, logged restore, not a
dashboard read. The archive step needs its own write credential to Blob
Storage (a storage connection or managed identity), separate from the
Postgres roles in §2 — `rayin_retention_purger` only needs `SELECT`+`DELETE`
on Postgres, since the Blob write happens before the Postgres delete, not
through it.

<details>
<summary>Original tiered proposal (superseded, kept for reasoning context)</summary>

**Assumption (retention periods below were starting proposals, not confirmed
regulatory citations):** CBB Rulebook retention requirements vary by module
(e.g., transaction records vs. security/audit logs vs. AML records carry
different minimums, commonly in the 5–10 year range for financial records
specifically). A guardrail decision log is a **security/operational audit
trail**, not a financial transaction record, and the two should not be
conflated into one retention number without a compliance officer confirming
which CBB module (and, if relevant, Bahrain's PDPL) actually governs this
data category for the specific customer.

| Tier | Proposed retention | Deletion mechanism |
|---|---|---|
| `allow` | 1 year (matches typical operational log retention) | Scheduled purge (see §2, `rayin_retention_purger`) |
| `redact` (findings + redacted text) | 3–5 years (aligned to a typical audit-trail expectation; redacted text carries no raw PII so a longer window is lower-risk to hold) | Scheduled purge |
| `block` (raw encrypted content) | Shortest defensible window that still satisfies incident-investigation needs (proposal: 1 year, reviewed against actual incident-response requirements) | Scheduled purge, **same mechanism, shorter interval** |

</details>

Data-minimization principle (GDPR-equivalent, and Bahrain's PDPL follows the
same shape): the higher the sensitivity, the stronger the argument for the
*shortest* retention that still serves the audit purpose — this cuts against
naive "keep everything longer because it's an audit table" instincts for the
`block` tier specifically. The metadata-only `allow` tier has essentially no
minimization pressure; the `block` tier has the most.

**A genuine tension worth naming explicitly:** `AcmeGuardrailEvent` has no FK
to `Project` by design (documented in the schema comment — "an audit trail
must outlive the project it was recorded against"). That's correct for audit
durability, but it also means a data-subject erasure request (GDPR/PDPL
"right to erasure") cannot be satisfied by cascading a project deletion —
there is no automatic path that removes a person's data from this table when
their project is deleted, and there shouldn't be, or the audit trail becomes
worthless. The standard resolution is to document a **legal basis exemption**
(legitimate interest / legal obligation to retain security audit logs
overrides erasure requests for this specific data category, for the retention
window above, after which it is purged automatically regardless of any
request). This is a legal determination, not an engineering one — see Open
Decisions.

### 1.4 Data residency (GCC/Bahrain)

**Assumption:** this deployment's actual Azure region was not re-verified as
part of this review (out of scope — see `infra/langfuse-terraform-azure/variables.tf`
for whatever `location` is currently set to). Flagging the general issue: **Azure
has no native Bahrain region.** The nearest Azure regions are UAE North (Dubai),
UAE Central (Abu Dhabi), and Qatar Central. If a specific BFSI customer's CBB
obligations require in-Kingdom data residency (this varies by CBB module and by
whether the customer is a locally-licensed bank vs. another regulated entity —
confirm per customer), deploying this Postgres instance in a UAE or Qatar Azure
region may or may not satisfy that requirement even though it's "in-GCC." This is
a legal/compliance determination that needs to be made **per customer contract**,
not assumed to be satisfied by "we're in the Gulf region generally." See Open
Decisions.

---

## 2. Roles to be created

### 2.1 What Azure Postgres Flexible Server actually gives you

The `administrator_login` (`postgres`, set in `postgres.tf`) is a member of the
Azure-managed `azure_pg_admin` role, **not** a real Postgres superuser. Azure
retains the actual superuser role (`azuresu` or equivalent) for its own control
plane. Practical implications that matter for this design:

- `postgres` (as deployed today) **can** `CREATE ROLE`, `GRANT`, `REVOKE`, and
  own all objects in the `langfuse` database — everything below is executable
  from it.
- `postgres` **cannot** bypass row-level security policies it doesn't own,
  cannot access the server's internal replication/maintenance mechanisms, and
  is itself subject to Azure's own management-plane controls (e.g., Azure RBAC
  gates who can even reset that account's password via the control plane).
- Critically for the design's own honestly-flagged limitation: `postgres` (or
  any role that inherits its `CREATEROLE`/ownership) **can re-grant itself any
  privilege it revoked from another role**, because it owns the objects.
  `REVOKE UPDATE, DELETE ON acme_guardrail_events FROM <app role>` is real
  defense-in-depth against an application bug or SQL-injection-class exploit
  reachable through the app's own connection — it is **not** a boundary against
  a compromised or malicious holder of the `postgres` credential itself. Closing
  that gap requires genuine credential separation for *human/administrative*
  access (§3.1), not just more Postgres roles for the app.

### 2.2 Roles

Four roles, each used by exactly one credential/connection-string, each with the
minimum privilege that role's job requires:

| Role | Used by | Holds | Notes |
|---|---|---|---|
| `rayin_migrator` | Migration Job / init-container only (`DIRECT_URL`) | DDL owner of the whole schema | Never embedded in a long-running web/worker pod. |
| `rayin_app_runtime` | Web + worker pods, general traffic (`DATABASE_URL`) | Broad DML on existing schema (status quo — see below) | This mirrors what `postgres` already implicitly does today for runtime traffic; it is **not** a new exposure, just the same access formalized under a non-DDL-capable role. |
| `rayin_guardrails_writer` | The new `POST /api/public/guardrails-events` handler only, via its own separate connection/Prisma client | `INSERT` on `acme_guardrail_events` only | New, narrow role — this is the segregation-of-duties addition. |
| `rayin_retention_purger` | A scheduled job (k8s CronJob) only, not any request path | `DELETE` on `acme_guardrail_events` (and, if adopted, `acme_prompt_approvals`), gated by an age predicate | New — gives retention deletion its own audited, narrowly-scoped path instead of quietly reusing a role that also serves live traffic. |

**Why a dedicated writer role for one table, not just app-level checks:** the
new endpoint receives raw, attacker-influenced content (that's the entire
point — it's the blocked-content path) over a network path that, while
in-cluster-only, is reachable from a separate service (`rayin-guardrails`) this
repo does not control the code of. If that endpoint has a bug (injection,
logic error, dependency compromise in `rayin-guardrails` itself), the blast
radius should stop at "can insert rows into one audit table," not "can read or
write traces, users, api_keys, sessions, or anything else `rayin_app_runtime`
can touch." This is the standard BFSI "least privilege per integration
boundary" argument, applied at the one place in this design where an external
service writes into this database.

### 2.3 SQL

**STATUS: LIVE-TESTED (2026-09-17), PASS.** The full migration file
(`packages/shared/prisma/migrations/20260917090000_add_acme_guardrail_events_push_support/migration.sql`)
was run end to end — role bootstrap and schema changes both — against a
disposable Postgres 15 instance (matching `psql-langfuse-bgqj`'s actual
major version), deleted immediately after. The test used a non-superuser
admin role modeling `azure_pg_admin`'s real privileges (`CREATEDB
CREATEROLE NOSUPERUSER`), not a local bootstrap superuser, and pre-created
a table owned by that role before the migration ran, to genuinely exercise
`REASSIGN OWNED BY` against pre-existing objects rather than a clean
database. This surfaced one real bug (see the `GRANT rayin_migrator TO
postgres` correction below — confirmed to fail without it, pass with it)
that an earlier, less faithful test (against a true local superuser) had
missed entirely, because a true superuser bypasses the role-membership
check that non-superuser `azure_pg_admin` is actually subject to.

What was verified, concretely, not just "command exited 0":
- All 4 roles created idempotently.
- `rayin_migrator` — after the fix — actually ran a real `ALTER TABLE ...
  ADD COLUMN` and `INSERT` against the pre-existing simulated table
  (proof of capability, not just that `REASSIGN OWNED` returned success).
- The plain unique index on `event_id` and `ON CONFLICT (event_id) DO
  NOTHING` behavior reconfirmed in this same fully-migrated instance.

Not covered by this test: the real Azure Flexible Server's exact
`azure_pg_admin` grants may differ in ways not visible from outside the
service (this was a faithful model, not a clone of the live server) — and
password provisioning, since the migration deliberately creates roles
without one. Recommend one supervised dry run against the real server
before or during first production use, but this is no longer an
untested, unknown-risk step.

Run once, from the `postgres` (`azure_pg_admin`) connection, as part of
environment bootstrap — **not** repeated per deployment via application code:

```sql
-- =====================================================================
-- 1. Migration / DDL role — DIRECT_URL only, never a runtime pod credential
-- =====================================================================
CREATE ROLE rayin_migrator WITH
  LOGIN PASSWORD '<generated, stored in the langfuse k8s Secret as
  migrator-password, see §3.3 for rotation>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 5;

GRANT ALL PRIVILEGES ON DATABASE langfuse TO rayin_migrator;
GRANT ALL PRIVILEGES ON SCHEMA public TO rayin_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO rayin_migrator;

-- CORRECTION (2026-09-17, review comment): the four statements above do NOT
-- confer ownership of the ~400 tables that already exist (all currently
-- owned by `postgres`) -- GRANT ALL PRIVILEGES gives DML rights, not DDL
-- rights. ALTER TABLE / DROP TABLE are ownership-gated operations in
-- Postgres with no equivalent GRANT; without this statement, rayin_migrator
-- could CREATE new objects but could not run any future `prisma migrate
-- deploy` that ALTERs an existing table -- including, notably, the
-- acme_guardrail_events ALTER TABLE below, which this exact migration
-- depends on. Must run immediately after CREATE ROLE rayin_migrator, before
-- anything else in this script:

-- SECOND CORRECTION, CONFIRMED BY LIVE TEST (2026-09-17, see status note
-- below): this GRANT is REQUIRED, not a defensive "if it fails" fallback as
-- an earlier draft of this note assumed. REASSIGN OWNED BY requires the
-- executing role to be a member of BOTH the old and new role. `postgres`
-- just created rayin_migrator above, but on Postgres 15 (the real server's
-- major version), CREATEROLE does not grant automatic membership in roles
-- you create -- that only became automatic in Postgres 16. Without this
-- line, the REASSIGN below fails with "permission denied to reassign
-- objects", confirmed against a disposable instance modeling
-- azure_pg_admin's actual (non-superuser) privileges.
GRANT rayin_migrator TO postgres;

REASSIGN OWNED BY postgres TO rayin_migrator;

-- =====================================================================
-- 2. General application runtime role — replaces `postgres` as DATABASE_URL.
-- Broad DML is deliberate and unchanged from today's *effective* access —
-- this statement formalizes existing behavior, it does not widen it.
-- =====================================================================
CREATE ROLE rayin_app_runtime WITH
  LOGIN PASSWORD '<generated, stored as app-runtime-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 100;

GRANT CONNECT ON DATABASE langfuse TO rayin_app_runtime;
GRANT USAGE ON SCHEMA public TO rayin_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rayin_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rayin_app_runtime;

-- Keep future tables (created by future `prisma migrate deploy` runs, owned
-- by rayin_migrator) automatically extending the same grant, so this block
-- doesn't need to be re-run by hand after every schema change:
ALTER DEFAULT PRIVILEGES FOR ROLE rayin_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rayin_app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE rayin_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO rayin_app_runtime;

-- Append-only enforcement on the guardrails audit table — applied to the
-- *general* runtime role too, not just the narrow writer role below, as
-- defense-in-depth for any code path that ever queries this table through
-- the general connection (e.g. the existing acmeGuardrailsRouter reads).
REVOKE UPDATE, DELETE ON acme_guardrail_events FROM rayin_app_runtime;

-- =====================================================================
-- 3. Narrow writer role for the new guardrails-events ingest endpoint only.
-- This is a SEPARATE connection/Prisma client from rayin_app_runtime inside
-- the web pod — the endpoint handler must not reuse the general pool.
-- =====================================================================
CREATE ROLE rayin_guardrails_writer WITH
  LOGIN PASSWORD '<generated, stored as guardrails-writer-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 20;

GRANT CONNECT ON DATABASE langfuse TO rayin_guardrails_writer;
GRANT USAGE ON SCHEMA public TO rayin_guardrails_writer;
-- No blanket grant at all — explicit INSERT-only on one table, nothing else:
GRANT INSERT ON acme_guardrail_events TO rayin_guardrails_writer;
-- (SELECT is deliberately NOT granted: idempotency is enforced via the new
-- event_id UNIQUE constraint + `ON CONFLICT (event_id) DO NOTHING`, which
-- does not require read access. If a future need for read-your-write
-- confirmation arises, grant SELECT explicitly then, don't default to it.)

-- =====================================================================
-- 4. Retention purge role — scheduled job only, distinct from live traffic.
-- =====================================================================
CREATE ROLE rayin_retention_purger WITH
  LOGIN PASSWORD '<generated, stored as retention-purger-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 2;

GRANT CONNECT ON DATABASE langfuse TO rayin_retention_purger;
GRANT USAGE ON SCHEMA public TO rayin_retention_purger;
GRANT SELECT, DELETE ON acme_guardrail_events TO rayin_retention_purger;
-- Extend to acme_prompt_approvals only if/when that table gets its own
-- confirmed retention policy; not assumed here.
```

Migration-time addition to `acme_guardrail_events` (illustrative — the actual
migration file belongs in the endpoint PR, this is the shape):

```sql
ALTER TABLE acme_guardrail_events
  ADD COLUMN event_id UUID,
  ADD COLUMN redacted_text TEXT,
  ADD COLUMN pii_findings JSONB,
  ADD COLUMN raw_content_encrypted TEXT;

-- Real idempotency key, generated by rayin-guardrails at decision time,
-- replacing the fragile composite dedup key. Nullable during backfill,
-- then enforce NOT NULL + UNIQUE once existing rows are migrated or purged.
CREATE UNIQUE INDEX acme_guardrail_events_event_id_key
  ON acme_guardrail_events (event_id)
  WHERE event_id IS NOT NULL;
```

**CORRECTION (2026-09-17, review comment), tested live before being accepted
as final:** because the index above is *partial* (`WHERE event_id IS NOT
NULL`), any insert that names an explicit conflict target must restate the
same predicate, or Postgres rejects it at runtime — the conflict target has
to match the index definition exactly, predicate included.

```sql
-- WRONG -- fails at runtime, confirmed live (see test below):
INSERT INTO acme_guardrail_events (...) VALUES (...)
  ON CONFLICT (event_id) DO NOTHING;

-- CORRECT -- restates the index's own predicate:
INSERT INTO acme_guardrail_events (...) VALUES (...)
  ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING;
```

**Verification (2026-09-17):** tested against the live dev Postgres instance
via a session-scoped `TEMP TABLE` reproducing this exact shape (temp tables
auto-drop on disconnect — no persistent schema or data touched). Three forms
were tried against a genuine duplicate `event_id`:

| Form | Result |
|---|---|
| `ON CONFLICT (event_id) DO NOTHING` (the original, wrong form) | **Failed** — Postgres rejected it, exactly as flagged |
| `ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING` (corrected) | **Succeeded** — duplicate correctly skipped, row count stayed at 1 |
| bare `ON CONFLICT DO NOTHING` (no explicit column target) | **Succeeded** — also skips correctly against a partial index |

The third row matters for the actual endpoint PR: Prisma's own
`createMany({ skipDuplicates: true })` is believed to generate the bare form,
not an explicit column list — if confirmed against the real generated SQL
once that endpoint exists, the application code path was never exposed to
this bug at all; only hand-written raw SQL using an explicit target (as
originally drafted here) was. Worth a quick confirmation against Prisma's
actual query log in the endpoint PR, but the corrected raw-SQL form above is
proven safe either way.

**Assumption:** the composite `[projectId, agentId, eventTime, direction]`
dedup key stays in place until `event_id` backfill is complete, then gets
dropped in a follow-up migration — not resolved unilaterally here since it
depends on rollout sequencing between this repo and `rayin-guardrails`
actually emitting `event_id` on every event first.

---

## 3. Authentication model

### 3.1 Password auth vs. Azure AD (`active_directory_auth_enabled`)

`postgres.tf` already sets `active_directory_auth_enabled = true`, but nothing
in this codebase uses it — `DATABASE_URL`/`DIRECT_URL` are plain
`postgresql://user:password@host/db` connection strings (confirmed via
`web/entrypoint.sh`), and Prisma is not configured for Azure AD token auth
anywhere in `packages/shared/prisma`. **It is enabled but unused** — the
setting currently buys nothing beyond leaving the door open.

**Recommendation, split by access pattern:**

- **Human/administrative access** (a DBA or on-call engineer connecting
  directly via `psql` for investigation, one-off queries, or manual grants):
  adopt Azure AD auth for this path specifically. It replaces a standing
  shared password with a short-lived AAD token tied to an individual Entra
  identity — this is a real, valuable BFSI story (individual accountability
  for every interactive DB session, tokens that expire, no shared secret a
  departing employee could retain). Low cost to adopt since it doesn't touch
  application code at all — it's purely how a human authenticates their own
  `psql` session.
- **Service/application access** (the four roles in §2.2): stay on password
  auth for now. Azure Postgres Flexible Server does support AAD auth for
  workload-identity/managed-identity principals, which would let AKS pods
  authenticate without any static password in a Kubernetes Secret at all —
  but Prisma does not have native support for AAD token-based auth with
  automatic token refresh, so adopting this for the app's own connections
  would mean either a custom connection-string-refresh sidecar or moving off
  Prisma's connection-string model for this piece. That's a real
  architecture change, not a config flag — worth it for a BFSI customer
  story eventually, not something to fold into this feature's scope. See
  Open Decisions.

### 3.2 Connection security

TLS enforcement and private networking are already confirmed elsewhere in this
deployment (private endpoint in `postgres.tf`, TLS enforced at the Flexible
Server level) and this design doesn't change that. One concrete addition:
`rayin_guardrails_writer`'s connection string should explicitly set
`sslmode=require` (or stronger, `verify-full` if a CA bundle is distributed to
the pod) rather than relying on server-side defaults, since this is the one
credential whose traffic originates from a service this repo doesn't own the
code of — don't inherit TLS posture implicitly for that one.

### 3.3 Credential rotation — the four new DB passwords

Unlike `ENCRYPTION_KEY` (see §3.4), the four Postgres role passwords in §2.2
are ordinary rotatable secrets: rotating a DB password just means updating the
Kubernetes Secret and bouncing the pods that hold that particular connection
string — no data becomes unreadable. Recommend a standard rotation cadence
(e.g., 90 days, or per whatever the customer's BFSI policy already mandates)
via Terraform `random_password` + a time-based rotation trigger, same pattern
already used for `random_password.postgres_password` today. This is
straightforward and should just be adopted, not treated as an open question.

### 3.4 `ENCRYPTION_KEY` — the real constraint, and a concrete recommendation

Today's `ENCRYPTION_KEY` has no rotation mechanism (confirmed — no
re-encryption script exists; rotating it makes all existing ciphertext,
including LLM API keys and SSO client secrets, permanently undecryptable).
This design proposes making that same key responsible for a *new*, higher-
sensitivity consumer: `raw_content_encrypted`.

**Recommendation:** do not add `raw_content_encrypted` as another consumer of
the shared global `ENCRYPTION_KEY`. Introduce a **second, dedicated** key
(e.g. `GUARDRAILS_ENCRYPTION_KEY`, same AES-256-GCM mechanism, same
`encrypt()`/`decrypt()` utility parameterized to accept a key argument instead
of always reading the module-level `ENCRYPTION_KEY`) scoped only to this one
column. Rationale:

- **Blast-radius separation.** A compromise or forced rotation of the key
  protecting LLM API keys/SSO secrets should not require touching the
  guardrails audit trail, and vice versa — these are different data owners,
  different sensitivity profiles, and in a BFSI audit, different "who can
  authorize access to this key" answers (guardrails raw content is closer to
  a security-incident record; LLM API keys are operational credentials).
- **It's a small, cheap change now, and an expensive one later.** Splitting
  the key today costs one new env var and a small utility signature change.
  Retrofitting a split after `raw_content_encrypted` already has production
  data under the shared key means either leaving it under the old key forever
  (defeating the purpose) or a migration that decrypts-and-re-encrypts every
  row — exactly the kind of operation the current lack of rotation tooling
  makes painful.
- This does **not** solve the underlying "no rotation mechanism" gap for
  either key — that's a separate, larger piece of work (see Open Decisions) —
  it just stops today's decision from making that gap worse by conflating two
  data categories under one non-rotatable secret.

---

## 4. Scope review (app-level RBAC)

### 4.1 What's already in place, correctly

The existing `projectGuardrails:read` scope (already added to
`packages/shared/src/features/rbac/projectAccessRights.ts`, owner/admin-level
sensitivity matching audit logs) is the right call for the dashboard read path
— it is a dedicated scope, not a reuse, and the code comment correctly reasons
about why it's at that sensitivity level. No change recommended there.

### 4.2 `AcmePromptApproval` — reusing `prompts:CUD` / `project:update`

The approve/reject step is gated on `project:update` (owner/admin only),
distinct from `prompts:CUD` (broader — used for the request step). Structurally
this *does* implement maker-checker: the set of roles that can request a
promotion is broader than the set that can approve one.

**Finding a BFSI auditor would raise:** because `OWNER` (and typically `ADMIN`)
holds *both* `prompts:CUD` and `project:update`, nothing in the current design
prevents the same individual from requesting a prompt promotion and then
approving their own request — the scope model enforces "which roles can do
which step" but not "the same person can't do both steps for the same
request." Self-approval is a textbook segregation-of-duties finding in any
change-approval workflow (prompt promotion here is functionally a production
change-control process).

**STATUS: FIXED (2026-09-17).** `reviewedBy != requestedBy` is now enforced
in the `approve` mutation (`acmePromptApprovalRouter.ts`) — a `FORBIDDEN`
rejection, not a warning, if the reviewing user's id matches the request's
`requestedBy`. One-line guard in the existing router, no schema or scope
change. This closes the specific gap a BFSI audit tests for directly ("can
an Owner approve their own prompt promotion?") — the answer is now no.

Note this does not by itself close the separate, larger gap noted in the
2026-09-17 architecture review: a user with `prompts:CUD` can still set a
label directly on the native prompt page, bypassing this approval flow
entirely, since protected-label *configuration* is Enterprise-gated and no
licence is set. That is tracked as its own roadmap item (in-house
protected-label enforcement), not fixed by this guard.

### 4.3 New guardrails-events endpoint — shared-secret auth, no user scope

This is service-to-service by design (`rayin-guardrails` has no user session to
present), so it correctly doesn't use `throwIfNoProjectAccess`/a `ProjectScope`
— that model doesn't fit a machine caller. But the specific mechanism proposed
(one shared secret, `projectId` supplied in the request body) has two gaps a
BFSI auditor would flag:

1. **No cryptographic binding between the claimed `projectId` and the
   credential.** Any holder of the one shared secret can write events
   attributed to *any* project in this deployment, not just the one(s) that
   particular `rayin-guardrails` instance actually serves. In a deployment
   where one RAYIN instance's Postgres backs multiple internal ACME projects
   (environments, business units), this is a real tenant/environment
   isolation gap, not a hypothetical one.
2. **No non-repudiation.** If the shared secret leaks or is guessed, there is
   no way to distinguish legitimate `rayin-guardrails` traffic from a forged
   write — every row this endpoint accepts is equally "trusted," with no
   per-caller identity to revoke independently of every other caller.

**Recommendation, in order of preference:**

- **Preferred:** reuse this repo's existing project API key infrastructure
  (`createAuthedProjectAPIRoute`, the same public/secret key pair mechanism
  every other `/api/public/*` route already uses) instead of a bespoke shared
  secret. This gets per-project attribution, existing rate-limiting, and
  existing revocation/rotation UI for free, and ties every write
  cryptographically to the one project it claims to be for — `rayin-guardrails`
  would hold one project-scoped API key per project it serves, generated the
  same way any other integration's key is generated today.
- **If shared-secret is kept for MVP speed** (matches the existing
  `RAYIN_GUARDRAILS_CONFIG_SECRET` pattern already used for the config
  read/write path, and the design's "in-cluster-only network path" framing):
  at minimum (a) validate the claimed `projectId` actually exists and has
  guardrails enabled before insert — don't blind-write to arbitrary/misspelled
  project ids — and (b) log the calling pod/source identity (not just the
  event content) on every accepted write, so a post-incident audit can at
  least reconstruct *which* `rayin-guardrails` deployment/pod sent a given
  event, even without per-project cryptographic separation.

**Assumption:** the choice between "adopt project API keys now" vs. "ship the
shared-secret MVP and revisit" is a real cost/timeline tradeoff for whoever
owns the two PRs, not something this review resolves unilaterally — see Open
Decisions.

---

## Open decisions requiring a human call

These are flagged deliberately rather than resolved as assumptions, because
each has real cost/tradeoff implications that a compliance officer or business
owner should weigh in on.

**Items 1-3 are business/legal decisions and are explicitly BLOCKED — do not
implement against them.** Any code that would depend on a specific answer here
(the retention purge job's actual interval, an erasure-request handler, a
region-pinning decision) must not be built until these are resolved. Where
engineering work is unblocked in the meantime (e.g., the purge *mechanism*
itself — `rayin_retention_purger`'s existence and grants), it should be built
generically, with the actual retention interval as a configurable parameter
supplied later, not hardcoded from the proposals below.

1. **STATUS: RESOLVED (2026-09-17, leadership review) — Retention periods**
   (§1.3) — business decision made: **30 days hot in Postgres, then archived
   to cold storage and purged.** Applies uniformly to all three tiers,
   superseding the earlier 1yr/3–5yr/1yr engineering proposal. This is a
   business decision, not a confirmed reading of the CBB Rulebook or Bahrain
   PDPL — if a specific BFSI customer's regulatory obligation requires a
   longer minimum for a given data category, that customer's contract may
   need a per-deployment override of this default; flag that possibility to
   compliance rather than assuming 30 days satisfies every customer. The
   purge job (§2, `rayin_retention_purger`) should still read the interval
   from a configurable parameter, not a hardcoded literal, so a future
   per-customer override doesn't require a code change.
2. **STATUS: PENDING — Legal basis for exempting `block`-tier content from
   erasure requests** (§1.3) — whether "security audit trail, legitimate
   interest/legal obligation" is a sufficient documented basis to retain raw
   blocked content against a PDPL/GDPR-equivalent erasure request, and for how
   long. Legal call, not engineering. **No erasure-request handling should be
   built against an assumed answer.**
3. **STATUS: PENDING — Data residency** (§1.4) — whether the actual deployed
   Azure region (UAE or Qatar, since Azure has no native Bahrain region)
   satisfies a given BFSI customer's in-Kingdom/in-GCC data residency
   obligation under their specific CBB licensing category. This must be
   confirmed per customer, not assumed generally satisfied by "it's in the
   Gulf." **No region-pinning or per-customer deployment-location decision
   should be made against an assumed answer.**

Items 4-7 were reviewed and decided on 2026-09-17 (recorded in
`ACME-CHANGELOG.md`'s entry for that date) — see each item below for the
resolution and its rationale.

4. **RESOLVED — Project-API-key auth adopted, not the shared-secret MVP**
   (§4.3). The reusable infrastructure (`createAuthedProjectAPIRoute`) already
   exists and is already production-tested on every other `/api/public/*`
   route — this is not actually the slower option here, since the piece that's
   normally expensive to build (per-project key issuance, rotation UI, rate
   limiting) is not new work. Deferring to a shared-secret MVP would only defer
   the cost, not avoid it, and would defer it to a point where real audit rows
   already exist under the weaker model — the same "cheap now, expensive to
   retrofit later" reasoning already applied to the encryption-key split in
   §3.4. `rayin-guardrails` holds one project-scoped API key per project it
   serves.
5. **RESOLVED — Defer Azure AD/Entra workload-identity for service
   connections** (§3.1). Adopt the already-recommended rotated-password
   approach (§3.3) for all four new roles now; revisit AAD-for-services only
   if Prisma gains native AAD token-refresh support, or a specific signed
   customer contract requires it. This is a deliberate "not now" with a stated
   trigger condition, not an indefinite deferral — distinct from items 1-3,
   which are blocked on someone else's answer, not an engineering call at all.
   Human/administrative AAD access (the other half of §3.1) proceeds as
   recommended — that decision was not in question.
6. **RESOLVED — Treat PAN-masking in `rayin-guardrails`' push logic as a
   "must do," not a "should do"** (§1.2). This doesn't require knowing ACME's
   actual customer mix to resolve: implementation cost is low (Presidio's
   `CREDIT_CARD` recognizer already exists), and the downside of skipping it
   is asymmetric and severe (accidentally pulling the whole Postgres instance
   into PCI-DSS scope). Guardrails exist specifically to catch cases the
   product didn't anticipate — a support-ticket-summarizing agent can
   encounter a card number even at a customer ACME never positioned as
   "payment-adjacent." Cheap insurance beats a scope argument after the fact.
7. **RESOLVED — Sequence Key Vault adoption after the PAN-masking decision,
   defer the HSM-tier question specifically** (§3.4). Adopt standard
   (software-protected) Azure Key Vault for `GUARDRAILS_ENCRYPTION_KEY` as
   part of the broader secrets-management Terraform follow-up already
   captured — this is a "yes, do it" independent of anything else. The
   HSM-protected tier specifically is left open: item 6's resolution (PAN
   never reaches this column in full) meaningfully weakens the case for
   paying for HSM-tier custody on this particular key, since the column it
   protects is designed to no longer be PCI-scoped data. Revisit HSM tier only
   if a specific customer's compliance regime mandates hardware-backed key
   custody regardless of PCI scope.

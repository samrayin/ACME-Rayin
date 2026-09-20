# ADR-0003 — CAIRO as the single control plane for LiteLLM: management and request-log capture

| | |
|---|---|
| **Change IDs** | **CHG-2026-005** management · **CHG-2026-008** request-log receiver, mirror and reconciliation · **CHG-2026-009** enabling the gateway callback (separate Heavy change: own changelog entry and rollback plan, this ADR is its design note). CHG-2026-006 (image pin) is a prerequisite, already applied. |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Tags after `acme-v4.38.0.3`, one pull request per change ID. Each ships dark: flags off. |
| **Status** | Accepted for build by the owner, 2026-09-19 (revision 9: proofs 1, 3 and 4 run in dev; first real-browser pass of the console, with the fixes of CHG-2026-011; revision 8: real push payload verified against the closed schema; push side of proof 2 observed). Production approval is separate and not given. |
| **Type** | Forward |
| **Date** | 2026-09-19 |
| **Author** | Claude (implementation), on the owner's instruction |
| **Approval** | Design accepted for build by Anees Ur Rahman, 2026-09-19 (instruction to build CHG-005, -008 and -009 in full). Each pull request is reviewed and merged by the owner; the implementer is not an approver of its own change. This is not a production approval. |
| **Commits / tag** | Branch `feat/cairo-litellm-management`; no tag yet |

**Numbering:** drafted locally on 2026-09-19 as ADR-0002 with change IDs CHG-2026-003, -005 and -006. Those
numbers were claimed in parallel by another change (#36) before this was pushed, so it was renumbered to
ADR-0003 with CHG-2026-005, -008 and -009, claimed through `CHANGE-ID-REGISTER.md` (#38). The image pin it
depends on is CHG-2026-006. Nothing was ever published under the old numbers.

**Length:** the procedure asks for one page. This note covers three change IDs at
the owner's instruction and is longer. It can be split per change ID on request.

## 1. Purpose
Managing the LLM gateway today means a second portal: LiteLLM's admin UI has its
own login, authenticates with one all-powerful master key, and leaves no record
in CAIRO. And nothing durable in CAIRO says which key made which model call.
This change makes CAIRO the only place gateway keys, teams, budgets and spend
are managed, and gives CAIRO its own append-only record of every management
action and every gateway request, built to the standard of the guardrail audit
trail (`POSTGRES-COMPLIANCE-FRAMEWORK.md`).

## 2. Scope
**In, CHG-005:** key create, list, rotate, revoke; model catalogue with health;
teams; budget and rate limit on keys and teams; spend and usage by key, team and
model; an append-only record of every mutating action.
**In, CHG-008:** authenticated receiver endpoint; `acme_litellm_request_logs`;
scheduled reconciliation against LiteLLM's spend logs with a recorded gap count;
request-log and reconcile-status screens.
**In, CHG-009:** turning on LiteLLM's HTTP logging callback towards the receiver.

**Out:** provider onboarding UI; routing and fallback editing; guardrail policy
editing; SSO identity passthrough; adopting keys created outside CAIRO; storing
prompt or response text; every LiteLLM Enterprise feature.

**Enterprise-only, therefore not used:** native rotation
(`/key/{key}/regenerate`), `tags`, `model_max_budget`, `temp_budget_increase`,
`/global/spend/report` (HTTP 400 "must be a LiteLLM Enterprise user", observed
live), the team `admin` role, LiteLLM's own audit log (0 rows without a licence).
`model_max_budget` and tag-based limits are enforced inside the proxy per
request; CAIRO can report on them but cannot replace them.

## 3. Decision — management (CHG-005)
1. **CAIRO is the only UI.** The gateway Service is ClusterIP; its admin UI is
   never shown to a customer.
2. **Server-side only.** New tRPC router `acmeLitellm`. New server-only
   `env.mjs` entries `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY`. The master key
   is never returned, logged, put in an error message or stored.
3. **CAIRO RBAC is authoritative; LiteLLM is a projection.** A LiteLLM team
   belongs to exactly one CAIRO project. CAIRO-issued keys and teams carry
   `metadata`: `cairo_managed`, `cairo_key_id`, `cairo_org_id`,
   `cairo_project_id`, `cairo_created_by`, `cairo_lineage_id`. Scopes:
   `llmGateway:read` (OWNER, ADMIN, MEMBER, VIEWER), `llmGateway:CUD` (OWNER,
   ADMIN), `llmGatewayLogs:read` (OWNER, ADMIN, SECURITY), each enforced with
   `throwIfNoProjectAccess`; lists are filtered to the caller's project
   server-side. **Limit, stated plainly:** assigning a role per project needs
   Langfuse's `rbac-project-roles` Enterprise entitlement, which this deployment
   does not have. Until it does, a user's organisation role applies to every
   project in that organisation.
4. **Metadata is merged, never replaced.** `/key/update` replaces the whole
   `metadata` object, and LiteLLM keeps its own settings inside it (`tags`,
   `guardrails`, `temp_budget_increase`, `model_rpm_limit` and others; read in
   upstream source). Every CAIRO update reads the current metadata, changes only
   `cairo_*` keys and writes the merged object back.
5. **Rotation is an OSS-tier composition, not native rotation.** Native
   regenerate is Enterprise-gated. CAIRO (a) creates a new key with the same
   settings, then (b) deletes the old key, both recorded under one correlation
   ID. If (b) fails, CAIRO deletes the new key and reports failure; if that also
   fails the record is marked `ROTATION_PARTIAL` with both key IDs, the UI shows
   it as needing action, and success is never reported. The secret always
   changes; both keys are valid briefly; the alias gets a generation suffix; the
   old key's spend is carried to the new key so rotating cannot reset a budget.
   Rotation sits behind one interface so native regenerate can replace it under
   a licence, and drift is matched on `cairo_key_id`, not on the token hash.
6. **Every mutating action is recorded before it is confirmed.** New table
   `acme_litellm_events`, append-only (§5). An *intent* row is written before
   LiteLLM is called; if that write fails, LiteLLM is not called. An *outcome*
   row is written before the user sees a result. Rows carry actor, organisation,
   project, action, target, safe before/after, correlation ID. Never key
   material. This replaces revision 1's use of `audit_logs`, which is not
   append-only at database level. CAIRO also sends `litellm-changed-by: <user>`
   on every call, so a future LiteLLM audit log attributes correctly.
7. **Drift detection, read-only:** *unmanaged*, *missing*, *drifted*. All 5 keys
   that exist today are unmanaged. A team holding a LiteLLM `admin` member is
   flagged: that role would let someone manage keys around CAIRO.
8. **Flag** `CAIRO_LITELLM_MANAGEMENT_ENABLED`, default `"false"`. **Gateway
   unreachable:** reads fall back to the last snapshot with its age shown;
   mutations are refused; a banner says why.

## 4. Decision — request-log capture (CHG-008, CHG-009)
**Order of work is fixed.** (a) Image pinned and verified: done. (b) Build and
prove the receiver, table and reconciliation. (c) Only then enable the callback.
The pod is never restarted on a floating tag. There is no time cut and no scope
is deferred for time. **Readiness gates:** a change ID is not done until it is
(1) verified working, with the evidence recorded, (2) documented, and (3) its
rollback rehearsed. Each of CHG-005, -008 and -009 lands as its own pull
request with its own changelog entry and rollback plan. The four proofs in §10
are mandatory; if one fails, work stops and the failure is reported.

1. **Receiver:** `POST /api/public/litellm-request-logs`, behind
   `CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED` (default `"false"`; off = 404).
   - *Authenticated:* a dedicated bearer secret `CAIRO_LITELLM_INGEST_SECRET`,
     compared in constant time; anything else gets 401. Not a project API key:
     one gateway serves every project, so no project key is the right identity.
   - *Strict validation, per record:* a closed schema of the LiteLLM 1.100.1
     `StandardLoggingPayload` (42 fields) and its metadata (34 fields), read from
     the running gateway's own type definitions. An unknown field, a wrong type,
     an unknown status or a millisecond timestamp rejects **that record**; it is
     never coerced. A batch with some bad records is answered 200 with counts
     (the gateway drops a whole batch on any 4xx, which would throw the good
     records away); a batch with only bad records is answered 422. Rejections
     are logged as field paths and codes, never values.
   - ***Deviation from LiteLLM's native behaviour, approved by the owner
     2026-09-19: partial acceptance of a batch.*** LiteLLM's logger treats a
     batch as all-or-nothing: one HTTP status for up to 512 records, the whole
     batch retried on 5xx or timeout and the whole batch **dropped** on any
     4xx. If CAIRO answered 4xx because one record in 512 was malformed, the
     511 good records would be thrown away by the gateway. So CAIRO accepts
     per record: the good records are written, the bad ones are rejected and
     counted, and the batch is answered **200** with
     `{received, inserted, duplicates, rejected}`. Only a batch in which
     *every* record is malformed gets 422. **Consequence to keep in mind:** a
     200 from this endpoint does not mean every record was stored, and LiteLLM
     never learns that some were rejected. CAIRO therefore does not rely on the
     gateway to notice: rejections are logged on the CAIRO side and the
     rejected requests reappear as a non-zero reconciliation gap count.
   - *Nothing from a request reaches a log.* The receiver logs in exactly two
     places. A rejected record logs counts, field paths and validator codes,
     never a value, never the unknown key's name, never the validator's
     message. A write failure logs the error's class name and machine code
     only, never its message: a Prisma or driver message can echo the values it
     was given. A test spies on every log sink with a marker string planted in
     every content field, in an unknown key's name and in a database error's
     message, and asserts the marker appears nowhere.
   - *Metadata only:* the payload carries far more than prompt and response
     text: also `error_str`, `error_information.error_message` and `traceback`
     (which can quote a prompt), `model_parameters`, requester headers and
     metadata, auth metadata and the user's email. All are recognised so the
     record validates and then **discarded**. Only an explicit allow-list of 24
     columns is persisted. CHG-2026-009 also sets `turn_off_message_logging`.
   - *Idempotent:* unique `request_id` plus skip-duplicates. The writer needs no
     `SELECT` on the table.
   - *Project is derived, never trusted:* the payload's hashed key is looked up
     in `acme_litellm_keys` (revoked and rotated hashes are kept, so late
     records still resolve). Any project field in the payload is ignored. No
     match = stored with no project, visible to organisation owners only. The
     project is stamped at insert and never rewritten.
   - *Bounded:* body limit 4 MB, at most 512 records per call (the gateway's
     batch size), rate-limited through the existing public-API limiter; 413 and
     429 otherwise.
   - *Fast:* validate, one bulk insert, respond. No call to LiteLLM or anything
     else on this path.
2. **Callback (CHG-009):** LiteLLM's built-in `generic_api` logger, for success
   and failure events. Verified in the running 1.100.1 by reading its
   source inside the pod: it is in the core package with no licence check,
   batches 512 events or 5 seconds and runs off the request path.
   **Correction, 2026-09-19 (revision 7): it does NOT retry and does NOT buffer
   a failed batch.** Named as the plain `generic_api` callback it is built with
   no arguments, so `max_retries` is 0; and its `async_send_batch` catches its
   own errors and then clears the queue in a `finally` block. A batch whose
   POST fails, for any reason and with any status, is **dropped at once**.
   Revisions 2 to 6 of this note said it "retries on timeouts and 5xx" and
   "holds at most 50,000 events"; both capabilities exist in the code, neither
   is in effect in this configuration (the 50,000-event buffer applies only to
   loggers that re-raise). **Option for CHG-2026-009, for the owner to decide at
   the restart gate:** instead of the plain name, mount a four-line custom
   callback module that constructs the same OSS logger with
   `max_retries=3`, a timeout, and the header taken from the environment.
   Retries would then cover a brief CAIRO restart; a longer outage still drops
   events. **Verified 2026-09-19 in a throwaway pod on the pinned image** (mock model,
   local sink, no database, live gateway untouched): the module loads from
   beside the config file; with the sink answering 503 twice it made 3 POSTs
   and delivered the batch, where the plain callback made 1. Still best-effort:
   after the last retry the batch is dropped. The secret reaches it as an environment reference, not a literal.
   **Enabling or removing it requires a restart of the LiteLLM pod**, on the
   pinned digest. **Rollback of CHG-009:** remove the callback from
   `litellm-config.yaml`, re-apply the ConfigMap, restart the pod.
3. **If CAIRO is unreachable:** the gateway keeps serving; model calls are not
   delayed or failed. With the plain callback **nothing waits and nothing
   is retried**: every batch sent while CAIRO is unreachable, slow past the
   client timeout, or answering anything but 2xx is dropped by the gateway, up
   to 512 events or 5 seconds of traffic per flush. *Lost from the push path:*
   all of those, plus whatever is queued if the LiteLLM pod restarts. *Recovered by
   reconciliation:* every one of those that LiteLLM wrote to its own spend
   logs. *Not recoverable by anyone:* a request LiteLLM never wrote to its spend
   logs (its database was down too), or a spend-log row deleted before the next
   reconcile. Fields the push carries but the spend log does not are absent on
   reconciled rows; each row records its `source` (`PUSH` or `RECONCILE`).
4. **Reconciliation — a silent gap is worse than no mirror.** A scheduled
   worker job (every 5 minutes, overlapping window) pages LiteLLM's
   `/spend/logs/v2` (verified live: in the OpenAPI schema, HTTP 200, no
   Enterprise marker, paginated, hashed key per row, no prompt or response
   text), inserts anything missing, and appends one row to
   `acme_litellm_reconcile_runs`: window, rows checked, **gap count**, status.
   The UI shows last successful reconcile time and gap count on the request-log
   screen, and warns when the last success is older than 15 minutes. Before the
   callback is on, every row arrives this way and the gap count equals the
   volume; the UI labels that state "push not enabled" rather than showing it
   as a fault. `/spend/logs/ui` is not used.
   **Matching (found during the build):** a spend-log row counts as present if
   the mirror has its `request_id` **or** its `litellm_call_id`. On a cache hit
   LiteLLM appends `_cache_hit<time>` to the id separately on the push path and
   the spend-log path, so the two ids differ for one request; matching on
   `request_id` alone would report a false gap and store the request twice.
   **Window:** rows younger than 2 minutes are left to the push; each window
   overlaps the last successful one by 15 minutes; the first run looks back 7
   days; at most 20,000 rows per run. A run that could not read LiteLLM, hit
   the row ceiling or met an unreadable row is recorded as `failure` or
   `partial`, never as a clean zero, and only a `success` advances the window.
5. **Proof before enablement:** the receiver is tested against a replayed
   sample payload built from the 1.100.1 payload type and a real
   `/spend/logs/v2` row: accepted once, duplicate skipped, unauthenticated
   rejected, unknown field rejected, oversize rejected, project derived from a
   known hash, no project for an unknown hash, prompt text not stored. LiteLLM
   configuration is not touched until all pass.

## 5. Database change
- **Migrations:** two, one per pull request, additive only; no shipped migration edited. CHG-005, `<timestamp>_add_acme_litellm_management`: `acme_litellm_keys`, `acme_litellm_teams`, `acme_litellm_spend_snapshots` (mutable, CAIRO's projection) and `acme_litellm_events` (append-only). CHG-008, `<timestamp>_add_acme_litellm_request_logs`: `acme_litellm_request_logs` and `acme_litellm_reconcile_runs` (both append-only). No foreign key to `projects` on any of them: the record must outlive the project.
- **Append-only at database level, not in code.** The roles and grants live **inside the migrations**, idempotently, following `20260917090000_add_acme_guardrail_events_push_support`; they are not applied by hand. (Revision 2 of this note said "by hand". That was wrong and is corrected here.) On each append-only table the general runtime role `rayin_app_runtime` gets `REVOKE ALL` then `GRANT SELECT`: it can read the record and do nothing else to it. New role `rayin_litellm_writer`: `INSERT` on the append-only tables and nothing else, no `SELECT` (so writes use `createMany`, a plain `INSERT`; Prisma's `create` issues `RETURNING`, which needs `SELECT`). It is used through its own Prisma client bound to `RAYIN_LITELLM_WRITER_DATABASE_URL`, which refuses to fall back to the general connection. New role `rayin_litellm_retention_purger`: `SELECT, DELETE`, for a scheduled job only. Grants to `rayin_app_runtime` on the mutable tables are explicit, because the default privileges set up for `rayin_migrator` do not fire where migrations still run as the admin login. Roles are created **without a password**; setting one, and the connection string, is the only per-environment step and is recorded in `acme-rayin-ops`.
- **The control is designed, not yet effective (finding B9).** Verified in dev on 2026-09-19: web connects to Postgres as the admin login `postgres`, not as `rayin_app_runtime`. The least-privilege cutover was never executed (`acme-rayin-ops/PHASE-C-TERRAFORM-GAP-LIST.md`, item B9). The admin login owns the tables, so the revokes above do not constrain the running application: it can update and delete rows in these tables today. The same is true of `acme_guardrail_events`. Until B9 is closed by its own Heavy change, nothing in this note may be read as claiming the append-only control is effective. Validation therefore runs **two** checks (§10): as `rayin_app_runtime` (must be denied) and through the application's own connection (expected to succeed today; recorded as a known failure tied to B9 until the cutover closes it).
- **Backfill:** none. Existing keys stay unmanaged; reconciliation fills request history as far back as LiteLLM still holds it.
- **Rollback:** one folder per migration under `acme-governance/rollback/`, each with `ROLLBACK.md` and `down.sql` (drops that migration's tables and enums, deletes its `_prisma_migrations` row, one transaction), each rehearsed up → down → up on a throwaway database. CHG-009 has no schema change; its rollback plan is the configuration removal and restart in §4.2, rehearsed in dev. **Data lost on `down`: the append-only records themselves.** `ROLLBACK.md` says so and gives the export command to run first. Primary rollback is the two flags; `down.sql` is for full removal only.

## 6. Impacted components
| Component | Impact |
|---|---|
| Postgres | six new tables, two new roles, grants (§5). Nothing existing altered. |
| ClickHouse | none |
| Web / API | router `acmeLitellm`; server-side client; public route for the receiver; 3 scopes; 5 `env.mjs` entries; Security Analyst allow-list gains the two read-only log procedures; new screens |
| Worker | one scheduled reconciliation job; needs `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY`, `RAYIN_LITELLM_WRITER_DATABASE_URL` |
| Infra / Helm | env values from Secrets for web and worker; recorded in `acme-rayin-ops`; not in the Terraform module |
| Integrations | CHG-009 only: `litellm-config.yaml` gains the callback and `turn_off_message_logging`; the LiteLLM Secret gains the ingest secret; one pod restart |

## 7. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Master key reaches a browser or log | Low | Critical | server-only env; redaction; test that fails if it appears in any response or log line |
| Prompt or response text lands in the mirror | Medium | High | discarded at the receiver and switched off at the gateway; test asserts it is not stored |
| Silent gap in the mirror | Medium | High | scheduled reconciliation, recorded gap count, staleness warning |
| **The application connects as the admin login, so the append-only grants do not bind it (B9)** | **Certain in dev today** | High | not mitigated by this change. Both checks of proof 1 are run and recorded; B9 cutover is its own Heavy change and a blocker for production readiness |
| LiteLLM upgrade adds a payload field; strict receiver rejects every batch | Medium | Medium | image pinned; rejects are counted; reconciliation still fills the mirror; schema updated with each upgrade |
| Callback restart leaves the gateway unhealthy | Low | High | fixed order, receiver proven first, pinned digest, rollback is config removal and restart, rehearsed |
| Rotation leaves two live keys | Low | Medium | compensation, `ROTATION_PARTIAL`, never reports success |
| Spend reads $0.00 in dev, so cost paths are untested with real money | High | Medium | the only healthy model in dev is free tier; views show requests and tokens beside cost; cost figures need one paid provider before a customer relies on them |
| Ingest secret leaks | Low | Medium | it can only append well-formed rows: no read, no update; rotate (needs a gateway restart) |

## 8. Compatibility
- Backward compatible with the previous image: yes. Additive tables; both flags off changes nothing.
- Upstream merge risk: small edits to `env.mjs`, `root.ts`, `projectAccessRights.ts`, `securityRoleAllowList.ts`, worker queue registration, navigation. Everything else is new files under `acme-enhancements`.
- A later LiteLLM licence: no rework expected given §3.4, §3.5 and the `litellm-changed-by` header. LiteLLM's audit log would corroborate CAIRO's, not replace it.
- Flags: `CAIRO_LITELLM_MANAGEMENT_ENABLED`, `CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED`, both default off. Removal: one tagged release running with them on at a customer, no Critical or High finding.

## 9. Client-facing notes
Flags off: none. On: owners and admins manage gateway keys, teams, budgets and spend in CAIRO; owners, admins and security analysts see an append-only record of gateway changes and of every gateway request (who, which key, model, tokens, cost, status, source address; never prompt text). To be said plainly: rotation issues a new secret; keys created outside CAIRO appear as unmanaged, read-only, and their requests are visible to organisation owners only; per-project role assignment needs a Langfuse licence; an unhealthy provider is shown as unhealthy.

## 10. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| Pre-design | Done 2026-09-19 | GET-only probes inside the pod: LiteLLM 1.100.1; all §2 endpoints present; 401 without a key; `/spend/logs/v2` verified; `generic_api` logger verified ungated in the running version |
| Prerequisite CHG-006 | Done 2026-09-19 11:52 UTC | pod on `sha256:a3715fa7…`, readiness healthy, database connected, 0 restarts, 5 keys present, model health unchanged |
| **Mandatory proof 1a** — append-only grants hold for the runtime role | **PASS in dev, 2026-09-19** | as `rayin_app_runtime`: `SELECT` allowed; `UPDATE`, `DELETE`, `INSERT` and `TRUNCATE` each refused with `ERROR: permission denied for table …` on `acme_litellm_request_logs`, `acme_litellm_reconcile_runs`, `acme_litellm_events` and `acme_guardrail_events` |
| **Mandatory proof 1b** — the same statements through the application's own connection | **KNOWN FAILURE, confirmed in dev 2026-09-19 (B9). The append-only control is designed, not effective** | web and worker connect as the admin login, which owns the tables. As that login, inside a transaction that was rolled back: `UPDATE 34` and `DELETE 1` on `acme_litellm_request_logs`, `UPDATE 15` on `acme_guardrail_events`; 0 rows changed afterwards. Stays in the record until CHG-2026-010 closes it |
| **Mandatory proof 2** — push `id` equals spend-log `request_id` | **Proven by observation on both sides, 2026-09-19, on two different proxies; not yet on one request end to end** | *Spend-log side, live gateway:* a throwaway key made one successful and one failing call; `request_id` equalled the provider response id on success and the `litellm_call_id` on failure. *Push side, throwaway proxy on the pinned image:* the pushed record's `id` equalled the response id on success and the `litellm_call_id` on failure, and `litellm_call_id` equalled the `x-litellm-call-id` response header in both. Same rule on both sides. **Exception: cache hits** (§4.4), handled by matching on `litellm_call_id` as well. The same single request seen on both paths is observed only when CHG-2026-009 is live |
| **Mandatory proof 3** — reconciliation detects a real gap | **PASS in dev, 2026-09-19** | the callback is not enabled, so nothing is pushed. A real request through the gateway with a throwaway key at 19:43:04 UTC was absent from the mirror; the 19:50:00 run recorded `gap_count` 3, inserted 3, and the request is present with source `reconcile`. The other two were the gateway's own health-check calls (§13). First run: checked 34, gap 34 |
| **Mandatory proof 4** — no prompt or response text in the mirror | **PASS in dev on both paths, 2026-09-19** | *Push path:* a synthetic record with a marker in every content field was accepted by the live receiver (200, inserted 1; a repeat counted as duplicate); the marker is in 0 of 35 rows, every column searched as text, and in 0 web log lines; the project and organisation named in the payload were ignored. *Reconcile path:* the marker sent as the prompt of the proof-3 request is in 0 of 38 rows. The receiver also answered 401 without or with a wrong secret, 400 for a non-array body and 422 (paths and codes only) for a malformed record. **Earlier, throwaway proxy:** with `turn_off_message_logging` on, a marker placed in the prompt was absent from the whole pushed record (`messages` and `response` arrive as `redacted-by-litellm`); the receiver discards those fields regardless. The dev run is still required |
| A — leave dev | Pending | |
| B — staging | `Staging: not available; isolated migration and rollback rehearsal performed.` | Pending, see `ROLLBACK.md` |
| C — post-deploy | Pending | |

## 11. Operations note
Delivered with CHG-009 as `integrations/litellm/OPERATIONS.md` (product-level; environment names stay in `acme-rayin-ops`): how to verify the integration is healthy, what the reconcile gap count means, and what to do when it is non-zero. There is no demo runbook.

## 12. Not verified, and open questions
**Verified on the running 1.100.1 with throwaway keys, 2026-09-19 (created and deleted; the 5 original keys untouched):** a reused alias is refused (HTTP 400 "Unique key aliases across all keys are required"), so the generation suffix is needed; `spend` on `/key/generate` is honoured (`/key/info` read back 0.004); `/key/update` with a `metadata` object **replaces** the whole object (a foreign field vanished), and with no `metadata` leaves it alone, so §3.4's read-merge-write is required; `/key/{hash}/regenerate` is refused as an Enterprise feature (HTTP 500); `tags` on a key is refused as Enterprise (HTTP 403); the `token` LiteLLM returns equals SHA-256 of the key; deleting an already-deleted key returns 404, which CAIRO treats as already revoked.

**Still not verified:**
- How `request_id` is formed for call types other than chat completions (LiteLLM uses a per-call-type helper, `get_spend_logs_id`). Proof 2 covers chat completions only.
- ~~The exact push payload on 1.100.1.~~ **Verified 2026-09-19:** real success and failure records pushed by a throwaway proxy on the pinned image carried exactly the 42 top-level and 34 metadata keys of the receiver's closed schema: none unknown, none missing; `startTime` and `endTime` are floats (epoch seconds); the body is a JSON array; the `Authorization` header set through `GENERIC_LOGGER_HEADERS` arrives intact. Not covered: payloads of other call types (embeddings, responses API, MCP), streaming, or a gateway with a database and teams configured.
- **The Langfuse callback is registered but almost certainly delivers nothing:** it is in the active callback list, yet the pod has no `LANGFUSE_*` environment variables, so it has no credentials or host. Not investigated further; not changed here.
- Network path from the LiteLLM pod to the CAIRO web Service; any NetworkPolicy. (Web and worker to the gateway Service: **verified in dev 2026-09-19**, readiness and an authenticated list call answered 200 from both pods.)
- **Project derivation on a real request in dev.** No request has yet been made with a CAIRO-issued key, so the project's own request list is empty; the derivation is covered by unit tests only. The check was dropped by the owner on 2026-09-20: the one CAIRO-issued key's secret is no longer held by anyone, so no real request can be made with it. It stays not verified.
- `/openapi.json` on the gateway is served without authentication (in-cluster only). Noted, not changed.

**For the owner:** (1) Retention period for the three append-only tables; until set, nothing is purged. (2) `acme_litellm_events` replacing `audit_logs` for management actions was recommended on 2026-09-19 and is assumed here; say if not. (3) Disabling the LiteLLM admin UI outright is left to a separate change. (4) `integrations/litellm/README.md` is out of date: 5 keys not 2, and `chat-widget` and `rayin-guardrails` are scoped to the unhealthy model.

## 13. First real-browser pass in dev, 2026-09-19 (revision 9)
Signed in as a project ADMIN who is not an organisation owner. Done once, by hand: create, rotate and revoke a key; create and delete a team; model catalogue; spend; change record; requests.

**Worked as designed:** the secret is shown once and the dialog cannot be dismissed with Escape or the close button, only by ticking the acknowledgement; rotation left the old row `Rotated` and a new row `generation 2` with an `-r2` alias; revoke showed `Revoked`; both confirmation dialogs name the key and say what happens; the unhealthy model is listed as unhealthy with the provider's reason; the change record showed an intent and an outcome row per operation, six rows under one correlation ID for the rotation, the actor's role, and no key material (the detail view carries the token hash, by design); the requests tab showed the reconcile status, window and gap counts.

**Found, fixed in CHG-2026-011:**
1. A red "Forbidden" toast on every load of the Keys and Requests tabs for anyone who is not an organisation owner: the owner-only queries answered 403 as designed, and the global handler raised a toast. The page already handles that answer inline; the two queries now mark 403 as silent.
2. Every team showed a red "Has a gateway-side admin" badge. LiteLLM 1.100.1 adds the caller of `/team/new` as team admin, and for the master key that is `default_user_id` (read from the dev gateway). That membership is CAIRO's own identity and is now ignored; any other admin is still flagged.
3. Two sentences said the tables are "append-only at database level". With proof 1b failing, that describes a control as effective when it is not. They now say what is true today: CAIRO only adds rows.
4. `acmeLitellmService.ts` contained two literal NUL bytes (a join separator), so local `git diff` and `grep` treat the file as binary. GitHub did render its diff in #41 (checked through the API: 1,396 added lines shown), so the review was not affected. Replaced by the `\u0000` escape; behaviour unchanged.

**Found, not fixed:**
- The catalogue's health check makes a real call to every provider, and those calls appear in the gateway's spend logs as `litellm-internal-health-check`, so they are mirrored and counted in the gap count.
- The unhealthy model's reason is the provider's raw error text, cut off mid stack trace. No secret in it; untidy.
- A rotated or revoked key shows "In sync" in the gateway column, which reads oddly for a key that no longer exists there.
- With nothing pushed and a last-run gap of 0, the requests tab says "Complete as of the last reconciliation" and nothing tells the reader that push is not enabled at all ("1 pushed · 37 reconciled" is the only hint).
- The sticky page header is translucent: scrolled content shows through the breadcrumb on a narrow window. Cosmetic, shared with other pages.
- Dev's mirror now permanently holds two synthetic rows (proofs 3 and 4). Append-only, so they stay.

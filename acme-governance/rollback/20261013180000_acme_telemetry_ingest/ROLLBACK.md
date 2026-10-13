# Rollback plan — 20261013180000_acme_telemetry_ingest

| | |
|---|---|
| **Change ID** | CHG-2026-155 · Tier 1 · owner: Anees Ur Rahman |
| **ADR** | ADR-0006 addendum (separate document, pending the owner's review of its wording) |
| **Forward migration** | `packages/shared/prisma/migrations/20261013180000_acme_telemetry_ingest/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Flags** | `EYEON_TELEMETRY_INGEST_ENABLED` (default `false`), `EYEON_TELEMETRY_CONTENT_MODES_ENABLED` (default `false`). Connection settings, by name only: `RAYIN_TELEMETRY_READER_DATABASE_URL` (unset: the ingest answers 503) and `RAYIN_TELEMETRY_WRITER_DATABASE_URL` (unset: counters are not persisted) |
| **Test status** | **Tested 2026-10-13, isolated:** up, down and up again on a throwaway Postgres 15.19 as a non-superuser admin, 44 of 44 checks PASS; and the reader role with the two runtime lookups, 19 of 19 PASS. **Not run:** the full-chain `rehearsal-db.sh` (it creates a pod on the dev cluster, which needs the owner's go). **Not yet run in dev.** |
| **Data lost on rollback** | **Steps 1 and 2:** none. **Step 3 (`down.sql`):** the telemetry policy rows (including each project's end-user hash salt), the policy history (every change, with who and when) and the counters; the two telemetry roles. The key table is **not** dropped: only the reader's column grants on it are revoked. Traces already written to the tracing engine are **not** touched. |

## When to roll back
- **The ingest misbehaves, or a canary is found anywhere:** step 1 (the flag). This is immediate and needs no restart of the gateway.
- **A defect in the released console image:** steps 1 and 2.
- **The schema must go:** step 3. The owner decides, because it destroys an audit record and the salts.

## Order of operations
1. **Stop the route.** Either of these is immediate and reversible:
   - set `EYEON_TELEMETRY_INGEST_ENABLED=false` on the console (the route answers 404 and does nothing else), or
   - set `enabled = false` on the project's row in `acme_telemetry_policy` (the route answers 403 for that project; the change is picked up within 30 seconds).

   Spans already accepted stay in the tracing engine (Readiness Ledger P0-11: there is no deletion path yet).
2. **Redeploy the previous image tag** with `scripts/release/release.sh`. The previous image does not have the route, so a request for it is a plain 404. The tables are not read by any other code.
3. **Only if the schema must also revert:** export first, then run `down.sql` as the table owner or admin login:
   ```
   \copy (SELECT project_id, enabled, content_mode, user_id_mode, attribute_allowlist_extra, retention_days, version, updated_by_user_id, updated_at FROM acme_telemetry_policy ORDER BY project_id) TO 'acme_telemetry_policy.csv' CSV HEADER
   \copy (SELECT * FROM acme_telemetry_policy_history ORDER BY recorded_at) TO 'acme_telemetry_policy_history.csv' CSV HEADER
   \copy (SELECT * FROM acme_telemetry_ingest_stats ORDER BY bucket_start) TO 'acme_telemetry_ingest_stats.csv' CSV HEADER
   ```
   The salt column is left out of the export on purpose. If the migration is applied again later, every project gets a **new** salt, so end-user hashes written before the rollback will not match the ones written after.
4. Verify (below).

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not applied, with no drift
- [ ] `SELECT to_regclass('public.acme_telemetry_policy')`, `...policy_history` and `...ingest_stats` return NULL
- [ ] the functions `acme_telemetry_policy_record`, `acme_telemetry_policy_before_update` and `acme_telemetry_policy_history_append_only` no longer exist
- [ ] the roles `rayin_telemetry_writer` and `rayin_telemetry_reader` no longer exist, and `information_schema.column_privileges` shows no grant to either
- [ ] `acme_litellm_keys` is intact (its row count is unchanged)
- [ ] the console's `RAYIN_TELEMETRY_READER_DATABASE_URL` and `RAYIN_TELEMETRY_WRITER_DATABASE_URL` Secret entries are removed, or left unused (they are read only by the route this change adds)
- [ ] `POST /api/eyeon/telemetry/v1/traces` answers 404 from outside
- [ ] the console starts on the previous image, and the smoke test passes
- [ ] LLM calls through the gateway are unaffected (the ingest is not on that path)

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`

**What this is, and is not.** The migration was applied by a script to a scratch Postgres container whose roles model the Azure Flexible Server shape: a non-superuser admin (`NOSUPERUSER CREATEDB CREATEROLE`) that owns database `langfuse`, with the `rayin_*` roles already present. The migration ran as that admin, not as a superuser. It is a rehearsal of **this migration only**. It is not the full-chain `prisma migrate deploy` over every migration, which the repository's `rehearsal-db.sh` does on a pod in the dev cluster; that run has **not** been done.

**Environment:** a throwaway container, Postgres 15.19, no published port, no volume kept, removed by the script. The real `acme_litellm_keys` DDL (migration 20260919120000) was created first, with one synthetic row, because this migration grants on it. No other data than the synthetic rows listed below. **Started 2026-10-13 21:31:36 UTC, finished 21:31:50 UTC.**

| Step | Result |
|---|---|
| Up (`migration.sql`, as the non-superuser admin) | PASS |
| Three tables exist; the writer and reader roles exist, are not superusers and cannot create roles | PASS |
| The reader holds exactly 9 column grants on the key table and no other privilege outside the policy table | PASS (2 of 2) |
| Down (`down.sql`) applies; tables, functions and both roles gone; the migration row removed; the pre-existing roles untouched; the key table and its row intact; no grant to the reader left | PASS (9 of 9) |
| Up again: the reader is back with its 9 grants; a second run gives each project a fresh salt (verified) | PASS (4 of 4) |

**Extra checks** (between the first up and the down, 24 in all, as the admin and with `SET ROLE`; 44 checks in the whole run):

| Check | Result |
|---|---|
| A bare insert gives `enabled = false`, `metadata`, `hash`, version 1 and a 64-hex-character salt | PASS |
| An update moves the version to 2, and the project id and the salt cannot be changed through it | PASS |
| Insert, update and delete of a policy row each appear in the history; the history has no salt column | PASS |
| `content_mode` and `user_id_mode` outside their sets, `retention_days = 0` and more than 32 extras are refused by CHECK constraints, and a refused update leaves the version alone | PASS (5 of 5) |
| `UPDATE`, `DELETE` and `TRUNCATE` on the history are refused by the append-only triggers; a policy delete is recorded in it | PASS (4 of 4) |
| The counters upsert, taken from the application source, adds across two executions for one bucket and keeps the later `last_received_at` | PASS |
| `rayin_telemetry_writer`: can upsert counters; cannot read policy, history or the migrations ledger, and cannot delete counters | PASS (5 of 5) |
| `rayin_app_runtime`: can read policy; cannot write policy or delete counters | PASS (3 of 3) |

**The reader and the two runtime lookups** (a separate run, 19 checks, same container shape; the exact SQL of the two lookups was executed as `PREPARE`/`EXECUTE`, so values are bound parameters):

| Check | Result |
|---|---|
| Key lookup returns the key row; an unknown hash returns no row; an injection-shaped value is matched as data and returns no row | PASS (3 of 3) |
| Policy lookup returns the policy row, including the salt | PASS |
| As `rayin_telemetry_reader`: refused `max_budget`, `models`, `litellm_key_alias`, `created_by_user_id` and `SELECT *` on the key table | PASS (5 of 5) |
| As `rayin_telemetry_reader`: refused UPDATE, DELETE and INSERT on the key table, UPDATE and INSERT on the policy table, and any read of the policy history, the counters, the migrations ledger and `pg_authid` | PASS (9 of 9) |
| The reader can log in, is not a superuser, and has no `CREATEROLE` or `CREATEDB` | PASS |

**Known limit, tied to Readiness Ledger P0-5:** in dev the application connects as the admin login, so the grants to `rayin_app_runtime` do not constrain it yet. The append-only and version triggers do: they hold for every login except a superuser who disables them.

**Known limit, retention (RET-6):** the counters table has an index on `bucket_start` for a purge by age, but no scheduled purge is part of this change. The rows hold no content.

# Rollback plan — 20261007040000_acme_request_log_trace_id

| | |
|---|---|
| **Change ID** | CHG-2026-126 |
| **ADR** | [ADR-0023](../../adr/ADR-0023-applications-page.md) §3.6 (phase 3: one trace per request) |
| **Forward migration** | `packages/shared/prisma/migrations/20261007040000_acme_request_log_trace_id/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Tested 2026-10-07** on a throwaway local database (portable Postgres 16.4, Azure-like roles, no real data): up, constraint and index checks, down, status, up again, all PASS. Not yet run in dev. |
| **Data lost on rollback** | **Steps 1 to 3:** none. **Step 4 (`down.sql`):** the recorded trace ids only. Every request log row stays, with its other columns unchanged. |

## When to roll back
- **The gateway hook misbehaves:** step 1 only (the console keeps working; new rows simply get no trace id).
- **A defect in the console release:** steps 2 and 3.
- **The column itself must go:** step 4.

## Order of operations
1. **Gateway:** restore the previous `cairo_trace_metadata_hook.py` (the gateway configuration as before this change) and restart the gateway. Requests keep flowing; the request log stops carrying `eyeon_trace_id`.
2. **Unset `CAIRO_GATEWAY_TRACES_PROJECT_ID`** on the console if it was set (the trace links disappear; the ids still show).
3. **Redeploy the previous console tag** with `scripts/release/release.sh --redeploy <previous tag>`. The previous image does not read the column, so it can stay.
4. **Only if the column must go:** run `down.sql` as the table owner or admin login. No export is needed unless the trace ids themselves are wanted:
   ```
   \copy (SELECT id, otel_trace_id FROM acme_litellm_request_logs WHERE otel_trace_id IS NOT NULL) TO 'acme_request_log_trace_ids.csv' CSV HEADER
   ```

## down.sql requirements
- Drops the index, the CHECK constraint and the column, and removes the migration's row from `_prisma_migrations`, in one transaction.
- Touches no other column, no row and no upstream table.

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not yet applied
- [ ] `acme_litellm_request_logs` has no `otel_trace_id` column, and its row count is unchanged
- [ ] the console starts on the previous image, and the Applications detail screen loads

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`

**Environment:** a throwaway local Postgres 16.4 (portable binaries) on 127.0.0.1, initialised with `scripts/ci/postgres-azure-like-init.sql` so the roles match Azure's. No real data. Data directory in the session's scratch space, removed afterwards. Nothing on the dev cluster was touched.

| Step | Command | Result / schema check | Timestamp (UTC) |
|---|---|---|---|
| Set-up | `initdb`; `pg_ctl start`; `psql -f scripts/ci/postgres-azure-like-init.sql` | PASS | 2026-10-07 05:23:38 – 05:25:01 |
| Up | `prisma migrate deploy` on an empty database (all migrations) | PASS: applied; migration row present; column `text`, nullable; CHECK and index present | 2026-10-07 05:25:02 – 05:26:05 |
| Backfill | none | — | — |
| Checks | psql as the admin login | PASS (4 of 4): a valid id stored; NULL stored; an uppercase id refused; a short id refused. A lookup by trace id uses `acme_litellm_request_logs_otel_trace_id_idx` | 2026-10-07 05:26:15 |
| Down | `prisma db execute --file …/down.sql` | PASS: column gone, migration row removed, rows unchanged (2) | 2026-10-07 05:26:39 |
| Status after down | `prisma migrate status` | PASS: lists the migration as not yet applied | 2026-10-07 05:26:52 |
| Up again | `prisma migrate deploy` | PASS: applied; "Database schema is up to date"; column and CHECK back; rows unchanged (2) | 2026-10-07 05:27:05 |
| Teardown | `pg_ctl stop`; data directory deleted | PASS | 2026-10-07 05:28:01 |

# Rollback plan — 20261006230000_acme_application_detail_indexes

| | |
|---|---|
| **Change ID** | CHG-2026-125 |
| **ADR** | ADR-0023 §3.5 (the Applications page, phase 2: the detail screen) |
| **Forward migration** | `packages/shared/prisma/migrations/20261006230000_acme_application_detail_indexes/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Tested 2026-10-06** on a throwaway local database (portable Postgres 16.4, Azure-like roles, no real data): up, the detail query against seeded rows, index use at volume, down, status and up again, all PASS. Not yet run in dev. |
| **Data lost on rollback** | **None.** The migration adds two indexes and nothing else; an index holds no data of its own. |

## What the migration does
Two indexes on ACME tables, for the application detail screen's new filters:
- `acme_litellm_request_logs (project_id, key_alias, start_time)`: one application's requests in a period, by the key aliases of all its generations. Also serves the Applications scorecard's existing per-alias counts.
- `acme_litellm_events (resource_id)`: one key's change record, every generation.

**Plain `CREATE INDEX IF NOT EXISTS`, not `CONCURRENTLY`.** Prisma sends a migration's statements together, which Postgres runs as one transaction block, where `CONCURRENTLY` is refused. A plain build blocks writes to the table while it runs: well under a second at today's dev table sizes, so acceptable there. On a large table (a customer's production request log), build the index by hand first with `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` (the same name and columns as in the migration); the migration then finds it and does nothing for it. That path is rehearsed below.

## When to roll back
- **The detail screen misbehaves:** step 1 only. The indexes are harmless to the previous image and can stay.
- **An index causes a measurable write slowdown** on the request log or the change record: steps 1 and 2, then step 3.
- **The migration failed part-way:** it has no data step, so run `down.sql` (it uses `IF EXISTS`) and apply again.

The owner decides; no customer data is at stake either way.

## Order of operations
1. **Redeploy the previous image tag** with `scripts/release/release.sh --redeploy <previous tag>`. The previous image does not need the indexes and is unaffected by them.
2. **Only if the indexes must also go:** no export is needed; there is no data to keep.
3. Run `down.sql` as the table owner or admin login:
   `npx prisma db execute --file acme-governance/rollback/20261006230000_acme_application_detail_indexes/down.sql --schema packages/shared/prisma/schema.prisma`
4. Verify (below).

> Code first, schema second. The new image also works without the indexes, only more slowly on large tables, so either order is safe.

## down.sql requirements
- One transaction.
- Drops only the two indexes this migration created (`DROP INDEX IF EXISTS`), in reverse order, and removes the migration's row from `_prisma_migrations`.
- Touches no table, column, row or upstream object.

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not yet applied
- [ ] `SELECT indexname FROM pg_indexes WHERE indexname IN ('acme_litellm_request_logs_project_id_key_alias_start_time_idx', 'acme_litellm_events_resource_id_idx')` returns no rows
- [ ] Row counts of `acme_litellm_request_logs` and `acme_litellm_events` are unchanged, and their other indexes are still there
- [ ] The application starts on the previous image

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`

**Environment:** a throwaway local Postgres 16.4 (portable binaries only) on 127.0.0.1, port 55481, initialised with `scripts/ci/postgres-azure-like-init.sql` so the roles match Azure's (admin login without superuser, `rayin_migrator`, `rayin_app_runtime`). No real data. Data directory in the session's scratch space, removed after the run. Nothing on the dev cluster or any live database was touched.

| Step | Command | Result / schema check | Timestamp (UTC) |
|---|---|---|---|
| Set-up | `initdb -U pgboot -A trust`; `pg_ctl start`; `psql -f scripts/ci/postgres-azure-like-init.sql` | PASS: server up, roles and `langfuse` database created | 2026-10-06 22:35:40 – 22:36:28 |
| Up | `prisma migrate deploy` on an empty database (all 452 migrations) | PASS: "All migrations have been successfully applied"; the migration's row is present | 2026-10-06 22:36:38 – 22:37:21 |
| Index check | `pg_indexes` as the admin login | PASS: both indexes exist with the expected columns | 2026-10-06 22:38:08 |
| Backfill | none | — | — |
| Detail query on seeded rows | the `acmeApplications.detail` query itself, through Prisma, as Owner and as Auditor; 2 generations (one rotated), 60 requests across both aliases plus one in another project, 5 guardrail decisions (one in another project), 3 change rows with a token hash in before and after | PASS: 60 calls counted; the latest 50 requests listed; decisions joined by the gateway call id (prompt block on the newest; prompt allow and answer redact on the next), another project's request and decision excluded; change record newest first with only the changed setting; no token hash and no redacted text in the output; Auditor: no cost and no daily spend; the exact multi-alias guardrail filter matches the application's 4 decisions | 2026-10-06 22:46:40 – 22:46:50 |
| Index use at volume | 50,000 more requests and 5,000 more change rows in the project, `ANALYZE`, `EXPLAIN` of the detail's request list, its per-alias counts and its change record | PASS: the request list and the counts use `acme_litellm_request_logs_project_id_key_alias_start_time_idx`; the change record uses `acme_litellm_events_resource_id_idx`. (On the 61 seeded rows alone the planner chose the existing `(project_id, start_time)` index, as expected at that size.) | 2026-10-06 22:47:03 – 22:47:06 |
| Down | `prisma db execute --file …/down.sql` | PASS: both indexes gone, migration row removed; row counts unchanged (50,061 requests, 5,003 change rows, 5 decisions, 2 keys); the tables' 9 other indexes intact | 2026-10-06 22:47:14 – 22:47:20 |
| Status after down | `prisma migrate status` | PASS: lists `20261006230000_acme_application_detail_indexes` as not yet applied | 2026-10-06 22:47:24 |
| Up again | `prisma migrate deploy` | PASS: applied; both indexes back; "Database schema is up to date!" | 2026-10-06 22:47:31 – 22:47:36 |
| Large-table path | `down.sql`, then `CREATE INDEX CONCURRENTLY IF NOT EXISTS` for the request-log index by hand, then `prisma migrate deploy` | PASS: the migration applied over the hand-built index without error; both indexes present, none invalid; schema up to date | 2026-10-06 22:47:44 – 22:47:51 |
| Teardown | `pg_ctl stop`; data directory deleted | PASS | 2026-10-06 22:47:56 |

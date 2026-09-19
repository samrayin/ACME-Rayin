# Rollback plan — 20260919120000_add_acme_litellm_management

| | |
|---|---|
| **Change ID** | CHG-2026-005 |
| **ADR** | [ADR-0003](../../adr/ADR-0003-cairo-litellm-control-plane.md) |
| **Forward migration** | `packages/shared/prisma/migrations/20260919120000_add_acme_litellm_management/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Tested 2026-09-19** on a throwaway database (up → down → up, all PASS). Not yet run in dev. |
| **Data lost on rollback** | Steps 1 and 2: none. Step 3 (`down.sql`): everything in the four new tables, including `acme_litellm_events`, the append-only record of gateway management actions. Export first (below). The virtual keys live in LiteLLM and keep working; after `down.sql` CAIRO no longer knows which project issued them. |

## When to roll back
- The management screens or API misbehave: step 1 only.
- A defect in the released image: steps 1 and 2.
- The schema itself must go (for example the feature is being withdrawn): step 3.
  The owner decides step 3. It destroys an audit record, so it is never routine.

## Order of operations
1. **Flag off.** Set `CAIRO_LITELLM_MANAGEMENT_ENABLED=false` (or unset it) on web
   and restart web. The router refuses every call, the navigation entry
   disappears and CAIRO stops calling LiteLLM. Nothing is deleted. Keys already
   issued keep working in LiteLLM and can still be revoked there by an
   administrator holding the master key.
2. **Redeploy the previous image tag** with `scripts/release/release.sh`. The
   previous image runs against the new schema: the change is additive and the
   previous image does not read the new tables.
3. **Only if the schema must also revert:**
   1. If CHG-2026-008's migration is applied, roll that back first. `down.sql`
      refuses to run otherwise.
   2. Export the record, as the admin login:
      ```
      \copy (SELECT * FROM acme_litellm_events ORDER BY event_time) TO 'acme_litellm_events.csv' CSV HEADER
      \copy (SELECT * FROM acme_litellm_keys) TO 'acme_litellm_keys.csv' CSV HEADER
      \copy (SELECT * FROM acme_litellm_teams) TO 'acme_litellm_teams.csv' CSV HEADER
      ```
      Store the files with the deployment record in `acme-rayin-ops`.
   3. Run `down.sql` as the table owner or admin login (command is in its header).
4. Verify (below).

> Code first, schema second.

## What `down.sql` does
One transaction. Refuses to run while CHG-2026-008's tables exist. Revokes the
grants and drops the two roles this migration created
(`rayin_litellm_writer`, `rayin_litellm_retention_purger`), drops the four
tables and four enums, and deletes the migration's row from
`_prisma_migrations` so `prisma migrate deploy` stays consistent.

It does not touch LiteLLM. Keys and teams CAIRO created there remain, carrying
their `cairo_*` metadata.

## Verification after rollback
- [ ] `npx prisma migrate status` reports the migration as not applied, no drift
- [ ] Application starts on the previous image; smoke test passes
- [ ] `SELECT to_regclass('public.acme_litellm_events')` returns NULL, and the same for the other three tables
- [ ] `SELECT rolname FROM pg_roles WHERE rolname LIKE 'rayin_litellm_%'` returns no rows

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`

Environment: throwaway Postgres 15.19 pod in scratch namespace `cairo-rehearsal-chg003` on the dev cluster, no real data, random credential. **Created 2026-09-19 13:42 UTC, deleted 14:06:01 UTC** (`kubectl get ns` afterwards: none). Reproduce with `acme-governance/scripts/rehearsal-db.sh rehearse 20260919120000_add_acme_litellm_management`.

| Step | Command | Result | UTC |
|---|---|---|---|
| Up | `npx prisma migrate deploy` on an empty database (all 444 migrations) | PASS: "All migrations have been successfully applied" | 13:53:59 – 14:01:33 |
| Schema check | catalogue queries | PASS: 4 tables, 4 enums, 2 roles (no password), migration row present. Grants on `acme_litellm_events`: `rayin_app_runtime`=SELECT, `rayin_litellm_writer`=INSERT, `rayin_litellm_retention_purger`=DELETE,SELECT | 14:02 |
| Role behaviour | `SET ROLE` + statements | PASS: writer INSERT ok; writer `INSERT … RETURNING`, SELECT, UPDATE, DELETE denied; runtime SELECT ok; runtime UPDATE, DELETE, INSERT, TRUNCATE denied (`ERROR: permission denied for table acme_litellm_events`); runtime full DML on `acme_litellm_keys` ok; purger INSERT, UPDATE denied, DELETE ok | 14:02:47 |
| Backfill | not applicable | | |
| Down | `npx prisma db execute --file …/down.sql` as the admin login | PASS: "Script executed successfully"; 0 tables, 0 enums, 0 `rayin_litellm_*` roles, migration row gone; the four pre-existing `rayin_*` roles and `acme_guardrail_events` untouched; `migrate status` lists this migration as not applied | 14:03:07 |
| Up again | `npx prisma migrate deploy` | PASS: applied; 4 tables, 2 roles, same grants; "Database schema is up to date!" | 14:04:02 – 14:04:46 |

**Known failure, tied to finding B9 (kept here until the cutover closes it):** the same `UPDATE acme_litellm_events …` run as the admin login `postgres` **succeeded** (`UPDATE 2`, rolled back). Dev's application connects as that login today, so in dev the append-only grants do not constrain the application. The control is designed, not effective.

**Divergence found, not caused by this change:** on a stock Postgres image the chain fails at the existing migration `20260917090000_add_acme_guardrail_events_push_support`: `REASSIGN OWNED BY postgres` → `ERROR: cannot reassign ownership of objects owned by role postgres because they are required by the database system`, because there `postgres` is the bootstrap superuser. It applies on Azure Flexible Server, where `postgres` is a non-superuser admin. The rehearsal database models Azure (bootstrap superuser `pgboot`, non-superuser `postgres` owning database `langfuse`). Consequence to check separately: a local `pnpm run dx` database (stock image, `postgres` superuser) would hit the same error.

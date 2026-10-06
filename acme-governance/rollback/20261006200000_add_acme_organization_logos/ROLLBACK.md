# Rollback plan — 20261006200000_add_acme_organization_logos

| | |
|---|---|
| **Change ID** | CHG-2026-124 |
| **ADR** | [ADR-0025](../../adr/ADR-0025-customer-logo.md) |
| **Forward migration** | `packages/shared/prisma/migrations/20261006200000_add_acme_organization_logos/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Tested 2026-10-06** on a throwaway local database (portable Postgres 16.4, Azure-like roles, no real data): up, constraint checks, down and up again, all PASS. Not yet run in dev. |
| **Data lost on rollback** | **Steps 1 and 2:** none. **Step 3 (`down.sql`):** every organization's uploaded logo. Customers can upload it again. The audit-log entries for each upload and removal stay in `audit_logs`. |

## When to roll back
- **The card or the sidebar logo misbehaves:** step 1 (remove the logo; the header returns to EYEON alone).
- **A defect in the released image:** steps 1 and 2.
- **The schema must go:** step 3.

## Order of operations
1. **Remove the logo** in UI Customization → Add Logo → Remove (an Owner or Admin of the organization).
2. **Redeploy the previous image tag** with `scripts/release/release.sh --redeploy <previous tag>`. The previous image does not read the table, so the table can stay.
3. **Only if the schema must also revert:** export, then run `down.sql` as the table owner or admin login:
   ```
   \copy (SELECT org_id, content_type, width, height, size_bytes, sha256, updated_by, updated_at, encode(data, 'base64') AS data_base64 FROM acme_organization_logos) TO 'acme_organization_logos.csv' CSV HEADER
   ```
4. Verify (below).

## down.sql requirements
- Drops only `acme_organization_logos` (its constraints go with it) and removes the migration's row from `_prisma_migrations`.
- One transaction. Touches no upstream table.

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not yet applied
- [ ] `SELECT to_regclass('public.acme_organization_logos')` returns NULL
- [ ] `organizations` is untouched
- [ ] the application starts on the previous image, and the sidebar shows EYEON

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`

**Environment:** a throwaway local Postgres 16.4 (portable binaries) on 127.0.0.1, initialised with `scripts/ci/postgres-azure-like-init.sql` so the roles match Azure's (admin login without superuser, `rayin_migrator`, `rayin_app_runtime`). No real data. Data directory in the session's scratch space, removed after the run. Nothing on the dev cluster was touched.

| Step | Command | Result / schema check | Timestamp (UTC) |
|---|---|---|---|
| Up | `prisma migrate deploy` on an empty database (all 451 migrations) | PASS: migration row present; four constraints (`pkey`, `org_id_fkey`, `content_type_check`, `size_check`); `rayin_app_runtime` holds SELECT, INSERT, UPDATE, DELETE only | 2026-10-06 20:36:07 |
| Backfill | none | — | — |
| Constraint checks | psql as the admin login | PASS (6 of 6): a valid PNG row inserts; `image/svg+xml` refused; 102 401 bytes refused; `size_bytes` not matching the data refused; exactly 102 400 bytes accepted; a logo for an unknown organization refused; deleting the organization deletes its logo | 2026-10-06 20:37 |
| Down | `prisma db execute --file …/down.sql` | PASS: table NULL, migration row removed, `organizations` intact | 2026-10-06 20:37:29 |
| Status after down | `prisma migrate status` | PASS: lists the migration as not yet applied | 2026-10-06 20:37 |
| Up again | `prisma migrate deploy` | PASS: applied; "Database schema is up to date"; four constraints back | 2026-10-06 20:38:00 |

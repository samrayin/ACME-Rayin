# Rollback plan — 20260919180000_add_acme_litellm_request_logs

| | |
|---|---|
| **Change ID** | CHG-2026-008 |
| **ADR** | [ADR-0003](../../adr/ADR-0003-cairo-litellm-control-plane.md) |
| **Forward migration** | `packages/shared/prisma/migrations/20260919180000_add_acme_litellm_request_logs/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Tested 2026-09-19** on a throwaway database (up → down → up, 7 of 7 PASS). Not yet run in dev. |
| **Data lost on rollback** | Steps 1 and 2: none. Step 3 (`down.sql`): the whole request-log mirror and the reconcile history. LiteLLM's own spend logs are untouched, so the mirror can be rebuilt by reconciliation as far back as LiteLLM still holds them. Rows LiteLLM has since purged, and the fields only the push carries, cannot be rebuilt. |

## When to roll back
- The receiver or the screens misbehave: step 1.
- A defect in the released image: steps 1 and 2.
- The schema must go: step 3. The owner decides; it destroys an audit record.

## Order of operations
1. **Flag off.** `CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED=false` on web and worker. The receiver answers 404 and the reconciliation job does nothing. Nothing is deleted.
   If CHG-2026-009 is live, roll **it** back first (remove the callback from the gateway configuration and restart the LiteLLM pod), so the gateway is not pushing at a closed door. If that is skipped the gateway still serves traffic: it retries, then drops the events.
2. **Redeploy the previous image tag** with `scripts/release/release.sh`. The previous image does not read these tables.
3. **Only if the schema must also revert:** export, then run `down.sql` as the table owner or admin login:
   ```
   \copy (SELECT * FROM acme_litellm_request_logs ORDER BY start_time) TO 'acme_litellm_request_logs.csv' CSV HEADER
   \copy (SELECT * FROM acme_litellm_reconcile_runs ORDER BY finished_at) TO 'acme_litellm_reconcile_runs.csv' CSV HEADER
   ```
   Roll this migration back **before** `20260919120000_add_acme_litellm_management`: that migration's `down.sql` refuses to run while these tables exist.
4. Verify (below).

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not applied, no drift
- [ ] `SELECT to_regclass('public.acme_litellm_request_logs')` and the same for `acme_litellm_reconcile_runs` return NULL
- [ ] roles `rayin_litellm_writer` and `rayin_litellm_retention_purger` still exist; `acme_litellm_events` untouched
- [ ] application starts on the previous image; smoke test passes

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`
Command: `acme-governance/scripts/rehearsal-db.sh rehearse 20260919180000_add_acme_litellm_request_logs`, then `down`.

Environment: throwaway Postgres 15.19 pod modelling Azure, scratch namespace `cairo-rehearsal` on the dev cluster, no real data. **Created 2026-09-19 14:45 UTC, removed 14:54:44 UTC** by the script's `down`.

| Step | Command | Result | Started (UTC) |
|---|---|---|---|
| Up | `prisma migrate deploy` (empty database, all 445 migrations) | PASS | 14:45:47 |
| Up check | migration row present | PASS | 14:53:13 |
| Down | `prisma db execute --file …/down.sql` | PASS | 14:53:13 |
| Down check | migration row removed | PASS | 14:53:32 |
| Status after down | `prisma migrate status` lists it as pending again | PASS | 14:53:33 |
| Up again | `prisma migrate deploy` | PASS | 14:53:52 |
| Status after up again | "Database schema is up to date" | PASS | 14:54:11 |

Not covered by this run: the role-behaviour statements (denied as `rayin_app_runtime`, allowed as the admin login). The grants are the same pattern rehearsed statement by statement for `acme_litellm_events` under CHG-2026-005; they are re-run against dev as mandatory proof 1.

**Known failure, tied to Readiness Ledger P0-5 / ops gap list B9:** in dev the application connects as the admin login, which owns these tables, so these grants do not constrain it. The control is designed, not effective.

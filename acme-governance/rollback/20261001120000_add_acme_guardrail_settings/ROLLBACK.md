# Rollback plan — 20261001120000_add_acme_guardrail_settings

| | |
|---|---|
| **Change ID** | CHG-2026-089 (part a) |
| **ADR** | [ADR-0005-B](../../adr/ADR-0005-B-console-enforcement-switch.md) |
| **Forward migration** | `packages/shared/prisma/migrations/20261001120000_add_acme_guardrail_settings/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Not yet rehearsed.** The rehearsal (`acme-governance/scripts/rehearsal-db.sh`) creates a throwaway Postgres pod in a scratch namespace on the dev cluster, and runs only with the owner's go. Record the result below before this migration is released. |
| **Data lost on rollback** | **Steps 1 and 2:** none. **Step 3 (`down.sql`):** the guardrail settings history (every version, with who, when and why), the pod-status table, and the settings version and pod recorded on guardrail events since. The audit-log entry for each change stays in `audit_logs`. |

## When to roll back
- **The console card or the save misbehaves:** step 1.
- **A defect in the released image:** steps 1 and 2.
- **The schema must go:** step 3. The owner decides, because it destroys an audit record.

## Order of operations
1. **Stop new versions.**
   - Unset `CAIRO_GUARDRAIL_ADMINS`, so nobody can save.
   - Unset `CAIRO_GUARDRAILS_SYNC_PROJECT_ID`, so pulls are refused.
   - Pods that already pulled keep their last settings. A rayin-guardrails pod started afterwards uses its built-in defaults.
2. **Redeploy the previous image tag** with `scripts/release/release.sh`. The previous image does not read these tables. If the rayin-guardrails half is live, roll it back first, so its pods stop pulling from a route that no longer exists. Unanswered pulls are harmless: pods keep their last settings.
3. **Only if the schema must also revert:** export, then run `down.sql` as the table owner or admin login:
   ```
   \copy (SELECT * FROM acme_guardrail_settings ORDER BY version) TO 'acme_guardrail_settings.csv' CSV HEADER
   \copy (SELECT * FROM acme_guardrail_settings_pods ORDER BY pod) TO 'acme_guardrail_settings_pods.csv' CSV HEADER
   \copy (SELECT id, settings_version, pod FROM acme_guardrail_events WHERE settings_version IS NOT NULL OR pod IS NOT NULL) TO 'acme_guardrail_events_settings.csv' CSV HEADER
   ```
4. Verify (below).

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not applied, with no drift
- [ ] `SELECT to_regclass('public.acme_guardrail_settings')` and the same for `acme_guardrail_settings_pods` return NULL
- [ ] `acme_guardrail_events` has no `settings_version` or `pod` column, and its row count is unchanged
- [ ] the function `acme_guardrail_settings_append_only` no longer exists
- [ ] the application starts on the previous image, and the smoke test passes

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal to be performed.`
Command: `acme-governance/scripts/rehearsal-db.sh rehearse 20261001120000_add_acme_guardrail_settings`, then `down`.

| Step | Command | Result | Started (UTC) |
|---|---|---|---|
| Up | `prisma migrate deploy` (empty database, all migrations) | not yet run | |
| Up check | migration row present; seeded version 1 present; UPDATE and DELETE on the settings table refused by the trigger | not yet run | |
| Down | `prisma db execute --file …/down.sql` | not yet run | |
| Down check | migration row removed; tables and columns gone | not yet run | |
| Up again | `prisma migrate deploy` | not yet run | |

**Known limit, tied to Readiness Ledger P0-5:** in dev the application connects as the admin login, so the grants to `rayin_app_runtime` do not constrain it yet. The append-only triggers do: they hold for every login except a superuser who disables them.

# Rollback plan — 20261002120000_acme_guardrail_enforcement_switch

| | |
|---|---|
| **Change ID** | CHG-2026-089 (part b) |
| **ADR** | [ADR-0005-B](../../adr/ADR-0005-B-console-enforcement-switch.md) |
| **Forward migration** | `packages/shared/prisma/migrations/20261002120000_acme_guardrail_enforcement_switch/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Tested 2026-10-02** on a throwaway database (owner: "go rehearsal"): up, down and up again, 7 of 7 steps PASS, plus 9 extra checks PASS, including `down.sql` refusing once an enforce version exists. After review finding SF-2026-025, `down.sql` was made one transaction and re-tested locally (5 of 5 cases PASS, below). Not yet run in dev. |
| **Reversible** | **Only while no enforce or automatic version is stored.** The settings table is append-only, so such a version cannot be deleted, and the "record only" constraint cannot come back while it exists. `down.sql` checks this first and stops without changing anything. After that point, roll back the code and forward-fix the schema. |
| **Data lost on rollback** | **Steps 1 and 2:** none. **Step 3 (`down.sql`):** the gateway pod, mode and settings version recorded on guardrail events since the release; the `revert_at` and `automatic` columns, which are empty while `down.sql` is allowed to run. |

## When to roll back
- **The Enforcement card or the switch misbehaves:** step 1.
- **A defect in the released image:** steps 1 and 2.
- **The schema must go, and no enforce version was ever stored:** step 3. The owner decides.

## Order of operations
1. **Stop mode changes.**
   - Set `CAIRO_GUARDRAIL_MODE_MAX=record` on the console and on the gateway (the default). The console then offers no enforce, and the gateway keeps to record whatever is stored.
   - If enforce is in force, switch back to record in the console first; this writes a record version that every pod pulls within 30 seconds.
2. **Redeploy the previous image tag** with `scripts/release/release.sh`. The previous image reads the settings table without the new columns, and it reads **every** stored version as `record`, whatever its stored mode. If an enforce version were still the newest, the previous image would serve it to the pods as record, and the pods would switch to record with no audit row. So step 1 must leave a record version newest: then what is stored and what is served agree.
3. **Only if the schema must also revert, and no enforce or automatic version exists:** export, then run `down.sql` as the table owner or admin login, with `psql -v ON_ERROR_STOP=1 -f down.sql` or `prisma db execute --file down.sql`. The script is one transaction: if its first check refuses, nothing changes under either runner. The export:
   ```
   \copy (SELECT id, gateway_pod, gateway_mode, gateway_settings_version FROM acme_guardrail_events WHERE gateway_pod IS NOT NULL) TO 'acme_guardrail_events_gateway.csv' CSV HEADER
   ```
4. Verify (below).

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not applied, with no drift
- [ ] `acme_guardrail_settings` has no `revert_at` or `automatic` column, and its mode constraint allows `record` only
- [ ] `acme_guardrail_events` has no `gateway_pod`, `gateway_mode` or `gateway_settings_version` column, and its row count is unchanged
- [ ] the append-only triggers on `acme_guardrail_settings` are still in place (part a)
- [ ] the application starts on the previous image, and the smoke test passes

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`
Command: `REHEARSAL_PORT=55451 acme-governance/scripts/rehearsal-db.sh rehearse 20261002120000_acme_guardrail_enforcement_switch`, then `down`.

**Environment:** a throwaway Postgres 15.19 pod modelling Azure, in the scratch namespace `cairo-rehearsal` on the dev cluster, with no real data. **Created 2026-10-02 09:58:52 UTC, removed 10:14:59 UTC** by the script's `down` (the namespace was then confirmed gone).

| Step | Command | Result | Started (UTC) |
|---|---|---|---|
| Up | `prisma migrate deploy` (empty database, all migrations) | PASS | 2026-10-02T09:58:59Z |
| Up check | migration row present | PASS | 2026-10-02T10:07:08Z |
| Down | `prisma db execute --file …/down.sql` | PASS | 2026-10-02T10:07:09Z |
| Down check | migration row removed | PASS | 2026-10-02T10:08:58Z |
| Status after down | `prisma migrate status` lists it as pending again | PASS | 2026-10-02T10:08:59Z |
| Up again | `prisma migrate deploy` | PASS | 2026-10-02T10:11:24Z |
| Status after up again | "Database schema is up to date" | PASS | 2026-10-02T10:12:48Z |

**Extra checks** (on the same database after "Up again", as the admin login with `SET ROLE postgres`; the runtime-role check without it):

| Check | Result |
|---|---|
| Constraints as designed: `acme_guardrail_settings_mode_check` allows `record` and `enforce`; `acme_guardrail_settings_revert_check` allows `revert_at` only on `enforce`; `acme_guardrail_events_gateway_mode_check` allows `record`, `enforce` or empty | PASS |
| Version 1 seed unchanged: mode `record`, `revert_at` empty, `automatic` false, 7 personal-data types | PASS |
| An `enforce` version with a `revert_at`, and an `automatic` record version, can be inserted (in a rolled-back transaction) | PASS |
| `revert_at` on a `record` version refused by `acme_guardrail_settings_revert_check` | PASS |
| `mode = 'block'` refused by `acme_guardrail_settings_mode_check` | PASS |
| `gateway_mode = 'block'` on an event refused by `acme_guardrail_events_gateway_mode_check` | PASS |
| `UPDATE`, `DELETE` and `TRUNCATE` on `acme_guardrail_settings` still refused by the append-only trigger | PASS (3 of 3 refused) |
| `rayin_app_runtime` reaches the new columns through its existing table grants: settings `revert_at` SELECT and `automatic` INSERT yes, `revert_at` UPDATE no; events `gateway_pod` INSERT and `gateway_mode` SELECT yes | PASS |
| **Down guard:** with an enforce version committed, `down.sql` (run with `ON_ERROR_STOP=1`) stopped at its first check with "An enforce or automatic guardrail settings version exists; the table is append-only, so this migration cannot be rolled back. Forward-fix instead." (psql exit 3). Afterwards the new columns, the migration row, both versions and the widened mode constraint were all still in place | PASS |

The first attempt at the down-guard check did not run: a quoting fault in how the check was written aborted its transaction before any statement ran. The state was confirmed unchanged, and the check was re-run from a file; the result above is that re-run.

**Re-test after SF-2026-025 (2026-10-02, local).** The cluster rehearsal above ran `down.sql` before it was one transaction. The review found that plain `psql` (without `ON_ERROR_STOP`) carries on past the refused first check. `down.sql` now runs inside `BEGIN` … `COMMIT`.

The wrapped script was re-tested on a throwaway local Postgres 16.4 (portable binaries, scratch data directory, removed afterwards; nothing on the cluster). The test database had the two tables in their part a shape, with the append-only trigger, the forward migration applied and its migration row present:

| Case | Runner | Result |
|---|---|---|
| Enforce version stored | plain `psql -f` | PASS: refused at the first check, every later statement ignored in the aborted transaction, nothing changed. psql still exits 0, so read its output |
| Enforce version stored | `psql -v ON_ERROR_STOP=1 -f` | PASS: refused (exit 3), nothing changed |
| Enforce version stored | `prisma db execute --file` | PASS: refused (exit 1), nothing changed |
| Record versions only | `prisma db execute --file` | PASS: new columns and checks removed, mode check back to `record` only, migration row deleted, rows kept |
| Record versions only | `psql -v ON_ERROR_STOP=1 -f` | PASS: as above |

**Known limit, tied to Readiness Ledger P0-5:** in dev the application connects as the admin login, so the grants to `rayin_app_runtime` do not constrain it yet. The append-only triggers and the check constraints do: they hold for every login except a superuser who disables them.

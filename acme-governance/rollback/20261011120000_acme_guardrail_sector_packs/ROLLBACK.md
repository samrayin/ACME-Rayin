# Rollback plan — 20261011120000_acme_guardrail_sector_packs

| | |
|---|---|
| **Change ID** | CHG-2026-151 |
| **ADR** | [ADR-0031](../../adr/ADR-0031-guardrail-sector-packs.md) phase 1 |
| **Forward migration** | `packages/shared/prisma/migrations/20261011120000_acme_guardrail_sector_packs/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Tested 2026-10-11 and 2026-10-12** on a throwaway local database (portable Postgres 16.4, Azure-like roles, no real data): every migration up to this one with Prisma, seeded versions, this migration tried as `rayin_migrator` and applied as the admin login, twelve checks, the down guard under three runners, down, status and up again, all as expected (log below). Not yet run in dev. |
| **Reversible** | **Yes, while the version in force enables all six packs.** `down.sql` checks this first and stops without changing anything otherwise (see "Why the guard"). |
| **Data lost on rollback** | **Steps 1 to 3:** none. **Step 4 (`down.sql`):** the sector selection stored with each version. Every version row stays, with its other columns unchanged. Each change's before and after, the packs included, stay in the audit log. |

## What the migration does
- **Adds** `acme_guardrail_settings.sectors`, `TEXT[] NOT NULL`, default all six packs in pack order (`banking`, `government`, `healthcare`, `hr`, `retail_telecom`, `education`). Existing versions read the default: exactly what the guardrail applied before.
- **Adds** the CHECK `acme_guardrail_settings_sectors_check`: at least one pack, a flat list, no NULL element, known ids only. EYEON never stores an empty or unknown selection, whoever writes the row.
- **No row changes.** A NOT NULL column with a constant default is a catalogue change on Postgres 11 and later: existing rows are not rewritten. So the append-only triggers (`BEFORE UPDATE OR DELETE`, `BEFORE TRUNCATE`) are not fired, and stay as they were.
- **No new grants.** `rayin_app_runtime` holds `SELECT` and `INSERT` on the whole table, which covers the new column. It still has no `UPDATE` or `DELETE`.

**Who can run it.** `ALTER TABLE` needs the table's owner. The table was created by `20261001120000`, run as the admin login that applies migrations today (`web/entrypoint.sh`, `DIRECT_URL`), so that login owns it. `rayin_migrator` (created, not yet used) does not own it and is refused ("must be owner"), as it would be for every ACME table created after `20260917090000`. See "Known limit" below.

## Why the guard
rayin-guardrails (v0.7.0 and later) reads a settings version without `sectors` as all six packs. If the column were dropped while the version in force narrows the packs, the previous console image would serve versions without `sectors`, and the pods would widen the answer scope to all six with no audited version behind it. `down.sql` therefore refuses unless the newest version enables all six. Save such a version in the console first (step 1): it is audited, and then what is stored and what is served agree.

The packs set only the answer scope. Every pack's conduct rules and the universal rules (personal data, fraud, general harm, jailbreak and prompt injection) apply whatever is enabled, before and after a rollback.

## When to roll back
- **The Policies card's packs section or the Enforcement page misbehaves:** steps 1 and 2 (the column can stay).
- **A defect in the console release:** steps 1 and 2.
- **The column itself must go:** steps 1 to 4. The owner decides.
- **The guardrails service must go back to v0.6.1:** step 1 first. v0.6.1 has no packs and ignores `sectors`, so it is safe only while the selection in force is all six (rayin-guardrails #34).

## Order of operations
1. **Enable all six packs.** If the version in force narrows them, a guardrail administrator saves a version with all six on the Guardrails page (Policies card, with a reason). It is audited, and every pod pulls it within 30 seconds.
2. **Redeploy the previous console tag** with `scripts/release/release.sh --redeploy <previous tag>`. The previous image does not read the column; new versions it writes take the default, all six. The pods receive no `sectors` and apply all six, which matches step 1.
3. **Only if the guardrails service must also go back:** redeploy rayin-guardrails v0.6.1 (its own procedure). Console first, then the service, the reverse of the release order.
4. **Only if the column must go:** run `down.sql` as the table owner or admin login:
   `npx prisma db execute --file acme-governance/rollback/20261011120000_acme_guardrail_sector_packs/down.sql --schema packages/shared/prisma/schema.prisma`
   No export is needed unless the earlier selections are wanted outside the audit log:
   ```
   \copy (SELECT version, sectors FROM acme_guardrail_settings ORDER BY version) TO 'acme_guardrail_settings_sectors.csv' CSV HEADER
   ```
5. Verify (below).

## down.sql requirements
- One transaction. Its first check refuses, changing nothing, unless the newest version enables all six packs; skipped if the column is already gone.
- Drops the CHECK and the column, and removes the migration's row from `_prisma_migrations`.
- Touches no other column, no row, no trigger and no upstream table. The append-only triggers block `UPDATE`, `DELETE` and `TRUNCATE`, not `ALTER TABLE`.

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not yet applied
- [ ] `acme_guardrail_settings` has no `sectors` column and no `acme_guardrail_settings_sectors_check`; its row count is unchanged
- [ ] the append-only triggers `acme_guardrail_settings_no_update_delete` and `acme_guardrail_settings_no_truncate` are still in place
- [ ] the console starts on the previous image, the Guardrails page loads, and every guardrail pod reports the newest version

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`

**Environment:** a throwaway local Postgres 16.4 (portable binaries) on 127.0.0.1, initialised with `scripts/ci/postgres-azure-like-init.sql`, so the admin login `postgres` is not a superuser and the roles match Azure's. No real data. Data directory in the session's scratch space, removed afterwards. Nothing on the dev cluster or any live database was touched. Prisma CLI 6.19.3. The server ran from 2026-10-11 20:20Z to 2026-10-12 04:20Z; the steps ran in the two windows below.

| Step | Command | Result / schema check | Timestamp (UTC) |
|---|---|---|---|
| Set-up | `initdb -U pgboot -A trust`; `pg_ctl start`; `psql -f scripts/ci/postgres-azure-like-init.sql` | PASS: `postgres` is a login with CREATEROLE, not a superuser | 2026-10-11 20:20:39 |
| Up to the previous migration | `prisma migrate deploy` with a copy of the migrations folder that stops at `20261007040000` (453 migrations) | PASS: "All migrations have been successfully applied" | 2026-10-11 20:23:27 – 20:24:38 |
| Seed | as `rayin_app_runtime`: version 2 (enforce, with a switch-back time) and version 3 (automatic record), beside the seeded version 1 | PASS. The table is owned by `postgres`; the runtime role holds `SELECT` and `INSERT`; `postgres` is a member of `rayin_migrator`, not the reverse | 2026-10-11 20:24:50 |
| As `rayin_migrator` | `psql -1 -v ON_ERROR_STOP=1 -f migration.sql` | Refused as expected: "must be owner of table acme_guardrail_settings"; no column added | 2026-10-11 20:25:08 |
| Up | `prisma migrate deploy` with the branch's schema, as the admin login | PASS: this migration applied; its row is present | 2026-10-11 20:25:22 – 20:25:35 |
| No rewrite | `pg_relation_filenode` before and after; `pg_attribute.atthasmissing` | PASS: filenode unchanged (19104); the default is stored as the missing value; versions 1 to 3 read all six | 2026-10-11 20:25:49 |
| Column | `information_schema.columns` | PASS: `ARRAY`, not nullable, default all six in pack order | 2026-10-11 20:25:49 |
| Triggers | `pg_trigger` | PASS: both append-only triggers present and enabled | 2026-10-11 20:25:49 |
| Checks (12) | as `rayin_app_runtime` and the admin login | PASS (12 of 12): refused: an empty list, an unknown id, a NULL element, a two-dimensional array (all by the sectors CHECK), a NULL column (NOT NULL); accepted: `{banking,hr}`, and an insert without `sectors` stored all six (both rolled back); runtime `UPDATE` refused (permission denied), runtime `SELECT` of the column allowed; admin `UPDATE`, `DELETE` and `TRUNCATE` refused by the append-only trigger | 2026-10-11 20:26:20 |
| Down guard | version 4 committed with `{banking,hr}`, then `down.sql` with `psql -v ON_ERROR_STOP=1 -f`, plain `psql -f`, and `prisma db execute --file` | PASS: all three refused at the first check with the "does not enable all six" message (exit 3, 0 with the remaining statements ignored in the aborted transaction, and 1). Afterwards the column, the CHECK, the migration row and version 4's `{banking,hr}` were all still there | 2026-10-11 20:26:50 – 20:27:38 |
| Status | `prisma migrate status` | PASS: "Database schema is up to date!" | 2026-10-11 20:27:38 |
| Down | version 5 committed with all six, then `prisma db execute --file …/down.sql` | PASS: "Script executed successfully"; column and CHECK gone, migration row removed, 5 versions kept, both triggers still present | 2026-10-12 04:18:31 |
| Status after down | `prisma migrate status` | PASS: lists `20261011120000_acme_guardrail_sector_packs` as not yet applied | 2026-10-12 04:18:52 |
| Up again | `prisma migrate deploy` | PASS: applied; "Database schema is up to date!"; versions 1 to 5 read all six (version 4's narrower selection is the data the rollback loses) | 2026-10-12 04:19:09 – 04:19:39 |
| Teardown | `pg_ctl stop`; data directory deleted | PASS | 2026-10-12 04:20:36 |

The first Prisma run of the down guard did not reach the database: the shell left `DIRECT_URL` empty and Prisma stopped at schema validation (P1012). It was re-run with the variable set; the row above is that re-run.

**Known limit, tied to Readiness Ledger P0-5:** migrations run as the admin login, which owns the ACME tables created after `20260917090000`, this one included. When start-up migrations move to `rayin_migrator` (POSTGRES-COMPLIANCE-FRAMEWORK.md §2), those tables need their ownership handed to that role first, or this and any later `ALTER TABLE` on them is refused, as the rehearsal shows.

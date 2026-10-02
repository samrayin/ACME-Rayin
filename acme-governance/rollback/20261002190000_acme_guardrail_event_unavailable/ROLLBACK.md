# Rollback plan — 20261002190000_acme_guardrail_event_unavailable

| | |
|---|---|
| **Change ID** | CHG-2026-089 (part b, phase 2, console) |
| **ADR** | [ADR-0005-B](../../adr/ADR-0005-B-console-enforcement-switch.md) §3.3.1 |
| **Forward migration** | `packages/shared/prisma/migrations/20261002190000_acme_guardrail_event_unavailable/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Rehearsed locally on 2026-10-02** on a throwaway Postgres 16.4 (portable binaries, scratch data directory, removed afterwards; nothing on the cluster): up, down and up again, 7 of 7 steps PASS, plus the extra checks below. **Rehearsed on the dev cluster's throwaway Postgres 15.19 on 2026-10-02**, with the owner's yes: 7 of 7 steps PASS (log below). |
| **Reversible** | **Only while no event uses the value `unavailable`.** Postgres cannot drop one enum value, so `down.sql` rebuilds the type without it, and that fails once a row uses it. `down.sql` checks first and stops without changing anything. After that point, roll back the code and keep the value. |
| **Data lost on rollback** | None: `down.sql` runs only while no row uses the value. |

## When to roll back
- **A defect in the released image:** steps 1 and 2. The extra enum value is harmless to the previous image as long as no row uses it.
- **The value itself must go, and no event uses it:** step 3. The owner decides.

## Order of operations
1. **Stop the events that use it.** Roll back rayin-guardrails to the release before CHG-2026-089 part b phase 2, if it was released: that build records no `unavailable` events.
2. **Redeploy the previous console image** with `scripts/release/release.sh`.
   - The previous image's history and export map every stored action through a fixed list.
   - **A row with `unavailable` would break those pages** in the previous image. So if any such row exists, do not redeploy the previous image: forward-fix instead.
3. **Only if the value must also go, and no event uses it:** run `down.sql` with `psql -v ON_ERROR_STOP=1 -f down.sql` or `prisma db execute --file down.sql`.
   - **Who runs it:** the role that owns the type and the table (the admin login), because the rebuilt type is owned by whoever runs the script.
   - **What it does:** the script is one transaction. It locks `acme_guardrail_events` first and rewrites the table.
   - **While it runs:**
     - event pushes wait on the lock; past rayin-guardrails' client timeout (3 attempts of 5 s) they give up and stay in its buffer, and a waiting insert may still commit once the lock is released (the unique `event_id` index prevents duplicates);
     - reads of the event history wait too;
     - buffered events are backfilled only when someone next opens the event history or the recent-events view.
4. Verify (below).

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not applied, with no drift
- [ ] `enum_range(NULL::"AcmeGuardrailEventAction")` is `{allow,redact,block}`
- [ ] `acme_guardrail_events` row count is unchanged
- [ ] the application starts on the previous image, and the smoke test passes

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`

**Local rehearsal, 2026-10-02.** Postgres 16.4 from portable binaries; the same shape as the cluster script: a non-superuser admin login `postgres` that owns database `langfuse`, the full migration chain applied with `prisma migrate deploy`. Run with the `down.sql` that locks the table first.

| Step | Command | Result | Started (UTC) |
|---|---|---|---|
| Up | `prisma migrate deploy` (empty database, all migrations) | PASS | 2026-10-02T15:49:23Z |
| Up check | migration row present; enum = allow, redact, block, unavailable | PASS | 2026-10-02T15:49:41Z |
| Down | `prisma db execute --file …/down.sql` | PASS | 2026-10-02T15:49:41Z |
| Down check | migration row removed; enum = allow, redact, block | PASS | 2026-10-02T15:49:44Z |
| Status after down | `prisma migrate status` lists it as pending again | PASS | 2026-10-02T15:49:44Z |
| Up again | `prisma migrate deploy` | PASS | 2026-10-02T15:49:48Z |
| Status after up again | "Database schema is up to date" | PASS | 2026-10-02T15:49:51Z |

**Extra checks** (after "Up again"):

| Check | Result |
|---|---|
| The runtime role `rayin_app_runtime` can insert an event with action `unavailable` (in a rolled-back transaction) | PASS |
| **Down guard, plain `psql -f`** (no `ON_ERROR_STOP`), with an `unavailable` event stored: refused at the first check, every later statement ignored in the aborted transaction; the migration row, the enum value and the event are all still there | PASS |
| **Down guard, `prisma db execute`**, same state: refused, nothing changed | PASS |

**Cluster rehearsal, 2026-10-02 (owner's yes, before the console release).**
- **Command:** `REHEARSAL_PORT=55453 acme-governance/scripts/rehearsal-db.sh rehearse 20261002190000_acme_guardrail_event_unavailable`, then `down`, run from `main` at `d2c78b33c`.
- **Environment:** a throwaway Postgres 15.19 pod modelling Azure, in the scratch namespace `cairo-rehearsal` on the dev cluster, with no real data. Created 23:06:33Z and removed 23:18:24Z UTC.

| Step | Command | Result | Started (UTC) |
|---|---|---|---|
| Up | `prisma migrate deploy` (empty database, all migrations) | PASS | 2026-10-02T23:06:36Z |
| Up check | migration row present | PASS | 2026-10-02T23:15:58Z |
| Down | `prisma db execute --file …/down.sql` | PASS | 2026-10-02T23:15:58Z |
| Down check | migration row removed | PASS | 2026-10-02T23:16:31Z |
| Status after down | `prisma migrate status` lists it as pending again | PASS | 2026-10-02T23:16:31Z |
| Up again | `prisma migrate deploy` | PASS | 2026-10-02T23:17:07Z |
| Status after up again | `prisma migrate status` up to date | PASS | 2026-10-02T23:17:39Z |

**A harness fault, recorded so it is not lost.** The first attempt (22:46–23:04Z) did apply the whole chain: the database held all 450 migrations as finished, and prisma printed "All migrations have been successfully applied."
- **What went wrong:** the script's own pass check, `grep -q … <<<"${out}"`, hung on Git Bash for Windows with that much output. Ending the hung `grep` made the step report FAIL, and the script removed the namespace as designed.
- **The re-run above:** the one check line read the output from a temporary file instead of a here-string. That change was made in the local copy only, and was restored afterwards with `git checkout`. Nothing else in the script, the migration or `down.sql` changed.
- **The permanent fix** to the script is a separate change.

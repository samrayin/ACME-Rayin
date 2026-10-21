# Rollback plan — 20261021030000_acme_guardrail_event_source_gateway

| | |
|---|---|
| **Change ID** | CHG-2026-169 |
| **ADR** | [ADR-0033](../../adr/ADR-0033-guardrail-refusal-audit-from-gateway.md) |
| **Forward migration** | `packages/shared/prisma/migrations/20261021030000_acme_guardrail_event_source_gateway/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Rehearsed 2026-10-21** on a throwaway, network-less Postgres 15 modelling the Azure shape: up, down, up again, the refusal case and an idempotent re-run all behaved as designed. Full log: `rehearsal-2026-10-21.log` beside this file. |
| **Reversible** | **Only while no event uses the value `gateway`.** Postgres cannot drop one enum value, so `down.sql` rebuilds the type without it, and refuses (in one transaction, changing nothing) once a row uses it. |
| **Data lost on rollback** | None: `down.sql` runs only while no row uses the value. |

## When to roll back
- **A defect in the released worker:** set `CAIRO_GUARDRAIL_REFUSAL_AUDIT_ENABLED=false` (step 1). Usually sufficient on its own.
- **A defect in the released images, and no `gateway` row exists:** steps 1–2.
- **The value itself must go, and no event uses it:** step 3. The owner decides.

## Order of operations
1. **Stop new rows:** `CAIRO_GUARDRAIL_REFUSAL_AUDIT_ENABLED=false` on the worker, restart it.
2. **Redeploy the previous console and worker images** with `scripts/release/release.sh` — **only if no row has `source = 'gateway'`**. The previous images' Prisma client does not know the value, so a `gateway` row would make the guardrail pages fail to load. If such rows exist: forward-fix, do not roll back.
3. **Only if the value must also go:** `psql -v ON_ERROR_STOP=1 -f down.sql` (or `prisma db execute --file down.sql`), as the role that owns the type and the table. One transaction; it locks `acme_guardrail_events` first, so pushes wait (rayin-guardrails keeps them in its buffer and the backfill recovers them).
4. Verify (below).

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not applied, with no drift
- [ ] `enum_range(NULL::"AcmeGuardrailEventSource")` is `{push,pull}`
- [ ] `acme_guardrail_events` row count is unchanged

## Rehearsal log
Staging: not available; isolated migration and rollback rehearsal performed.

| Step (2026-10-21, 03:12Z) | Enum after | `_prisma_migrations` row | Events | Result |
|---|---|---|---|---|
| Baseline: schema of the restored EYEON `.58` database (455 migrations, 90 tables), owned by non-superuser `postgres` | `{push,pull}` | 0 | 0 | — |
| Up 1 (`migration.sql` in one transaction, then the migration row) | `{push,pull,gateway}` | 1 | 0 | PASS |
| Down 1 (`down.sql`, no `gateway` rows) | `{push,pull}` | 0 | 0 | PASS, one transaction |
| Up 2 | `{push,pull,gateway}` | 1 | 0 | PASS |
| Refusal case: one synthetic `gateway` row, then `down.sql` | `{push,pull,gateway}` (unchanged) | 1 (unchanged) | 1 | PASS: refused with the forward-fix message, nothing changed |
| Up 3 (idempotent `ADD VALUE IF NOT EXISTS`) | unchanged | 1 | 1 | PASS |

The scratch container `chg169-rehearsal-pg` was used without a network and stopped afterwards; it is kept (not removed) on the
owner's no-automatic-cleanup instruction and is listed for cleanup. Deviation from `rehearsal-db.sh` (owner decision
2026-10-21): the rehearsal runs on a throwaway, network-less Postgres on a local Docker engine using the EYEON appliance's
`eyeon/postgres` image, which models the Azure shape (bootstrap superuser `pgboot`; `postgres` a non-superuser owning `langfuse`),
instead of a namespace on the dev AKS cluster, so that nothing in Azure is touched.

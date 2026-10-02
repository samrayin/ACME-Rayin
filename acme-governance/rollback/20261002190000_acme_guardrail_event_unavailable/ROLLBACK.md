# Rollback plan — 20261002190000_acme_guardrail_event_unavailable

| | |
|---|---|
| **Change ID** | CHG-2026-089 (part b, phase 2, console) |
| **ADR** | [ADR-0005-B](../../adr/ADR-0005-B-console-enforcement-switch.md) §3.3.1 |
| **Forward migration** | `packages/shared/prisma/migrations/20261002190000_acme_guardrail_event_unavailable/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Not yet rehearsed.** Record the result below before this migration is released. |
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
   - **What it does:** the script is one transaction. It locks `acme_guardrail_events` first and rewrites the table, so event pushes are refused until it commits; they wait in rayin-guardrails' buffer and are backfilled.
4. Verify (below).

## Verification after rollback
- [ ] `npx prisma migrate status` lists this migration as not applied, with no drift
- [ ] `enum_range(NULL::"AcmeGuardrailEventAction")` is `{allow,redact,block}`
- [ ] `acme_guardrail_events` row count is unchanged
- [ ] the application starts on the previous image, and the smoke test passes

## Rehearsal log
`Staging: not available; isolated migration and rollback rehearsal performed.`

| Step | Command | Result | Started (UTC) |
|---|---|---|---|
| Up | `prisma migrate deploy` | not yet run | |
| Up check | migration row present | not yet run | |
| Down | `down.sql` | not yet run | |
| Down check | migration row removed | not yet run | |
| Status after down | migration pending again | not yet run | |
| Up again | `prisma migrate deploy` | not yet run | |
| Status after up again | "Database schema is up to date" | not yet run | |

**Extra checks to run:** with an `unavailable` event stored, `down.sql` stops at its first check and changes nothing; an event with action `unavailable` can be inserted by the runtime role; the enum's other values are unchanged.

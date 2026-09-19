# Rollback plan — <migration_name or release tag>

| | |
|---|---|
| **Change ID** | CHG-YYYY-NNN |
| **ADR** | ADR-NNNN |
| **Forward migration** | `packages/shared/prisma/migrations/<timestamp>_<name>/migration.sql` |
| **Rollback script** | `./down.sql` |
| **Test status** | **Tested YYYY-MM-DD** / **UNTESTED — blocks promotion** |
| **Data lost on rollback** | None / describe exactly what, and how to export it first |

## When to roll back
The trigger conditions (e.g. migration fails mid-way, smoke test fails, error rate above X).
Who decides.

## Order of operations
1. Switch off the feature flag (if any) — often sufficient on its own.
2. Redeploy the previous image tag: `acme-v<base>.<N-1>`.
3. Only if the schema must also revert: export affected data, then run `down.sql`.
4. Verify (below).

> Code first, schema second. The previous image must run against the *new* schema
> (expand/contract rule) so that step 3 is rarely needed.

## down.sql requirements
- Single transaction.
- Reverses every statement in the forward migration, in reverse order.
- Ends with:
  `DELETE FROM "_prisma_migrations" WHERE migration_name = '<timestamp>_<name>';`
- Run with: `npx prisma db execute --file <path>/down.sql --schema packages/shared/prisma/schema.prisma`

## Verification after rollback
- [ ] `npx prisma migrate status` reports the migration as not applied, no drift
- [ ] Application starts on the previous image; smoke test passes
- [ ] Objects created by the migration are gone (query)

## Rehearsal log
Environment: fresh throwaway copy of the database.
`Staging: not available; isolated migration and rollback rehearsal performed.`
Evidence location: …

| Step | Command | Result / schema check | Timestamp |
|---|---|---|---|
| Up | | | |
| Backfill | | | |
| Down | | | |
| Up again | | | |

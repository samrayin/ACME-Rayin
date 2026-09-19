# Migration rollback inventory

Inventory only, 2026-09-19. **No rollback scripts are written or tested for the
five shipped migrations below.** Classes: *safely reversible* · *reversible with
data loss* · *forward-fix only* · *backup-and-restore*.

Scope: the ACME-authored Prisma migrations. The other 438 migrations in
`packages/shared/prisma/migrations` are upstream Langfuse's and are reversed by
restoring a backup, not by script. There are no ACME ClickHouse migrations.

| # | Migration | What it does | Class | Why, and what a rollback would cost |
|---|---|---|---|---|
| 1 | `20260915140000_add_acme_guardrail_events` | creates `acme_guardrail_events`, 2 enums, 2 indexes | **Reversible with data loss** | `DROP TABLE` + 2 `DROP TYPE` is mechanically trivial, but the table **is** the guardrail audit trail: every row is lost. Must be exported first. Depends on 3 and 4 being reversed first. |
| 2 | `20260917020000_add_acme_prompt_approvals` | creates `acme_prompt_approvals`, 1 enum, 2 indexes | **Reversible with data loss** | `DROP TABLE` + `DROP TYPE`. Loses the named-approver trail for prompt promotions. Export first. Independent of the others. |
| 3 | `20260917090000_add_acme_guardrail_events_push_support` | creates 4 cluster roles; `GRANT rayin_migrator TO postgres`; **`REASSIGN OWNED BY postgres TO rayin_migrator`** (every object in the database); database, schema and default-privilege grants; 5 new columns and a unique index on `acme_guardrail_events`; `REVOKE UPDATE, DELETE` from `rayin_app_runtime` | **Forward-fix only** | Three parts do not reverse cleanly. (a) Roles are cluster-wide, not per database, and `rayin_guardrails_writer` is in live use by the ingest endpoint: dropping it breaks ingest. (b) `REASSIGN OWNED` moved ownership of ~400 objects; reassigning back is possible but also sweeps up anything `rayin_migrator` has created since. (c) Dropping the columns destroys redacted text, PII findings, encrypted blocked content and user identity on every pushed event. If the column data had to go, that part alone is *reversible with data loss*; the migration as a whole is not. Also fails on a stock Postgres image where `postgres` is the bootstrap superuser (found 2026-09-19); it applies on Azure Flexible Server. |
| 4 | `20260918120000_add_acme_guardrail_events_source_client_host` | adds enum `AcmeGuardrailEventSource`; adds nullable columns `source`, `client_host` | **Reversible with data loss** | `DROP COLUMN` ×2 + `DROP TYPE`. Loses which capture path wrote each row and the client host. The previous image does not read either column. |
| 5 | `20260918200000_add_security_analyst_role` | `ALTER TYPE "Role" ADD VALUE 'SECURITY'` | **Forward-fix only** | Postgres cannot remove an enum value. Reversal means rebuilding the `Role` type and every column that uses it (organisation and project memberships, invitations), which fails while any member holds `SECURITY`. The value is inert if unused, so the practical rollback is: reassign those members, redeploy the previous image, leave the value in place. |

Not yet shipped, for completeness: `20260919120000_add_acme_litellm_management`
(CHG-2026-005) is **reversible with data loss** and has a `down.sql`, rehearsed
up → down → up on 2026-09-19 (see its `ROLLBACK.md`).

## Reading this
- Nothing here is *safely reversible*: every ACME migration either holds audit data or changes something Postgres cannot undo.
- Nothing is classed *backup-and-restore* on its own, but that is the only complete answer for 3, and the fallback for all of them. It depends on a restore that has actually been rehearsed; see the dev restore rehearsal plan.
- Reverse order matters for the guardrail table: 4, then 3's columns, then 1.

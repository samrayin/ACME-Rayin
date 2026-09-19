# CAIRO / RAYIN Change Procedure

**Status:** Active from 2026-09-19 (tiering added 2026-09-19, CHG-2026-007) · **Owner:** Anees Ur Rahman · **Applies to:** every
enhancement and every database change in this fork (Postgres, ClickHouse, infra-as-code).

This is the standing procedure. It extends `CONTRIBUTING-ACME.md` (one change = one
commit = one changelog entry) — it does not replace it.

**Principle:** dev is a prototype; everything that leaves it is production-grade and
leaves a paper trail a client or auditor can read without asking us questions.

---

## 0. Tiers (in force from 2026-09-19)

The procedure is tiered by risk. Decide the tier first; when unsure, it is Tier 1.

| | **Tier 1** | **Tier 2** |
|---|---|---|
| **Applies to** | anything that touches **schema, authentication or authorisation, secrets, guardrails, audit, or anything a client can see** | everything else: documentation, CI, internal tooling, refactors with no behaviour change, dependency bumps with no schema or client-visible effect |
| **Artefacts** | the full set in §1: ADR, versioned migration, rehearsed rollback, changelog entry | **one changelog line** that references the commit. No ADR, no rehearsal |
| **Change ID** | yes | yes (the line carries it) |
| **Commits and PR** | two-commit sequence: the change with approval recorded as *Pending*, then the approval once the owner gives it. One PR | **one commit, one PR.** No pending-then-approved sequence |
| **Rollback** | plan + tested script (§2, §3) | "revert the commit", stated in the changelog line |

**Artefacts are produced during the build, never after it.** For a Tier 1 change
the ADR and the rollback plan are written in the same pass as the migration, and
the rehearsal runs before the code that depends on the schema is built on top of
it. An ADR or rollback plan written as a follow-up step is a procedure failure.

Documentation-only changes are Tier 2, including changes to this procedure.

## 1. Artefacts every Tier 1 change must produce

| # | Artefact | Where it lives | Template |
|---|---|---|---|
| 1 | Design note (ADR) | `acme-governance/adr/ADR-NNNN-<slug>.md` | `templates/ADR-TEMPLATE.md` |
| 2 | Versioned migration (schema changes only) | `packages/shared/prisma/migrations/<timestamp>_<name>/migration.sql` or `packages/shared/clickhouse/migrations/` | — (Prisma / ClickHouse native) |
| 3 | Backfill steps (if existing data must change) | Section in the ADR + script under `acme-governance/rollback/<migration_name>/backfill.sql` | — |
| 4 | Rollback plan + script, **tested** | `acme-governance/rollback/<migration_name>/` (`ROLLBACK.md` + `down.sql`) | `templates/ROLLBACK-PLAN-TEMPLATE.md` |
| 5 | Change log entry | `ACME-CHANGELOG.md`, same commit as the change | `templates/CHANGELOG-ENTRY-TEMPLATE.md` |

A Tier 1 change with no schema impact still needs 1, 4 (rollback = how to revert the
release) and 5. Artefacts 2–3 apply only when the database changes. A Tier 2 change
needs only the changelog line (§0).

**Change ID — standing convention (confirmed by the owner 2026-09-19):** every change
gets a unique ID, `CHG-YYYY-NNN` — four-digit year, three-digit sequence restarting at
`001` each year, never reused, including for abandoned changes. The first is
`CHG-2026-001` (adoption of this procedure). The ID is carried on the ADR, rollback plan
and changelog entry, with a named owner, date, scope and affected release, and is what
cross-references commits, pull requests, ADRs, migrations, tests and evidence.

**IDs and ADR numbers are allocated only through `CHANGE-ID-REGISTER.md`:** claim the
next free number there, on `main`, in a pull request that contains nothing else, before
the number is used anywhere. Two sessions picking "the next number" independently
collided twice on 2026-09-19.

**Size rule:** an ADR is one page. If it needs more, the change is too big — split it.

## 2. Migration rules

1. **Shipped migrations are immutable.** Never edit a migration that has run anywhere
   outside a developer machine. Fix forward with a new migration.
2. **Expand, then contract.** Additive first (new nullable column / new table), deploy
   code that works with both shapes, backfill, and only then remove the old shape in a
   *later* release. No release may require code and schema to change in lock-step.
3. **Every migration has a `down.sql`.** Prisma has no native down migrations, so ours
   live in `acme-governance/rollback/<migration_name>/down.sql`. The script must, in one
   transaction, reverse the schema change **and** remove the migration's row from
   `_prisma_migrations`, so `prisma migrate deploy` stays consistent afterwards.
   ClickHouse migrations use the native `.up.sql` / `.down.sql` pair.
4. **"Tested" means executed.** The rollback is run for real in the rehearsal (§3) —
   up, down, up again — and the output is recorded in `ROLLBACK.md`. An unrun script is
   recorded as *untested* and blocks promotion.
5. **Data-destroying rollbacks say so.** If `down.sql` drops data written after the
   migration, `ROLLBACK.md` states what is lost and how to export it first.
6. **Backfills are idempotent and batched.** Safe to re-run; never one unbounded
   `UPDATE` on a large table.

## 3. Promotion flow and validation gates

```
dev  ──Gate A──►  staging  ──Gate B──►  production  ──Gate C (post-deploy)
```

| Gate | Must be true | Evidence recorded |
|---|---|---|
| **A — leave dev** | ADR written · lint/typecheck/tests pass · migration applies to a clean DB · `down.sql` exists | Command output in ADR "Validation" section |
| **B — leave staging** | Migration + backfill + rollback executed (up → down → up) on a production-like copy · smoke test passes · no Critical/High from independent review | `ROLLBACK.md` rehearsal log · review result |
| **C — after prod deploy** | Pods healthy · migration row present · smoke test passes · release tagged `acme-v<base>.N` | Changelog entry "Deployment status" |

> **OPEN RISK — no staging environment exists (flagged 2026-09-19).**
> Until one is built, Gate B is met by a **rehearsal**: for each database change the
> forward migration, backfill and rollback are run against a fresh throwaway copy of the
> database, recording the commands, timestamps, results, schema checks and evidence
> location. Every applicable change record states, exactly:
> `Staging: not available; isolated migration and rollback rehearsal performed.`
> The rehearsal is one command:
> `acme-governance/scripts/rehearsal-db.sh rehearse <migration_name>`, then `down`.
> It builds a throwaway Postgres 15 that models Azure Flexible Server (a bootstrap
> superuser, plus a **non-superuser** `postgres` admin owning database `langfuse`),
> runs up → down → up and prints the PASS/FAIL table for `ROLLBACK.md`. Do not
> rehearse on a stock image where `postgres` is the superuser: migration
> `20260917090000` fails there at `REASSIGN OWNED BY postgres`, though it applies on
> Azure. Record that the scratch namespace was used and removed.
> This is a compensating control, not an equivalent: it does not exercise AKS, Helm,
> networking, or real data volume. Closure: a representative staging environment is
> provisioned, promotion from development to staging is automated, and the validation
> evidence is retained. Must be closed before the first customer production deployment.
> Tracked in the Readiness Ledger; does not block progress.

## 4. Approval

**Delegated auto-approval applies to development records only.** It needs two
independent, evidence-backed checks:

1. **Build check** — tests pass, and the migration and rollback are successfully rehearsed.
2. **Independent check** — an auditor-style review that did not build the change (the
   Readiness Auditor, area 7 "Change governance" plus any area the change touches)
   reports no unresolved Critical or High findings.

When both pass, approval is recorded with exactly this wording:

> `Auto-approved for development under standing delegation from Anees Ur Rahman, <date>. This is not a human production approval.`

Restrictions:

- Never represent auto-approval as a human review.
- Never use delegated auto-approval to authorise a customer production deployment.
- Never allow the person or agent that implemented a production change to be its only approver.
- Stop and escalate to the owner if either check fails or the evidence is incomplete.

> **OPEN RISK — no named human production approver (flagged 2026-09-19).**
> Delegated auto-approval does not satisfy the separation of duties a customer
> production change requires — the same separation CAIRO's own self-approval guard
> enforces. Closure: a named human production approver and a backup approver are
> assigned, the approval workflow is documented, and separation of duties is enforced.
> Must be closed before the first customer production deployment. Tracked in the
> Readiness Ledger.

## 5. Feature flags and compatibility layers

Recommend one in the ADR whenever any of these is true:

- the change alters behaviour a client can see or an API a client calls;
- the change cannot be rolled back by redeploying the previous image alone;
- the change depends on a backfill completing;
- the change touches authentication, authorisation, audit, or guardrail enforcement.

Default mechanism: an environment-variable flag read through the existing `env.mjs`
pattern, **default off**, removed in a follow-up change once stable (the ADR names the
removal condition). API changes keep the old contract working for at least one tagged
release.

## 6. Keeping the records consistent

There are exactly three records. No fourth.

| Record | Role | Updated when |
|---|---|---|
| `ACME-CHANGELOG.md` | What changed, when, approval, impact, rollback | Same commit as the change |
| Readiness Ledger | Open risks, gaps, readiness status | **Batched: published once per working session**, carrying everything that opened or closed in it. **Published immediately** if a P0 or P1 finding is discovered. Not republished per change |
| Readiness Auditor (`acme-governance/READINESS-AUDITOR-PROMPT.md`) | Independent check; verifies this procedure was followed | Run before every customer-bound release |

ADRs and rollback folders are *evidence referenced by* these records, not a separate
history. The ADR index (`adr/README.md`) is a table of contents only.

## 7. Report format

Four headings, nothing else: **what changed · what was verified · what failed ·
what is unresolved.** The procedure is not restated in a report.

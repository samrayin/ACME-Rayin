# Change log entry template

Paste into `ACME-CHANGELOG.md` (above "Outstanding, not yet done"), in the same commit
as the change. Keeps the four questions from `CONTRIBUTING-ACME.md` and adds the
governance block on top.

---

```markdown
## YYYY-MM-DD — <title> (acme-v<base>.N)

| | |
|---|---|
| **Change ID** | CHG-YYYY-NNN · owner: <name> |
| **ADR** | [ADR-NNNN](acme-governance/adr/ADR-NNNN-<slug>.md) |
| **Approval** | Auto-approved for development under standing delegation from Anees Ur Rahman, <date>. This is not a human production approval. — build check ✔ · independent check ✔ |
| **Dates** | Dev: YYYY-MM-DD · Staging: not available; isolated migration and rollback rehearsal performed. (YYYY-MM-DD) · Prod: YYYY-MM-DD / not yet |
| **Impact** | Who/what is affected, downtime (none / N min), client-visible? |
| **Schema change** | None / migration `<timestamp>_<name>` (+ backfill yes/no) |
| **Rollback** | [plan](acme-governance/rollback/<migration_name>/ROLLBACK.md) — tested YYYY-MM-DD · data lost: none / … |
| **Feature flag** | None / `ACME_<FLAG>` default off |

**What:** files touched.

**Why this approach:** the reasoning; cite source for any licensing-gated claim.

**Deployment status:** source-only / built / deployed (say which).

**Known-incomplete:** anything needing attention before production.
```

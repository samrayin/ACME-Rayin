# ADR-NNNN — <short title>

| | |
|---|---|
| **Change ID** | CHG-YYYY-NNN |
| **Owner** | |
| **Affected release** | `acme-v<base>.N` |
| **Status** | Proposed / Accepted / Superseded by ADR-XXXX |
| **Type** | Forward / **Retrospective** (decision made YYYY-MM-DD, written YYYY-MM-DD) |
| **Date** | YYYY-MM-DD |
| **Author** | |
| **Approval** | `Auto-approved for development under standing delegation from Anees Ur Rahman, <date>. This is not a human production approval.` — or a named human approver — or `Not formally recorded at the time` for retrospective notes |
| **Commits / tag** | `<sha>` · `acme-v<base>.N` |

## 1. Purpose
Why this change exists. The problem, in two or three sentences.

## 2. Scope
**In:** …
**Out:** …

## 3. Decision
What we are doing, and the alternatives we rejected (one line each on why).
Security and compliance considerations, if any.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres schema | e.g. new table `acme_…` |
| ClickHouse | none |
| Web / API | |
| Worker | |
| Infra / Terraform / Helm | |
| Integrations (LiteLLM, NeMo, promptfoo) | |

## 5. Database change
- **Migration:** `packages/shared/prisma/migrations/<timestamp>_<name>/`
- **Backfill:** none / steps (idempotent, batched) — script path
- **Rollback:** `acme-governance/rollback/<migration_name>/` — data lost on rollback: none / …

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|

## 7. Compatibility
- Backward compatible with previous image? yes / no — why
- Upstream Langfuse merge risk (files we touch that upstream also changes)
- Feature flag / compatibility layer: name, default, removal condition — or "not needed because …"

## 8. Client-facing notes
What a customer would notice, need to do, or need to be told. "None" is a valid answer.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | | command + outcome |
| B — staging | `Staging: not available; isolated migration and rollback rehearsal performed.` | see `ROLLBACK.md` |
| C — post-deploy | | |

## 10. Assumptions and open questions

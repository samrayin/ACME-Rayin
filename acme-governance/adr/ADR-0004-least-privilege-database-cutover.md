# ADR-0004 — Least-privilege database cutover: the application stops connecting as the admin login

| | |
|---|---|
| **Change ID** | CHG-2026-010 (Tier 1) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Not yet planned. Queued behind the dev deployment of CHG-2026-005 and CHG-2026-008. |
| **Status** | **Proposed — design only. No implementation has started and none may start until the owner accepts this note.** |
| **Type** | Forward |
| **Date** | 2026-09-19 |
| **Author** | Claude (implementing session), on the owner's instruction |
| **Approval** | Pending. The owner reviews. The implementer is not an approver of its own change. |
| **Commits / tag** | Branch `docs/adr-0004-least-privilege-cutover`; this file only |

## 1. Purpose
Web and worker connect to Postgres as the **admin login**. The least-privilege
role model exists in the schema (`rayin_migrator`, `rayin_app_runtime`,
`rayin_guardrails_writer`, `rayin_retention_purger`, and with CHG-2026-005
`rayin_litellm_writer`, `rayin_litellm_retention_purger`) but the running
application does not use it. Consequences today:

- Every `REVOKE … FROM rayin_app_runtime` is inert. **`acme_guardrail_events`
  is not append-only in practice**, and neither will the three LiteLLM record
  tables be: the application can update and delete audit rows.
- A flaw reachable through the application's connection (injection, a bug in
  any router) has the admin login's reach: DDL, every table, role management.
- CAIRO sells segregation of duties and an append-only audit trail. Its own
  deployment does not have them. A BFSI due-diligence review will test this.

Readiness Ledger **P0-5** (and **P0-6**, the crash-loop this change must not
cause); ops gap list **B9**, TF-22, TF-25, TF-26. The owner made this a
**blocker for production readiness** on 2026-09-19.

## 2. Scope
**In:** web and worker connect as `rayin_app_runtime`; schema migrations run as
`rayin_migrator` from a one-shot Job, never from a long-running pod; a privilege
audit and the grants it shows are missing; a **tested revert to the admin
login**; per-environment evidence that the append-only revokes now bind the
application.

**Out:** Key Vault / CSI integration for these credentials (P0-3); rotating the
admin password; hash-chaining or triggers on audit tables (N-41: append-only
needs more than this cutover); ClickHouse credentials; Terraform automation of
all of the above (gap list TF-22, -25, -26 stay open until the module does it).

## 3. Decision
Two steps, **in this order, as two deployments**, because doing them together is
what produces P0-6:

**Step A — move migrations off the application's connection.**
Start-up migration is switched off in web
(`LANGFUSE_AUTO_POSTGRES_MIGRATION_DISABLED=true`) and migrations run from a
Kubernetes Job that connects as `rayin_migrator`. `rayin_migrator` gets a
password (it has none today). The Job runs before web rolls, and a failed
migration fails the release with the previous web pods still serving.
*Why first:* after Step B the application role has no DDL rights. The web
entrypoint runs `prisma migrate deploy` on every start; with nothing pending it
passes silently, and **the first image carrying a new migration crash-loops**.
Step A removes that fuse before Step B lights it.

**Step B — cut the application over.**
1. **Ownership.** `REASSIGN OWNED BY <admin login> TO rayin_migrator` again.
   The first reassignment ran on 2026-09-17; everything the admin login has
   created since (start-up migrations still run as it: the Security Analyst enum
   value, the LiteLLM tables of CHG-2026-005 and -008) is owned by the admin
   login, and `rayin_migrator` cannot `ALTER` what it does not own.
2. **Privilege audit, then grants.** For every table, sequence and enum in the
   schema: does `rayin_app_runtime` hold what the application needs? The
   default privileges set on 2026-09-17 fire only for objects `rayin_migrator`
   creates, so objects created by the admin login since then may have **no**
   grant at all. (CHG-2026-005 and -008 grant explicitly for exactly this
   reason; earlier migrations did not.) The audit is a catalogue query whose
   output is reviewed, and the missing grants ship as a migration.
3. **Repoint, do not overwrite.** Web and worker get the runtime role's username
   and a reference to the runtime password Secret key. The admin credential is
   **not** edited or replaced in place: the documented procedure that overwrote
   it would have destroyed the only stored copy and with it the rollback
   (ledger P0-5 "Fix"). Both deployments change in one rollout.
4. **Verify under real traffic** (§9), then hold for an observation window
   before the change is called done.

**Rejected:** cutting over first and fixing migrations "before the next one
ships" (that is P0-6, a delayed fuse that passes every check on the day);
setting `DIRECT_URL` to a migrator credential inside the web pod (puts a
DDL-capable credential back in a long-running pod, which the role model exists
to prevent); granting `rayin_app_runtime` broad rights "to be safe" (defeats the
purpose; the audit exists so grants are exact); doing it inside CHG-2026-005 or
-008 (the owner ruled it a separate change; it is disruptive and needs its own
revert).

**Security.** After this change the admin credential is break-glass only: held
in the secret store for the migration bootstrap and for rollback, mounted in no
long-running pod. Honest limit, unchanged: the table owner (`rayin_migrator`)
can still re-grant; this is a control against application-level compromise, not
against a holder of the migrator or admin credential.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres | ownership reassigned; grants added where the audit finds them missing; a password for `rayin_migrator`. No table or column changes. |
| Web / Worker | connection username and password reference; start-up migration disabled in web. One rollout each step. |
| Infra / Helm | a migration Job; two values changes. Recorded per environment in `acme-rayin-ops`; the Terraform module does not do this yet. |
| ClickHouse, integrations | none |

## 5. Database change
- **Migration:** one, additive in effect: the grants the audit shows are missing. Written only after the audit has run; none is guessed here.
- **Backfill:** none.
- **Rollback:** no `down.sql` for grants that are merely additional. The rollback that matters is the **connection revert** (§7), and that is what is rehearsed.

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A code path needs a privilege the runtime role lacks: `permission denied` in production traffic | **High on first attempt** (no path has ever run under this role) | High | the privilege audit; a rehearsal that runs the application's test suite and a smoke pass **as the runtime role**; an observation window; a fast, rehearsed revert |
| P0-6: crash-loop on the next migration | Certain if Step A is skipped | High | Step A is a precondition and a separate deployment |
| Rollback impossible because the admin credential was altered | Was certain under the old procedure | Critical | repoint, never overwrite; revert rehearsed before the cutover |
| Worker left on the admin login (only web patched) | Medium | High | one change covers both; verification checks both pods' connection username |
| Reassigning ownership sweeps in objects that should stay with the admin login | Low | Medium | list what will move first; review it |
| Connection limit on the runtime role (100) lower than the pools need | Low | Medium | compare with current peak connections before cutover |

## 7. Compatibility and revert
- Backward compatible: yes. No schema shape changes; an image built before this change runs unmodified.
- **Revert (must be rehearsed, and timed, before Step B is run anywhere):** point web and worker back at the admin username and the admin password Secret key; one rollout. The admin login is a superset of the runtime role, so the revert cannot fail on privileges. Step A is reverted separately by re-enabling start-up migration; it does not need to be reverted to revert Step B.
- Feature flag: not applicable. A database identity is not switchable per request; the revert above is the switch.

## 8. Client-facing notes
None visible if it works. It changes what can truthfully be said: that the audit
tables are append-only **for the application**, and that the application does
not hold an admin credential. Neither may be said before this change is
verified in the environment in question.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| Rehearsal | Pending | on the throwaway Azure-like database (`acme-governance/scripts/rehearsal-db.sh`): full migration chain, then the audit query, then the application's server tests and a smoke pass connecting **as `rayin_app_runtime`**; then the revert, timed |
| A — leave dev | Pending | Step A deployed; a release carrying a migration applied by the Job, web never running DDL |
| B — staging | `Staging: not available; isolated migration and rollback rehearsal performed.` | Pending |
| **Proof 1b flips** | Pending | the check recorded as a *known failure* under CHG-2026-005 and -008 — `UPDATE` and `DELETE` on each append-only table **through the application's own connection** — must now be **denied**. That is the closing evidence for ledger P0-5, and the point at which the append-only control may be described as effective |
| C — post-deploy | Pending | both pods' connection username is the runtime role; no `permission denied` in web or worker logs across the observation window; guardrail ingest and LiteLLM record writes still succeed through their writer roles |

## 10. Assumptions and open questions
- **Not verified:** which objects the admin login owns today and which grants are missing. Both come from catalogue queries not yet run (a read-only query through the application pod was blocked by this session's permission classifier on 2026-09-19).
- **Not verified:** that the application's every path works under the runtime role. Nothing has ever run as it. Expect the first rehearsal to find gaps.
- **Not verified:** the worker's and web's peak connection counts against the role's connection limit.
- **For the owner:** (1) the length of the observation window before Step B is called done; (2) whether Step A may ship ahead of Step B by a full release, which is the safer sequencing; (3) who holds the break-glass admin credential afterwards (links to N-47: no named production approver).

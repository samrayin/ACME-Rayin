# Rollback plan — CHG-2026-003 (security review gate; no migration, no release tag)

| | |
|---|---|
| **Change ID** | CHG-2026-003 |
| **ADR** | ADR-0002 |
| **Forward migration** | None. CI configuration only. |
| **Rollback script** | None needed: a branch-protection setting, or `git revert` of the merge commit. No `down.sql`, because no schema changes. |
| **Test status** | **Not rehearsed.** There is no state to rehearse against; see "Rehearsal log". |
| **Data lost on rollback** | None |

## When to roll back
- The reviewer produces false HIGH findings often enough to block normal work.
- The Anthropic API is unavailable or the key is out of credit, and merges cannot wait.
- The cost per PR is not acceptable.

The owner decides. Turning a security gate off is itself a governance event: record it in
the Readiness Ledger with the reason and the date it will be turned back on.

## Order of operations
There is deliberately **no "off" variable**. GitHub counts a skipped job as passing a
required check, so a switch that skips the job would let changes merge unreviewed while
looking green.

1. **Loosen, do not disable:** `CLAUDE_SECURITY_REVIEW_BLOCK_AT` is already `HIGH`, the
   loosest level. Change the model with `CLAUDE_SECURITY_REVIEW_MODEL` if the model is the
   problem.
2. **One PR, with a recorded decision:** the owner merges as an administrator, and writes
   the accepted-risk reason in the PR. Visible in the repository audit log.
3. **Stop it blocking, for a period:** remove "Security review" from the required checks
   in the branch-protection rule for `main`. The job still runs and still goes red, so the
   signal stays honest; it just no longer blocks. Put it back afterwards.
4. **Full rollback:** `git revert <merge commit>` on a branch, open a PR, merge. This
   returns the workflow to ADR-0001's state: opt-in, skipped by default, and fail-open
   when enabled. Note that a skipped job passes a required check, so after the revert
   the required check no longer protects anything: remove it from the rule as well.
5. No image, database or environment is involved, so there is nothing to redeploy.

## Verification after rollback
- [ ] The next pull request shows "Security review" in the expected state (red but not
      blocking after step 3; skipped after step 4).
- [ ] After a full revert, `.github/scripts/security_review_gate.py` is gone and the
      workflow has no "Enforce the gate" step.
- [ ] The Readiness Ledger records that the gate is off, why, and until when.

## Rehearsal log
Not applicable: no database change, so there is no migration to run up, down and up again.
The procedure's staging statement does not apply for the same reason.
Evidence location: the pull request for CHG-2026-003 and its check runs.

| Step | Command | Result / schema check | Timestamp |
|---|---|---|---|
| Up | — | no schema change | — |
| Backfill | — | none | — |
| Down | — | none | — |
| Up again | — | none | — |

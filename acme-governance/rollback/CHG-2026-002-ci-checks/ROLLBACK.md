# Rollback plan — CHG-2026-002 (CI checks; no migration, no release tag)

| | |
|---|---|
| **Change ID** | CHG-2026-002 |
| **ADR** | ADR-0001 |
| **Forward migration** | None. CI configuration only. |
| **Rollback script** | None needed: `git revert` of the merge commit. No `down.sql`, because no schema changes. |
| **Test status** | **Not rehearsed.** A revert of five small text edits has no state to rehearse against; see "Rehearsal log". |
| **Data lost on rollback** | None |

## When to roll back
- The conflict labeller fails with a permissions error under the built-in token.
- Codespell starts passing text it should have caught because of the `aks` ignore.
- The owner decides the security review should fail loudly rather than be skipped.

The owner decides.

## Order of operations
1. Partial rollback is usually enough, because the three fixes are independent:
   - Labeller: set a `PR_LABELER_TOKEN` secret. It takes precedence over the fallback.
   - Security review: set the repository variable `CLAUDE_SECURITY_REVIEW_ENABLED` to
     `true` (and the `CLAUDE_API_KEY` secret) to run it, or leave it unset to skip it.
   - Codespell: remove `aks` from `ignore-words-list` in `.codespellrc`.
2. Full rollback: `git revert <merge commit>` on a branch, open a PR, merge.
3. No image, database or environment is involved, so there is nothing to redeploy.

## Verification after rollback
- [ ] The next pull request's check run shows the three checks in the expected state.
- [ ] `git diff <pre-change commit> -- .codespellrc .github/workflows/label-prs-with-conflicts.yml .github/workflows/claude-code-security-review.yml` is empty after a full revert.

## Rehearsal log
Not applicable: no database change, so there is no migration to run up, down and up
again. The procedure's staging statement does not apply for the same reason.
Evidence location: the pull request for CHG-2026-002 and its check runs.

| Step | Command | Result / schema check | Timestamp |
|---|---|---|---|
| Up | — | no schema change | — |
| Backfill | — | none | — |
| Down | — | none | — |
| Up again | — | none | — |

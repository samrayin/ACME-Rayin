# ADR-0002 — Make the AI security review a gate (enforceable once required on `main`)

| | |
|---|---|
| **Change ID** | CHG-2026-003 |
| **Owner** | Anees Ur Rahman |
| **Affected release** | None. CI configuration only; no image is built from it. |
| **Status** | Proposed |
| **Type** | Forward |
| **Date** | 2026-09-19 |
| **Author** | Claude (implementation), on the owner's instruction |
| **Approval** | Pending. The owner reviews and merges. The implementer is not an approver of its own change. Independent check: run before the PR was opened; see section 9. |
| **Commits / tag** | Branch `ci/security-review-real-gate`; no tag |

## 1. Purpose
ADR-0001 stopped "Security review" failing on every PR by making it opt-in, which left it
skipped. The owner asked for it to be enabled as a real gate, not a check that is always
green. The upstream action cannot be that on its own: it is **fail-open**. A scanner or
API error becomes a warning and "0 findings"; an unparsable model reply becomes an empty
findings list with `review_completed: false` and exit 0; real findings only produce a PR
comment. In every case the job ends green.

## 2. Scope
**In:** `.github/workflows/claude-code-security-review.yml`; a new enforcement script and
its tests under `.github/scripts/`.
**Out:** setting the `CLAUDE_API_KEY` secret, branch protection and CODEOWNERS (owner
actions, section 10); the heavy test jobs with no runner; every other workflow.

## 3. Decision
- An enforcement step, `security_review_gate.py`, **fails closed**: no key, a scanner or
  API error, a missing, empty or malformed result, or a review that did not confirm
  `review_completed: true` all fail the job.
- Findings at or above a blocking severity fail the job (default `HIGH`, variable
  `CLAUDE_SECURITY_REVIEW_BLOCK_AT`). Missing or unrecognised severity is blocking.
- **Nothing is skipped.** GitHub counts a job skipped by a job-level `if:` as *passing*
  a required check, so draft PRs, fork PRs, Dependabot PRs and a missing key all run
  and fail with a stated reason (drafts at no API cost). There is deliberately no "off" variable; this
  supersedes ADR-0001's opt-in switch. Bypass is removing the required check or an
  administrator merge, both visible in the audit log.
- The gate script and the agent-instruction files (`CLAUDE.md` and `AGENTS.md` at any
  depth, `.claude/`, `.agents/`; `.mcp.json` removed) are taken from **current `main`**,
  dereferencing this repo's symlink chain, so a PR cannot swap the gate script or the
  reviewer's standing instructions. It reduces prompt injection; it does not end it
  (section 6). Planted result files are deleted first, the reserved tooling path names
  are rejected, and the gate only judges a review step that succeeded.
- Findings removed by upstream's false-positive filter (an LLM pass shown the PR title and
  body) are surfaced as warnings at or above the threshold, not silently dropped.
- The workflow runs only for PRs into `main` and re-runs when a PR is edited. That
  includes title and body edits, so it can cost extra runs; a concurrency group keeps
  only the newest.
- The gate's 31 unit tests run on every PR in a job that needs no key.
- Model: `claude-opus-5`, variable `CLAUDE_SECURITY_REVIEW_MODEL`.

Rejected: enabling the upstream action unchanged (green-washed); patching its pinned shell
step (brittle); a kill-switch variable (a skipped job passes a required check); blocking
on every severity (too noisy to stay on).

Security: each PR diff goes to the Anthropic API. The repository is public today, so this
discloses nothing new; if it goes private this is a third-party data flow to record.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres, ClickHouse, Web / API, Worker, Infra, Integrations | none |
| CI (GitHub Actions) | "Security review" can fail, and **is red on every PR into `main` until the owner sets `CLAUDE_API_KEY`**, and on drafts by design; new "Security review gate self-test" job |

## 5. Database change
- **Migration:** none · **Backfill:** none
- **Rollback:** `acme-governance/rollback/CHG-2026-003-security-review-gate/` — data lost: none

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Advisory only: `main` has no branch protection | **True today** | High | Owner action, section 10. Recorded in the Readiness Ledger |
| A same-repo PR edits or deletes the workflow (`pull_request` runs the head's copy; inherent to GitHub Actions) | Medium: one account, no required review | High | Visible in the diff. Real fix: branch protection with required review and a fork-owned CODEOWNERS for `.github/**` (the current file is upstream's and protects nothing here) |
| Prompt injection from PR content steers the reviewer | Medium | Medium | Instruction files at every depth come from `main`; `review_completed` required. Residual: instructions hidden in ordinary code or docs the reviewer reads, and the PR title and body, which upstream's false-positive filter is shown |
| Upstream drops any file containing the string `@generated` from the diff | Low | Medium | Known upstream limitation; not fixable here without forking the action |
| The CLI that receives the key is installed unpinned by the action | Low | Medium | Residual; the action itself is SHA-pinned. Use a CI-only key with a spend limit |
| False positives, API outage or exhausted credit block merges | Medium | Medium | Intended: fail closed. Threshold is a variable; owner can remove the required check |
| Red on every PR until the key is set | Certain | Low | Truthful, and it names the fix. It stops when the owner sets the secret |

## 7. Compatibility
- Backward compatible with previous image? Yes. No image content changes.
- Upstream merge risk: one upstream workflow file is substantially rewritten. Keep ours.
- Flags: `CLAUDE_SECURITY_REVIEW_BLOCK_AT` (default `HIGH`), `CLAUDE_SECURITY_REVIEW_MODEL`
  (default `claude-opus-5`). Permanent controls. `CLAUDE_SECURITY_REVIEW_ENABLED` from
  ADR-0001 is removed and no longer read.
- **Follow-up with a removal condition:** the enforcement step falls back to the PR's own
  gate script when the base branch has none. That is reachable only until this change
  merges. The next change removes the fallback so a missing script fails closed.

## 8. Client-facing notes
None. Customers do not receive this repository's CI configuration.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | Pass for what runs without a key | 31 unit tests pass (clean, severities and thresholds, unknown severity, scanner error, unparsed review, malformed results, filtered findings, workflow-command injection). Workflow parses as YAML. Pre-commit hook passed. Self-test job result: in the PR. **End-to-end run with a real key: pending the owner's secret; recorded in the PR when done, including whether `claude-opus-5` is accepted.** |
| Independent check | First pass **failed**: 2 High, 5 Medium, 6 Low, 0 Critical. Re-review: both High verified fixed, **no Critical or High remain, so the check passes at the procedure's threshold**; it raised 4 new Medium (agent-instruction symlinks, excluded-path hiding, draft race, unenforced review outcome), fixed in this change. Those last fixes have not themselves been independently re-reviewed. | A reviewer that did not build the change, read-only, against review area 7, twice. Both reports are in the PR. Not fixable here: section 6. |
| B — staging / C — post-deploy | Not applicable: no database or runtime change; nothing is deployed. | — |

## 10. Assumptions and open questions
Owner actions this depends on, none of which the implementer may do:
1. Set the repository secret `CLAUDE_API_KEY`: a key used only for CI, with a spend limit.
2. Protect `main`: require "Security review" and "Security review gate self-test", and
   require review. Until then this and every other check is advisory.
3. Replace `.github/CODEOWNERS` with a fork-owned file covering `.github/**` and
   `acme-governance/**`.

Open: whether `HIGH` is the right threshold once real results are seen; whether Dependabot
should get its own secret so its PRs can be reviewed; whether to block, not only warn, on
findings the false-positive filter removed.

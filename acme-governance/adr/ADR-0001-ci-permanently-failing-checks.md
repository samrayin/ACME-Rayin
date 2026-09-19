# ADR-0001 — Fix or gate the three CI checks that failed on every PR

| | |
|---|---|
| **Change ID** | CHG-2026-002 |
| **Owner** | Anees Ur Rahman |
| **Affected release** | None. CI configuration only; no image is built from it. |
| **Status** | Accepted |
| **Type** | Forward |
| **Date** | 2026-09-19 |
| **Author** | Claude (implementation), on the owner's instruction |
| **Approval** | Approved by Anees Ur Rahman (owner), 2026-09-19. Human approval: the owner merged pull request #34 and then confirmed the approval in person. Delegated auto-approval was not used. No independent review was run before the merge, and the pull request's author and merger are the same GitHub account, so GitHub holds no formal review for it. That gap is tracked in the Readiness Ledger (N-47). |
| **Commits / tag** | `47a67678a`, merged to `main` as `30425343f` (pull request #34); no tag |

## 1. Purpose
Three checks were red on every pull request in this fork (seen on #29, #31 and #32):
Codespell, "Label PRs with conflicts" and "Security review". None of the failures came
from the changes under review. A check that is always red hides the day it fails for a
real reason, and it trains reviewers to merge past red. The 2026-09-19 readiness audit
follow-up asked for them to be fixed or properly disabled.

## 2. Scope
**In:** `.codespellrc`; one description string in
`infra/langfuse-terraform-azure/variables.tf`; one line each in
`.github/workflows/label-prs-with-conflicts.yml` and
`.github/workflows/claude-code-security-review.yml`.
**Out:** the heavy test jobs that stay queued for want of a runner; the repository's
visibility; anything about licensing; whether to fund the AI security review.

## 3. Decision
- **Codespell:** add `aks` to the ignore list (78 false hits on "AKS") and fix the one
  real typo.
- **Conflict labeller:** fall back to the built-in `github.token` when the
  `PR_LABELER_TOKEN` secret is absent. The workflow already declares the least
  privilege it needs (pull requests: read, issues: write) and already skips fork PRs.
- **Security review:** make it opt-in through the repository variable
  `CLAUDE_SECURITY_REVIEW_ENABLED`. It needs a paid `CLAUDE_API_KEY` and sends each PR
  diff to a third-party API, so enabling it is an owner decision, not a default.

Rejected: deleting the workflows (they return on the next upstream sync, and the
decision disappears from view); `continue-on-error` (leaves a check that can never go
red); creating a personal access token for the labeller (a long-lived credential where
the built-in token suffices).

Security: no new secret or permission is introduced. The labeller's token scope is
unchanged. CodeQL and the existing "Security scan" job still run on every PR.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres schema | none |
| ClickHouse | none |
| Web / API | none |
| Worker | none |
| Infra / Terraform / Helm | one variable description string corrected; no plan change |
| Integrations (LiteLLM, NeMo, promptfoo) | none |
| CI (GitHub Actions) | three checks stop failing for non-reasons |

## 5. Database change
- **Migration:** none
- **Backfill:** none
- **Rollback:** `acme-governance/rollback/CHG-2026-002-ci-checks/` — data lost on rollback: none

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ignoring `aks` hides a genuine misspelling of "ask" | Low | Low | Codespell only flags "aks" as a typo of "ask"; prose review still applies |
| Security review stays off indefinitely and is forgotten | Medium | Medium | Recorded in the Readiness Ledger as an owner decision; CodeQL and "Security scan" remain |
| Upstream changes the same workflow lines | Medium | Low | Each edit is one place with an `ACME:` comment; conflict is small and obvious |
| Built-in token lacks a permission in some event context | Low | Low | Same-repo PRs and pushes to `main` both receive the declared permissions; proven by this PR's own run |

## 7. Compatibility
- Backward compatible with previous image? Yes. No image content changes.
- Upstream Langfuse merge risk: two upstream workflow files and `.codespellrc` are
  touched, one line each.
- Feature flag / compatibility layer: repository variable
  `CLAUDE_SECURITY_REVIEW_ENABLED`, default unset (off). Removal condition: none; it
  is the permanent on/off switch for that check.

## 8. Client-facing notes
None. Customers do not receive this repository's CI configuration.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | Pass, with two items provable only in CI | `codespell --skip "./.git,./patches" .` exit 0 (was exit 65 with 79 hits); `terraform fmt -check variables.tf` exit 0; both workflow files load with `yaml.safe_load`; pre-commit hook (format check, lint) passed. Labeller and security-review behaviour: see the pull request's own check run, recorded in the PR. |
| B — staging | Not applicable: no database or runtime change. | — |
| C — post-deploy | Not applicable: nothing is deployed. After merge, the next PR's checks are the confirmation. | — |

## 10. Assumptions and open questions
- Assumes the repository's Actions settings give `GITHUB_TOKEN` the permissions a
  workflow declares (the default). If the organisation restricts this, the labeller
  needs the secret after all.
- Open, for the owner: fund and enable the AI security review, or leave it off and rely
  on CodeQL plus "Security scan"?
- Not addressed: heavy test jobs remain queued with no runner. Until that is fixed,
  "tests pass" in Gate A cannot be shown by CI for any change.

# ADR-0008 — CI runner provisioning for the heavy `pipeline.yml` jobs (N-51)

| | |
|---|---|
| **Change** | CHG-2026-033 · Tier 2 · owner: Anees Ur Rahman |
| **Status** | **Proposed — root cause confirmed, two fix paths compared, owner to pick. No workflow file touched.** |
| **Related** | ADR-0001 §10 ("Not addressed: heavy test jobs remain queued with no runner. Until that is fixed, 'tests pass' in Gate A cannot be shown by CI for any change.", 2026-09-19) · Readiness Ledger N-51 · ACME-CHANGELOG.md's separately-tracked "`blacksmith-*` runner gap" (two prior mentions, §08 and the PR #8 rebuild-acceptance-test entry) |
| **Blocked by** | Owner decision below. Whichever path is picked becomes its own change, claimed and built separately. |

## 1. The problem, verified not assumed

Every job in `.github/workflows/pipeline.yml` ("CI/CD" — build, lint, typecheck, every test
suite, the Docker image smoke build) is pinned to a `blacksmith-*` runner label:

```
$ grep -n "runs-on:" .github/workflows/pipeline.yml
45:    runs-on: blacksmith-4vcpu-ubuntu-2404
...(24 matches total, all blacksmith-* or a matrix expression that resolves to one)
```

`blacksmith-*` is not a GitHub-hosted label. It only resolves through the Blacksmith GitHub
App (`useblacksmith`/`blacksmith.sh`), which provisions and attaches the actual runner.

**Confirmed live, 2026-09-22:**
- `GET /repos/samrayin/ACME-Rayin/actions/runners` → `{"total_count":0,"runners":[]}`. Zero
  runners registered.
- A representative run (`docs/claim-chg-2026-029-judge-key-hygiene`, `pull_request`, created
  `2026-09-22T12:09:07Z`) sat at API `status: "pending"` for 2h26m+ with `updated_at` only 2
  seconds after `created_at`. Its own jobs endpoint: `{"total_count":0,"jobs":[]}` — GitHub
  never dispatched a single job to it, not slow, not degraded, never assigned.
- Sampling the last day of `pipeline.yml` runs (`gh run list --workflow=pipeline.yml`, ~40
  runs across both `pull_request` and `push` events): every run is either still
  `pending`/`queued`, or `completed` with `conclusion: cancelled`. Not one run in the sample
  shows a real `success` or `failure` from the actual build/lint/test jobs — `cancelled` is
  the concurrency group or a newer push superseding a run that was never going to finish
  anyway, not a verdict on the code.

This is the mechanism behind N-51 and confirms, with evidence, what ADR-0001 already flagged
by name in 2026-09-19 but didn't investigate: "heavy test jobs remain queued with no runner."
All test evidence in this repo to date — 26 service tests, 13 worker tests, typecheck, lint —
is local, from a developer machine, never from CI. No PR in this repo's history has ever
received a real `pipeline.yml` verdict.

**Not an ACME decision to begin with.** `git log --all -- .github/workflows/pipeline.yml`
shows 228 commits, every one of them upstream Langfuse's; grepping that history for an ACME/
Rayin/CAIRO commit touching a `runs-on:` line returns nothing. The `blacksmith-*` labels are
inherited unmodified from the upstream sync, never examined or chosen by this fork.

## 2. Scope

**In:** why CI never runs today; the two ways to make it run; enough evidence on each to let
the owner pick.
**Out:** editing `pipeline.yml` or any release-related workflow (Thread 1 is mid-deploy on the
guardrail/gateway/judge-key path; this is Thread 2, kept fully separate). The Docker
image-build/push job (`runs-on: ${{ matrix.runner }}`, `blacksmith-4vcpu-ubuntu-2404[-arm]`,
pushes to `ghcr.io`) is release-adjacent and excluded from both paths below for the same
reason — it is not analyzed here.

## 3. Path (a) — provision the Blacksmith GitHub App

**What it actually requires.** Per Blacksmith's own docs (`docs.blacksmith.sh`, fetched
2026-09-22): *"Blacksmith is limited to GitHub organizations and not available for personal
repositories."* `samrayin`, the account that owns this repo, is confirmed by GitHub's API to
be `"type": "User"` — a personal account, not an Organization.

**This means path (a) is not currently available, full stop — not "not yet installed," but
structurally blocked under the repo's present ownership.** Making it available would require
either converting `samrayin` to a GitHub Organization or transferring the repo into one. That
is an account/ownership decision with consequences well outside CI (billing entity, admin
model, who else gets access) — a separate decision from "which runner do the tests use," not
a sub-step of this one.

- **Why it was chosen originally:** not an ACME choice (see §1) — it's upstream Langfuse's own
  CI infrastructure, inherited by the fork along with the rest of `pipeline.yml`. Upstream is
  itself an Organization (`langfuse/langfuse`), so the constraint above never surfaced for
  them. No ACME-side rationale exists to cite; none was found in `ACME-CHANGELOG.md` or any
  ADR.
- **Cost/performance case, from upstream's own history:** real. Commit `aa5f60aa8` ("increase
  Blacksmith CPUs and tune concurrency") deliberately bumped `lint` and `tests-web` from
  8vcpu to 16vcpu Blacksmith runners together with worker-count tuning
  (`VITEST_MAX_WORKERS`, ESLint `--concurrency`) — a real throughput investment, not
  incidental. Blacksmith's own marketing claims ~2x faster / up to 75% cheaper than GitHub
  standard runners at scale (`blacksmith.sh/pricing`, not independently verified against this
  repo's usage). Upstream also has direct outage experience with it: commit `435042a4f`
  ("switch pipelines back to GitHub-hosted runners") moved every general CI/lint/test/build
  job off Blacksmith during a partial outage, then commit `041523592` reverted that once the
  outage cleared — i.e., upstream itself keeps GitHub-hosted as a known-working fallback for
  this exact workflow, and switches back to Blacksmith for speed once available, not out of
  necessity.
- **Time to provision, if the ownership blocker were resolved:** not concretely stated in
  Blacksmith's docs beyond "visit `app.blacksmith.sh` to grant permissions" — no published SLA
  or turnaround figure found. Not stating a number I can't source.

## 4. Path (b) — move the heavy jobs to `ubuntu-latest`

**Simplicity:** no external app, no account-type prerequisite, no billing setup. GitHub's
standard hosted Linux runner is available immediately on every repo, public or private.

**Actual resource requirement, checked against the file (not assumed):** of the 24
`blacksmith-*` `runs-on:` lines in `pipeline.yml`, only **two** request 16vcpu unconditionally
— `lint` (line 210) and `tests-web` (line 694) — plus **one** conditional leg,
`tests-worker`'s `redis-cluster` matrix variant only (line 905), which falls back to 8vcpu for
its other two variants. Every other job (build, typecheck, knip, prettier, storybook, shared
tests, docker-build smoke test, eslint-plugin tests, sandbox-runtime tests, the default and
`-azure` `tests-worker` legs) already runs at 4vcpu or 8vcpu.

**Verdict on `ubuntu-latest`'s standard spec:** GitHub's standard hosted Linux runner is
**4 vCPU / 16 GB RAM** as of its late-2023/2024 upgrade (confirmed via GitHub's own changelog
and docs, fetched 2026-09-22), free and unmetered on public repositories — and this repo is
public (per this portfolio's own index, `ACME-Rayin` is listed "public (product only)").
That matches this repo's *majority* of jobs (the 4vcpu ones) close to like-for-like. It is
**below** what `lint`, `tests-web`, and the `redis-cluster` `tests-worker` leg currently
request (16vcpu, or 8vcpu for that one leg) — those three would be running with fewer cores
than they're tuned for, not a like-for-like swap.

This is not a hedge: upstream's own history already ran this exact experiment. Commit
`435042a4f` swapped every general CI/lint/test/build job — at the time, all 4vcpu/8vcpu
Blacksmith labels — onto plain `ubuntu-latest` during the outage, and the revert commit
(`041523592`) records no failures, only a plain revert once Blacksmith came back. That predates
the 16vcpu bump, so `lint` and `tests-web` at their *current* 16vcpu-tuned concurrency have
never themselves been run at 4vcpu — but the mechanism (GitHub-hosted Linux runners
successfully running this workflow's jobs) is proven, not hypothetical.

**Consequence of downsizing:** `lint` and `tests-web` would need their concurrency tuned back
down to match 4 actual cores — `lint`'s `pnpm turbo run lint --concurrency=3 -- --concurrency=4`
and `tests-web`'s `VITEST_MAX_WORKERS: "12"` were both set for 16 cores (`aa5f60aa8`) and would
oversubscribe a 4-core box at those settings, which risks the jobs getting *slower* than a
correctly-tuned 4-core run, not just proportionally slower. Retuning those two settings (and
the `redis-cluster` `tests-worker` leg's `VITEST_MAX_WORKERS: "8"`) is a small, mechanical part
of implementing this path — not a structural blocker, not a redesign, no job needs splitting
into multiple parallel jobs to fit.

## 5. Recommendation

The evidence doesn't leave this close. Path (a) is not a provisioning task right now — it's
blocked by the repo's account type, and the fix for that is an ownership decision, not a CI
decision. Path (b) has no external dependency, is proven by upstream's own outage history for
the workflow's actual jobs, and touches three concurrency settings, not a redesign. **Path (b)
is the only one buildable today; (a) becomes viable only after a separate ownership decision
this ADR doesn't make.**

## 6. Impacted components (either path)

| Component | Impact |
|---|---|
| Postgres / ClickHouse / Web / Worker | none — CI runner choice, no product code |
| CI (GitHub Actions) | `pipeline.yml`'s `runs-on:` lines and three `VITEST_MAX_WORKERS`/`--concurrency` settings, if (b) is chosen — not touched by this ADR itself |
| Account / ownership | only relevant to (a); out of this ADR's scope |

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| (b) chosen, retuned concurrency still oversubscribes | Low | Low | `VITEST_MAX_WORKERS`/`--concurrency` set to match 4 actual cores, verified by the first real CI run — the thing that's never existed yet |
| (a) pursued without resolving the ownership blocker first | High if attempted | Wasted effort | This ADR names the blocker explicitly; don't install-and-see |
| Upstream re-syncs `pipeline.yml` and reintroduces `blacksmith-*` after (b) is merged | Medium | Low | Same pattern as ADR-0001's `ACME:`-comment approach — mark the diverged lines if/when (b) is built |

## 8. Assumptions and open questions

- Assumes `samrayin`/`ACME-Rayin` stays a personal-account-owned public repo for the
  foreseeable future; if an org transfer is ever done for other reasons, path (a) is worth
  revisiting then.
- Blacksmith's provisioning turnaround time is not stated anywhere sourced — if the owner
  wants a real number before deciding, that needs a direct question to Blacksmith, not a guess
  from their docs.
- Open, for the owner: which path to build. This ADR presents both; it does not choose.

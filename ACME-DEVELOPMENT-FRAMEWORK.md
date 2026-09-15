# ACME Development Framework

This governs how RAYIN development actually ships — branching, environments,
CI/CD, infrastructure, and secrets — across all three repos (`ACME-Rayin`,
`rayin-guardrails`, and any future `integrations/*` service repo). It sits
above `CONTRIBUTING-ACME.md`, which governs commit/changelog hygiene inside
this one repo specifically; this file governs the process around those
commits — how they reach `main`, how `main` reaches a live environment, and
what has to be true before either of those counts as "done."

Every rule below exists because something already went wrong without it.
That's deliberate — a generic SDLC policy is easy to ignore; one that names
the actual incident it prevents is harder to.

## 1. Source control

**No direct commits to `main`. Every change goes through a PR**, even a
one-line doc fix, even solo. Enforced via GitHub branch protection where the
plan tier allows it (see §6).

- `ACME-Rayin`: public repo, so branch protection is *available* — but as of
  2026-09-15, a direct API check (`branches/main/protection` → `404`,
  rulesets → `[]`) confirmed it is **not actually active**, despite an
  earlier command having been handed over to set it up. Direct pushes to
  `main` are currently possible. This is exactly the "documentation as a
  substitute for verification" failure this file warns about elsewhere —
  the rule was written down and believed before it was checked. Re-run the
  setup and re-verify with the same API check before trusting this bullet
  again. Target config once actually applied: PR required, no force-push,
  no deletion, required-approval count `0` (not `1`) deliberately — this is
  a one-person-reviewed repo today, and requiring a second approval would
  just lock the owner out of their own merges. Raise it to `1` the day a
  second regular reviewer (human or a standing AI review step) exists.
- `rayin-guardrails`: private repo, GitHub's free tier doesn't offer branch
  protection on private repos. Until that's upgraded or the repo goes
  public (don't — it's proprietary), "PR before merge" is a discipline-only
  rule here, not an enforced one. Treat any direct push to this repo's
  `main` as a process violation worth a conversation, not a technicality.

**Before starting new work, check for parallel work first.** A second,
independent guardrails implementation (`rayin/enhanced/`) was built across a
multi-day gap with no visibility into the already-fixed `rayin-guardrails`
service, because nothing forced a check for existing in-flight work before
starting. Before starting anything nontrivial: `git log --all --oneline -20`
across all three repos, and skim `RAYIN-SESSION-CONTEXT.md` if it exists.
Five minutes, and it's the single check that would have prevented that
specific multi-day duplication.

## 2. Environments

**Today there is exactly one environment** —
`langfuse-dev.aiatacme.com` — serving as dev, demo, and de facto production
simultaneously. Every rule in this section is the target state, not the
current one; don't claim a staging gate exists until it does.

Target:
- **Dev**: this cluster, freely broken, no approval needed to deploy to it.
- **Staging**: a separate namespace in the same AKS cluster (not a second
  cluster — no budget justification for that yet) with its own DB schema.
  Changes land here first; nothing goes to the shared/demo environment
  without having run here.
- **Production**: does not exist yet in any form that should hold a
  customer's real data — see §5 for why, and don't let a sales conversation
  get ahead of this section.

## 3. CI/CD

- **Required checks on `ACME-Rayin`'s branch protection are deliberately
  empty right now.** Codespell, the Claude Code security review, and the
  PR-conflict labeler all fail on a clean `main` today (an "AKS" ==
  false-positive typo flag, a missing API key secret on this fork, and a
  permissions gap, respectively) — turning any of them into a hard
  requirement would make every future PR unmergeable until that baseline
  noise is fixed separately. Fix the baseline first, then promote checks to
  required one at a time, verified green on `main` before flipping the
  switch — never require a check that's currently red.
- **Add a dedicated typecheck gate**, separate from the image build.
  Production builds currently run with `NEXT_IGNORE_BUILD_ERRORS=true` to
  dodge an OOM on the default build agent — which is how an RBAC scope
  rename (`auditLogs:read` → `projectAuditLogs:read`) shipped and silently
  broke the Audit Logs nav item, undetected, because nothing typechecked the
  build that shipped it. A separate `pnpm run typecheck` CI job (no image
  build attached, so no OOM pressure) closes this without touching the
  build pipeline itself.
- **Container images get git-sha tags, not hand-picked names.** This
  session shipped `fix-rail-wiring`, then `fix-rail-wiring-v2`, because the
  first one didn't actually contain the fix being tested. A tag generated
  from the commit that built it doesn't have this failure mode — it's
  either the commit you think it is, or the build didn't run.
- **All of the above is currently a manual step run from a laptop**
  (`az acr build`, `kubectl apply`, by hand, verified with `curl` afterward).
  It works, and every deploy this session was genuinely verified — but nothing
  stops the next deploy from skipping that verification. The fix is wiring
  this into a GitHub Actions job triggered on merge, not asking people to
  remember to test by hand forever.

## 4. Infrastructure as Code

- **Commit the `.terraform.lock.hcl` for every Terraform config** —
  `deploy/azure/` and `deploy/customer-template/` both currently lack one.
  Without it, a fresh `terraform init` anywhere else can silently resolve
  different provider versions than whatever was last tested.
- **`.terraform/` and `*.tfstate*` belong in `.gitignore`**, repo-wide — not
  yet true. This is the same category of mistake that already forced
  abandoning a branch once (`feat/promptfoo-evals`, 60–219MB of provider
  binaries committed to history, unrecoverable without a fresh branch).
- **No manual changes against infrastructure Terraform is supposed to
  own**, once the reconciliation below is complete. Until then, the honest
  state is: Terraform does not manage the live environment's ~65 real
  resources at all — they were provisioned manually and never imported. A
  scoped plan for closing this (state-only `terraform import`, sensitive
  values sourced from live `kubectl get secret` output, never freshly
  generated, a mandatory zero-diff `terraform plan` as the completion gate)
  already exists — execute it before treating Terraform as the real
  deployment mechanism for anything.

## 5. Secrets and credentials

This section exists because of a real incident, days old as of this
writing: a guardrails bypass secret sat in **plaintext in a ConfigMap**
(not a `Secret`) for two days, reachable through a proxy that was, in turn,
reachable from the **public internet** via an ingress rule nobody
re-checked after adding it. Closing it required finding and rotating the
same credential in **three separate places** — the service's own config,
the proxy that fronted it, and a completely separate copy the main web app
held for its own dashboard call. The first rotation attempt missed the
third one.

Rules going forward:
1. **Secrets are `Secret` objects, never `ConfigMap` values, ever** —
   including ones interpolated into a larger config file (like nginx's
   `default.conf`). If a value needs auth, it needs to be a Secret even if
   it's awkward to template in.
2. **Before rotating any shared credential, grep every namespace for every
   consumer of it first** — `for ns in $(kubectl get ns -o
   jsonpath='{.items[*].metadata.name}'); do kubectl get secrets,configmaps
   -n $ns -o json | grep -l <marker>; done` — not just the ones a bug report
   or a prior conversation happened to mention. The missed third copy above
   is exactly the failure mode this prevents.
3. **After any change to network path or auth (a new proxy, a new ingress
   rule, a new internal caller), make one unauthenticated call from outside
   the boundary you think exists, and confirm it actually fails.** Both the
   plaintext-ConfigMap and the public-ingress problems were each, on their
   own, locally reasonable changes made by people solving a real problem
   (a dashboard needed to reach the service; the service needed to be
   reachable). Nobody tested the composition of the two from outside. That
   test is cheap and would have caught this in minutes instead of two days.
4. **Never print a raw secret value in a chat transcript, a log line
   intended for humans, or a commit message** — even when debugging
   requires reading it once to confirm a fix. Confirm success by testing
   behavior (old value rejected, new value accepted), not by displaying the
   value.

## 6. Definition of done

Extends `CONTRIBUTING-ACME.md`'s existing bar ("committed" and "deployed"
are different states) with the same standard applied to infrastructure and
security changes specifically:

- A fix isn't done because the code changed. It's done when it's been
  **rebuilt, redeployed, and re-tested against the live behavior that was
  originally broken** — ideally with the exact input that first exposed the
  bug. "The wiring should now be correct" is a hypothesis until that test
  runs.
- A security finding isn't closed because a patch was applied. It's closed
  when the specific attack that was possible has been tried again and
  confirmed to now fail.
- A branch isn't finished because it's pushed. `git diff origin/main..HEAD`
  gets read before assuming what's in it, and a PR gets opened — an
  unopened PR sitting on a pushed branch for days is exactly what allowed
  independent, overlapping work to happen unnoticed once already.

## 7. Ongoing cadence

- Re-score the OWASP SAMM scorecard (tracked in the RAYIN Readiness Ledger)
  every time the Ledger is refreshed — this turns "we're improving" from a
  claim into a number that can go down as well as up.
- Security assessment is a recurring calendar item (quarterly, or triggered
  by any major dependency/infra change), not a single point-in-time
  document from one review.
- The Ledger itself gets a fresh, independently-spawned outside review
  periodically, not only ever the same author checking their own work.

# ACME Customization Changelog

This file catalogs every ACME-specific customization made to this Langfuse fork —
what changed, why, how it works, and its current status. It exists so this fork can
go to production with full context, not as a pile of undocumented patches.

**Convention going forward:** every ACME change lands as its own commit (never bundled
into an unrelated change), and gets an entry here in the same commit. See
`CONTRIBUTING-ACME.md` for the exact process.

**Versioning:** every version that reaches a deployment gets an annotated git
tag at the exact commit it was built from (`acme-v4.35.0.N`). From `acme-v4.35.0.5`
on, the tag also records the image, its digest and the ACR build run. Since
2026-09-18 the tag is created by `scripts/release/release.sh`, which **is** the
deploy command: build, then tag, then deploy the tagged digest. See
`scripts/release/README.md`.

**What a tag does and does not give you:**
- **Traceable:** for any running image you can find the exact commit, and this
  changelog says what that commit contains.
  `scripts/release/verify-deployed.sh` checks the running images against the tags.
- **Not reproducible end to end, yet.** A tag says *what* was running. It does
  **not** prove the environment can be stood up fresh on a customer subscription.
  That needs infrastructure, secrets, configuration and seed data beyond the
  image, and the customer Terraform template has never been run end to end
  (tracked as #23). Don't read `git checkout <tag>` as a rebuild.

**Base version:** Langfuse `v4.38.0` (upgraded from `v4.35.0` on 2026-09-19 — see
"Upgrade to v4.38.0" below; before that from `v4.33.0` on 2026-09-11, see
"Upgrade to v4.35.0", and from `v4.17.0` on 2026-09-10, see "Upgrade to
v4.33.0"). Tags restart at `acme-v4.38.0.1` (web) and
`worker-acme-v4.38.0.1` (worker) under this base. Helm chart `2.0.0` — matches what's live
on `langfuse-dev.aiatacme.com` (see `Azure Blueprint/ENVIRONMENT-STUDY.md` in
the companion infrastructure project for the full deployment audit).
**Note on tag numbering:** existing tags (`acme-v4.33.0.1`, `.2`) were cut
under the v4.33.0 base and stay as-is — retagging history isn't worth the
churn. Going forward from this base bump, new tags restart as
`acme-v4.35.0.1`, `.2`, ... — the number always resets to `.1` on a base
version bump; see "Versioning" above for what a tag captures.

**Status of this fork as a whole:** **live on `langfuse-dev.aiatacme.com`** as of
2026-09-10. Both container images (`acmelangfuseacr.azurecr.io/langfuse-web:acme-dev`,
`acmelangfuseacr.azurecr.io/langfuse-worker:acme-dev`) are built, pushed, and
deployed — `kubectl get pods -n langfuse` shows both `1/1 Running`, 0 restarts. See
the "Live deployment" entry near the end of this file for the full path to get
there (including two real bugs found and fixed along the way — an ACR build OOM
and a CRLF-corrupted entrypoint script). Terraform itself does **not** yet manage
this deployment — see that same entry for why and what's needed to close that gap.

---

## 2026-09-09 — ACME branding (logo)

**What:** Replaced Langfuse's stock logo assets with ACME's own.

**Files:**
- `web/public/icon.svg`
- `web/public/wordart-black.svg`
- `web/public/wordart-white.svg`

**Why this approach, not Langfuse's paid UI-customization feature:** Langfuse's own
logo-replacement mechanism (`self-host-ui-customization` entitlement) requires an
Enterprise license *and* is co-branding only — the customer's logo sits alongside
Langfuse's, never replacing it (verified directly in `LangfuseLogo.tsx` during the
branding audit). Editing these three MIT-licensed static files directly achieves a
cleaner, full replacement than the paid feature does, at zero licensing cost. See the
branding audit (`AWS blueprint/langfuse-logo-branding-audit.md` in the companion
project) for the full legal reasoning — MIT permits this; only files under `ee/` would
require a license, and none of these three are.

**Deployment status:** Was briefly live on `langfuse-dev.aiatacme.com` via a manually
`kubectl`-applied ConfigMap + volume mount **outside Helm's own management** — a fragile
setup that a future `helm upgrade` would silently revert, since the chart's own
`extraVolumes`/`extraVolumeMounts` values (the correct, Helm-native mechanism) were
never actually set to `[]` → populated. That manual patch is not durable and is not
what's being version-controlled here. This commit instead bakes the files directly into
the fork's source tree, so they become part of any image built from this repo
permanently — no ConfigMap, no volume mount, no drift risk.

---

## 2026-09-09 — Contact ACME Support button

**What:** Added a "Contact ACME Support" button to the in-app Support panel, ahead of
the community GitHub links.

**File:** `web/src/features/support-chat/IntroSection.tsx`

**Why this approach:** Same reasoning as the logo — Langfuse's own `supportHref`
customization field exists for exactly this, but it's gated behind the same
Enterprise `self-host-ui-customization` entitlement (verified in
`uiCustomizationRouter.ts` — the whole customization object returns `null`
server-side without a valid license, regardless of what env vars are set). This button
is added directly to the MIT-licensed component instead, at zero licensing cost.

**Current target:** `mailto:anees.r@almoayyedcomputers.com` — a placeholder pointing at
a personal inbox. **Before production, this needs to become a real ACME support
channel** (a shared inbox or ticketing system), not an individual's email address.

**Deployment status:** Not yet deployed anywhere — source-only, same as everything
below.

---

## 2026-09-09 — ACME Enhancements: Audit Logs page

**What:** A new "ACME Enhancements" sidebar section with a license-free Audit Logs
viewer.

**Files:**
- `web/src/features/acme-enhancements/server/acmeAuditLogsRouter.ts`
- `web/src/features/acme-enhancements/components/AcmeAuditLogsTable.tsx`
- `web/src/features/acme-enhancements/pages/AcmeAuditLogsPage.tsx`
- `web/src/pages/project/[projectId]/acme-enhancements/audit-logs.tsx`
- `web/src/components/layouts/routes.tsx` (new nav entry + `RouteGroup.AcmeEnhancements`)
- `web/src/server/api/root.ts` (registers `acmeAuditLogs` router)

**Why this approach:** Verified during the original deployment audit that audit-log
*writes* are completely ungated in Langfuse OSS (`auditLog.ts` has no plan/entitlement
check) — only the official viewer UI is Enterprise-gated (`audit-logs` entitlement,
`auditLogs.ts:89,189`). That viewer component lives under `web/src/ee/`, which the root
`LICENSE` carves out as Enterprise-licensed regardless of what the code does at
runtime — so it can't be reused directly. This is a from-scratch reimplementation of
the same read query (same Prisma model, same pagination shape) in an MIT-licensed
location, using ordinary project RBAC (`auditLogs:read`) instead of the entitlement
check. No write path exists in this router — read-only by construction.

**Deployment status:** Not yet deployed.

---

## 2026-09-09 — ACME AI: in-app chat

**What:** A chat assistant embedded natively in the console (floating widget, bottom
right of every project-scoped page), grounded in the project's own trace data plus
ACME's operational knowledge.

**Files:**
- `web/src/features/acme-enhancements/server/acmeChatRouter.ts`
- `web/src/features/acme-enhancements/server/acmeKnowledgeBase.ts`
- `web/src/features/acme-enhancements/components/AcmeChatWidget.tsx`
- `web/src/components/layouts/app-layout/variants/AuthenticatedLayout.tsx` (widget wired
  into the global layout, `panel` layer band)
- `web/src/env.mjs` (new `ANTHROPIC_API_KEY` server-only env var)
- `web/package.json` (new `@anthropic-ai/sdk` dependency)
- `web/src/server/api/root.ts` (registers `acmeChat` router)

**Architecture, and why it's simpler than first assumed:** Originally scoped as
needing a separate backend service plus a Content-Security-Policy patch (to allow an
externally-loaded widget script). Neither turned out to be necessary once designed as
a *native* Next.js feature instead of an externally-embedded one:
- The chat backend runs server-side inside the already-authenticated tRPC process — no
  new service to deploy.
- CSP only restricts what the *browser* loads/calls; a same-origin tRPC mutation never
  triggers it. **No CSP change was needed at all.**
- Project data access reuses the same session-authenticated repository functions the
  rest of the app already uses (`getTracesTable`, `getTraceById`,
  `getObservationsForTrace`, `getScoresForTraces` from `@langfuse/shared/src/server`) —
  not a round-trip through Langfuse's own external MCP endpoint, which would have
  required solving a separate per-project API-key provisioning problem.

**Security design** (mirrors the standalone `acme_ai.py` reference tool built earlier
in this engagement — see that tool's own README for the fuller rationale):
1. **Read-only by construction** — the tool set (`list_recent_traces`,
   `get_trace_detail`) only ever calls read repository functions. No write tool is
   defined; Claude has no code path to mutate project data through this feature.
2. **Prompt-injection-safe tool results** — every tool result is wrapped in
   `<untrusted_data source="...">` tags before entering the conversation, with an
   explicit system-prompt instruction to treat that content as data, never as
   instructions, and to report (not comply with) anything inside those tags that looks
   like an injection attempt. Trace content originates from the project's own end
   users and must be treated as potentially adversarial.
3. **Project-scoped by the existing tRPC session** — a user can only ever query the
   project they're already authorized to view; no separate credential to provision or
   leak.

**Differentiator, not just parity:** Langfuse's own "Ask AI" (Cloud) is a docs
assistant with no access to a customer's actual data. This is grounded in the
project's real traces — something Langfuse's Enterprise tier doesn't offer at any
price. See `Azure Blueprint/ACME-Enterprise-Offering-Comparison.xlsx` (companion
project) for how this was priced into the offering.

**Known limitation:** the tool set is intentionally small (2 tools) for this first
version. Extending it to cover more of the read surface (scores, datasets, prompts)
follows the same pattern — add a function, add it to `TOOLS`, wire it in `runTool`.

**Deployment status:** Not yet deployed. Also not yet tested against a live Claude API
call end-to-end (the standalone reference tool hit an Anthropic account credit-balance
error during its own test; this in-app version has not been separately smoke-tested).

---

## 2026-09-09/10 — Build fix: strip `--platform` from Dockerfile FROM lines for ACR builds

**What:** Removed the `--platform=...` flag entirely from every `FROM` line in both
`web/Dockerfile` and `worker/Dockerfile` (7 stages each).

**Files:**
- `web/Dockerfile`
- `worker/Dockerfile`

**Why this approach:** Not an ACME feature — a build-tooling compatibility fix,
discovered and corrected across two `az acr build` attempts. Upstream Langfuse's
Dockerfiles pin every stage with `FROM --platform=${TARGETPLATFORM:-linux/amd64} ...`
(BuildKit's shell-style default-value substitution). Azure Container Registry
Tasks' pre-build "scan for dependencies" step uses a narrower Dockerfile parser
than real BuildKit and aborts the whole build before the build engine ever runs:
- Attempt 1 hardcoded the value (`--platform=linux/amd64`), assuming the `${VAR:-default}`
  substitution syntax specifically was the problem. Build still failed at the same
  step (`unable to understand line FROM --platform=linux/amd64 ...`,
  `failed to scan dependencies: exit status 1`) — ACR's scanner doesn't recognize the
  `--platform` flag on `FROM` at all, regardless of its value.
- Attempt 2 (this fix) removes the flag entirely. ACR build agents are themselves
  linux/amd64, and this fork's only deployment target is AKS on standard amd64 node
  pools, so omitting `--platform` (Docker then defaults to the build machine's own
  platform) is a correct, zero-risk fix for this deployment. It would need revisiting
  only if ACME ever needs to cross-build for a different architecture (e.g. ARM64
  nodes) — at which point per-arch builds via separate `az acr build --platform`
  invocations would be the right mechanism, not Dockerfile-level `TARGETPLATFORM`
  substitution (which ACR's scanner can't consume either way).

**Deployment status:** Source-only until the resulting images are actually built and
deployed — see build progress in this same session.

---

## 2026-09-10 — Build fix: regenerate lockfile, pin anthropic-ai/sdk to a mature version

**What:** Regenerated `pnpm-lock.yaml` (previously never updated after `@anthropic-ai/sdk`
was added to `web/package.json` during the ACME AI chat work) and changed the
dependency's version range from `^0.124.0` to `^0.123.0`.

**Files:**
- `pnpm-lock.yaml`
- `web/package.json`

**Why this approach:** Two separate real build failures, both discovered live
running `az acr build`, not assumed:
1. `pnpm install --frozen-lockfile` (what the Dockerfile runs) failed outright —
   `pnpm-lock.yaml` didn't match `web/package.json`'s `@anthropic-ai/sdk` addition.
   The lockfile was never regenerated when that dependency was added earlier in
   this engagement. Fixed by running `pnpm install --no-frozen-lockfile` to bring
   the lockfile back in sync.
2. That regeneration then hit this workspace's own `minimumReleaseAge: 7200`
   (5-day) supply-chain policy (`pnpm-workspace.yaml`) — `^0.124.0` resolves to
   `0.124.0`, published only days earlier, inside the maturity window. Rather than
   wait out the window or add a `minimumReleaseAgeExclude` bypass (a real security
   control this fork should not weaken), pinned to `^0.123.0` — the next version
   down, published 2026-09-01 and already clear of the window at the time of this
   fix.

**Deployment status:** Source-only until the resulting images are actually built and
deployed — see build progress in this same session.

---

## 2026-09-10 — Build note: web image OOM-killed on ACR's default build agent

**What:** No source change. Documenting a build-time-only workaround needed to get
`langfuse-web:acme-dev` built on Azure Container Registry's default (Basic-tier)
build agent: passing `--build-arg NEXT_IGNORE_BUILD_ERRORS=true` to `az acr build`.

**Why:** The first successful-past-dependency-resolution build attempt (run `dt4`)
compiled the Next.js app fine (`Compiled successfully in 3.3min`), then got killed
(`exit 137` — SIGKILL, the classic OOM-kill signature) during the separate
TypeScript type-checking pass that runs after compilation. ACR Tasks' default
build agent is memory-constrained, and this monorepo's full type-check is heavy
enough to exceed it. `web/Dockerfile` already had `NEXT_IGNORE_BUILD_ERRORS`
wired in for exactly this class of problem (its own comment: "Allows the CI
docker build smoke test to skip the Next.js type check that the lint job already
runs"). Two live attempts, not one:
- Attempt 1 passed `NEXT_IGNORE_BUILD_ERRORS=1`. Same OOM crash (run `dt5`) — the
  build still ran the full TypeScript check and died at the same point.
  `next.config.mjs` checks `process.env.NEXT_IGNORE_BUILD_ERRORS === "true"`, a
  strict string comparison; `"1"` never matched it, so the flag silently had no
  effect.
- Attempt 2 passed the literal string `NEXT_IGNORE_BUILD_ERRORS=true`. Build
  succeeded (run `dt6`, 15m31s) — confirms this Next.js version actually skips
  running the type-checker when the flag is honored, not just suppresses errors
  from it.

**Tradeoff, explicitly:** this means `langfuse-web:acme-dev` is NOT verified
type-clean by its own build — type errors would not fail this particular build.
Acceptable for a dev-prototype image; **not** acceptable for a real release build
without either (a) running on a build agent with more memory (e.g. a Premium-SKU
ACR dedicated agent pool), or (b) running `pnpm run typecheck` as a separate CI
step before building the image, which is exactly what Langfuse's own upstream CI
already does per that Dockerfile comment.

**Deployment status:** Applies only to how `langfuse-web:acme-dev` gets built,
not to any source file. See the "Custom image build" entry below for the
resulting image's actual status.

---

## 2026-09-10 — Custom image build: both images pushed to ACR

**What:** Both ACME-customized images successfully built (via `az acr build`,
Cloud Shell, driven end-to-end through browser automation) and pushed to the
`acmelangfuseacr` registry created for this purpose:

| Image | Tag | Digest | Build time |
|---|---|---|---|
| `langfuse-web` | `acme-dev` | `sha256:04aa360eb6a75f842e8a62837233e9f84b2b4331bf7460ce9d423c83531d56e7` | 15m31s (run `dt6`) |
| `langfuse-worker` | `acme-dev` | `sha256:31a417643c20a4e0393742176f5dbab83df56a798d26bd3d4050ceb3b1c68e47` | 8m19s (run `dt7`) |

Both built from this repo's `HEAD` at the time of the build (commit `fcc197f` and
earlier). The worker build hit one non-fatal issue worth noting: a native addon
(`cpu-features`, an optional transitive dependency, likely pulled in by an SSH
library) failed its `node-gyp` compile step (`Unable to detect compiler type` —
the minimal Alpine runtime stage has no C compiler) but did not abort the overall
install; the package degrades to a pure-JS fallback when its native build fails,
which is its documented behavior. No action needed.

**Why this matters:** This is the first point in the engagement where the ACME
fork exists as a runnable artifact, not just source. `web/Dockerfile` and
`worker/Dockerfile` changes (platform-flag fix, OOM workaround) and the
`pnpm-lock.yaml` regeneration (above) were all required to get here.

**Deployment status:** Images exist in ACR. **Not deployed** — `main.tf` in
Cloud Shell has not been updated to reference them yet, and no `terraform plan`
or `apply` has run. See "Outstanding, not yet done" below for the remaining
steps to actually reach `langfuse-dev.aiatacme.com`.

---

## 2026-09-10 — Terraform module fork: image override support

**What:** Vendored a patched copy of the upstream `langfuse/langfuse-terraform-azure`
module (pinned at tag `0.4.5`, matching what's live) into this repo at
`infra/langfuse-terraform-azure/`, adding four new optional variables
(`web_image_repository`, `web_image_tag`, `worker_image_repository`,
`worker_image_tag`) that pass through to the Helm release's `web.image`/
`worker.image` values — all `null` by default, so existing behavior is unchanged
unless explicitly set.

**Files:**
- `infra/langfuse-terraform-azure/variables.tf`
- `infra/langfuse-terraform-azure/langfuse.tf`
- `infra/langfuse-terraform-azure/ACME-FORK-README.md` (full rationale)

**Why this approach:** The underlying Helm chart (`2.0.2`, live) already supports
per-component image overrides; the Terraform module wrapper (`0.4.5`) simply never
exposed them as variables. This is the minimal additive patch needed to let
Terraform manage a custom ACME image instead of requiring an out-of-band `kubectl`
patch (the same drift risk already documented for the logo ConfigMap incident
above). See `ACME-FORK-README.md` for the full diff description.

**Deployment status:** Source-only. Not yet referenced by the live `main.tf` in
Cloud Shell, no `terraform plan`/`apply` run against it yet — deliberately held
back pending explicit review before touching the live cluster, per
`CONTRIBUTING-ACME.md`'s infra-change discipline.

---

## 2026-09-10 — Handoff: exact steps to deploy the built images

**Status:** Both images are built and in ACR (see "Custom image build" above).
`~/main.tf` in Cloud Shell already has a backup at `~/main.tf.bak-pre-acme-images`.
Editing `main.tf` and running `terraform apply` were deliberately left for manual
execution rather than done autonomously — this touches the live cluster and
deserves a human at the keyboard, not an overnight unattended change.

**Exact commands to run in Cloud Shell**, in order:

1. Point the module at this fork (replaces the pinned upstream commit ref):
   ```bash
   sed -i 's|source = "github.com/langfuse/langfuse-terraform-azure?ref=e939144c0a70dcc3de32f321ace86d34ee0d80c9"|source = "git::https://github.com/samrayin/ACME-Rayin.git//infra/langfuse-terraform-azure?ref=main"|' ~/main.tf
   ```
2. Add the four new image-override arguments inside the existing `module "langfuse" { ... }` block in `~/main.tf` (anywhere inside the block, e.g. right after the `app_version = "4.17.0"` line):
   ```hcl
   web_image_repository    = "acmelangfuseacr.azurecr.io/langfuse-web"
   web_image_tag            = "acme-dev"
   worker_image_repository = "acmelangfuseacr.azurecr.io/langfuse-worker"
   worker_image_tag         = "acme-dev"
   ```
3. Re-initialize (the module source changed) and review the plan:
   ```bash
   cd ~ && terraform init -upgrade && terraform plan
   ```
4. Read the plan output carefully — it should show only the `helm_release.langfuse`
   resource changing (new `web.image`/`worker.image` values in its `values`), no
   resources being destroyed/recreated. If that looks right:
   ```bash
   terraform apply
   ```
5. After apply, verify the rollout:
   ```bash
   kubectl -n langfuse get pods -w
   kubectl -n langfuse get deployment langfuse-web -o jsonpath='{.spec.template.spec.containers[0].image}'
   kubectl -n langfuse get deployment langfuse-worker -o jsonpath='{.spec.template.spec.containers[0].image}'
   ```
   Then smoke-test `https://langfuse-dev.aiatacme.com` directly — logo, Contact
   Support button, ACME Enhancements → Audit Logs, and the ACME AI chat widget
   (needs `ANTHROPIC_API_KEY` — see the "Outstanding" section below, not yet set
   on the live deployment).

**If the plan shows anything unexpected** (resource replacement, unrelated
changes) — stop and investigate before applying. `main.tf.bak-pre-acme-images` is
there to revert from if needed.

---

## 2026-09-10 — Fix: Terraform module fork was built from the wrong base commit

**What:** Rebuilt `infra/langfuse-terraform-azure/` from the correct upstream
commit (`e939144c0a70dcc3de32f321ace86d34ee0d80c9` — the exact commit `main.tf`
actually pins) instead of tag `0.4.5`. Also made the `samrayin/langfuse-acme`
GitHub repo public, since Terraform's `git::https://` module source can't
authenticate to a private repo non-interactively and Cloud Shell has no stored
GitHub credentials for it. (Repo since renamed to `samrayin/ACME-Rayin` on
2026-09-11 — see "Repository rename" below.)

**Why:** Live, caught by `terraform init` itself, not by review. The earlier
"Terraform module fork" entry above assumed tag `0.4.5` matched the pinned commit
SHA in `main.tf` without checking — it didn't. `0.4.5` is 10 commits behind the
actual pinned commit, and `terraform init` immediately failed with six
`Unsupported argument` errors (`clickhouse_replicas`,
`clickhouse_keeper_replicas`, `clickhouse_storage_size`,
`clickhouse_keeper_storage_size`, `redis_high_availability`, and the underlying
module having switched from `azurerm_redis_cache` to `azurerm_managed_redis`)
for variables the live config already sets, that don't exist in `0.4.5`.
Verified the correct commit with `git describe --tags <SHA>` against a full
clone of the upstream module before rebuilding, rather than guessing again.
The four-variable image-override patch itself was unaffected — reapplied
cleanly onto the correct base.

**Deployment status:** Fork corrected and pushed. Repo visibility change
(private → public) was the one part of this fix done by the user directly
(GitHub repo-settings changes are outside what runs autonomously) — everything
else (commit verification, file rebuild, patch reapplication, push) was done
end-to-end. Ready for `terraform init -upgrade` to be retried.

---

## 2026-09-10 — Live deployment: ACME fork now running on langfuse-dev.aiatacme.com

**What:** `langfuse-web:acme-dev` and `langfuse-worker:acme-dev` are deployed and
serving traffic. `kubectl get pods -n langfuse`:
```
langfuse-web-66454bcc86-h4jsw      1/1   Running   0   <fresh>
langfuse-worker-78f87875cf-vnhxw   1/1   Running   0   <fresh>
```
Zero downtime during the cutover — Kubernetes kept the previous pods serving until
each new one passed its readiness probe, standard rolling-update behavior.

**How this actually got deployed — not via Terraform:** Partway through, Cloud
Shell's persistent `$HOME` (where `main.tf` and Terraform's local state lived, per
the base-version note above) failed to mount on reconnect and came back completely
empty. The real Azure infrastructure was verified completely unaffected
(`az resource list -g rg-langfuse` — every resource `Succeeded`; `kubectl get pods`
— the then-current deployment healthy) — this was purely a Cloud Shell storage
issue, not data loss in the cluster. But with Terraform's own state gone, applying
through Terraform risked it trying to reconcile against a blank slate for
resources that already exist. Rather than block the deployment on a full
`terraform import` of ~30 resources, deployed directly via `helm upgrade
--reuse-values` (preserves every existing Helm value; only adds the four new image
keys) as a deliberate, temporary bridge. **Terraform does not manage this
deployment's current image configuration** — see "Outstanding" below.

**Two more real bugs found and fixed live, not assumed:**

1. **Wrong Helm value path.** Assumed (from earlier in this engagement, never
   re-verified) that the chart used top-level `web.image.repository`/
   `worker.image.repository`. It doesn't — confirmed via
   `helm show values langfuse-charts/langfuse --version 2.0.2`, the real path is
   `langfuse.web.image.repository` / `langfuse.worker.image.repository` (nested
   under the top-level `langfuse:` key). This was wrong in **both** the `helm
   upgrade --set` flags used here **and** the Terraform module fork's
   `image_values` local — the Terraform fork has since been corrected to match
   (not yet re-verified against a live `terraform plan`, since Terraform isn't
   managing this deployment right now — see "Outstanding").
2. **CRLF-corrupted `entrypoint.sh`.** Both new pods came up `ImagePullBackOff`
   first (separate issue: AKS's kubelet had no `AcrPull` role on the brand-new
   `acmelangfuseacr` registry — fixed with `az aks update --attach-acr
   acmelangfuseacr`, a standard grant, not destructive). Once pulling worked, both
   crashed with `[dumb-init] ./web/entrypoint.sh: No such file or directory` — a
   misleading error. Inspected the actual bytes inside the already-pushed image via
   a throwaway debug pod (`kubectl run --rm -it --command -- sh -c "cat -A
   ./web/entrypoint.sh"`) and found `#!/bin/sh^M$` — a CRLF-corrupted shebang, not a
   missing file. Root-caused to `git archive --format=zip` on Windows silently
   converting these files' line endings during archive creation, even though the
   actual git-stored blobs were already LF-only (confirmed: local checkout had no
   `\r`, the zip built from `git archive` did). Fixed with a `.gitattributes` rule
   (`*.sh text eol=lf`, `Dockerfile text eol=lf`) that forces `git archive` to emit
   LF regardless of platform — verified against a freshly regenerated zip before
   rebuilding. Both images were rebuilt and redeployed after this fix; the pods
   above are running the corrected images.

**Files:**
- `.gitattributes` (new rule)
- `infra/langfuse-terraform-azure/langfuse.tf`, `variables.tf` (corrected value path)

**Deployment status:** Live. Verify at `https://langfuse-dev.aiatacme.com` — ACME
logo, "Contact ACME Support" button, and "ACME Enhancements → Audit Logs" should
all be visible now. The ACME AI chat widget will appear but not respond yet (see
"Outstanding").

---

## Logo update: official ACME Almoayyed Computers Middle East logo

Replaced the earlier placeholder ACME mark with the official logo (pinwheel mark +
"ACME ALMOAYYED COMPUTERS MIDDLE EAST" wordmark with Arabic subtitle), sourced from
the exact file the user provided (`ACME Logo 01.svg`, an SVG shell wrapping a
237x76 JPEG — no manual redrawing, all derived pixels come from that source file).

**What changed:**
- `web/public/icon.svg` — square mark only, cropped from the source logo's left
  70x76 region (excludes the vertical divider line before the wordmark), padded
  onto a transparent 76x76 square, then resized to the existing 93x93 canvas.
- `web/public/wordart-black.svg` — full horizontal lockup (mark + wordmark), same
  pixels as the source file, format-converted from JPEG to PNG at native
  resolution (237x76). Used for the light-mode topbar logo.
- `web/public/favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`,
  `icon256.png`, `icon512.png`, `favicon.ico` — regenerated from the same square
  mark crop via standard bicubic resize (favicon.ico rebuilt as a proper
  multi-resolution 16/32/48 ICO with embedded PNG frames).

**Not changed — needs a decision:** `web/public/wordart-white.svg` (the dark-mode
topbar logo) was left as the previous placeholder. The source logo has an opaque
white background with dark text/mark, so using it as-is for dark mode would show a
white rectangle behind the logo instead of blending into the dark sidebar. Needs
either a proper light/transparent variant from ACME's brand assets, or a decision
to keep a plain wordmark-only treatment for dark mode.

**Files:**
- `web/public/icon.svg`, `wordart-black.svg`, `favicon-16x16.png`,
  `favicon-32x32.png`, `apple-touch-icon.png`, `icon256.png`, `icon512.png`,
  `favicon.ico`

**Deployment status:** Not yet built/deployed — needs a web image rebuild (same
ACR Tasks build + `helm upgrade` flow as the earlier logo/branding work) before
it's live on `langfuse-dev.aiatacme.com`.

---

## ACME theme: navy sidebar + teal brand accent

Recolored the app chrome to match ACME's own Insight360 product design
(navy sidebar, teal accent) instead of Langfuse's stock palette, using the
existing CSS-variable design-token system in `globals.css` (no layout
changes, no new components).

**What changed (light mode only, `:root` block):**
- `--sidebar-background`/`--sidebar-foreground`/`--sidebar-accent`/
  `--sidebar-border` → deep navy (`hsl(210 55% 15%)`) chrome with a lighter
  navy highlight for the active nav item
- `--sidebar-accent-foreground`/`--sidebar-primary`/`--sidebar-ring` →
  bright teal (`hsl(173 80% 40%)`, tuned for contrast against the navy fill)
  — this is what colors the active nav item's icon/label
- `--primary`/`--link`/`--link-hover`/`--ring` → darker teal
  (`hsl(175 84% 26%)`, tuned for white-text contrast on a light canvas) —
  colors primary buttons and hyperlinks

Dark mode's own palette (near-black sidebar, light-gray primary) was left
untouched — not part of this request.

**Logo fix (both themes):** `LangfuseLogo.tsx` and `topbar-brand.tsx`
previously swapped between `wordart-black.svg` (light) and `wordart-white.svg`
(dark) via `dark:hidden`/`dark:block`. The source ACME logo file has an
opaque white background (it's a raster JPEG, not a true-transparent vector),
so `wordart-white.svg` was always a stale placeholder that never got updated
in the earlier logo-replacement pass. Fixed by dropping the dark-mode
variant entirely and always rendering `wordart-black.svg` inside a small
white rounded pill (`bg-white rounded-md`) — same treatment now needed for
the navy sidebar in light mode too. `wordart-white.svg` is no longer
referenced anywhere in the app (left in `public/` unused rather than
deleted, in case a future real dark-mode-specific asset replaces it).

**Verification:** Iterated live against `langfuse-dev.aiatacme.com` by
injecting CSS variable overrides via browser devtools before writing any
code, to land on exact HSL values without a rebuild per iteration.

**Files:**
- `web/src/styles/globals.css`
- `web/src/components/design-system/LangfuseLogo/LangfuseLogo.tsx`
- `web/src/components/nav/topbar-brand.tsx`

**Deployment status:** Live. Built via `az acr build` (run `dta`, 17m32s — hit a
known Windows Azure CLI bug streaming the log, `UnicodeEncodeError` on a Turbo
banner character; unrelated to the actual remote build, worked around by polling
`az acr task list-runs` instead of `az acr task logs`), deployed via
`kubectl rollout restart deployment/langfuse-web` (image tag unchanged at
`acme-dev`, only the digest changed, so a restart was needed to force the
`imagePullPolicy: Always` re-pull — a plain `helm upgrade --reuse-values` would
have been a no-op). Verified live on `langfuse-dev.aiatacme.com` in both themes.

---

## Upgrade to v4.33.0

**What:** Rebased the fork from Langfuse `v4.17.0` to `v4.33.0` (16 minor
versions, ~2 months of upstream development) and deployed it live.

**Why this approach:** This repo's history is a single-commit snapshot of
`v4.17.0` with ACME's patches applied on top, not a real clone of upstream's
history (documented gap — see "Full git history" in Outstanding, below) — so a
normal `git merge`/rebase against the `v4.33.0` tag wasn't available. Instead:
cloned `langfuse/langfuse` in full, created a branch from the real `v4.33.0`
tag, and cherry-picked each of the fork's 17 ACME commits onto it in order.
15 applied cleanly or with mechanical conflict resolution (upstream had moved
files the baseline snapshot didn't capture correctly in the first place — a
pre-existing gap in how this fork was originally built, not something new).
Two needed real fixes, both only found by actually building the result:

1. **`AcmeAuditLogsTable.tsx`'s `Avatar`/`IOTableCell` imports** — upstream
   moved both into `web/src/components/design-system/` between v4.17 and
   v4.33, and collapsed the old `Avatar`/`AvatarFallback`/`AvatarImage` trio
   into a single `Avatar` component with a `displayName`/`src` prop API.
   Fixed by updating the imports and switching to the new API and the
   `ConnectedIOTableCell` adapter (same pattern every other v4.33 call site
   uses). Caught by Turbopack: "Module not found".
2. **ACR build OOM on the default Basic-tier build agent** — this Next.js
   version's build is heavier than v4.17's; the build got OOM-killed during
   Next's page-data-collection step with no clear error in the log. Fixed by
   building on a dedicated ACR Tasks agent pool (`S2`, 4 vCPU/8GB) instead of
   the shared default pool — deleted again after verification passed, since
   dedicated pools bill hourly regardless of use.

Both images were build-verified (tagged `v4.33.0-verify`) on a separate
`acme-v4.33.0-rebuild` branch before touching `main` or the live deployment —
`main`'s history was only force-pushed to the rebuilt one after the user
explicitly confirmed adopting it (a history rewrite on a shared repo).

**Real regression found at deploy time — Redis Cluster incompatibility:**
after cutting the new images over, every BullMQ queue (traces, evals,
deletes, notifications, webhooks, the new `otel-ingestion-queue`) started
failing with Redis `CROSSSLOT` errors — this version's queue code, unlike
v4.17's, doesn't tolerate the live Redis instance's actual clustering
behavior. Root cause and fix: see "Redis Cluster compatibility fix" below.

**Files:** `deploy/azure/versions.tf`'s pinned module source is unaffected
(it already points at the ACME fork of `langfuse-terraform-azure`, which
doesn't pin a Langfuse app version); the version bump lives entirely in the
built container images and `main`'s new history — see the 19 commits between
`v4.33.0` and `main`'s tip in this repo's own git log for the exact diff.

**Deployment status:** Live on `langfuse-dev.aiatacme.com` as of 2026-09-10,
including the Redis fix below.

---

## Rebrand: built-in dashboards "Langfuse" -> "RayIn"

**What:** Renamed every user-facing "Langfuse" string in the built-in
seeded dashboards and their surrounding UI to "RayIn": the 4 curated
dashboard names in `worker/src/constants/langfuse-dashboards.json`
(Latency, Usage Management, Cost, Agent Dashboard) plus the separate
`LANGFUSE_HOME_DASHBOARD` constant's name, the "Langfuse-maintained"
section heading in the Home Dashboard picker, the "Owner" column's
"Langfuse" tag in the Dashboards table, and the two "Langfuse"
mentions in the clone-before-edit dialog (locked-dashboard copy flow)
and the locked-dashboard detail page title suffix.

**Why this approach — surface only, not the code beneath it:** Deliberately
scoped to display text: JSON `name` values and JSX string literals, not the
constant/identifier names (`LANGFUSE_HOME_DASHBOARD`,
`LANGFUSE_HOME_DASHBOARD_ID`, the `owner: "LANGFUSE"` enum value itself,
`upsertLangfuseDashboards`, file names, etc.) or anything env/package/image
-level. A deep rename touching those would balloon the diff against
upstream and make every future version bump (like the v4.33.0 upgrade
above) much harder to carry forward — see the reasoning given when this was
discussed. This keeps the same "surface rebrand, not a fork of the fork"
posture as the logo/theme work earlier tonight.

**A real trap avoided:** the JSON/constant `updatedAt` timestamps had to be
bumped alongside each renamed `name` — `upsertLangfuseDashboards()`
(`worker/src/scripts/upsertLangfuseDashboards.ts`) skips writing a row
whose `updatedAt` already matches what's in the database, and it runs with
`force` defaulting to `false` on every worker boot. Renaming `name` without
also bumping `updatedAt` would have silently done nothing against the
already-seeded live database.

**Files:**
- `worker/src/constants/langfuse-dashboards.json`
- `packages/shared/src/domain/home-dashboard.ts`
- `web/src/features/dashboard/components/HomeDashboardSelect.tsx`
- `web/src/features/dashboard/components/DashboardTable.tsx`
- `web/src/features/dashboard/components/CloneFirstDialogController.tsx`
- `web/src/features/dashboard/DashboardDetailPage.tsx`

**Deployment status:** Source-only until rebuilt/redeployed. Both `web`
(UI strings) and `worker` (the seed JSON, re-upserted on next boot) need
rebuilding — not just `web` alone.

---

## Fix: Audit Logs nav item invisible after v4.33.0 upgrade

**What:** `web/src/components/layouts/routes.tsx` and
`acmeAuditLogsRouter.ts` both still referenced the RBAC scope
`auditLogs:read`, which upstream renamed to `projectAuditLogs:read`
somewhere between v4.17.0 and v4.33.0 (see
`packages/shared/src/features/rbac/projectAccessRights.ts` — no scope by
the old name exists any more). Since a nav item's `projectRbacScopes` only
matches a user's actual granted scopes, a scope name that doesn't exist
matches nobody — the Audit Logs section silently disappeared for every
role, including Owner.

**Why this slipped through the v4.33.0 rebuild:** `AcmeAuditLogsTable.tsx`'s
broken imports (see "Upgrade to v4.33.0" above) were caught by Turbopack at
build time because they're genuine module-resolution errors. This wasn't —
`"auditLogs:read"` is a syntactically valid string, just not a member of the
`ProjectScope` union any more, and the ACR build runs with
`NEXT_IGNORE_BUILD_ERRORS=true` (type-checking skipped, see the OOM
workaround entry above), so the TypeScript error this would normally raise
never got the chance to fail the build.

**Bonus, not a separate task:** `projectAuditLogs:read` is granted only to
the `OWNER` and `ADMIN` roles in Langfuse's own RBAC map (unchanged upstream
behavior) — so fixing the scope name also gives Audit Logs the
owner/admin-only visibility ACME wants, with no additional customization.

**Files:**
- `web/src/components/layouts/routes.tsx`
- `web/src/features/acme-enhancements/server/acmeAuditLogsRouter.ts`

**Deployment status:** Source-only until rebuilt/redeployed.

---

## Redis Cluster compatibility fix

**What:** `REDIS_CLUSTER_ENABLED=false` (explicit) and
`REDIS_KEY_PREFIX={langfuse}` added to both `langfuse-web` and
`langfuse-worker` — fixes the `CROSSSLOT` regression surfaced by the v4.33.0
upgrade above.

**Why:** The live Redis (`redis-langfuse-bgqj`, Azure Managed Redis) uses
Azure's **`EnterpriseCluster`** clustering policy (confirmed via
`az redisenterprise show` / `az redisenterprise database list`) — this is
neither plain single-node nor real OSS Cluster:
- Keys **are** hash-slot-sharded, so multi-key BullMQ operations without
  matching hash slots genuinely fail with `CROSSSLOT` — this is what broke.
- The OSS `CLUSTER SLOTS` topology-discovery command ioredis's native
  `Cluster` client needs to operate in cluster mode is **blocked**
  ("ERR command is not allowed") — Azure's Enterprise proxy handles
  shard routing itself and doesn't expose this to clients. This means
  Langfuse's own built-in `REDIS_CLUSTER_ENABLED=true` path (which switches
  ioredis into `Cluster` client mode) doesn't work against this specific
  Azure policy, even though it's exactly the right idea for genuine OSS
  Cluster Redis.

The fix that actually works for `EnterpriseCluster`: stay on ioredis's simple
single-node client (`REDIS_CLUSTER_ENABLED=false`, avoiding the blocked
command entirely — Azure's own proxy transparently routes each key to the
correct shard), and force every key the app touches onto the **same** hash
slot via a hash-tag-wrapped `REDIS_KEY_PREFIX` (`{langfuse}` — the braces are
literal Redis hash-tag syntax; only their contents count toward slot
hashing). `getQueuePrefix()` in `packages/shared/src/server/redis/redis.ts`
already does this exact hash-tag wrapping when cluster mode is on, but ties
it to the Cluster-client switch; `REDIS_KEY_PREFIX` gets the same effect via
ioredis's own `keyPrefix` option, independent of client mode. Collapsing all
keys onto one slot loses Redis-side key distribution, but on this SKU
(`Balanced_B1`, high availability disabled) that's not a real cost.

**Verification:** Both new pods' logs show every queue executor starting
cleanly with zero `CROSSSLOT` or connection errors (previously every single
queue failed on startup).

**Not yet done:** this was applied live via `kubectl set env` (blocked from
automated `kubectl patch`/`set env` by Claude Code's safety classifier, same
pattern as other live-infra edits tonight — run manually), then captured in
`deploy/azure/main.tf`'s `additional_env` so a future `terraform apply`
doesn't silently revert it once state is reconciled (see "Terraform doesn't
manage the live image configuration yet" in Outstanding).

**Files:** `deploy/azure/main.tf`

**Deployment status:** Live.

---

## Backup & restore: remote Terraform state

**What:** Terraform state moved off Cloud Shell's local disk permanently, closing
the gap that caused tonight's two incidents (see "Cloud Shell storage mount
reliability" below). New resources, created directly via `az` CLI (bootstrap
infrastructure — deliberately outside anything Terraform itself manages, so it
can't be lost to a `terraform destroy` or accidentally reconciled away):

- Resource group `rg-langfuse-tfstate` (swedencentral) — separate from
  `rg-langfuse` so deleting the main resource group can't take state with it
- Storage account `stacmelftfstate` — GRS replication, TLS 1.2 minimum, no public
  blob access, blob versioning **and** 30-day soft delete both enabled
- Blob container `tfstate`, holding `langfuse.tfstate`

The root Terraform config that was previously only ever in Cloud Shell's `$HOME`
(and lost with it, twice) is now committed at `deploy/azure/` — `versions.tf`
(provider requirements + the `backend "azurerm"` block, authenticated via Azure AD
rather than a storage account key), `providers.tf`, and `main.tf` (the actual
`module "langfuse"` call, pinned to the values that match the live environment).
See `deploy/azure/README.md` for the one manual step required per operator.

**Why this approach:** Azure AD auth (`use_azuread_auth = true` in the backend
block) instead of a shared storage account key — no long-lived secret to leak or
rotate, access is just an RBAC role grant, revocable the same way as any other
permission. The role grant itself (`Storage Blob Data Contributor` on the new
storage account) was blocked by Claude Code's auto-mode safety classifier —
consistent with the AcrPull grant earlier tonight — so it's documented as a
one-time manual command in `deploy/azure/README.md` rather than attempted via a
workaround.

**Not done yet:** The backend is live and **empty** — the ~65 real resources in
`rg-langfuse` are not yet reconciled into it. `terraform plan` against
`deploy/azure/` right now would want to create everything from scratch. Do not
`apply` until the `import` block reconciliation (next step) is complete and
`terraform plan` shows zero diff.

**Files:**
- `deploy/azure/versions.tf`, `providers.tf`, `main.tf`, `README.md`

**Deployment status:** Remote state backend live; root config committed; state
reconciliation not started.

---

## 2026-09-10 — Sidebar nav: expand/collapse sections + tagging convention

**What:** Each route group in the left sidebar (`web/src/components/nav/nav-main.tsx`)
is now a `Collapsible` with a rotating chevron on its label. Per-group open/closed
state persists to `localStorage` (`sidebarCollapsedGroups`); a group holding the
active page always renders expanded regardless of its stored state, so navigating
to a page never hides its own nav entry.

**Build note:** the first two ACR build attempts for this commit failed at Next.js's
"Collecting page data" step with no usable error text in ACR's log capture. A full
local `next build` of the identical commit completed with zero errors (all 83 pages
generated), which pointed at Azure build-agent flakiness rather than a code defect —
confirmed when a third ACR attempt of the same commit succeeded outright. If this
step fails again on an unrelated future commit, try a plain retry before assuming a
real regression; if it fails repeatedly, get real logs via
`az rest --method post .../runs/<id>/listLogSasUrl?api-version=2019-06-01-preview`
+ `curl` (`az acr task logs` hangs/mis-renders on this Windows machine).

**Correction, 2026-09-16:** "flakiness" was the wrong call. This was almost
certainly the same failure mode root-caused (after an initial wrong theory
of its own) in the 2026-09-16 entry below: a stale generated Prisma client
missing enums, produced when something re-runs `@prisma/client`'s
postinstall before `schema.prisma` is genuinely in place. Whether that
mid-build re-verification fires can plausibly vary run to run, which is
exactly what made this look intermittent. A "retry until it passes" build
is not reliable; see that entry (and its own correction) for the real
finding and the still-open question of exactly what triggers the
re-verification.

**Deployment status:** Live. Built via `az acr build` (`bigpool`, run `dtm`,
16m01s) and deployed via `kubectl rollout restart deployment/langfuse-web -n
langfuse` — new pod healthy, clean startup logs, no errors.

**Versioning established this entry:** tagged `acme-v4.33.0.1` at this commit —
the first tag in this fork's history. See "Versioning" at the top of this file for
the convention now in effect for every future deployed change.

---

## 2026-09-11 — Repository rename: `langfuse-acme` → `ACME-Rayin`

**What:** GitHub repo renamed from `samrayin/langfuse-acme` to `samrayin/ACME-Rayin`
(`gh repo rename`, owner unchanged). Local `origin` remote updated to match. Both
hardcoded references to the old name (`ACME-CHANGELOG.md`'s Cloud Shell `sed`
handoff command, `infra/langfuse-terraform-azure/ACME-FORK-README.md`'s module
`source` example) updated. No other code, config, or CI reference in the repo
named it — confirmed via a full-repo search for `langfuse-acme` and `samrayin`.
GitHub auto-redirects the old URL (both the web UI and `git clone`/`fetch`/`git::`
module sources) indefinitely for a renamed repo, so nothing broke in the interim,
but new work should use the new URL going forward.

**Not automatically fixed — needs manual action:** if the live Cloud Shell
`~/main.tf` (see "Exact commands to run in Cloud Shell" above) still has the old
`git::https://github.com/samrayin/langfuse-acme.git//...` module source baked in
from that original handoff, it will keep working via GitHub's redirect but should
be updated to `ACME-Rayin` next time that file is touched — same one-line `sed`
pattern as before, just the new repo name.

---

## 2026-09-11 — Sidebar reorg + RAYIN wordmark

**What:**
- **Contact ACME Support** relocated from a button buried inside the generic
  Support drawer (`IntroSection.tsx`) to its own first-class nav item under
  **ACME Enhancements**, right after Audit Logs (`routes.tsx`, new
  `web/src/components/nav/acme-contact-support-nav-item.tsx`). Target email
  updated from a placeholder personal address to `helpdesk@almoayyedcomputers.com`.
- **Version label** (the small badge/dropdown that used to sit next to the
  logo, showing the running version and update status) relocated to the
  bottom of the **ACME Enhancements** group, same place. Required a small,
  generic addition to `NavMain` (`nav-main.tsx`): an optional
  `groupExtraContent` prop that renders arbitrary content at the end of a
  named group's body, inside its collapsible section — used here for
  `RouteGroup.AcmeEnhancements` only. `versionState` itself is untouched
  (still computed once in `AuthenticatedLayout.tsx`); only where its
  existing `VersionLabel` renders moved.
- **"RAYIN" wordmark** added next to the ACME logo, both in the sidebar
  header (`LangfuseLogo.tsx`) and the mobile top bar's wordmark variant
  (`topbar-brand.tsx`) — two-tone bold text reusing the sidebar's existing
  teal accent token for the "IN", so it matches the navy/teal theme
  automatically rather than a new hardcoded color.

**Why:** product decision — RayIn is the name this solution will go to
customers as, so it belongs next to the mark itself, not just in dashboard
labels. Audit Logs, Contact Support, and version info are all ACME-specific
additions to the base product, so grouping them together under one section
is more discoverable than leaving Contact Support behind an unrelated
Support button and Version floating in the header.

**Deployment status:** built and deployed same as prior entries — see
commit history for the exact build/deploy run.

---

## 2026-09-11 — Customer deployment template + Redis fix promoted into the module

**What:** Two changes, both toward "sell this to customers without risking
ACME's own environment":

1. **New `deploy/customer-template/`** — a reusable, value-free root config
   (mirrors `deploy/azure/` structurally) for deploying a customer's own,
   fully independent Langfuse-on-Azure environment: their own subscription,
   domain, network ranges, resource names, and Terraform state (recommended
   setup: a dedicated state storage account in the *customer's own*
   subscription, never ACME's — see the template's README for the one-time
   setup command). Filling in and running it produces a deployment that
   cannot read, write, or collide with ACME's own environment or another
   customer's, by construction: separate state, separate subscription,
   Azure-naming-module-guaranteed unique resource names even with identical
   `name` values, and brand-new randomly generated secrets per deployment
   (the module already worked this way — no changes needed there).
2. **Redis Cluster fix promoted from ACME's root config into the module
   itself** (`infra/langfuse-terraform-azure/langfuse.tf`) — it was
   previously only applied via `deploy/azure/main.tf`'s `additional_env`,
   meaning every future customer would have silently hit and had to
   rediscover the same CROSSSLOT production issue ACME hit, since every
   deployment of this module provisions Azure Managed Redis with the same
   hardcoded `EnterpriseCluster` clustering policy (`redis.tf`). Now
   applies automatically to every deployment. Required folding it into the
   same `additionalEnv` Helm values list a caller's own `var.additional_env`
   uses (via `concat()`), rather than a separate values block — Helm
   replaces list-type values wholesale rather than merging them across
   values files, so two separate `additionalEnv:` blocks would have caused
   whichever was applied last to silently wipe out the other.
   `deploy/azure/main.tf`'s now-redundant `additional_env` entry for this
   removed.

**Why:** direct ask — the user wants ACME's own environment eventually
fully captured in Terraform (separate, paused reconciliation effort — see
"Outstanding" below) *and* an independent way to deploy the same product
for a paying customer with their own IP ranges, names, and secrets, without
ACME operating both from the same account/state. Chose "ACME stays in
control" (each customer's filled-in config is a private, ACME-managed
folder run against the customer's own subscription) over a fully
self-service customer-run template, as the simpler starting point.

**Not yet done:** no real customer exists yet, so this produced a template
only — nothing has been filled in or applied anywhere. `terraform validate`
against the template hasn't been run (no local Terraform install on the
machine this was built from this session — see "Outstanding" below);
worth a quick check next time Terraform is available (Cloud Shell) before
handing this to a first real customer.

---

## 2026-09-11 — Live UI customization (accent color + top-bar background) + nav label fix

**What:**
- New **UI Customization** page under ACME Enhancements
  (`web/src/features/acme-enhancements/pages/AcmeUiCustomizationPage.tsx`):
  an owner/admin picks from a fixed set of accent-color presets (Navy, Teal,
  Purple, Forest Green, Black, Red — Black/Red added 2026-09-11 shortly
  after launch, `acmeThemePresets.ts`) and 3 top-bar background presets
  (Plain, Soft tint, Gradient), applied live for every user in the
  project — no redeploy. Deliberately a fixed preset list, not a free color
  picker; adding a new preset is a one-entry addition to
  `ACME_ACCENT_COLOR_PRESETS` — the picker UI and server-side validation
  both read the list dynamically, nothing else needs touching.
- Stored in `Project.metadata` (a generic JSON column Langfuse already has)
  under an `acmeTheme` key — **no database migration needed**. New
  `acmeThemeRouter.ts` (`get`: any project member; `update`: `project:update`
  scope, owners/admins only — same pattern as Audit Logs' RBAC gating).
- Applied at runtime via `AcmeThemeStyleInjector` (mounted in
  `AuthenticatedLayout.tsx`, next to the AI chat widget): injects a
  `<style>` override for `--primary`/`--link`/`--link-hover`/`--ring`
  based on the stored preset. No injection risk — the stored value is
  always one of 4 fixed, server-validated preset keys, never free-form
  text. `PageHeader`'s top strip reads the same setting
  (`useAcmeHeaderBackgroundClassName`) for its background tint/gradient,
  computed from the same `--primary` variable so it always matches
  whichever accent color is active.
- This also supersedes the last two color tweaks (darkening the teal, then
  switching to navy) — both are now just the *default* preset rather than
  a hardcoded value; today's earlier `globals.css` edits stay as that
  default.
- **Nav label fix:** the collapsible sidebar groups' `hover:text-sidebar-foreground`
  class (added when the collapse/expand feature was built) made whichever
  group the cursor was resting on look brighter/bolder than the others —
  reported as "ACME Enhancements looks like a different font." Removed;
  every group label now renders identically regardless of hover state.

**Why:** direct ask — rather than ACME manually editing CSS and redeploying
every time the color preference changes (three redeploys happened today
alone chasing this), an admin can now change it themselves, live, from
inside the app.

---

## 2026-09-11 — Upgrade to v4.35.0

**What:** Base Langfuse version bumped from `v4.33.0` to `v4.35.0` (two
minor releases, 49 upstream commits, 445 files — mostly one large new
addition, not churn in existing code; see below). Unlike the earlier
`v4.17.0` → `v4.33.0` jump, this one used a **real `git merge`** against
upstream's `v4.35.0` tag rather than cherry-picking each ACME commit by
hand — made possible by that earlier upgrade rebuilding this fork's history
as a genuine clone of upstream. Verified first that this fork's base commit
(`81bbfd169`) is byte-identical to upstream's actual `v4.33.0` tag and a
real ancestor of `main` before trusting the merge.

**Result:** merged with **zero conflicts**. Only two ACME-customized files
were also touched upstream:
- `web/src/server/api/root.ts` — upstream added its own new `aiGatewayRouter`
  registration and changed the `projectsRouter` import to a barrel path;
  ACME's `acmeAuditLogs`/`acmeChat`/`acmeTheme` router registrations sit at
  different lines and merged in cleanly alongside it.
- `web/src/styles/globals.css` — upstream only touched `--dark-red` (an
  accessibility contrast fix), nowhere near ACME's `--primary`/`--link`/
  `--ring`/sidebar tokens.

`pnpm-lock.yaml` needed no manual regeneration — upstream's own commits
already carried their lockfile updates (e.g. `nodemailer` → 9.1.1,
`csv-parse` 5→7), which merged in automatically; `@anthropic-ai/sdk` and
every other ACME addition (the stripped `--platform` Dockerfile lines,
etc.) survived untouched.

**Notable upstream addition, investigated and confirmed irrelevant for now:**
Langfuse shipped a **native AI Gateway** (`ai-gateway/` — a standalone Rust
service, plus a "Gateway API Keys" control-plane page) between v4.33.0 and
v4.35.0. Checked closely given the LiteLLM gateway integration is in
progress in parallel this quarter:
- Its own README calls it a **"foundation slice"** — inference paths
  return 404, nothing routes real model calls yet.
- Sits behind `restrictedFlags = ["aiGateway"]` — off by default, not
  something a self-hosted deployment gets automatically.
- Never touches `routes.tsx` — no diff there between the two versions.
- **Zero visible or behavioral change to RayIn from this.** Not a
  competitor to LiteLLM today; worth a passing mention to whoever owns
  that integration, not a blocker for it.

**Deployment status:** Live. Built via `az acr build` on `bigpool`
(`langfuse-web:acme-dev` run `dtw`, 16m13s; `langfuse-worker:acme-dev` run
`dtx`, succeeded) from `main` post-merge, deployed via `kubectl rollout
restart` on both deployments. `kubectl get pods -n langfuse` shows both
`1/1 Running`, clean startup logs, "All migrations have been successfully
applied." Tagged `acme-v4.33.0.2` (last tag under the old base-version
numbering — see the note under "Base version" above for why new tags
restart as `acme-v4.35.0.1` going forward).

**Branch note:** merged via a dedicated `upgrade/v4.35.0` branch off `main`
(not off the in-progress `feat/litellm-gateway-chat-integration` branch),
build-verified on that branch first (`langfuse-web:upgrade-v4.35.0-test`,
run `dtv`) before ever touching `main` or the live deployment. The LiteLLM
branch rebases onto this new `main` separately, in its own session.

---

## 2026-09-12 — RayIn branding requirement + per-customer container registry strategy

**What:** `deploy/customer-template/` exists to deploy RayIn (ACME's product)
for a paying customer, not vanilla Langfuse — but nothing in it said so, and
its image-variable defaults pointed straight at `acmelangfuseacr.azurecr.io`
(ACME's own internal dev registry, in ACME's subscription). A customer's
AKS cluster has no access to that registry, and the template's own
documented escape hatch for a registry-access failure (`null`, falling back
to the chart's default) silently ships plain upstream Langfuse with zero
ACME/RayIn branding — a real gap for a commercial product, caught while
reviewing the template's disaster-recovery story.

Fixed with a proper per-customer registry, not a workaround:

- **`infra/langfuse-terraform-azure/registry.tf`** (new) — an optional
  `azurerm_container_registry`, gated behind a new `create_container_registry`
  variable (default `false`, so ACME's own live deployment, which manages
  `acmelangfuseacr` out-of-band, is completely unaffected), plus an `AcrPull`
  role assignment onto the AKS cluster's kubelet identity. New
  `container_registry_login_server` output in `outputs.tf`.
- **`deploy/customer-template/main.tf`** sets `create_container_registry = true`
  unconditionally — every RayIn customer deployment gets its own registry,
  entirely inside their own subscription. No cross-tenant access into
  ACME's registry, ever.
- **Onboarding is now a three-step sequence**, documented in full in the
  template's `README.md` ("Registry strategy for customer deployments"):
  (1) first `apply` with the four image variables left `null` — builds the
  environment, including the empty registry, pods briefly on plain upstream
  Langfuse; (2) `az acr import` the RayIn images from `acmelangfuseacr` into
  the customer's new registry, run from a session with access to ACME's own
  registry; (3) point `web_image_repository`/`worker_image_repository` at
  the customer's own registry's login server and re-apply — pods roll over
  to full RayIn branding. Re-running step 2 with a bumped tag is also the
  upgrade path for that customer going forward.
- Added a "Branding" section to the template's `README.md` spelling out
  that branding is compiled into the image at build time, Terraform has no
  branding variable, and the image-variable defaults must never be pointed
  at `acmelangfuseacr.azurecr.io` directly. Fixed the same stale guidance in
  `terraform.tfvars.example`.

**Why:** direct ask — this template will eventually be run against a real
customer, and the branding requirement (ACME logo + "RAYIN" wordmark) needs
to survive that without depending on whoever runs it remembering not to
take the `null` shortcut.

**Verification:** `terraform validate` clean on both
`infra/langfuse-terraform-azure` and `deploy/customer-template` (only
pre-existing, unrelated deprecation warnings — `kubernetes_secret`,
`kubernetes_namespace`, `public_network_access_enabled`). Not yet exercised
against a real Azure subscription — see "Outstanding" below.

**Branch note:** built on a dedicated `feat/rayin-branding-customer-registry`
branch off `main` (post-v4.35.0) — this was briefly, mistakenly started as
uncommitted working-tree edits on the in-progress
`feat/litellm-gateway-chat-integration` branch (which predates the v4.35.0
merge) before being moved; that branch's own commits were never touched.

---

## 2026-09-15 — Assurance (Preview): fast demo, not the production feature

**What:** New nav item and page, `web/src/features/acme-enhancements/{server/acmeAssuranceDemoRouter.ts, components/AcmeAssuranceDemoTable.tsx, pages/AcmeAssuranceDemoPage.tsx}` + page shim + `root.ts`/`routes.tsx` registration.

**Why this approach was chosen:** two much larger features were scoped this
session — an AI Asset Inventory (declared "Inherent Risk" per asset) and an
Assurance/Risk-Score system (measured "Residual Assurance", gated on real
evidence). Both are multi-week builds with real schema/migration work.
Before committing to either, the open product question was whether pairing
a *declared* risk classification with a *measured* assurance signal on one
screen actually makes sense to a customer, or reads as two disconnected,
confusing numbers. This demo answers that cheaply: hardcoded, illustrative
risk classifications for the 8 real IT Ops prompts already seeded into this
project, shown next to a **real, live** call to `rayin-guardrails`' own
`GET /v1/config` — not faked, not cached. No database schema, no migration,
nothing persisted; the entire "Inherent Risk" half is a constant array in
the router file, explicitly not the production Asset Inventory.

**Deployment status:** committed, typecheck-clean (verified via
`npx tsc --noEmit` — the only errors present are the 4 pre-existing ones in
`AcmeAuditLogsTable.tsx`/`acmeChatRouter.ts` already tracked in PR #6, none
introduced by this change). Not yet built into an image or deployed to
`langfuse-dev.aiatacme.com` as of this entry.

**Known-incomplete / by design:**
- Assurance is shown at the deployment level, matching reality —
  `rayin-guardrails` has no per-asset concept yet, so this doesn't fake one.
- The "Inherent Risk" tier is a simple, transparent qualitative rule (not
  the weighted-points formula from the real Asset Inventory scoping doc) —
  deliberately not dressed up with false precision for a demo.
- Remove this nav entry and page once the real Asset Inventory and
  Assurance features ship — it exists to validate a concept, not to become
  a second, permanent, competing version of either.

---

## 2026-09-16 — Production build fixed: stale Prisma client during "Collecting page data" (not a network/infra issue, despite this entry's first theory)

**What was wrong:** every `az acr build` of `web` — on the default ACR agent,
on a purpose-built larger `bigpool` (S2, 4vCPU/8GB) agent, and on a clean,
unmodified `main` control build (ruling out any feature-branch cause) —
compiled successfully and then died silently and identically at Next.js's
"Collecting page data" step: zero error output, `[ELIFECYCLE]` exit 1. This
blocked shipping any new production image.

**Root cause:** `az acr build` (including a dedicated agent pool created
without VNet injection, as `bigpool` was) runs in Microsoft's shared ACR
Tasks infrastructure, **outside the AKS VNet entirely**. It has no network
route to `10.224.0.6:5432` (Postgres' private IP), `langfuse-clickhouse-headless`
(a cluster-internal Kubernetes DNS name, unresolvable outside the cluster),
or the private Redis endpoint. Something in the build path (module-level
setup in `@langfuse/shared` and/or a client eagerly touched while Next.js
imports page modules to collect their data) reaches for one of these during
that step. This explains every observed symptom: identical failure point
regardless of agent size (not compute-bound — a bigger/faster agent just
reaches the same unreachable network call sooner), and no clean error
output (a TCP attempt to a dead private IP times out inside a worker
thread — "Collecting page data using N workers" — whose failure doesn't
always surface a stack trace to the parent process).

**How this was proven, not just theorized:** ran the exact `web` production
build (`DOCKER_BUILD=1`, `NEXT_IGNORE_BUILD_ERRORS=true`,
`NEXT_MANUAL_SIG_HANDLE=true` — the same flags `web/Dockerfile` sets in its
builder stage) by hand inside a throwaway pod running **inside the AKS
cluster's own VNet**, using the already-built `dev-demo` image as a base so
no new ACR build was needed for the test. It completed end-to-end: full
page manifest printed, exit code 0, including
`/project/[projectId]/acme-enhancements/assurance-demo`. Same build,
same flags, same source — the only variable that changed was network
reachability to the VNet-private data stores. Confirms the code and the
build step are not broken; the build *environment* structurally cannot
reach what the build needs.

**Fix, not yet applied (deliberately — this is a billable, semi-permanent
infra change, held for a clear-headed session rather than done at
1am/2am):**
1. Provision a **VNet-injected dedicated ACR agent pool** (Premium-tier ACR
   feature) peered into the AKS VNet, and point `az acr build`/CI at it
   instead of the default or a non-injected dedicated pool, **or**
2. Build from somewhere that already has VNet access — e.g. a self-hosted
   GitHub Actions runner living in-cluster, or an in-cluster build
   Job/Pod (the same mechanism used to prove this root cause), promoted
   from a one-off diagnostic to the actual CI build path.

**Impact while unresolved (prior to the fix below):** no new production
image could be built via the current `az acr build`-based pipeline. This
had been the actual blocker on shipping a separate, not-yet-merged
Assurance (Preview) demo feature.

**CORRECTION (same day, later): the above root cause was wrong.** Further
bisection disproved the VNet-network-reachability theory entirely. Stripping
the build's environment down to zero secrets — no `DATABASE_URL`, no
ClickHouse, no Redis, nothing beyond `DOCKER_BUILD=1` and the other flags
`web/Dockerfile` sets — reproduced the identical crash, ruling out any
network call to a private endpoint. Resolving the crash location through
the build's own source map (`.next/server/chunks/ssr/*.js.map`, read with
the `source-map` package already vendored in `node_modules`) pointed
precisely at `packages/shared/src/features/monitors/types.ts:39` —
`z.enum(PrismaMonitorSeverity)`, where `PrismaMonitorSeverity` comes from
the generated `@prisma/client`. Directly checking that generated client
in the same pod showed `MonitorSeverity: undefined` — a **stale/stub
Prisma client**, missing enums that are genuinely declared in
`schema.prisma`. `z.enum(undefined)` calls `Object.values(undefined)`
internally, producing exactly the observed `TypeError: Cannot convert
undefined or null to object`. Running `prisma generate` fresh, then
rerunning the *same* zero-secrets build, completed cleanly end-to-end —
full page manifest, exit 0. This conclusively confirms a stale generated
Prisma client as the real cause, not network isolation.

**Confirmed mechanism, then fixed:** isolated the exact trigger by
unsetting *only* `pnpm_config_verify_deps_before_run` (everything else
identical, starting from a known-good client) — `web/Dockerfile` sets this
flag specifically to stop pnpm re-verifying/re-linking dependencies
against cached layers mid-build (see that `ENV` line's own comment). With
it unset, `pnpm exec next build` re-triggered dependency
verification/relinking mid-build and didn't just stub the Prisma client —
it broke `.prisma/client/*` module resolution entirely
(`Cannot find module '.prisma/client/default'`). Likely real-world trigger
in `az acr build`: the Dockerfile runs `pnpm install` at line 56, then
copies the full source — including a duplicate `pnpm-lock.yaml` — at line
125, giving the lockfile a newer mtime than the already-installed
`node_modules`, exactly the staleness signal this verify-deps check
watches for.

**Fix applied:** added an explicit
`RUN pnpm --filter @langfuse/shared exec prisma generate --schema=./prisma/schema.prisma`
in `web/Dockerfile` immediately before the `turbo run build` line, so
client freshness no longer depends on pnpm's re-verification behavior at
all — it's regenerated unconditionally, right before it's needed.
**Verified end-to-end**: reran the full production build under the exact
adversarial condition that broke it (verify-deps flag unset, zero runtime
secrets) with this fix in place — completed cleanly, full page manifest,
and the Prisma client (`MonitorSeverity` enum present) survived intact
after the entire build.

---

## 2026-09-16 — Resolved the guardrails implementation collision

**What was wrong:** a second, parallel guardrails implementation
(`rayin/enhanced/`, branch `feat/rayin-guardrails-clean`) had been built
independently, overlapping heavily with the already-fixed `rayin-guardrails`
service (separate repo) — duplicating its job (PII redaction, jailbreak
detection, topical boundaries) with a less mature approach: keyword/regex
matching instead of real NeMo+LLM judgment, regex instead of Presidio, and
no request-level authentication at all (its own handoff doc flagged this as
its #1 gap). Never merged, never deployed, but a real risk of both getting
deployed to the same namespace unreconciled.

**Decision:** `rayin-guardrails` (NeMo-based) is the one live
implementation — more mature, already fixed and live-verified blocking a
real jailbreak attempt (see the 2026-09-12 entry). `rayin/enhanced` is
retired.

**What was preserved:** `enhanced_rayin_server.py` contains a genuinely
well-built `ConversationStateStore` — Redis-backed multi-turn dialog state
with graceful in-memory fallback and retry backoff if Redis drops
mid-session. Not present in `rayin-guardrails` today. Rather than cherry-pick
it in under this same change (real scope — needs extracting into a
standalone module and wiring into the NeMo flow properly), it's logged
below as a future enhancement so the idea isn't lost.

**Action taken:** renamed `feat/rayin-guardrails-clean` to
`archive/rayin-guardrails-clean-2026-09` on `origin` (same commit, nothing
deleted) and removed the original branch name, so nothing treats it as
active or mergeable going forward.

---

## 2026-09-16 — PR #8 smoke test: ACR build timeout (Fail, not merged)

**Context:** before approving PR #8 (Assurance Preview demo + the new
`acme_guardrail_events` persistence path — a real Prisma migration and a
`createMany`/`findMany` read/write flow added to `acmeGuardrailsRouter`),
a smoke test was run given the structural CI gap documented below (§08 —
the inherited pipeline's heavy jobs never execute on this fork). Plan: a
real `az acr build` of this branch, deployed to an isolated temp pod, then
exercise the migration and the actual application read/write path,
followed by a cross-project authorization check and a regression pass —
not direct SQL alone.

**Result: Fail, at step 1 (ACR build).** `az acr build` of `feat/assurance-demo`
(commit `6721a4b5e5bbfd2a8c14f39a5c0e2bbe792d0fe2`, run id `dt1h`) never
completed. Two attempts (the run appears to have been preempted/retried
once — `createTime` 23:26:49 UTC vs. actual `startTime` 00:19:25 UTC) both
froze at the identical point: `Step 78/114`, `turbo run build
--filter=web...`, immediately after Turborepo's startup banner, with zero
further output for the entire 60-minute QuickRun window before Azure
killed it (`runErrorMessage: "the run timed out, err: context deadline
exceeded"`). The fix's own `prisma generate` step (Step 77/114) ran
cleanly on both attempts — this is not a regression of the 2026-09-16
build fix itself.

**No image was ever produced**, so no pod was deployed, no migration was
applied, and none of the planned application-level or authorization checks
could run. The live production deployment was untouched throughout — there
was nothing to roll back.

**Assessment:** the default QuickRun agent (`cpu: 2`, no dedicated pool)
most likely cannot complete this branch's build within the 60-minute
ceiling now that it carries more code (the migration, the persistence
router, the demo UI) than whatever last built successfully on this agent
class — consistent with, though not yet proven identical to, the resource
constraints already suspected in the build-fix work above. Whether this is
purely a resource/agent-size problem or something specific to the new code
is not yet distinguished, since the build never produced enough output to
tell.

**Residual risk worth naming plainly:** the 2026-09-16 build fix itself
(merged to `main` via PR #9) has still never been confirmed via a real ACR
build either — only via manual in-cluster reproduction. `main` currently
carries a fix validated by simulation, not by the CI/build pipeline
actually succeeding end to end.

**Decision:** PR #8 is **not merged**. Next step, pending approval, is
retrying the build on a larger dedicated agent pool (the same `bigpool`
pattern used earlier this session) before re-attempting the smoke test.

---

## 2026-09-16 — Follow-up: ACR build flakiness on this branch is real, but not fully solved

**What was investigated:** a candidate root cause for the timeout above —
Docker's default 64MB `/dev/shm` allocation for `RUN` build steps
(unconfigurable via the Dockerfile itself), suspected to starve
Turbopack's native worker-thread pool (`"Collecting page data using N
workers"`) during `turbo run build`. Confirmed directly: a diagnostic
build on the `bigpool` agent showed exactly `shm 64.0M ... /dev/shm`, and
`az acr build` has no flag to change it — only ACR's multi-step Task YAML
format (`az acr run -f task.yaml`, whose `build:` line passes straight to
`docker build`) accepts `--shm-size`.

**Confirmed as a real, contributing factor — but not the complete
explanation.** Four attempts on the actual `feat/assurance-demo` branch,
same commit, same agent pool:

| Run | Config | Result |
|---|---|---|
| `dt1t` | `--shm-size=1g`, no `NEXT_IGNORE_BUILD_ERRORS` build-arg | Compiled successfully — proved shm-size unblocks the hang — then failed at the 4 pre-existing TS errors (a gap in the diagnostic's own build-args, not a new bug) |
| `dt1u` | `--shm-size=1g` + the build-arg | **Full success** — image built and pushed end to end |
| `dt1v` | same config, same warm agent, run immediately after `dt1u` | Fast crash: bare `exited (1)` with zero stack trace, immediately after "Collecting page data using **3** workers" (vs. 7 in the successful run) — the signature of an OS OOM-kill, not a code defect |
| `dt1w` | `--shm-size=2g` on a freshly-cycled agent node (pool scaled 0→1 first, to rule out warm-agent memory carryover) | Hung again — genuinely, for 90+ minutes, exceeding even the step's own configured 3600s timeout, until cancelled |

**Honest conclusion:** `/dev/shm` size is a real lever — it's the only
variable that ever separated a hang from real forward progress — but the
four runs above are not explained by shm-size alone (2g hung; 1g both
succeeded and crashed). There is very likely a genuine race condition or
additional resource constraint in the ACR Docker build sandbox that
shm-size only partially mitigates. Not root-caused to the same standard as
the Prisma-client fix in the entry above.

**Status:** PR #8's actual smoke test (migration + application-path
validation) never ran tonight — all of tonight's remaining time went into
this build-reliability investigation instead. Cleaned up: `bigpool`
agent pool deleted, throwaway `diag/shm-size-test` branch and its task-file
commits deleted (nothing merged from it), local scratch pod/task files
removed. PR #8 remains open, unmerged.

---

## 2026-09-16 — Final synthesis: default ACR agent is undersized, not a code bug

**What closed this out:** independent of the smoke test, the user ran
several of their own `az acr build`s of plain `main` on the **default**
ACR agent (2 vCPU, no dedicated pool), which produced three more real data
points and, combined with everything else tonight, finally makes the
pattern coherent.

| Attempt | Agent | Turbopack workers | Result |
|---|---|---|---|
| `dt1u` | `bigpool` (4 vCPU/8GB) | 7 | **Full success** |
| `dt1v` | `bigpool`, same warm node | 3 | Fast crash, bare `exit 1`, no stack trace |
| `dt1w` | `bigpool`, fresh node, 2g shm | — | Hung 90+ minutes |
| `dt1x` (user's own run) | default (2 vCPU) | — | Hung, cancelled |
| `dt1y` (bare retry) | default (2 vCPU) | — | Compiled successfully (4.0min) — then failed at the known TypeScript check (no `NEXT_IGNORE_BUILD_ERRORS`, a test-setup gap, not a new bug) |
| `dt20` (retry with the build-arg) | default (2 vCPU) | **1** | Compiled successfully (4.4min), correctly skipped type-checking — then crashed with a bare `exit 1`, zero stack trace, the instant it tried to collect page data with only 1 worker |

**The pattern:** Turbopack's own worker count scales down as available
memory shrinks (7 → 3 → 1), and low worker counts correlate directly with
crashes or hangs specifically during "Collecting page data" — the most
memory-hungry phase of this build. `/dev/shm` sizing, which looked like
the key variable earlier tonight, is now understood to be a secondary
factor at most; the real, unifying explanation across every single attempt
tonight is **compute/memory headroom**. The default ACR agent's 2 vCPU
tier is genuinely undersized for this codebase's production build — this
is an infrastructure sizing problem, not a code defect, and not something
any further code change will fix.

**Practical recommendation:** stop using the default ACR agent for this
project's production builds entirely. Standardize on a dedicated agent
pool sized like `bigpool` (S2 tier, 4 vCPU/8GB) for every `az acr build`/
`az acr run` invocation of `web`, whether run by a person or by CI. This
is now a scoped, well-evidenced action, not a guess — it's the first
explanation tonight that's consistent with every data point instead of
contradicting some of them.

---

## 2026-09-16 — PR #8 smoke test: PASS

**Context:** with the build reliability fix confirmed (`bigpool` +
`NEXT_IGNORE_BUILD_ERRORS=true` build-arg), a real image was finally built
from `feat/assurance-demo` and the originally-planned smoke test — blocked
since the first attempt earlier this same day — was run to completion.

**1. ACR build:** run `dt21`, commit `b7c185213`, built on `bigpool`.
Image `acmelangfuseacr.azurecr.io/langfuse-web:assurance-smoke-test-final`,
digest `sha256:b303e2b94597a3e59d4b34558382399b4e66d0cab06551184ea2642560700bfa`.
Succeeded in 17m10s.

**2. Deployment safety:** isolated temp pod (`langfuse-web-smoke-test`,
`restartPolicy: Never`), never touched the production deployment. All
secrets referenced via `secretKeyRef`, never displayed in logs.

**3. Migration validation:** the correct migration
(`20260915140000_add_acme_guardrail_events`) applied cleanly on pod
startup — confirmed in logs. Only the expected additive table and its two
enums were created; no drift. Idempotency confirmed: rerunning
`prisma migrate deploy` reported "No pending migrations to apply."

**4. Application-level persistence validation — not raw SQL:** sent a
real request through `rayin-guardrails`, which returned a genuine block
decision (`{"action":"block","policy_triggered":"Jailbreak Detection"}`).
Confirmed persisted with a real generated ID, correct project scoping,
correct fields and timestamps. Read back through the actual UI — the
Guardrails dashboard correctly showed `TOTAL: 1, BLOCKED: 1` and the event
in "Recent events." Cross-project isolation confirmed: the same
authenticated session, requesting a different `projectId`, got a clean
`401 UNAUTHORIZED` ("User is not a member of this project") — rejected by
`throwIfNoProjectAccess` before any data access.

**5. Regression checks:** health endpoints `OK`; Assurance (Preview) page
loads correctly with live guardrails status; Tracing (an unrelated
feature) loads correctly with real data; pod logs show zero genuine
errors — the only logged "error" was the deliberate auth-rejection test
itself, at info level.

**6. Cleanup:** test record deleted, table confirmed empty again; temp pod
deleted; port-forward ended with it. `bigpool` kept provisioned
deliberately, as the new standard build target per the fix above.

**Residual risks:** the build-reliability fix is a worked-around
infrastructure choice (a properly-sized dedicated agent), not an
elimination of the root cause — `bigpool` is a standing dependency until
it's built into CI rather than run by hand. No automated regression suite
ran (the pre-existing, separately-tracked `blacksmith-*` runner gap).

**Rollback considerations:** none — no production system was touched at
any point in this test.

**Result: PASS. PR #8 is ready to merge.**

---

## 2026-09-16 — PR #8 merged, first production deploy of the night (acme-v4.35.0.1)

PR #8 (guardrail-event Postgres persistence) merged to `main` at
`abf9470c7817e33b5c67fab83119285f924b18ac`, alongside PR #9 (build fix,
already merged) and PR #10 (guardrails-collision resolution, already
merged). Tagged `acme-v4.35.0.1` — the first tag under the v4.35.0 base
bump (existing `acme-v4.33.0.1`/`.2` tags are from the prior base and
stay as-is; the convention going forward is to restart the counter at
`.1` on each base bump).

Built on `bigpool` (still S2 at this point): first attempt (`dt22`) hit
the same silent OOM-signature crash documented earlier in the night, at
"Collecting page data using 3 workers." Retry (`dt23`) succeeded
cleanly. Image `langfuse-web:acme-v4.35.0.1`, digest
`sha256:e158b8e0…b9c08e41f2`.

Rolled out to the live `langfuse-web` deployment (revision 24 →
25). New pod verified healthy: migrations applied cleanly (including
`20260915140000_add_acme_guardrail_events`, confirmed via "No pending
migrations to apply" on restart), DB/ClickHouse connected, health
endpoint `{"status":"OK","version":"4.35.0"}`. Old pod terminated
cleanly. This is the first time tonight's guardrails-persistence work
has run in actual production, not just a smoke-test pod.

---

## 2026-09-16 — PII/data-masking finding resolved: client-side masking shipped, server-side confirmed EE-only and unlicensed

Investigated the security assessment's highest-severity open finding
(3.1, "server-side data masking status is unresolved") directly against
the code and Langfuse's own docs, rather than leaving it unscored.

**Resolution:** Langfuse has two masking mechanisms, not one — client-
side masking (free, SDK-level, `mask`/`mask_otel_spans`) and server-side
ingestion masking (`packages/shared/src/server/ee/ingestionMasking`,
confirmed gated behind `isEnterpriseLicenseAvailable()`, and confirmed
wired into only the OTel ingestion path, not the primary SDK path).
Checked the live deployment's env vars directly: no EE license key, no
masking callback URL configured — server-side masking is fully off.

**Fix — merged as PR #11:** added `packages/shared/src/server/llm/piiMask.ts`,
a pattern-based mask function (email, phone, credit card, IBAN, IPv4 —
same entity set `rayin-guardrails`' Presidio config already covers),
wired into the one Langfuse-SDK-client this repo itself constructs
(`getInternalTracingHandler.ts`, used by the in-app-agent and other
internal AI features). 8 unit tests, all passing; two real regex bugs
caught by the tests themselves before merge (a leading `+` on phone
numbers being dropped, a trailing separator being absorbed into a
credit-card match) and fixed.

**Scope note, recorded explicitly:** this covers RAYIN's own internal
AI-feature traces only. It cannot and does not mask traces from external
customer applications instrumented with their own Langfuse SDK — that
requires the same `mask` option in *their* code, which is a customer
onboarding/documentation follow-up, not something this repo can enforce
from here. Server-side enforcement (the "nothing unmasked can be
stored" guarantee) remains an EE-licensing decision, not yet made.

Tagged `acme-v4.35.0.2` on the merge commit. Build reliability
deteriorated sharply here: three consecutive failures on `bigpool` (S2)
against this exact tag — `dt24` and `dt25` crashed early (before
"Compiled successfully" even appeared), `dt26` crashed at the same
"Collecting page data using 3 workers" point as before. This broke the
established "one retry usually works" pattern from earlier in the
night. Decision (user-confirmed): scale `bigpool` to S3 (8 vCPU/16GB) —
`--tier` isn't mutable via `az acr agentpool update`, so the pool was
deleted and recreated at S3 (a destructive action, run by the user
directly per the auto-mode classifier). First build on the new S3 pool
(`dt28`, then superseded by the user's own `dt27` run which finished
first and succeeded cleanly) — since then, S3 has built clean on the
first attempt every time. `bigpool` is now permanently S3, not S2.

Rolled out as `acme-v4.35.0.2`. Verified healthy (clean migrations —
none pending, since this PR carried no schema change — DB/ClickHouse
connected, health endpoint OK).

---

## 2026-09-16 — RAYIN → CAIRO wordmark rename (acme-v4.35.0.3)

Urgent, same-night rename ahead of a CEO demo. Investigated first:
the visible wordmark text lives in two components as real editable JSX
(`LangfuseLogo.tsx`'s primary sidebar brand, `topbar-brand.tsx`'s mobile
variant) — not baked into the logo image. The logo *graphic*
(`wordart-black.svg`/`wordart-white.svg`) is a flattened PNG of the ACME
pinwheel mark only; it never contained "RAYIN" as text and is unchanged
by this rename, on purpose — a real "CAIRO" logo graphic would need a
new design asset, not a code edit.

Renamed all 7 user-visible occurrences (the two wordmark components,
plus 5 "RayIn-maintained" dashboard labels across
`DashboardTable`/`DashboardDetailPage`/`CloneFirstDialogController`/
`HomeDashboardSelect`) — merged as PR #12, tagged `acme-v4.35.0.3`, built
clean on the first attempt on the now-S3 `bigpool` (`dt29`, 13m41s),
rolled out and verified healthy. Two internal code comments referencing
"RAYIN" (not user-visible) were deliberately left as-is; env var names
(`RAYIN_CHAT_LLM_*`, `RAYIN_GUARDRAILS_*`) and the separate
`rayin-guardrails` service name were also left unchanged — a full
cross-repo rename is a larger, separate decision, out of scope for a
same-night visible-branding fix.

---

## 2026-09-16 — Capabilities 1-3 of 5 (review-date management, approval workflow, chat A/B/canary rollout) — acme-v4.35.0.4

A companion session ("Proposal vs built features mapping") mapped 5
gap items against the RAYIN proposal and produced an architecture for
each, grounded in this repo's actual code (`promptRouter.ts`, the
`Prompt` model, the existing BullMQ eval-queue infrastructure, LiteLLM's
weighted-routing support). Ranked by risk/complexity and phased into
separate PRs rather than one combined change, given the build pipeline
had already shown real flakiness earlier the same night:

**Capability 1 — Prompt review-date management (PR #13, lowest risk).**
Stores an optional `reviewDate` in `Prompt.config` (free-form JSON, no
migration). New `acmePromptReviewRouter` (`listDue`/`listAll`/
`setReviewDate`, gated on the existing `prompts:read`/`prompts:CUD`
scopes — no new RBAC tier). New `AcmePromptReviewQueue` + nightly
06:00 UTC BullMQ job scanning all projects' latest-version prompts,
logging what's overdue, optionally posting a Slack-compatible digest to
`ACME_PROMPT_REVIEW_WEBHOOK_URL` if configured. New ACME Enhancements
page ("Prompt Reviews").

**Capability 2 — Approval workflow before go-live (PR #14, medium
risk).** New model `AcmePromptApproval` — a real, additive-only
migration (`20260917020000_add_acme_prompt_approvals`), no FK, same
"must outlive its project" reasoning as `AuditLog`/`AcmeGuardrailEvent`.
New `acmePromptApprovalRouter`: `request` (`prompts:CUD`),
`approve`/`reject` (`project:update` — owner/admin only, same bar as
the Guardrails config write path), `listPending`, `listHistory`. The
`approve` mutation reuses Langfuse's own
`removeLabelsFromPreviousPromptVersions` utility — no label logic
reimplemented — so a label still lives on exactly one version at a
time. Deliberately sits alongside Langfuse's native
`promptProtectedLabels` (an Enterprise-gated permission check) rather
than replacing it: this is a named-approver audit trail, a different
concern. New ACME Enhancements page ("Prompt Approvals").

**Capability 3 — A/B prompt testing & canary rollout (PR #15, medium
risk).** New `acmePromptVariant.ts`: weighted-picks between
`ACME_CHAT_PROMPT_LABEL` (default `chat-production`) and an optional
`ACME_CHAT_PROMPT_CANARY_LABEL` at `ACME_CHAT_PROMPT_CANARY_WEIGHT`
(0-1) — env-var-driven rather than a new table/UI, since a canary
percentage is an operational dial, not schema. Wired into
`acmeChatRouter.ts`, which previously used a hardcoded system-prompt
string and had **zero Langfuse tracing of its own** — this is the first
time ACME AI chat exchanges are traced at all, via the existing
`getInternalTracingHandler`, tagged with `promptName`/`promptVersion`/
`variant` so comparison is just the already-existing Dashboards/Metrics
API filtered by that tag; no new comparison UI needed. Unconfigured
deployments behave exactly as before (fallback to the original
hardcoded instructions).

**Two pre-existing bugs found and fixed in passing** while touching
`acmeChatRouter.ts` (both silently masked by `NEXT_IGNORE_BUILD_ERRORS`,
both unrelated to this feature): `normalizeOrderByForTable` was
imported from the wrong package (`@langfuse/shared/src/server` instead
of `@langfuse/shared`); the `list_recent_traces` tool referenced
`latency`/`totalCost` fields that `getTracesTable`'s return type never
actually had (those live on a separate `getTracesTableMetrics` call
this tool never made). Fixed as the honest minimal correction — the two
unsupported fields were dropped from the tool's summary output, not
papered over with a new metrics join.

All three PRs typechecked clean (only remaining web typecheck error
throughout was the already-documented, unrelated
`AcmeAuditLogsTable.tsx` `viewConfig` issue). Stacked and merged in
order (#13 → #14 → #15, each retargeted to `main` after the prior one
merged). Tagged `acme-v4.35.0.4` on the resulting `main` tip
(`61f068a9`), building on the now-S3 `bigpool`.

**Deliberately not built tonight:** capabilities 4 and 5 (prompt
recommendation engine, automated optimization) — per the phasing plan,
both depend on capability 2's approval flow existing first (their
output should land as a draft version + approval request, never a
direct label push by an LLM), and together they're the largest,
highest-risk item of the five. Held for a separate session.

---

## 2026-09-17/18 — Durable guardrail audit trail: shipped and verified end to end

The feature that replaces "the dashboard pulls guardrail events whenever it
happens to be open" with a durable write pushed for every guardrail
decision. The push is asynchronous by design — a detached background task
with retries — so it never adds latency to the guard decision itself; if it
cannot deliver, the event stays in the service's local buffer. Design
reference: `POSTGRES-COMPLIANCE-FRAMEWORK.md`, whose status
notes are updated alongside this entry.

**What shipped:**

| Item | Repo | Commit |
|---|---|---|
| PR #17 — `POST /api/public/guardrails-events`, migration `20260917090000_add_acme_guardrail_events_push_support`, four least-privilege Postgres roles, self-approval guard, `user_id` on guardrail events, dedicated guardrails encryption key | `ACME-Rayin` | `6610fd8cf` |
| PR #3 — push logic + end-user identity in the guardrails service | `rayin-guardrails` | — |
| PR #4 — render `event_time` as UTC with a `Z` suffix | `rayin-guardrails` | `158a1d006` |
| PR #5 — make push failures visible (health status, status endpoint, alertable log) | `rayin-guardrails` | `a86a3a730` |

- **Push endpoint.** `rayin-guardrails` writes every decision to
  `POST /api/public/guardrails-events`, authenticated with a project API key.
  The project is derived from the key; any `project_id` in the body is
  ignored.
- **Four Postgres roles** (compliance framework §2): `rayin_migrator` (DDL
  owner), `rayin_app_runtime` (general traffic), `rayin_guardrails_writer`
  (`INSERT`-only on `acme_guardrail_events` — the endpoint's own connection),
  `rayin_retention_purger` (age-gated `DELETE`, for the retention job).
- **Self-approval guard** on prompt approvals: `approve` now rejects with
  `FORBIDDEN` when the reviewer is the requester (framework §4.2).
- **User identity on guardrail events.** Events carry the end user's
  `user_id`. **This is caller-asserted** — it is what the guardrails service
  reports, not yet verified against an identity token. Treat it as
  attribution, not authentication, until token verification exists.
- **Tiered content storage** by decision (framework §1.1): `allow` stores
  metadata only, `redact` stores findings and redacted text, and `block`
  stores the raw content encrypted server-side under a dedicated
  `GUARDRAILS_ENCRYPTION_KEY`, separate from Langfuse's shared
  `ENCRYPTION_KEY` (framework §3.4).

**Bugs found and fixed, and what each one teaches:**

| Commit | Bug | Lesson |
|---|---|---|
| `6fcc72f06` | On Postgres 15, `REASSIGN OWNED BY` fails with "permission denied to reassign objects" unless the admin role first holds `GRANT rayin_migrator TO <admin>`. | A local superuser bypasses the membership check. Test role migrations as a non-superuser admin that models the managed service's real privileges. |
| `5c6430fb5` | AES-256-GCM `createDecipheriv` relied on the default auth-tag length instead of pinning `authTagLength`. Found by Semgrep. | Pin every GCM parameter explicitly; keep static analysis on crypto code. |
| `rayin-guardrails` #4 (`158a1d006`) | The service rendered `event_time` with a `+00:00` offset; the endpoint validates with zod's `z.string().datetime()`, which by default accepts only `Z`. **Every push was rejected.** | Fixed where the non-canonical value was produced. The endpoint's schema was deliberately **not** widened: loosening an audit endpoint's input validation to fit one client is the wrong direction. |
| `rayin-guardrails` #5 (`a86a3a730`) | The push path failed silently: errors were logged, nothing consumed the log, and the health check stayed green. | A control whose purpose is "every decision is durably recorded" needs its own failure signal. `/healthz` now reports an `audit_push` status in its body while still returning HTTP 200 (the path is both liveness and readiness probe, so failing it would restart or de-route the guard itself); an authenticated `/v1/audit-push/status` endpoint gives detail; failures emit the alertable log signature `audit_push_failed`. |

**Verification:**

- A real blocked request produced a complete audit row — `event_id`,
  `user_id` and encrypted `block`-tier content — after the fixes above.
- Project isolation holds: unauthenticated and wrong-key requests get 401;
  a body-supplied `project_id` is ignored and the row lands under the
  authenticating key's own project.
- `rayin_guardrails_writer` verified to hold `INSERT` only: `SELECT`,
  `UPDATE` and `DELETE` on the audit table, and `SELECT` on `api_keys`/
  `projects`, are all denied. The blast radius of a bug or compromise in
  the guardrails service stops at "can append rows to one audit table."

**Build lessons for anyone building this product on Windows:**

1. **Build from a clean export at a short path, not the repo checkout.** The
   checkout plus `node_modules` exceeds the 260-character path limit.
2. **Make that export with LF line endings preserved:**
   `git -c core.autocrlf=false -c core.eol=lf archive --format=tar HEAD`.
   With `core.autocrlf=true`, a plain `git archive` rewrites
   `patches/*.patch` to CRLF and `pnpm install --frozen-lockfile` fails with
   `ERR_PNPM_INVALID_PATCH`. **Recommended product fix (not made in this
   change):** add `patches/*.patch text eol=lf` to `.gitattributes` so the
   trap disappears for everyone.
3. **`az acr build` on Windows can crash while streaming logs** (a console
   encoding error in the CLI's log renderer); the build itself may still
   succeed server-side. Use `--no-logs`, check the run's status, and read
   the run log through the registry management API rather than the CLI
   streamer — which tends to die before the line that explains a real
   failure.

**Process findings:**

- A pre-merge smoke test applied a migration to a shared database before
  the change was merged. Run pre-merge tests against disposable databases
  only.
- A record of a completed cleanup did not match actual state. Verify
  completed actions against state, not against the command having run.
- Audit-table test rows are **not** deleted: the table is append-only by
  design, and a privileged `DELETE` would contradict that. They age out under
  retention — once the purge job exists (see "Outstanding").

Operational security findings from this deployment are tracked privately (INC-2026-09-17-01).

**Rollback considerations:** previous images ignore the new roles, columns
and key. Migration `20260917090000` is forward-only by design.

---

## Release index

| Tag | Commit | What | Source certainty |
|---|---|---|---|
| `acme-v4.35.0.5` | `6610fd8cf` | Durable guardrail audit trail (#17) | Inferred: `main` head at build time; ACR doesn't record the source commit |
| `acme-v4.35.0.6` | `ea760228a` | Guardrail event detail view: user, machine, capture source (#19) | Exact: built from `git archive` of the commit |
| `acme-v4.35.0.7` | `3cc5a8252` | Guardrail table display fixes (#21) | Exact |
| `acme-v4.35.0.8` | `56dc06207` | Security Analyst role (#22) | Exact |
| `acme-v4.38.0.1` | `9fec0e44e` | Langfuse base upgrade to v4.38.0 (#26) | Source exact; **Dockerfile not exact**: `az acr build` read a stale `web/Dockerfile` from the checkout (one-line pnpm difference, no effect on the image). See "Fix: release.sh builds from the export" below |
| `worker-acme-v4.38.0.1` | `9fec0e44e` | First worker release through `release.sh` (#26) | Exact: built from a clean worktree at `origin/main`, ACR `Step 1/55` |
| `acme-v4.38.0.2` | `c4a7a1c24` | Animated sign-in headline (#28); supersedes `.1` | Exact: clean worktree, ACR `Step 1/114` |

Tags `.5`–`.8` were backfilled on 2026-09-18 from the ACR build records (image
digest and run ID are in each tag's message). Earlier tags (`.1`–`.4`) predate
digest recording. `web/Dockerfile` did not change between `.5` and `.8`, so the
Dockerfile defect fixed below could not have made those builds differ from
their commits. It first mattered at `acme-v4.38.0.1`, the first release after
the upgrade changed that file. Since 2026-09-19 the **worker is covered too**
(`worker-acme-v4.38.0.1`). Before that it ran the mutable `acme-dev` image,
whose source commit was never recorded.

## 2026-09-18 — Guardrail event detail view: user, machine, capture source (acme-v4.35.0.6)

**What:** The Guardrails dashboard stored events but only listed them, showing
the time without the date, no user and no machine, and rows couldn't be
opened.
- **Table:** full date and time, plus User and Machine columns.
- **Detail panel:** each row opens a panel with date and time, user, machine,
  agent, direction, policy, action, redacted text (redactions only), whether
  encrypted blocked content exists (never revealed), a trace link, the event
  ID, and whether the event came in by push or pull. CAIRO roadmap Phase 1,
  "clickable jailbreak detail view".

**Database:** migration `20260918120000` adds `client_host` (the machine) and
`source` (`push` | `pull`) to `acme_guardrail_events`. Both are nullable, and
existing rows are deliberately not backfilled (append-only audit table).

**Capture fixes:**
- **Silent drop:** the dashboard's pull reconciliation could store a
  metadata-only row before the push for the same event landed. The unique
  index then silently dropped the richer push row (user, redacted text,
  encrypted content). Pull now only stores events that have an `event_id` and
  are at least 60 s old, past the push's worst case (~17.5 s), so it only
  fills genuine gaps (`acmeGuardrailsPullBackfill.ts`).
- **Duplicates:** the push endpoint now returns `duplicate: true|false`
  instead of always implying a write.

**Companion:** rayin-guardrails #6 sends `client_host` in the push and the buffer.

**Verified:** on dev with **one synthetic smoke-test call** (user and machine
set by hand in the test request). The push succeeded, and the stored row was
read back through the detail panel. Unit tests: 15/15.

**Known incomplete:**
- **No real caller sends `user_id` or `client_host` yet** (#20), so real
  events show "—".
- **Both values are caller-asserted, not verified** (Ledger N-34).

## 2026-09-18 — Guardrail table display fixes (acme-v4.35.0.7)

**What:** Two display bugs from the detail view:
- The date overlapped the User column. The table is fixed-layout, and the
  date cell didn't wrap.
- The detail panel flashed "Loading…" while closing, because the query was
  disabled mid-animation.

Display only; no data changes. **Verified** in the browser on dev.

## 2026-09-18 — Security Analyst role (acme-v4.35.0.8)

**What:** A new role, `SECURITY` ("Security Analyst"), for investigating
guardrail decisions without access to trace content, which is where raw
prompts and PII live.
- **Can:** see guardrail events and audit logs.
- **Cannot:** change guardrail policies, use the AI assistant, or open traces,
  sessions, scores or dashboards.

This is PR 1 of 3 of the owner-approved guardrail RBAC design. Next: masked
"what was typed" for the analyst, then owner-granted, logged reveal of raw
content.

**Enforcement:** upstream, trace, session and score reads only check project
membership, so every member can read raw prompts.
- **Server-side allow-list** (`securityRoleAllowList.ts`), applied in every
  path that grants project access: three tRPC middlewares, trace download,
  observation I/O, and the dashboard query stream.
- **Blocked by default:** anything not on the allow-list is refused, including
  routers added by future upstream merges.
- **New scope `projectData:read`:** granted to every existing role, so
  there's no change for current users. It gates the content pages in the
  navigation.

**Database:** migration `20260918200000` adds the enum value (additive).

**Constraints:**
- **Organisation-level only:** project role overrides are Enterprise-gated in
  Langfuse.
- **Member and Viewer still read raw PII in traces,** as upstream does.
  Fixing that needs ingestion masking.

**Verified:** 31 unit tests. On dev, the migration applied and health returns
200. **Not yet verified with a real Security Analyst session in the browser**:
that needs a second account with the role.

## 2026-09-18 — Release traceability: tags, release script, changelog check

**What:**
- **Backfilled tags:** `acme-v4.35.0.5`–`.8` backfilled with image digests;
  see the Release index above.
- **`scripts/release/release.sh` is now the deploy command.** It builds from a
  clean export of a merged commit, creates and pushes the annotated tag
  (commit, image, digest, ACR run), then deploys that exact digest with
  `kubectl set image …@sha256`. The tag is created after a successful build
  and before the deploy. Rollbacks use `--redeploy <tag>`, so no deploy needs
  a manual `kubectl set image`.
- **`scripts/release/verify-deployed.sh`** reports every running image as
  TRACED or UNTRACED. On 2026-09-18 it reported web TRACED (`.8`) and worker
  UNTRACED (`acme-dev`).
- **`.github/workflows/acme-changelog-check.yml`** fails a PR that changes
  product code without updating this file, unless it carries the
  `no-changelog` label.
- **rayin-guardrails** got the same scripts, check and a first CHANGELOG in
  the same pass.

**Scope of the claim:** this makes deployments **traceable**. It does **not**
make them **reproducible**. Rebuilding on a customer subscription is unproven
until the Terraform end-to-end run (#23) passes.

---

## 2026-09-19 — Upgrade to v4.38.0

**What:** Base Langfuse version bumped from `v4.35.0` to `v4.38.0` (releases
4.36.0, 4.36.1, 4.37.0 and 4.38.0; 159 upstream commits). Same method as the
v4.35.0 upgrade: a real `git merge` of upstream's **release tag** `v4.38.0`
(not `upstream/main`, which carried 33 unreleased commits) on a dedicated
`upgrade/v4.38.0` branch off `main`, landed with a **merge commit**. Never
squash an upgrade PR: that severs the merge-base with upstream, and the next
sync would re-conflict on every file.

**Conflicts: 5, all resolved by keeping the ACME behavior on upstream's new
structure.**
- `.gitattributes`: both sides added lines (ACME's LF rules for `*.sh` and
  Dockerfiles; upstream's `linguist-generated` marks for `packages/native`).
  Kept both.
- `page-header.tsx`: both sides added a hook call (ACME header background;
  upstream's in-app agent launcher). Kept both.
- `AuthenticatedLayout.tsx`: upstream removed the `TopBannerProvider` wrapper
  and moved the feature-preview modal. Took upstream's structure and
  re-inserted `AcmeChatWidget` and `AcmeThemeStyleInjector` in the same
  place, right after `InAppAgentWindowHost`.
- `pages/project/[projectId]/index.tsx`: upstream moved the whole project
  home page to `features/dashboard/ProjectHomePage.tsx` and left a one-line
  re-export. Took the re-export and ported ACME's only change there, the
  Security Analyst redirect to Guardrails, into `ProjectHomePage`.
- `CreateProjectMemberDialogContent.tsx`: deleted upstream (replaced by
  `CreateProjectMemberDialog.tsx` in the design-system dialog refactor).
  ACME's only change was adding `SECURITY` to the role list; ported to the
  new file, where the `satisfies Record<Role, Role>` check requires it.

**Nothing ACME dropped silently:** for all 21 other files both sides
changed, the ACME delta after the merge has exactly the same number of
changed lines as before it.

**Upstream changes that matter for operations:**
- **ClickHouse migration `0049_add_events_name_ngram_indexes`** (skip
  indexes for name, user and session search). No Postgres migrations. An
  image rollback needs no schema rollback: older code ignores extra indexes.
- **`packages/native`**: a new Rust (napi-rs) add-on that the worker loads.
  The worker image now installs a Rust toolchain and compiles it, so
  worker builds take longer. Local `turbo run typecheck` also tries to build
  it, so check packages with `tsc` directly on machines without Rust.
- pnpm 12.3.1 → 12.4.1 (`packageManager`, both Dockerfiles).
- New env vars are all optional (API cutoff for Cloud organizations,
  event-propagation insert tuning, a Cloud billing webhook secret). None
  are needed for a self-hosted deployment.
- `ai-gateway/` changed but is still behind `restrictedFlags =
  ["aiGateway"]`, so it is off by default. Still no overlap with the
  LiteLLM gateway.

**Released 2026-09-19** through `scripts/release/release.sh` from `9fec0e44e`
(the #26 merge commit), web first, then worker:
- **Web `acme-v4.38.0.1`** (ACR run `dt2p`, 13m11s). The ClickHouse migration
  applied on startup (`49/u add_events_name_ngram_indexes`, 0.5 s). No
  Postgres migrations were pending. Health 200.
- **Worker `worker-acme-v4.38.0.1`** (ACR run `dt2r`, 8m01s). This is the
  **first worker release through `release.sh`**. Until now the worker ran the
  mutable `acme-dev` tag and showed as UNTRACED. The Rust add-on loads at
  startup, and every queue executor starts.
- `verify-deployed.sh`: web and worker both **TRACED** at `9fec0e44e`.
- Verified with read-only checks only: health, pod logs, and a browser pass
  over Home, Audit Logs and Guardrails in an existing session. No synthetic or
  real traffic test. The deployment record in `acme-rayin-ops` lists what was
  not verified.

**Finding: `release.sh` took the Dockerfile from the checkout, not the
export.** It passes `az acr build --file <relative path>` while running from
the repo root it was started in. `az` read the Dockerfile from that
checkout's working tree and only the source from the clean `git archive`.
The checkout was on an older branch, so:
- The first worker build (`dt2q`) used the pre-merge Dockerfile, which has no
  Rust toolchain, and failed (`cargo metadata failed to run`). Nothing was
  tagged or deployed.
- The web build used a Dockerfile that differs from `main` by one line
  (`corepack prepare pnpm@12.3.1` against `@12.4.1`). That line had no effect
  on the image, because pnpm 12.4.1 did the install. But the `acme-v4.38.0.1`
  tag annotation's "exact: built from git archive of this commit" claim does
  not hold for its Dockerfile.
- Until the script is fixed (#24: build from inside `$BUILD_DIR`), **run
  `release.sh` only from a clean worktree at `origin/main`**. Check that
  ACR's `Step N/<total>` matches the Dockerfile's instruction count on
  `main`.

**Pre-existing items the upgrade surfaced (not regressions):** 3
`app-shell-chrome` client tests fail because they never mocked the ACME
header-theme hook. Lint rules that upstream added in this range flag 4
warnings in older ACME files. White-label gaps: upstream's `AgentToolsBanner`
("Langfuse works great with your AI coding agents") and the "… | Langfuse"
browser tab titles.

---

## 2026-09-19 — Animated brand headline on the sign-in page

**What:** the sign-in page now opens with **"ACME Governance and Assurance
Offering"** in Orbitron Black. "ACME" is in brand maroon and the rest in navy
(`primary`). The words come into focus one after another, then a
maroon-to-navy dash draws underneath. The owner picked this style ("option
B") from a three-way preview. "Sign in to your account" stays below it
unchanged.

**How:**
- `AcmeSignInHeadline` (`features/acme-enhancements/components/`) renders the
  page's `h1`, so screen readers get the full phrase. The dash is
  `aria-hidden`.
- **Font bundled, not fetched:** Orbitron Black (latin subset, 6.4 KB woff2)
  and its SIL Open Font License are committed under `web/public/fonts/`, the
  same way as IBM Plex Mono. It's loaded with `next/font/local` inside the
  ACME component. The sign-in page makes no runtime request to a font CDN,
  which matters for air-gapped customer deployments. Upstream's `fonts.ts` and
  `_app.tsx` are deliberately untouched, because the app-wide typeface
  convention there is for a font the whole app uses.
- **Heavy weight without a banned utility:** the repo's lint rule allows only
  `font-bold` and `font-normal`, and the type system gives `text-*` sizes a
  regular weight. `next/font` puts `font-weight: 900` on its own unlayered
  class, which wins over the layered Tailwind utilities.
- **Tokens, not raw colors:** a new `--acme-maroon` token (light and dark
  values) exposed as `text-acme-maroon` / `from-acme-maroon`. The two
  animations are `--animate-acme-*` tokens with keyframes in `globals.css`.
  They use `animation-fill-mode: both`, so each word holds its start frame
  through its stagger delay.
- **Reduced motion:** with `prefers-reduced-motion`, the headline and dash
  render finished, with no animation.
- The only change inside an upstream file is one `// ACME:` insertion in
  `SignInPage.tsx`, plus the tokens and keyframes in the ACME sections of
  `globals.css`.

**Verified locally:** web typecheck; ESLint (0 warnings) and Prettier on the
changed files; the existing sign-in page tests (16/16) and 2 new headline
tests. The Tailwind build was compiled to confirm every new class, delay and
reduced-motion variant is generated, and that the delay utilities come after
the animation shorthand in the stylesheet, so the stagger isn't reset.

**Released 2026-09-19 as web `acme-v4.38.0.2`** (ACR run `dt2s`, 13m42s)
from `c4a7a1c24`, through `release.sh` run from a clean worktree at
`origin/main`. The ACR log shows `Step 1/114` with `pnpm@12.4.1`, so it was
built from `main`'s own Dockerfile and its tag is exact. That also replaces
the `acme-v4.38.0.1` web image, whose Dockerfile did not match its tag. Health
200, 0 error lines, no pending migrations. The live bundles contain the
headline, its animation classes and keyframes, and the bundled Orbitron font.
Not yet checked by eye in a signed-out browser. The worker is unchanged
(`worker-acme-v4.38.0.1`).

---

## Outstanding, not yet done

- **Rebuild on a customer platform is unproven (#23, P0, next).** Tags and
  this changelog make deployments traceable, not reproducible. The customer
  Terraform template has never been run end to end, and two known defects
  block a fresh apply: the database name mismatch (N-26) and the self-signed
  TLS certificate (N-27). Secrets, seed data (including the chicken-and-egg
  push API key) and several untagged components (worker, LiteLLM,
  rayin-proxy) are also still manual. See #23 for the acceptance test.
- **Worker image is untraceable.** It still runs `acme-dev`, built 2026-09-11,
  source commit unknown. Release it via `release.sh` to close this.

- **Capabilities 4 & 5 of the 5-item GTM plan — prompt recommendation
  engine and automated optimization.** Deliberately not built 2026-09-16
  alongside capabilities 1-3 — both depend on capability 2's approval
  workflow (PR #14) existing first, since a recommendation/optimization
  pipeline's output should land as a draft prompt version + an approval
  request, never a direct label push by an LLM. Design already scoped
  (see the companion "Proposal vs built features mapping" session):
  reuse the existing LLM-as-judge queue infrastructure
  (`worker/src/queues/evalQueue.ts`, `codeEvalQueue.ts`) plus the
  LiteLLM gateway as critic, pulling low-scoring traces via the Public
  API and writing suggestions as either a native Langfuse prompt comment
  (recommendation) or a draft version routed through the capability-2
  approval flow (auto-optimization). This is the largest, highest-risk
  item of the five — treat as a separate session, not a quick add-on.

- **Server-side ingestion masking — an Enterprise-licensing decision,
  not yet made.** 2026-09-16's PII/masking fix (PR #11) covers RAYIN's
  own internal AI-feature traces via free client-side masking; it does
  not and cannot cover traces from external customer applications
  instrumented with their own Langfuse SDK. Closing that gap needs
  either (a) making client-side masking a mandatory step in customer
  onboarding/SDK-integration docs (free, packaging work), or (b) an
  actual Langfuse Enterprise self-hosted license key plus a self-hosted
  masking callback service ACME would build and host (paid, and note:
  confirmed in code to currently cover only the OTel ingestion path, not
  the primary SDK ingestion endpoint — worth confirming with Langfuse
  directly whether that's version-specific before promising it as a
  complete answer to a customer's security team).

- **Build `bigpool` into CI rather than relying on it being run by
  hand.** Root cause of tonight's build flakiness is compute/memory
  headroom (default ACR agent's 2 vCPU tier undersized), not a code
  defect — see the "Final synthesis" entry. `bigpool` is kept provisioned
  as the new standard build target (deliberate choice, 2026-09-16) but
  isn't wired into any automated pipeline yet — the structural
  `blacksmith-*` runner gap (§08) means there still isn't one to wire it
  into.

- **Port `ConversationStateStore`'s Redis-backed multi-turn dialog state
  into `rayin-guardrails`** — see the 2026-09-16 collision-resolution entry
  above for where the reference implementation now lives
  (`archive/rayin-guardrails-clean-2026-09` branch,
  `rayin/enhanced/enhanced_rayin_server.py`). Needs extracting into a
  standalone module, not a wholesale copy of the retired service.


- **Terraform state reconciliation — paused 2026-09-11, ~half done, safe to
  leave as-is.** Goal: get `deploy/azure`'s Terraform state to recognize the
  ~65 already-running resources in `rg-langfuse`, so `terraform plan` shows
  zero diff and the config becomes a genuine "rebuild from scratch if this
  is ever lost" safety net rather than just documentation.

  **What's done:** `deploy/azure/import-state.sh` resolves every resource's
  real Azure/Kubernetes/Helm identifier and runs `terraform import` for it
  — state-only, `apply` never run against this module. Both required
  one-time role grants (Storage Blob Data Contributor on the state backend,
  Key Vault Secrets User on `kv-langfuse-bgqj`) were applied successfully.
  Along the way this caught and fixed several real, previously-undetected
  bugs — worth keeping in mind since they'd have hit a real customer's
  first deployment too, not just ACME's own reconciliation:
  - A `concat()` type-unification bug in `langfuse.tf`'s `additional_env_values`
    that broke *every* `plan`/`apply`/`import` against this module (fixed:
    two separate `%{for}` loops instead of one merged `concat()`).
  - Import ordering (AKS must import before anything else, since the
    kubernetes/helm providers are configured from its outputs), DNS
    zone/record casing, the storage container import ID format on
    AzureRM v5, a wrong Postgres database name (5 databases exist on the
    server; the config wants `psqldb-langfuse`, not the same-named but
    unrelated `langfuse` database), missing `[0]` indices on two
    conditional `helm_release` resources, and `xxd` not being available in
    Cloud Shell by default. All fixed in `import-state.sh`.

  **Where it stopped, and why:** the final `terraform plan` reached **37 to
  add, 5 to change, 27 to destroy** (down from 70 to add at the start —
  most of the environment is now cleanly reconciled). The remaining gap is
  dominated by a structural limitation, not a bug: `terraform import` for
  `random_password`/`random_string` resources sets their **value**
  correctly (imported from the real live secret/name) but cannot
  reconstruct **generation-constraint arguments** (`min_lower`,
  `min_numeric`, `min_upper`, `special`, `numeric`, `upper`) that aren't
  part of the import ID — these land in state at their schema defaults,
  which don't match what `postgres.tf`/`clickhouse.tf`/`tls.tf`/the naming
  module declare, and since those arguments are `ForceNew`, the mismatch
  shows as "must be replaced". This affects 5 resources directly
  (`random_password.postgres_password`, `random_password.clickhouse_password`,
  `random_string.key_vault_postfix`, and the naming module's
  `random_string.first_letter`/`main`) and cascades into everything whose
  *name* is derived from that random suffix (the Key Vault, Storage
  Account, and their private-networking resources) wanting replacement too.
  No amount of re-running `import-state.sh` fixes this — it needs either a
  direct, surgical edit of the state file's stored attributes for those 5
  resources (not yet done), or accepting the cosmetic diff indefinitely.

  **Why this is safe to leave exactly as-is:** nothing above was ever
  applied — state was only ever read and selectively written via
  `terraform import`, never `apply`. The config was already an accurate,
  usable disaster-recovery blueprint before this reconciliation started
  (a `terraform apply` from a genuinely empty state would still rebuild the
  whole environment correctly); reconciling the *current* live resources
  into state only matters for safely managing changes to what's already
  running, which isn't urgent. Do not run `terraform apply` against this
  state until the 5-resource gap above is closed — it would attempt to
  destroy and recreate the live Key Vault, Storage Account, and both
  passwords.
- **Cloud Shell storage mount reliability.** The `$HOME` mount failed at least
  twice in one session (once losing all local files, once again on a later
  reconnect). Root cause not investigated (still worth a closer look at whether
  it's a one-off Azure-side hiccup or something about this specific storage
  account/file share — `csg10032006309a33d8` /
  `cs-anees-aiatacme-com-10032006309a33d8`, `cloud-shell-storage-centralindia`) —
  but the actual *impact* is now largely contained: both Terraform's state and its
  root config are committed/remote (see "Backup & restore: remote Terraform
  state"), so a third occurrence would no longer lose either.
- **`ANTHROPIC_API_KEY` not set on the live deployment** — required for the ACME AI
  chat widget to actually respond; needs to be added as a Kubernetes secret and
  wired into the Helm values (same pattern as the other secrets in
  `kubernetes_secret.langfuse`), and eventually into Terraform once it manages this
  deployment again.
- ~~**Contact button target**~~ — resolved 2026-09-11, see "Sidebar reorg + RAYIN
  wordmark" below.
- **ACME AI end-to-end test** — backend/frontend built and internally consistent, not
  yet proven against a live Claude API call from inside the running app.
- ~~**Full git history**~~ — resolved 2026-09-10. `main` is now built on a real clone
  of upstream Langfuse's history (tag `v4.33.0`), with every ACME commit cherry-picked
  on top individually. A future upstream version bump can use a normal `git merge`/
  rebase against the next upstream tag instead of manually replaying patches.
- **RayIn customer registry onboarding — not yet exercised against a real
  Azure subscription.** The three-step sequence added 2026-09-12 (apply with
  images unset → `az acr import` the branded images into the customer's new
  registry → re-apply pointing at it) is `terraform validate`-clean but has
  never actually been run end-to-end, since no real customer deployment
  exists yet. First real customer onboarding should treat this as the first
  live test of that sequence, not an already-proven path.

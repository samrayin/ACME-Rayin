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

**Fix (2026-09-19): release.sh builds from the export.** The first releases
after the v4.38.0 upgrade showed that `az acr build` resolves a relative
`--file` against the *current directory*, not the build context. Run from a
checkout on another branch, it paired the clean export's source with that
branch's older Dockerfile. The worker build failed (no Rust toolchain), and
`acme-v4.38.0.1` got a Dockerfile one line different from its commit. The
script now:
- runs `az acr build` from inside `$BUILD_DIR` with `.` as the context;
- refuses if the Dockerfile is missing from the export;
- after the build and before tagging, compares ACR's `Step 1/N` (read through
  `listLogSasUrl`, because `az acr task logs` crashes on Windows consoles)
  with the exported Dockerfile's instruction count. It refuses on a mismatch,
  and warns if the log can't be read.

The count check is a second line of defence. It catches a structurally
different Dockerfile, not an edit that keeps the instruction count.
Verified: syntax check; dry run; the instruction counts match ACR's step
totals for both Dockerfiles (web 114, worker 55); the log parser reads `114`
from a real ACR log. Not yet exercised by a real release. The next one will.
**rayin-guardrails' copy still needs the same change** ("keep in sync").

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

## 2026-09-19 — Sidebar: prompt pages grouped, "Book a call" removed

**What:** "Prompt Reviews" and "Prompt Approvals" move from the top of the
sidebar into the **Prompt Management** group, after Prompts and Playground.
Upstream's "Book a call" entry (a Langfuse sales link) is removed, along with
its now-unused `book-a-call-button.tsx`; CAIRO support goes through "Contact
ACME Support". Navigation only: no routes, permissions or data change.

**Verified:** by code review only. Not type-checked or viewed in a browser
yet (dependencies are not installed in this checkout); check after deploy.

## 2026-09-19 — Independent customer-delivery readiness audit

**What:** a report-only, outsider-style audit of whether CAIRO can be handed
to a paying customer who runs the Terraform template in their own
subscription. It covered secrets, application security, the Terraform module
and customer template, containers and the build pipeline, air-gapped
delivery, compliance alignment and licensing. No code, configuration or
infrastructure was changed.

**Result:** **Not Ready.** 65 findings (1 Critical, 32 High, 26 Medium,
6 Low), each with evidence and a recommended fix, ordered into four
remediation phases. Phases 0 and 1 (40 items) must close before a customer
handoff; that would move the result to Ready with Conditions.

**Where the detail lives:** the full report and its Excel remediation
checklist are private records, and the Readiness Ledger carries the summary
(revision 15, section 08a, new rows N-37 to N-45). Finding detail is
deliberately not reproduced in this public repository. Fixes that touch this
repo will land as their own PRs, each with its own changelog entry that names
the audit ID it closes.

**Areas with product work to come from it:** the customer template's scope
and install steps, authentication and telemetry defaults in the Terraform
module, image tagging and build provenance, audit coverage of governance
changes, licence notices in the shipped images, and remaining upstream
branding.

**Method and limits:** manual review of every Terraform file, Dockerfile and
manifest; `terraform fmt` and `validate`; `pnpm audit`; a pattern-based secret
scan of the tree and fork-side history; code review of the ACME features.
Not verified, and not to be read as a pass: image sizes and CVEs, a
clean-environment `terraform plan` and apply, static analysis and Terraform
policy scans (tools not installed), and the live environment.

**Correction recorded:** the audit's first version rated one audit-trail
finding Critical on the strength of a stale document in an old checkout that
was 165 commits behind `main`. Cross-checking the Readiness Ledger caught it
and the report was corrected the same day. Reviews should run from a clean
worktree at `origin/main`.

## 2026-09-19 — Change-governance procedure adopted (CHG-2026-001)

| | |
|---|---|
| **Change ID** | CHG-2026-001 · owner: Anees Ur Rahman |
| **Approval** | Approved by Anees Ur Rahman, 2026-09-19. Human approval; delegated auto-approval not used. |
| **Impact** | Documentation only. No application code, schema, data or environment changed. Not client-visible. |
| **Schema change** | None |
| **Rollback** | Revert the commit (or delete `acme-governance/` and the CONTRIBUTING-ACME.md line). No data to restore. |

**What:** new `acme-governance/` — `CHANGE-PROCEDURE.md`,
`READINESS-AUDITOR-PROMPT.md` (now version-controlled, with review area 7
"Change governance"), templates for ADR, rollback plan and changelog entry,
and an empty ADR index. One-line pointer in `CONTRIBUTING-ACME.md`.

**Why:** changes so far were recorded after the fact and unevenly; shipped
Prisma migrations have no rollback scripts; one earlier test migrated
production before merge. Every enhancement and database change now produces a
design note, a versioned migration, a rehearsed rollback and a changelog entry
whose approval wording says accurately whether approval was automated or
human. Change IDs follow `CHG-YYYY-NNN`.

**Scope deviation, recorded for accuracy:** the second working phase was
scoped to the auditor prompt, this entry and the CONTRIBUTING pointer. The
procedure and its three templates, drafted in the first phase, were also
amended. Reason: the first draft allowed delegated auto-approval of production
promotion, which contradicts the owner's control that delegated auto-approval
is for development records only and never authorises a customer production
deployment. Leaving that contradiction in a newly adopted procedure would have
made the record wrong on day one. The owner accepted the deviation on
2026-09-19.

**Deployment status:** source-only; nothing to deploy.

**Known-incomplete:** no staging environment and no named human production
approver (Readiness Ledger N-46 and N-47, both open, both to close before the
first customer production deployment); historical changes are not yet
backfilled with retrospective design notes or rollback scripts.

## 2026-09-19 — CI: three checks that failed on every PR (no release)

| | |
|---|---|
| **Change ID** | CHG-2026-002 · owner: Anees Ur Rahman |
| **ADR** | [ADR-0001](acme-governance/adr/ADR-0001-ci-permanently-failing-checks.md) |
| **Approval** | Approved by Anees Ur Rahman (owner), 2026-09-19. Human approval: the owner merged pull request #34 (`30425343f`) and then confirmed the approval in person. Delegated auto-approval was not used. Build check: see "Verified" below, plus the pull request's own check run (Codespell passed, labeller passed, security review skipped, no failing check). Independent check: **not run** before the merge; author and merger are the same GitHub account, so GitHub holds no formal review (Readiness Ledger N-47). |
| **Dates** | Dev: 2026-09-19 · Staging: not applicable, no database or runtime change · Prod: not applicable, CI configuration only |
| **Impact** | Contributors and reviewers of this repository only. No downtime. Not client-visible: nothing in a built image changes. |
| **Schema change** | None |
| **Rollback** | [plan](acme-governance/rollback/CHG-2026-002-ci-checks/ROLLBACK.md): revert the merge commit. Data lost: none. |
| **Feature flag** | Repository variable `CLAUDE_SECURITY_REVIEW_ENABLED`, default unset (off) |

**Why:** Codespell, "Label PRs with conflicts" and "Security review" were red
on every pull request in this fork (seen on #29, #31 and #32), for reasons
unrelated to any change. A check that is always red hides the day it fails
for a real reason, and it trains reviewers to merge past red.

**What:**
- **Codespell:** the whole failure was two words. `aks` (Azure Kubernetes
  Service; codespell reads it as a misspelling of "ask", 78 hits across the
  Terraform module, the customer template and these docs) is added to the
  ignore list in `.codespellrc`. The one real typo, a misspelt "Whether" in
  the `use_ddos_protection` description in
  `infra/langfuse-terraform-azure/variables.tf`, is fixed.
- **Label PRs with conflicts:** the job read a `PR_LABELER_TOKEN` secret this
  fork does not have, so `gh` ran unauthenticated and exited 1. It now falls
  back to the built-in `github.token`. The workflow's `permissions` block
  already grants exactly what the job needs (pull requests: read, issues:
  write), and fork PRs were already skipped. Setting the secret later still
  takes precedence.
- **Security review:** the job needs a `CLAUDE_API_KEY` secret (a paid API
  key; it also sends each PR diff to the Anthropic API). Rather than fail
  without one, it is now **opt-in**: skipped unless the repository variable
  `CLAUDE_SECURITY_REVIEW_ENABLED` is `true`. To turn it on, set the secret
  and the variable. Whether to fund and enable it is an owner decision; until
  then the PR shows "skipped", not a false red. CodeQL and the existing
  "Security scan" job are unaffected and still run.

**Why this approach:** fix what is genuinely broken (the typo, the missing
token), and make the one check that needs an owner decision explicitly
opt-in rather than deleting it. Alternatives rejected: deleting the two
workflows (loses them on the next upstream sync and hides the decision), and
adding `continue-on-error` (keeps a check that can never go red).

**Upstream sync note:** two upstream workflow files are edited, each in one
place, with an `ACME:` comment. Expect a small, obvious conflict if upstream
changes those lines.

**Verified:** `codespell` run locally with the workflow's arguments reports
no errors on this branch; `terraform fmt -check` passes on the edited file;
both workflow files parse as YAML; the pre-commit hook (format check and
lint) passed. The two workflow changes can only be proven by this PR's own
check run; the result is recorded in the PR.

**Deployment status:** source-only. CI configuration; nothing is built or
deployed from it.

**Known-incomplete:** the heavy test jobs (lint, tests, docker build, e2e)
stay queued because this fork has no runner for them. That is a separate
gap, not addressed here.

## 2026-09-19 — Change ID register (no release)

CHG-2026-004 · Tier 2 · owner: Anees Ur Rahman. New `acme-governance/CHANGE-ID-REGISTER.md`: a
change ID or ADR number is claimed there, on `main`, before it is used anywhere. Two parallel
sessions collided on IDs twice on 2026-09-19. Documentation only; nothing is built or deployed.
Rollback: revert the commit.
## 2026-09-19 — LiteLLM gateway image pinned by digest (no release)

| | |
|---|---|
| **Change ID** | CHG-2026-006 · owner: Anees Ur Rahman |
| **ADR** | None: Tier 2 change. |
| **Approval** | Pending. The owner reviews and merges; the implementer does not approve its own change. |
| **Dates** | Dev: applied 2026-09-19 11:52 UTC on the owner's instruction · Staging: not applicable, no database change · Prod: not applicable |
| **Impact** | The LiteLLM gateway in `rayin-platform` only. The digest is the one already running, so applying it does not change the version. Applying does restart the single LiteLLM pod once (a few seconds of gateway downtime), because the image field changes from a tag to a digest. Not client-visible. |
| **Schema change** | None |
| **Rollback** | Revert this commit and re-apply `integrations/litellm/k8s/deployment.yaml`. Data lost: none. |
| **Feature flag** | None |

**What:** `integrations/litellm/k8s/deployment.yaml` now references
`ghcr.io/berriai/litellm@sha256:a3715fa7…c62bf` instead of the `main-stable`
tag.

**Why:** `main-stable` is a floating tag. The live pod pulled it on
2026-09-12 and runs LiteLLM 1.100.1 (image built 2026-09-10). By 2026-09-19
the tag pointed at a different digest (`sha256:d295634e…`), so any pod
restart, node drain or reschedule would have changed the gateway version
without a record. CHG-2026-005 (CAIRO management of LiteLLM) is designed
against the endpoints verified on 1.100.1, so the version has to hold still.

**Why this approach:** pin the multi-arch index digest the kubelet reports
for the running pod, rather than picking a newer release. This records what
is running; it is not an upgrade. Alternative rejected: pinning a version tag
such as `v1.100.1-stable`, because a tag can be re-pushed and we did not
verify that such a tag resolves to the running digest.

**Verified:** running digest read from the pod's `imageID`; version read from
the installed package metadata inside the pod (1.100.1); the digest resolves
on the public registry to a linux/amd64 + linux/arm64 index.

**Deployment status:** deployed to dev, 2026-09-19 11:52 UTC, from branch
`chore/pin-litellm-image-digest` before merge, on the owner's instruction.
`kubectl diff` showed the image line as the only difference. Rolling update,
new pod ready before the old one stopped. Verified afterwards from inside the
new pod, read-only: pod spec and running image are both
`sha256:a3715fa7…`, LiteLLM 1.100.1, `/health/readiness` healthy with the
database connected, 0 restarts, all 5 virtual keys present, and model health
unchanged from before the change (`nvidia-nemotron` healthy; `claude-sonnet`
unhealthy with the same "credit balance is too low" error as before).

**Known-incomplete:** upgrades of this image have no documented cadence or owner.

## 2026-09-19 — Change procedure tiered by risk; one-command rehearsal database (no release)

CHG-2026-007 · Tier 2 · owner: Anees Ur Rahman. `acme-governance/CHANGE-PROCEDURE.md`: Tier 1
(schema, authentication or authorisation, secrets, guardrails, audit, client-visible) keeps the full
artefact set; Tier 2 is one changelog line, one commit, one PR. Artefacts are produced during the
build, ledger updates are batched per session (immediate for P0/P1), reports use four headings, and
IDs come from the register. New `acme-governance/scripts/rehearsal-db.sh` builds a throwaway
Postgres 15 that models Azure and runs up → down → up for a migration in one command (proven end
to end 2026-09-19). New `acme-governance/rollback/MIGRATION-ROLLBACK-INVENTORY.md` classifies the
five shipped ACME migrations; inventory only, no scripts. Documentation and tooling only; nothing is
built or deployed. Rollback: revert the commit.
## 2026-09-19 — CAIRO manages the LiteLLM gateway: keys, teams, budgets, models, spend (no release yet)

| | |
|---|---|
| **Change ID** | CHG-2026-005 · owner: Anees Ur Rahman |
| **ADR** | [ADR-0003](acme-governance/adr/ADR-0003-cairo-litellm-control-plane.md) |
| **Approval** | Pending. Design accepted for build by Anees Ur Rahman, 2026-09-19. The owner reviews and merges; the implementer does not approve its own change. Not a production approval. |
| **Dates** | Dev: deployed 2026-09-19, web `acme-v4.38.0.4` and worker `worker-acme-v4.38.0.2`, flag turned on the same day · Staging: not available; isolated migration and rollback rehearsal performed. (2026-09-19) · Prod: not yet |
| **Impact** | None while the flag is off: no navigation entry, no calls to LiteLLM, four unused tables. With it on: project owners and admins manage gateway keys, teams, budgets and spend inside CAIRO. No downtime. Client-visible once enabled. |
| **Schema change** | Migration `20260919120000_add_acme_litellm_management` (additive; no backfill). Creates roles `rayin_litellm_writer` and `rayin_litellm_retention_purger` without passwords. |
| **Rollback** | [plan](acme-governance/rollback/20260919120000_add_acme_litellm_management/ROLLBACK.md): flag off; then previous image; `down.sql` only for full removal. Tested 2026-09-19 (up → down → up on a throwaway database). Data lost by `down.sql`: the change record and CAIRO's key mapping; the keys keep working in LiteLLM. |
| **Feature flag** | `CAIRO_LITELLM_MANAGEMENT_ENABLED`, default off |

**What:** server-side LiteLLM client, append-only event writer, service and
tRPC router under `web/src/features/acme-enhancements/server/litellm/`; the
"LLM Gateway" page (keys, teams, models, spend, change record) and a nav entry
that renders nothing while the flag is off; project scopes `llmGateway:read`,
`llmGateway:CUD`, `llmGatewayLogs:read`; four server-only `env.mjs` entries;
the Security Analyst allow-list gains `acmeLitellm.status` and
`acmeLitellm.events` only.

**Why this approach:** CAIRO is the only portal and its RBAC is authoritative;
LiteLLM keys and teams are a projection tagged with `cairo_*` metadata. The
master key stays on the server. Every mutation writes an intent row before
LiteLLM is called and an outcome row before the user sees a result. Verified on
the running LiteLLM 1.100.1 with throwaway keys: `/key/{key}/regenerate` and
`tags` are refused as Enterprise features, so **rotation is CAIRO's own
create-then-delete, not native rotation**, and tagging uses `metadata`; key
aliases are unique (rotations carry a generation suffix); `spend` is honoured on
create (so rotating cannot reset a budget); `/key/update` replaces the whole
`metadata` object (so CAIRO reads, merges and writes back). Not used because
Enterprise-only: per-model budgets, temporary budget increases,
`/global/spend/report`, the team admin role, LiteLLM's own audit log.

**Verified:** 153 unit tests pass (client, audit wrapper, service, router RBAC
denial for MEMBER / VIEWER / NONE / Security Analyst, flag off, cross-project
ids, no key material in errors, rows, the record or responses); typecheck and
lint clean on every touched file; migration rehearsed up → down → up with the
grants behaving as designed for all three roles.

**Deployment status:** deployed to dev 2026-09-19 as `acme-v4.38.0.4` and
`worker-acme-v4.38.0.2`, flag off at first and turned on the same day on the
owner's instruction. Not in production. (Line corrected by CHG-2026-011; it
said "source-only" when merged.)

**Known-incomplete:**
- **The append-only control on `acme_litellm_events` is designed, not
  effective.** Dev's application connects to Postgres as the admin login, which
  owns the table, so it can update and delete rows today (Readiness Ledger
  P0-5; `acme-rayin-ops` gap list B9). The same is true of
  `acme_guardrail_events`. The rehearsal shows both halves: denied as
  `rayin_app_runtime`, allowed as `postgres`.
- Assigning a role per project needs Langfuse's `rbac-project-roles`
  entitlement, which this deployment does not have: a user's organisation role
  applies to every project in the organisation.
- Spend is $0.00 in dev (the only healthy model is free tier), so cost figures
  are untested with real money. Requests and tokens are shown alongside.
- Environment steps not done: passwords for the two new roles,
  `RAYIN_LITELLM_WRITER_DATABASE_URL`, `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY`
  on web. Network path web → `litellm.rayin-platform:4000` unverified.
- The UI has not been seen in a browser. No retention job exists for the new
  table; nothing is purged.
- Keys created outside CAIRO (5 today) are listed read-only to organisation
  owners; adopting them is out of scope.

## 2026-09-19 — Gateway request logs: receiver, append-only mirror, reconciliation (no release yet)

| | |
|---|---|
| **Change ID** | CHG-2026-008 · Tier 1 · owner: Anees Ur Rahman |
| **ADR** | [ADR-0003](acme-governance/adr/ADR-0003-cairo-litellm-control-plane.md) §4, §5 |
| **Approval** | Pending. The owner reviews and merges; the implementer does not approve its own change. Not a production approval. |
| **Dates** | Dev: deployed 2026-09-19, web `acme-v4.38.0.4` and worker `worker-acme-v4.38.0.2`, flag turned on the same day · Staging: not available; isolated migration and rollback rehearsal performed. (2026-09-19) · Prod: not yet |
| **Impact** | None while the flag is off: the receiver answers 404, the worker schedules nothing, two unused tables. With it on: CAIRO keeps its own record of every request through the LLM gateway (metadata only). No downtime. Client-visible once enabled. Depends on CHG-2026-005. |
| **Schema change** | Migration `20260919180000_add_acme_litellm_request_logs` (additive; no backfill): `acme_litellm_request_logs`, `acme_litellm_reconcile_runs`, grants for the roles created by CHG-2026-005. |
| **Rollback** | [plan](acme-governance/rollback/20260919180000_add_acme_litellm_request_logs/ROLLBACK.md): flag off; then previous image; `down.sql` only for full removal. Tested 2026-09-19 (up → down → up, 7 of 7 PASS, one command). Data lost by `down.sql`: the mirror and the reconcile history; LiteLLM's own spend logs are untouched. |
| **Feature flag** | `CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED`, default off, on web and worker |

**What:**
- **Receiver** `POST /api/public/litellm-request-logs`: a dedicated bearer secret
  (`CAIRO_LITELLM_INGEST_SECRET`, at least 32 characters, compared in constant
  time); a closed schema of the LiteLLM 1.100.1 logging payload, where an
  unknown or malformed record is rejected, never coerced; idempotent on
  `request_id` through the INSERT-only writer role; 4 MB and 512 records per
  call; a per-pod rate ceiling; validate, one lookup, one bulk insert.
- **The project is derived, never trusted:** from the payload's key hash matched
  to `acme_litellm_keys`. Project and organisation fields in the payload are
  ignored. A request made with a key CAIRO did not issue is stored with no
  project and is visible to organisation owners only.
- **Metadata only.** The payload also carries prompt and response text, error
  messages and tracebacks, model parameters, requester headers and the user's
  email. All of it is discarded; 24 allow-listed columns are stored.
- **Reconciliation**, a worker job every 5 minutes: pages LiteLLM's
  `/spend/logs/v2`, inserts what the mirror lacks, and records the **gap count**
  for every pass, including failed ones. Matches on `request_id` or
  `litellm_call_id`, because on a cache hit LiteLLM forms the two ids
  independently.
- **Screens:** a "Requests" tab on the LLM Gateway page. Above the list: last
  reconciliation, gap count, a warning when the last success is older than 15
  minutes, and a plain statement when nothing has arrived by push.
- The Security Analyst allow-list gains `acmeLitellm.requestLogs` and
  `acmeLitellm.reconcileStatus` (both need `llmGatewayLogs:read`).

**Why this approach:** push gives near-real-time records but the gateway drops
events rather than delay model traffic, so push alone can lose requests
silently. Reconciliation makes the mirror complete and, above all, makes a gap
visible. Verified on the running gateway before building: `/spend/logs/v2` is
OSS and carries no prompt text; the `generic_api` logger is in LiteLLM's core
package with no licence check; the spend-log `request_id` is the provider
response id on success and the `litellm_call_id` on failure, and the 1.100.1
source sets the push payload's `id` by the same rule.

**Verified:** 36 receiver tests against a replayed sample carrying every field
of the 1.100.1 payload (accepted once, duplicate skipped, unauthenticated
refused, unknown field refused, oversize refused, project derived, no project
for an unknown key, a marker string placed in every content field is absent
from what is stored, and from every log sink, including when a database
error message echoes the row: only the error name and code are logged);
13 reconciliation tests (a real gap is found, inserted
and counted; no false gap on a cache hit; a LiteLLM failure is recorded as a
failed run); router RBAC denial tests for the two new procedures; 196 web and
13 worker tests pass; typecheck clean on web, worker and shared; lint clean.

**Deployment status:** deployed to dev 2026-09-19 in the same images as
CHG-2026-005, flag turned on the same day on the owner's instruction. Proofs 1,
3 and 4 run in dev: see ADR-0003 §10. Not in production. (Line corrected by
CHG-2026-011; it said "source-only" when merged.)

**Known-incomplete:**
- **Push will be best-effort with no retry.** Read from the running LiteLLM
  1.100.1 source: the plain `generic_api` logger is built with `max_retries`
  0 and clears its queue after every send, so a batch whose POST fails for
  any reason is dropped at once. Earlier revisions of ADR-0003 said it retried
  and buffered 50,000 events; that was wrong and is corrected in revision 7.
  Every push failure becomes a reconciliation gap, which is what the gap
  count is for. CHG-2026-009 may configure retries; the owner decides.
- **Nothing pushes yet.** Enabling the gateway's callback is CHG-2026-009, a
  separate change that needs a LiteLLM pod restart. Until then every record
  arrives by reconciliation, up to about 7 minutes late, and the screen says so.
- **The append-only control is designed, not effective** while the application
  connects as the admin login (Readiness Ledger P0-5; ops gap list B9).
- The three remaining mandatory proofs of ADR-0003 §10 need a dev deployment:
  the grants as `rayin_app_runtime` and through the application's own
  connection, a real gap found by reconciliation, and no prompt text in the
  mirror.
- The push side of the id match is proven from source, not yet observed. How
  `request_id` is formed for call types other than chat completions is not
  verified.
- The rate ceiling is per web pod, not global. The end user and source address
  in a record are what the caller reported; they are not verified.
- No retention job exists; nothing is purged. The owner has not set a period.
- The UI has not been seen in a browser.

## 2026-09-19 — LLM Gateway console: fixes from the first real-browser pass (no release yet)

| | |
|---|---|
| **Change ID** | CHG-2026-011 · Tier 1 (clients can see it) · owner: Anees Ur Rahman |
| **ADR** | [ADR-0003](acme-governance/adr/ADR-0003-cairo-litellm-control-plane.md) §13 (revision 9). No new ADR. |
| **Approval** | Pending. The owner reviews and merges; the implementer does not approve its own change. Not a production approval. |
| **Dates** | Dev: deployed 2026-09-20 04:59 UTC as web `acme-v4.38.0.5`, digest `sha256:55b267aee5041d097d99af5192c1a7d9240409faae5844d9ff95a1a1d23843b8`, the four fixes re-checked in a browser; worker unchanged · Staging: not applicable, no database change · Prod: not yet |
| **Impact** | Console only. No API, schema, role or gateway change. |
| **Schema change** | None |
| **Rollback** | Revert the commit and redeploy the previous web tag with `scripts/release/release.sh --redeploy`. Nothing to undo in data. |
| **Feature flag** | Behind the existing `CAIRO_LITELLM_MANAGEMENT_ENABLED` and `CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED`. |

**What:** found by clicking through the console in dev, signed in as a project
admin who is not an organisation owner.
- No more red "Forbidden" toast on the Keys and Requests tabs for people who
  are not organisation owners. The owner-only queries still answer 403; the
  page already shows that inline, so the two queries mark 403 as silent.
- Teams no longer all show "Has a gateway-side admin". LiteLLM adds the master
  key's own user (`default_user_id`) as admin of every team it creates; that
  membership is ignored, any other admin is still flagged. New unit test.
- The change record and the request list no longer say the tables are
  "append-only at database level". That control is designed but not effective
  while the application connects as the admin login (Readiness Ledger P0-5,
  CHG-2026-010). They now say: CAIRO only adds rows here.
- `acmeLitellmService.ts` held two literal NUL bytes, so local `git diff` and
  `grep` treated it as binary (GitHub rendered its diff in #41 normally). Now
  the `\u0000` escape; same behaviour.

**Verified:** 26 service unit tests pass (one new); typecheck clean on web;
lint clean on the changed files. **Not verified:** the console was not checked
as an organisation OWNER after the fix (checked as a non-owner ADMIN).

**Known-incomplete:** the other findings of the pass are listed in ADR-0003 §13
and are not fixed here.

## 2026-09-19 — Sidebar: prompt pages grouped, "Book a call" removed (released as `acme-v4.38.0.3`)

| | |
|---|---|
| **Change ID** | None. [#31](https://github.com/samrayin/ACME-Rayin/pull/31) merged before the change-ID register (CHG-2026-004) existed. Recorded here by CHG-2026-012 so the release has a changelog line. |
| **ADR** | None. Navigation only. |
| **Approval** | Merged and released by the owner. Not an independent review. |
| **Dates** | Dev: released 2026-09-19, tag created 11:59 +03:00; exact rollout completion time not captured · Staging: not available · Prod: not yet |
| **Impact** | Navigation only. No route, API, schema or permission change. |
| **Schema change** | None |
| **Rollback** | `scripts/release/release.sh --env <env file> --redeploy acme-v4.38.0.2`. Nothing to undo in data. |
| **Feature flag** | None |

**What:** "Prompt Reviews" and "Prompt Approvals" moved into the sidebar's
Prompt Management group, after Prompts and Playground; upstream's "Book a call"
entry and its unused `book-a-call-button.tsx` removed.

**Released as:** web `acme-v4.38.0.3`, squash commit `f7c251b41`, ACR run
`dt2t`, digest `sha256:8e11ca7ad59af9f286c4ee61e04437ccdf670a261448b058d5447c20704e8386`.
It replaced `acme-v4.38.0.2`. The worker was not touched.

**Deviation, recorded honestly:** `release.sh` was not yet on `main` (#24 was
still open), so it was run from a copy taken from the release branch, and from
a working clone rather than a clean detached worktree — a deviation from the
N-35 interim control. The build input still matches the tag, because
`release.sh` builds from `git archive` of the commit and reported "Dockerfile
verified: ACR ran 114 steps, matching the export".

**Not verified:** the visible change was not checked in a browser by the
releasing session. Build start, end and duration, and the worker version
running at the time, were not captured.

## 2026-09-20 — Two statements in "Outstanding" that were no longer true (no release)

CHG-2026-013 · Tier 2 · owner: Anees Ur Rahman. Documentation only: no code,
schema, configuration or client-visible change. Rollback is to revert the
commit. Found while doing the CHG-2026-012 records catch-up and deliberately
split out of it, because both corrections were outside that change's
registered scope.

- **"Worker image is untraceable ... still runs `acme-dev`"** — closed on
  2026-09-19. The worker was released with `release.sh` as
  `worker-acme-v4.38.0.2`, traceable to its source commit, and
  `verify-deployed.sh` reports it TRACED.
- **"several untagged components (worker, LiteLLM, rayin-proxy) are also still
  manual"** — the worker is tagged as above; the LiteLLM gateway image is
  pinned by digest (CHG-2026-006); and `rayin-proxy` no longer exists. It was
  unused (0 requests in 7 days) and was removed from dev on 2026-09-20 during
  the R-05 guardrails-secret rotation.

**Not changed:** no Readiness Ledger rating, status or approval state, and
nothing else in the "Outstanding" list. The remaining items there were not
re-checked as part of this change.

## Outstanding, not yet done

- **Rebuild on a customer platform is unproven (#23, P0, next).** Tags and
  this changelog make deployments traceable, not reproducible. The customer
  Terraform template has never been run end to end, and two known defects
  block a fresh apply: the database name mismatch (N-26) and the self-signed
  TLS certificate (N-27). Secrets, seed data (including the chicken-and-egg
  push API key) are also still manual. See #23 for the acceptance test.
  (Updated 2026-09-20: the worker is now released and tagged, the LiteLLM
  image is pinned by digest (CHG-2026-006), and the unused rayin-proxy was
  removed from dev.)
- ~~**Worker image is untraceable.**~~ **Closed 2026-09-19:** the worker was
  released with `release.sh` as `worker-acme-v4.38.0.2`, traceable to its
  source commit, and `verify-deployed.sh` reports it TRACED.

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

---

## 2026-09-21 — promptfoo benign-prompt corpus committed (CHG-2026-017, no release)

**What:** Brought the N-56 measurement harness under version control. **Corrected 2026-09-21 (CHG-2026-021): as committed this runbook could not execute, and the relationship between these files and the 2026-09-20 measurement cited in the ledger is unestablished — see that entry.** These three
files existed only as untracked files in one working copy, on one machine, with no
backup — while being the instrument that produces the evidence ADR-0005's
enforcement gates are written against.

**Files:**
- `integrations/promptfoo/config/guardrails-benign.yaml` — 32 prompts against
  `/v1/guard`: 26 benign across five sections (core banking, regulatory, platform
  ops, adversarial-*sounding* but benign, short/low-signal) and 6 genuine attacks as
  controls. Grading is deterministic — the oracle is the returned `action`, never a
  judge model's opinion, because grading a false-positive measurement with the same
  class of model that produces the false positives would defeat the point.
- `integrations/promptfoo/config/summarize-benign.js` — reads a run's JSON and
  reports per-section false-positive and detection rates, plus a latency spread.
- `integrations/promptfoo/RUNNING-BENIGN-EVAL.md` — the in-pod run procedure.

**Why the controls matter:** without section F, a rail that blocks everything scores
a perfect detection rate. The summariser reads the two numbers together and says
which of three states the rail is in — discriminating, a constant, or inert.

**Why in-pod:** the run reads the guardrails shared secret through `envFrom` inside
the cluster rather than via `port-forward` plus an exported variable in a workstation
shell. The credential never leaves the cluster.

**Also in this change:** a note in `integrations/promptfoo/README.md` recording that
`config/gateway-eval.yaml` changes *meaning* when the ADR-0005 gateway guardrail hook
ships. Today it measures an uninspected path — routing, quality, latency. After the
hook lands in `record` mode the same file against the same endpoint measures an
inspected one, and becomes the record-mode corpus. Its behaviour does not change,
which is the hazard; results from either side of that line are not comparable.

**Risk:** none. Test scaffolding and documentation. No product code, no cluster
dependency, nothing deployed, no release.

**Deployment status:** not deployed and not deployable — these files are never built
into an image.
## 2026-09-21 — ADR-0005 amended: independent guardrails, and a recursion blocker (CHG-2026-018, no release)

**What:** Three amendments to `acme-governance/adr/ADR-0005-gateway-guardrail-hook.md`.
Documentation only. The hook is still **Proposed — design only**; nothing is built
and nothing is deployed.

**F7 — preferred fix replaced.** The PII short-circuit that lets any prompt carrying
a name, email, card number, IBAN or IP skip jailbreak detection was to be fixed by
running the rails on the original text and combining verdicts. That is now the
*fallback*. The preferred fix is to make PII and jailbreak **two independent gateway
guardrails**: LiteLLM evaluates each against the same request rather than piping one
into the next, so two guardrails cannot short-circuit each other. The bypass stops
being possible rather than being patched.

Verified in the running gateway before being written down: `presidio` is a built-in
integration (there is no built-in NeMo one — the jailbreak side stays custom);
`pii_entities_config` maps each entity to its own `BLOCK` or `MASK` action; all six
entities live in dev are present in `PiiEntityType`; and `logging_only` gives the PII
half a record mode for free.

**F10 — new, and it changes the schedule.** The rail's judge model is served *by the
gateway the hook attaches to*. With a guardrail attached, a gateway request calls
guardrails, whose rail calls its judge through the gateway, which calls guardrails
again. This bites in `record` mode as much as `enforce`, because record mode still
calls guardrails on every request — so it is a day-one blocker, not an
enforcement-time concern, and it would surface on the first request in either mode.

A new **Step 0** is added to §5 ahead of everything else, with a hard gate: *the judge
path must be provably excluded before the hook is enabled in any mode* — demonstrated
by a test, not a config review. Preferred mitigation is moving the judge off the
guarded gateway entirely, so the control does not depend on what it controls.

**F11 — new, and it records a withdrawal.** A concern was raised that the per-request
guardrail opt-out might be caller-controlled, which would have made "every prompt is
checked" false by construction. It was checked against the running gateway and is not
true: the opt-out reads from admin-configured key/team metadata only, with LiteLLM's
own docstring giving the reason. The concern is withdrawn and recorded as withdrawn so
it is not re-raised later. What remains is a monitoring item — an administrator can set
an opt-out on a key, so the claim holds only while no key carries one, and F10's
exclusion must be the only key that does.

**Cross-reference (CHG-2026-017):** §2 and §5 now record that
`integrations/promptfoo/config/gateway-eval.yaml` changes meaning when the hook ships —
measuring an uninspected path today and an inspected one in `record` mode, with no
change to the file. Runs from either side of that line are not comparable, and the
pre-hook baseline must be captured before Step 1, not after.

**Risk:** none. No product code, no cluster change, no deployment, no release.

---

## 2026-09-21 — promptfoo runbook corrections, found by running it (CHG-2026-021, no release)

**What:** Three defects in CHG-2026-017's own content, all found by executing the
procedure it documents rather than by review.

**1. The runbook could not execute.** `RUNNING-BENIGN-EVAL.md` pinned
`--image=node:20-alpine` while pinning `promptfoo@0.123.0`, which requires Node
`>=22.22.0`. `npm i` succeeds — 735 packages — and the binary then refuses to start.
Reproduced twice on 2026-09-21. Fixed to `node:22-alpine`.

**2. The runbook guaranteed a silent failure.** Its command was
`npm i -g promptfoo@0.123.0 >/dev/null 2>&1 && …`, so defect 1 produced no output, no
results file and nothing explaining why. The suppression is the worse defect of the
two: a wrong version pin fails once, a suppressed diagnostic hides every future
failure. The command now prints the node version, the install tail, the promptfoo
version, the full eval output and an explicit check for the results file.

**3. Evidence integrity: the corpus hardcoded a dated `agent_id`.**
`guardrails-benign.yaml` carried `agent_id: promptfoo-benign-2026-09-20`, so the
2026-09-21 run wrote its rows into `acme_guardrail_events` under the 2026-09-20 tag.
Two distinct runs became indistinguishable by tag and separable only by timestamp —
in the append-only table that exists to be the evidence. The id now comes from
`EVAL_RUN_ID`, set per run by the runbook.

**Also corrected:** the CHG-2026-017 changelog entry described this runbook as the
procedure that produced the 2026-09-20 measurement. It cannot have been. The entry now
records that relationship as unestablished.

**Not corrected, because it is not knowable from here:** what did produce the
2026-09-20 run. The guardrails writer role is insert-only and returns
`permission denied` on `SELECT` against `acme_guardrail_events`, and no read path was
available that did not require an admin database credential. Recorded as an open
discrepancy in the ledger's N-56 entry rather than reconciled by inference.

**Risk:** none. Documentation and test scaffolding. No product code, no cluster
change, no release.

---

## 2026-09-21 — ADR-0005 Step 0 decided: the judge stays on the gateway (CHG-2026-022, no release)

**What:** Records the owner's decision on ADR-0005 Step 0. The guardrail judge model
**stays on the LiteLLM gateway** and is excluded from the guardrail hook by
admin-configured key metadata — option (b). This reverses the ADR's previous preference
for moving the judge off the gateway, which was written before the gateway's governance
controls were measured.

**Why the earlier preference did not survive measurement:**

- The **guardrail audit trail is unaffected either way.** `acme_guardrail_events` is fed
  by a separate push path from `rayin-guardrails` and never touches the gateway. That
  removes the only argument that would have justified bypassing it.
- The **F3-coupling argument was weaker than stated.** If the gateway is down there is
  no traffic to judge, so the coupling is largely notional.
- **Bypassing costs exactly the governance capabilities the product is sold on:**
  per-key spend attribution, the per-key model allowlist, and console-based rotation
  with its `delete apiKey` audit entry. Measured live: the judge key shows
  `spend=0.0015` attributed correctly, and the older guardrails keys are genuinely
  restricted by allowlist. For BFSI, a raw provider key with no allowlist and no
  attribution is harder to defend than a single audited exclusion flag.

**What it costs, recorded rather than glossed:** recursion prevention becomes
configuration that must remain correct, not structural impossibility. A misconfiguration
does not degrade the control — it produces an unbounded loop.

**A constraint found while recording it.** Read from the running gateway,
`should_run_guardrail` consults the opt-out **only when `default_on is True`**. With
`default_on: false` — the zero-blast-radius configuration — the opt-out is never
consulted. So the exclusion mechanism cannot be exercised safely in advance; it takes
effect only where failing it recurses without bound. The exclusion must therefore also
be implemented **inside the hook**, by target model, where it is deterministic and
unit-testable before any flip. The LiteLLM opt-out becomes defence in depth rather than
the primary control. This is a design constraint on Step 1, not optional hardening.

**Step 0's gate is a test, and it recurs.** Because prevention is configuration rather
than structure, proving it once is insufficient. The test joins recurring release
verification and re-proves on every release; a release that cannot run it does not ship.

**New monitored invariant under F11:** the judge key must be the only virtual key
carrying a guardrail opt-out. Any second key carrying one is a finding, not a
configuration choice — it both weakens the control and silently exempts that key's
traffic from inspection.

**Risk:** none. Design only. No hook exists, no cluster change, no release.

---

## 2026-09-21 — ADR-0005-A: how the judge path is excluded from the hook, and how that is proven (CHG-2026-023, no release)

**What:** A companion design to ADR-0005, `acme-governance/adr/ADR-0005-A-step0-exclusion-design.md`,
for Step 0 — the gate that must hold before the gateway guardrail hook is enabled in
any mode. Design only: no hook exists, no key was edited, nothing ran against a cluster.

**The discriminator is authenticated key-level metadata.** Three candidates were
assessed against the running gateway. *Target model name* was rejected as a bypass that
is open today: application-side keys issued with an unrestricted model grant can already
reach the judge model, so a model-name check would let them skip inspection by asking
for it. *A request-metadata marker* was rejected as forgeable — it is caller-supplied,
the class LiteLLM refuses for its own opt-out. *Authenticated key metadata* is injected
by the proxy after authentication and is what LiteLLM's own opt-out trusts. The hook
honours the key-level opt-out itself, regardless of `default_on`; team-level opt-outs
are ignored; model name never exempts; every ambiguity resolves to *inspect*, because a
false skip is a silent hole and a false inspect is a loud, bounded loop.

**The judge key becomes an inspection-exempt credential, so its allowlist is on the
critical path.** One gated prerequisite change (not run, ID claimed when scheduled)
carries the opt-out metadata, a model allowlist of `groq-safeguard` and
`nvidia-nemotron`, and a rate cap. The allowlist bounds what a leaked judge key buys:
uninspected access to a safety classifier and nothing else.

**The cap is `rpm_limit` 10 for the flip window.** A runaway is a chain, not a fan-out;
at 10 it terminates in seconds rather than never. The test's assertions are equalities
so the cap cannot pass it: a clean pass is exactly one event, a capped runaway is about
ten and **fails**, zero is a vacuous pass and **fails**.

**The test has three layers and recurs.** Unit tests on a pure function; integration
with `default_on: false`, where nothing can loop — including a forged-metadata test
that stops the design if it fails; and post-flip equality assertions read after a
settle window, twice, from two independent counters. It attaches to every gateway
window, every `rayin-guardrails` release and every judge-key edit. A rotation mints a
key with no opt-out, no allowlist and no cap, so the rotation runbook must carry all
three and the test runs on the new key before the old one is retired.

**Recorded as a current violation** of the judge-model hygiene invariant: application-side
keys can reach the judge model today. Not a bypass under the adopted discriminator;
remediation rides with the deferred key clean-up.

**Risk:** none. Documentation only.

---

## 2026-09-21 — Guardrail hook: the Step 0 exclusion and its unit tests (CHG-2026-014, no release)

**What:** `integrations/litellm/config/cairo_guardrail_hook.py` and
`integrations/litellm/tests/test_cairo_guardrail_hook.py` — ADR-0005 Step 1 build work,
limited to the Step 0 exclusion designed in ADR-0005-A.

**Inert by construction.** No `guardrails:` block references the module, and its verdict
path raises `NotImplementedError` rather than returning something plausible. A hook that
silently appears to work is worse than one that is obviously unfinished.

**`should_skip()` is a pure function.** It reads the key-level opt-out from authenticated
metadata only. Team-level opt-outs are ignored, because one would exempt every key on the
team. Model identity never exempts. If the two metadata containers disagree — the shape a
forgery attempt produces — neither is trusted and the request is inspected. Every
ambiguity resolves to *inspect*: a false skip is a silent hole, a false inspect is a loud
loop that the judge key's rate cap bounds.

**25 tests, stdlib `unittest`, no new dependency.** This repository had no Python tests
at all; adding a test framework is a decision of its own and was not taken here. The tests
pass both with `litellm` installed and with it genuinely unavailable, so layer 1 can run
in a light CI job despite the fork having no runner for heavy jobs (N-51).

**A real defect was caught by writing them, not by review.** The first draft assigned
`self.guardrail_name` *before* calling `super().__init__()`. `CustomGuardrail.__init__`
then reset it to `None`, so `should_skip(data, None)` returned False for every request and
the exclusion became a **silent no-op** — the judge path back in the F10 recursion with
nothing to show for it. Every pure-function test passed; only constructing the class
exposed it. The ordering now carries a comment saying why it must not be reordered, and
`test_guardrail_name_survives_construction` pins it.

**Risk:** none. The module is not loaded by any running service and changes no behaviour.
No cluster change, no release.

---

## 2026-09-21 — Removed the inert Langfuse callback from the gateway config (CHG-2026-024, no release)

**What:** Deleted `litellm_settings.success_callback` and `failure_callback` from
`integrations/litellm/config/litellm-config.yaml`. Five lines out, a comment block in
recording why.

**Why removal and not enablement.** The registration had been present since the gateway
was configured, while the pod carries **zero** `LANGFUSE_*` environment variables. It
delivered nothing, for its entire life, and failed silently — the config advertised a
"native Langfuse logging integration" that had never once worked. Readiness Ledger
**N-20**, readiness audit **H-26**.

Removal is the ledger's own recommended fix, and enabling was assessed and rejected.
Without CHG-2026-009's `turn_off_message_logging`, switching it on would write **full
prompt and completion text** into ClickHouse — and raw payload bodies land in blob
storage *before* ClickHouse, so masking afterwards would not help the copy already
written. With retention requiring an entitlement this OSS instance does not have, that
data could never be deleted (**P0-11**, re-verified 2026-09-21: no
`LANGFUSE_EE_LICENSE_KEY`). Turning on content-bearing tracing into a store with no
delete path, while "can you delete customer data on request" still answers *no*, is the
wrong trade.

**What N-20 actually asked for.** Its recorded concern is that enabling was three
environment variables away with no approval gate — the control depended on a credential
being absent rather than on a decision. Removing the registration closes that; re-adding
becomes a deliberate act.

**Re-adding, when it is wanted:** a named credential owner, an approval gate, and
`turn_off_message_logging` in the same change. The comment left in the file says so.

**Verified before commit:** the file parses, all five models survive, and
`litellm_settings` is gone rather than left as an empty key — an empty mapping would have
been its own hazard.

**Risk:** removes a code path that has never executed. No behaviour changes. Applying it
needs one ConfigMap update and one gateway restart, owner-gated and tracked separately.

---

## 2026-09-21 — Sidebar: upstream promotional notifications switched off (CHG-2026-025, no release yet)

**What:** `AppSidebar.tsx` gains one constant, `ACME_SHOW_UPSTREAM_NOTIFICATIONS =
false`, ANDed into the condition that builds the sidebar notification list. While
it is false the list is always empty, so the "Star Langfuse" card — and any
promotional card upstream adds later — never renders. In `AppSidebar.stories.tsx`
upstream's `GitHubStar` story, which asserted that the card renders, is replaced by
`UpstreamPromoDisabled`, which asserts the inverse.

**Why:** the star card has no `createdAt`, so upstream's own expiry never removes
it. Only a per-browser `localStorage` dismissal does, which means every new browser,
profile or user sees it again. Its badge is loaded from `img.shields.io` by each
user's browser, a third-party request from an authenticated session, the same class
as ledger N-30 and N-32. It renders only while the v4 upgrade UI is off, which is the
self-hosted default. The five "Launch Week" cards above it in the list expired in
June and were not the ones users saw.

**Why this approach:** a guard on the existing condition rather than deleting the
entry. Upstream adds new entries in bursts, at launch weeks roughly every six
months, directly above the star entry in the same array, so editing the array means a
merge conflict or a silently shipped promo on every sync. The condition at
`AppSidebar.tsx:195-205` has not been changed by upstream since it was created, so a
guard there is the smallest surface. Setting the constant to `true` restores
upstream's behaviour.

**Not changed:** the notification data and type in `utils.ts` and the dismissal
storage in `AuthenticatedLayout.tsx`. Stale ids already in users' `localStorage` are
harmless. Other upstream nudges and third-party fetches in the logged-in UI
(onboarding videos from `static.langfuse.com`, the version label's server-side call
to `langfuse.com`, the agent-tools banner, the Support drawer) are out of scope here
and are tracked separately.

**Verified:** the full web typecheck (`tsc --noEmit`) passes. ESLint on both changed
files passes with `--max-warnings 0`; its first pass caught a redundant type
annotation, since removed. Prettier is clean once Windows CR line endings are
ignored.

**Not verified:** the story itself has **not** been run in a browser. The repository's
Playwright wants Chromium revision 1200, this machine has 1234, installing the
matching one is a download, and a run against the installed browser did not connect.
Nor has the change been seen in a running app, so the popup's disappearance is
established by reading the code, not by looking at it. CI cannot run these checks on
this fork (no runner for the heavy jobs, ledger N-51). Confirm in a browser after
deploy.

**Impact:** removes a card and a third-party image request from every session on a
deployment where the v4 upgrade UI is off. No routes, permissions or data change.

**Rollback:** revert the commit.

**Deployment status:** source only until a web image is released; the release is an
owner-gated `scripts/release/release.sh` run.

**Amended 2026-09-21, after merge (still CHG-2026-025).**

**Tier 2, confirmed by the owner, with the reasoning recorded so the exception is
visible and not silent.** `CHANGE-PROCEDURE.md` section 0 lists "anything a client
can see" under Tier 1 and says "when unsure, it is Tier 1". This change removes
something a client can see, so it was a genuine judgement call. The owner's reading
is that the clause targets behavioural and data-path changes, and that a cosmetic
suppression constant with no schema, authentication or data impact does not warrant
Tier 1's artefacts (an ADR, a versioned migration, a rehearsed rollback), none of
which has anything to apply to here. This is a deliberate exception to the letter of
the clause, not a case where the clause was silent, and it is not a precedent for
treating other client-visible changes as Tier 2.

**Verification update, superseding "Not verified" above.** After the merge the story
was run for real. Playwright's pinned browser, Chromium Headless Shell 143.0.7499.4
(playwright build v1200), was installed with the owner's approval: a one-time download
of about 180 MB from Playwright's CDN into the user profile, outside the repository.
Against merged `main` (`3a3e39c61`) the AppSidebar stories passed **13 of 13**,
including the inverse assertion (star card present and not dismissed, nothing renders).

**Control run.** An absence assertion also passes if the sidebar never rendered, so
the guard was flipped to `true` in a throwaway edit, since reverted and never
committed. Exactly one story failed, `(Test) Upstream promo notifications are
disabled`, reporting `expected <h3> to be null` with "Star Langfuse" in the rendered
output. The other 12 passed, including the chrome-alignment story, which shows the
sidebar does render in this browser. So the assertion is not vacuous. One of three runs
on the pinned browser failed to connect before any test executed and passed when
repeated; the cause was not isolated. Earlier attempts against an older installed
browser (revision 1234) also failed to connect.

**Still not verified:** the popup's absence in a running, deployed app. The change is
not deployed.

**Release held.** The owner decided not to spend a deployment on a cosmetic change.
It will ride the next web release driven by something substantive, and if none is
queued in a reasonable window it is to be raised for a standalone release. No window
was fixed. Nothing web-affecting was queued when this was recorded: #30 is a lint
chore, and #50 and #52 are parked draft snapshots.

**Observed the same day:** the owner checked the running dev environment in a browser
and the popup still appeared. That is expected. The running image is `acme-v4.38.0.5`,
built from `9f7958496`, which predates this change and contains no guard, so the
popup is the old build behaving as built.

---

## 2026-09-22 — CHG-2026-029 execution deviated from its own design; audit trail did not capture the change; a design gap, not solely an execution error

**Status: not closed.** Held pending a drift check on `acme_litellm_keys` (below) —
see "Not yet resolved."

**What was designed:** `models` and `rpm_limit` were to go through CAIRO's existing
`updateKeyLimits()`, specifically to preserve the audit trail (`acme_litellm_events`)
and keep CAIRO's own `acme_litellm_keys` row in sync with LiteLLM's live state.

**What was executed instead:** all three changes to the judge key
(`cairo-guardrails-judge-rotation-2026-09-20-7fe9a9d4` — opt-out metadata,
`rpm_limit`, `models`) were made via the raw LiteLLM `/key/update` API, called
directly against the gateway pod with the master key. Confirmed by direct query,
2026-09-22: zero rows exist in `acme_litellm_events` for any of the three changes.

**This was not avoidable in the execution context — state that plainly, not as
circumstance.** CAIRO provides **no operator-accessible audited path** for this
operation. `updateKeyLimits()` exists only as an application-code function inside
`langfuse-web`/`langfuse-worker` — it has no invocation route from outside a running
app-server session (no CLI, no admin script, no API endpoint callable independent of
the Next.js/tRPC process). An operator working from cluster access, as this session
was, has no instrumented way to make this change at all. The deviation is therefore
**a design gap in CAIRO, not solely an execution error** — the audited path existing
in code is not the same as the audited path being reachable by whoever actually needs
to make the change.

**Finding, rated P1 by the owner, 2026-09-22:**

> **LiteLLM key configuration can be modified outside CAIRO's audit path, leaving no
> record.** `acme_litellm_events` is written only by `auditedMutation()`, inside
> CAIRO's own application code. Nothing enforces that this is the only way to change
> a LiteLLM key — any holder of `LITELLM_MASTER_KEY` can call `/key/update` directly
> and change `models`, `rpm_limit`, or `metadata` with no intent/outcome row
> produced, no `before`/`after` snapshot, nothing.
>
> **Demonstrated, not theoretical.** 2026-09-22, three real configuration changes to
> the judge key were made via the raw API and confirmed, by direct query, to produce
> zero `acme_litellm_events` rows.
>
> **Directly contradicts ADR-0003's premise** — CAIRO as the single control plane
> for LiteLLM management, accepted for build and deployed to development.
>
> **Mitigated today only by single-operator control of `LITELLM_MASTER_KEY`** — the
> platform operator is currently the only holder of that credential, so this is not
> presently exploitable by anyone CAIRO does not already fully trust.
>
> **Transition condition, not a caveat: this becomes P0 at first customer
> deployment where operators hold cluster access.** The mitigation is a fact about
> who currently holds one credential, not a property of the design. Any deployment
> where a second party — a customer's own ops team, a second ACME engineer, a
> compromised credential — gains cluster access removes the mitigation entirely, and
> the finding's severity moves with it.
>
> **Cross-references:** ADR-0003 (the contradicted premise), CHG-2026-029 (the
> demonstration).
>
> **Recording note:** the Readiness Ledger — this project's live record for ratings
> and open findings — is currently unreachable (dead artifact link; see `CLAUDE.md`
> "Current state"). This finding is recorded here, in full, as the durable record
> until the Ledger is reachable again, at which point it needs to be transcribed
> there rather than left to live only in this changelog entry.

**Backlog item raised, separate from this finding:** CAIRO needs an
**operator-accessible audited path for LiteLLM key mutations** — a CLI, an admin
script, or an API endpoint that runs `auditedMutation()`-wrapped changes from outside
a live app-server session — so that a routine operational change (a rotation, a
limit correction, a metadata fix) cannot *only* be made by bypassing the audit trail.
Without it, every future operator in this position faces the same choice this session
faced: make the change with no instrumented path, or don't make it. Scope and
priority not yet decided — raised here for the roadmap, not designed.

**Drift check, 2026-09-22 — confirmed stale, not assumed.** Queried
`acme_litellm_keys` directly for the judge key (`id` = `cairo_key_id`
`7fe9a9d4-75db-4cda-b0bf-7cb958cec8c9`, the same value sent to LiteLLM as
`metadata.cairo_key_id`, per this table's own drift-matching design): `models: {}`
(empty, the pre-edit unrestricted state), `rpm_limit: NULL`, `updated_at:
2026-09-20 21:14:29` — exactly the row's creation timestamp, never written since.
CAIRO's database has no knowledge of the three live changes.

**`opted_out_global_guardrails` cannot drift — unaudited by design, not by
omission.** `acme_litellm_keys` (`schema.prisma`) has no `metadata` column at all.
CAIRO's database was never the source of truth for this field; only LiteLLM's own
key record ever holds it. This is a narrower, already-understood gap, distinct from
the `models`/`rpm_limit` drift below — recorded here so it is not mistaken for an
oversight in the drift check.

**Correction, same day: the console cannot reconcile this. There is no UI path,
checked, not assumed.** The plan above — owner reconciles via CAIRO's Key
Management console — turned out to be wrong on contact. The Keys page has no Edit
action, only Rotate and Revoke, and already shows this exact key with an amber
"Drifted: models, rpmLimit" badge: **CAIRO's own drift detection correctly
identifies a problem the product has built no way to fix.**

Checked the actual router and every frontend file, not inferred from the missing
button: `updateKeyLimits()` is registered as a working tRPC procedure
(`acmeLitellmRouter.ts:283`, exposed as `updateKey`) — fully implemented, fully
audited, read-merge-write, DB-syncing. Grepping the entire `web/src` tree for any
call to it (`acmeLitellm.updateKey`, `.updateKeyLimits.useMutation`, every variant)
returns **zero matches**. `Rotate` and `Revoke` do have a frontend home
(`AcmeLitellmGateway.tsx`); `updateKey` has none, anywhere.

**Revised framing — this is not "no audited path without a UI session," it is "no
reconciliation UI exists at all, for anyone, through any interface."** The earlier
framing understated it: the gap was described as an execution-context limitation
(this session lacked a UI session). It is not that. The audited backend capability
exists and works; it has simply never been wired to anything a human can click. No
UI session, however privileged, closes this today.

> **Standing hazard, live today — not hypothetical, not limited to the judge key.**
> `rotateKey()` sources the replacement key's `models` and `rpm_limit` from
> `requireKey()` — a plain read of CAIRO's own `acme_litellm_keys` row
> (`acmeLitellmService.ts:235`, `deps.db.acmeLitellmKey.findFirst(...)`) — **not**
> from LiteLLM's live state. The only field it reconciles from the live gateway is
> `spend` (line 579), to avoid resetting a budget. **Using Rotate on any key the
> Keys page shows as "Drifted" silently reverts that key to CAIRO's stale values
> under a new token**, discarding whatever the live gateway state actually was.
> This is a live risk on the Keys page today, for every drifted key it lists, not
> a scenario specific to today's judge-key change.

**Escalating the P1 finding's reasoning, rating unchanged.** This is no longer an
inconvenient gap in an edge case: CAIRO's console cannot correct a state it detects
and displays as wrong, and its one available action on a drifted key makes the
drift worse. That is a functional gap in the product's core key-management surface,
not a narrow operational inconvenience. Rating stays **P1** — still not exploitable
by an outside party, the reasoning already recorded above for that holds — but the
reasoning now reflects the true scope: this would misfire for any operator, with or
without console access, on any drifted key, not only one made without a UI session.

**Backlog item, revised and narrower than first thought:** wire `updateKeyLimits()`
(`updateKey`) to the Keys page UI — or build a dedicated reconciliation action if a
plain edit form is the wrong shape — so a drifted key can be corrected without
either bypassing the audit trail or, via Rotate, making the drift worse. The
backend function already exists, audited and working; this is a frontend gap, not
a missing feature from scratch.

**This change is blocked, not pending an owner action.** No owner action can
currently satisfy the reconciliation this entry requires — there is no audited path
to perform it, full stop. **CHG-2026-029 does not close today.** It stays open
until one of: `updateKeyLimits()` is wired to a UI a real session can use, a
dedicated reconciliation action is built, or the owner explicitly authorizes a
raw database correction with the reasoning recorded to the same standard as the
original deviation. `acme_litellm_keys` remains stale
(`models: {}`, `rpm_limit: NULL`) until one of those happens.

**Clarification, 2026-09-22, requested explicitly ahead of deploying CHG-2026-030:
shipping the reconciliation UI does not close the P1 finding above.** Two separate
things are tracked in this entry and must not be conflated when CHG-2026-030 ships:

1. **CHG-2026-029's own reconciliation mechanism** — closes once the Edit dialog is
   deployed and the owner uses it to correct `acme_litellm_keys`'s stale row. This
   is what CHG-2026-030 unblocks.
2. **The P1 finding itself** — "LiteLLM key configuration can be modified outside
   CAIRO's audit path, leaving no record" — is a standing structural gap: nothing
   in CAIRO stops a future raw `/key/update` call from bypassing the audit trail
   again. CHG-2026-030 does not touch this. It adds an audited *reconciliation*
   path for drift already caused by a bypass; it does not close the bypass itself.
   **Only the separately-raised, not-yet-scoped backlog item — an
   operator-accessible audited path for LiteLLM key mutations — can close this
   finding.** Until that is designed and shipped, the P1 rating stands, unchanged
   by any deploy of CHG-2026-030.

Deploying CHG-2026-030 should not be read, here or in the Ledger once it is
reachable again, as resolving this finding.

**Reconciliation performed and confirmed, 2026-09-22 — CHG-2026-029's mechanism
closes. The P1 finding above does not.** CHG-2026-030 deployed as `acme-v4.38.0.6`
(digest `sha256:08083ee3...2957`; full deploy record above at CHG-2026-030). The
owner then used the new Edit dialog against the judge key
(`cairo-guardrails-judge-rotation-2026-09-20-7fe9a9d4`,
`7fe9a9d4-75db-4cda-b0bf-7cb958cec8c9`) — dialog pre-filled from live state exactly
as designed, `models: groq-safeguard, nvidia-nemotron`, `10 rpm`, matching the
gateway. Save succeeded in the UI, then confirmed independently against the
database directly, not taken on the UI's word alone:

- `acme_litellm_keys`: `models = {groq-safeguard,nvidia-nemotron}`,
  `rpm_limit = 10`, `updated_at = 2026-09-22 15:05:43.379` — no longer the stale
  `2026-09-20 21:14:29` row. Matches live state exactly.
- `acme_litellm_events`: a matched `INTENT`/`OUTCOME` pair,
  `action = key.update`, `resource_id = 7fe9a9d4-75db-4cda-b0bf-7cb958cec8c9`,
  both `2026-09-22 15:05:43`, `outcome: success`. `before.models: []`,
  `before.rpmLimit: null` → `after.models: ["groq-safeguard","nvidia-nemotron"]`,
  `after.rpmLimit: 10` — this time through `auditedMutation()`, unlike the original
  2026-09-22 raw-API change this entry exists to record.

**CHG-2026-029 is closed.** Its own reconciliation mechanism worked as designed and
was used to fix the exact drift this entry documents. **The P1 finding stays open,
unaffected** — the reconciliation *tool* now exists and works; the standing gap
that a raw API call can bypass the audit trail entirely is untouched by this and
needs the separate, not-yet-scoped backlog item to close.

---

## 2026-09-22 — Key limits edit UI: source and tests, no release (CHG-2026-030, ADR-0007)

**What:** `updateKeyLimits()`/`acmeLitellm.updateKey` has existed as a complete,
audited tRPC procedure since CHG-2026-005 with zero frontend call sites — the gap
CHG-2026-029 ran into when it needed to reconcile a drifted key and found the Keys
page could only detect drift, not fix it. This change wires it up: an `Edit` button
per active key, next to `Rotate`/`Revoke`, opening a dialog scoped to `models` and
`rpm_limit` only.

**Why this shape.** `listProjectKeys()` (`acmeLitellmService.ts`) already fetched
each key's live LiteLLM state to compute the drift badge, but discarded the live
`models`/`rpm_limit` values after comparing — never sent them to the frontend. The
dialog now pre-fills its editable fields from those live values, not from CAIRO's
own (possibly stale) row: pre-filling from CAIRO's record would let an operator "fix"
drift by writing CAIRO's wrong value straight back onto the gateway. Falls back to
CAIRO's row, with a visible warning, only when `row.drift` is `"unknown"`/`"missing"`
— no valid live comparison exists in that case.

**A hazard found while wiring the submit path, not by inspection alone.**
`limitsInput` (`acmeLitellmRouter.ts`, shared by `createKey`/`updateKey`) has a Zod
`.default()` on every field. For `updateKey`, omitting a field does not leave it
unchanged — Zod fills the default and the mutation sends it, so a form exposing only
`models`/`rpm_limit` would silently clear `maxBudget`/`budgetDuration`/`tpmLimit` on
first save. Fixed by factoring the payload assembly into one exported pure function,
`buildUpdateKeyLimitsInput()`, which always carries the three unexposed fields
through from the row unchanged — one place that can get this right, instead of one
per call site.

**Scope held deliberately narrow.** No change to `updateKeyLimits()` itself, no new
fields on `KeyLimits`, no `metadata` editing — ADR-0005-A's judge-key exclusion
design depends on that field being set through a controlled path, and widening this
generic form to touch it would undermine that reasoning, not just add convenience.

**Verified, not type-checked only:** `tsc --noEmit --skipLibCheck` clean (twice — the
initial build and again after the pure-function refactor). 6/6 new tests pass in
`AcmeLitellmGateway.clienttest.tsx` (real `vitest run`, asserting the Zod-default
hazard above is actually prevented, not just type-shaped correctly). 28/28 pass in
`acmeLitellmService.servertest.ts` (26 pre-existing + 2 new — live values differ from
and are exposed over CAIRO's stale row; both are `null`, not stale-defaulted, when
the gateway is unreachable), no regression in the pre-existing suite. `eslint
--max-warnings 0` on all four changed/new files: exit 0, clean.

**Update, same day: now rendered in a real (headless) browser, not just
type-checked.** `EditLimitsDialog` and the `KeyRow` type were exported and a
Storybook story file (`EditLimitsDialog.stories.tsx`, test/preview-only — not
imported by any production page, never reaches the shipped bundle) added with
three variants built from fake data mirroring the actual CHG-2026-029 judge-key
scenario, not a generic example: drifted (CAIRO stale `models: []`/no `rpm_limit`
vs. live `groq-safeguard`+`nvidia-nemotron`/`rpm_limit 10`, confirming the dialog
pre-fills from live state), live-state-unavailable (confirming the fallback to
CAIRO's own row and its warning banner), and no-drift (contrast case). Run via
`DOCKER_BUILD=1 vitest run --project storybook` — the same mechanism already
verified this session. First run failed all three (Vite's own log: "optimized
dependencies changed, reloading" — a new `@radix-ui/react-alert-dialog` import
triggering mid-run re-optimization, a diagnosed cause, not a guess); retried once
with the dependency now cached, 3/3 passed. `AcmeLitellmGateway.clienttest.tsx`
re-run after the two exports: still 6/6, no regression. Still not clicked through
by a human in an actual browser window — this is a real headless render, not a
manual review, and does not substitute for the owner's own look before merging.

**Separate finding, incidental, not blocking:** `pnpm install` in this environment
currently fails outright. Root cause isolated, not just observed: `scripts/agents/
sync-agent-shims.mjs:15` does `resolve(new URL("../..", import.meta.url).pathname)`
— on Windows, a `file://` URL's `.pathname` keeps a leading slash before the drive
letter, and passing that straight to `resolve()` instead of through Node's own
`fileURLToPath()` produces a duplicated drive prefix (`C:\C:\Cairo-acme\...`),
so the script can never find `.agents/config.json` on this platform. `postinstall`
runs this script unconditionally, so every `pnpm install` on Windows fails at that
step — separately, `ssh2`'s optional native crypto binding also fails to compile
here for lack of Visual Studio build tools, though that one is merely an optional
dependency, not fatal by itself. Neither blocks anything today (existing
`node_modules` still work), but **this would block any future contributor doing a
fresh clone-and-install on Windows** — worth a backlog item: swap `.pathname` for
`fileURLToPath()` in `sync-agent-shims.mjs`.

**Deployment status:** source and tests only. **No ConfigMap change, no gateway
restart, no live deploy** — this ADR does not authorize a release, same gate as
every other Tier 1 change in this fork. The reconciliation this exists to unblock
(the judge key from CHG-2026-029) is the owner's action once this ships to a running
environment, not part of this change.

## 2026-09-22 — N-51 CI runner root cause confirmed; two fix paths compared, no fix built (CHG-2026-033, ADR-0008)

**What:** ADR-0001 §10 (2026-09-19) flagged by name that "heavy test jobs remain
queued with no runner" without investigating why. This change investigates it:
every job in `pipeline.yml` ("CI/CD") is pinned to a `blacksmith-*` runner label,
which only resolves through the Blacksmith GitHub App. `GET
/repos/samrayin/ACME-Rayin/actions/runners` returns zero registered runners; a
sampled run sat at API `status: "pending"` for 2h26m+ with `{"total_count":0,
"jobs":[]}` on its own jobs endpoint — GitHub never dispatches a job, not slow,
not degraded, never assigned. Every run sampled across the last day either hangs
`pending`/`queued` or resolves `cancelled`; not one shows a real pass/fail from
the actual build/lint/test jobs. No PR in this repo's history has ever received a
real CI verdict — every test result recorded anywhere in this fork's history to
date is local, from a developer machine.

**Not an ACME decision.** All 228 commits touching `pipeline.yml` are upstream
Langfuse's; none from this fork ever touched a `runs-on:` line. The `blacksmith-*`
labels are inherited unmodified from the sync, never chosen or examined here.

**Two fix paths, compared in ADR-0008, not decided:**
- **(a) Provision the Blacksmith GitHub App.** Blacksmith's own docs: *"Blacksmith
  is limited to GitHub organizations and not available for personal
  repositories."* `samrayin` is confirmed `"type": "User"` — a personal account.
  **This path is not a provisioning task today — it's blocked by the repo's
  account type**, which is a separate ownership decision this ADR does not make.
- **(b) Move the heavy jobs to GitHub-hosted `ubuntu-latest`.** No external
  dependency, available immediately, free and unmetered on this public repo.
  Checked against the file, not assumed: only two jobs (`lint`, `tests-web`) plus
  one conditional matrix leg (`tests-worker`'s `redis-cluster` variant) request
  16vcpu; everything else already runs at 4 or 8vcpu, close to `ubuntu-latest`'s
  standard 4vCPU/16GB spec. Upstream's own history already ran this exact swap:
  commit `435042a4f` moved every general CI/lint/test/build job onto
  `ubuntu-latest` during a Blacksmith outage with no recorded failures, reverting
  only once Blacksmith came back — proof by upstream's own operation, not a
  hypothesis. The three 16vcpu-tuned concurrency settings (`lint`'s
  `--concurrency=4`, `tests-web`'s `VITEST_MAX_WORKERS: "12"`, the
  `redis-cluster` leg's `VITEST_MAX_WORKERS: "8"`) would need retuning to 4 cores
  to avoid oversubscription — a mechanical adjustment, not a redesign; no job
  needs splitting.

**Recommendation recorded in the ADR:** path (b) is the only one buildable today;
path (a) becomes viable only after a separate account/ownership decision this ADR
doesn't make.

**Scope held deliberately narrow, by explicit instruction:** doc-only. No
`pipeline.yml` edit, no other workflow file touched, nothing release-related —
this investigation (Thread 2) stayed fully separate from Thread 1's parallel
guardrail/gateway/judge-key deploy. Register claim (CHG-2026-033, ADR-0008)
merged register-only first, per the hard rule, before this write-up used either
ID.

## 2026-09-22 — Heavy `pipeline.yml` jobs moved to `ubuntu-latest` (CHG-2026-034, ADR-0008, PR #94, not yet merged)

**What:** implements ADR-0008's owner-decided path (b). 18 heavy CI jobs
(build, lint, typecheck, every test suite, `test-docker-build`) move
`runs-on: blacksmith-*` → `ubuntu-latest`. The 4 tag-gated release jobs
(`validate-v3-release-tag`, `build-docker-image-release`,
`publish-docker-image-release`, `notify-docker-image-release`) are untouched —
release-related, out of scope. Three settings sized for 16 Blacksmith vCPUs
retuned to keep their established workers/vCPU ratio on 4: `lint`'s ESLint
`--concurrency` 4→1, `tests-web`'s `VITEST_MAX_WORKERS` 12→3, `tests-worker`'s
redis-cluster leg 8→2. `test-docker-build`'s "Setup Blacksmith Builder" step
(`useblacksmith/setup-docker-builder`, only functions from a Blacksmith
runner — the same coupling upstream's own outage swap, `435042a4f`, kept two
jobs on Blacksmith for) swapped to standard `docker/setup-buildx-action@v4.4.1`
(pinned by commit SHA, looked up live via `gh api`), since this job isn't
release-gated.

**Verified by a real run, not just YAML validity — this fork's first genuine
`pipeline.yml` pass/fail.** Run `35744928871` dispatched immediately (proof
N-51's root cause is fixed: zero runners → real dispatch) and completed with a
real `conclusion: failure` — 9 jobs passed for real
(`llm-connections-filter`, `ai-gateway-filter`, `tests-ai-gateway`,
`test-docker-build (worker)`, `tests-storybook`, `tests-eslint-plugin`,
`tests-shared`, `prettier-check`, `tests-in-app-agent-sandbox-runtime`).
`lint` failed on a genuine Node heap OOM at the retuned concurrency=1 (a RAM
ceiling, not a worker-count problem) — fixed by adding
`NODE_OPTIONS: --max_old_space_size=8192` to the "lint web" step, matching the
identical pattern `tests-web`'s own Build step already carries. Re-run
`35747624514` confirmed the OOM is gone; `lint` now fails on 46 real,
pre-existing ESLint warnings instead (`--max-warnings 0`), never caught
before because CI never ran.

**Three more genuine, pre-existing findings surfaced by this being the first
real run, none caused by this change, none fixed here:** `knip` found real
dead code (3 unused files, 1 unused dependency, 9 unused exports, 7 unused
exported types — filed as issue #96). `tests-web-client` found real failing
assertions plus a cascading timeout (filed as issue #97). Most significant:
migration `20260917090000_add_acme_guardrail_events_push_support` fails
`REASSIGN OWNED BY postgres` on a from-scratch database — rated **P0**,
recorded separately as its own finding (CHG-2026-035, above; register-claimed
and PR'd independently since it's a product/database issue, not a CI-runner
one).

**This PR cannot reach a fully green run on its own.** CHG-2026-035's bug
blocks every job that runs `db:migrate` or boots an image whose entrypoint
migrates on boot — `tests-web`, all three `tests-worker` legs, `e2e-tests`,
`e2e-server-tests`, `test-docker-build (web)`. Neither a CI-side workaround nor
that migration's fix exists yet; this change's own scope (runner
infrastructure) is separately verified working by the jobs that don't touch
the database, listed above.

**Does not retroactively verify anything.** Per ADR-0008 and explicit
instruction: no test "passed locally" claim anywhere in this fork's history
before today is upgraded to CI-verified by this change. Going forward is what
changes.

**Deployment status:** CI configuration only. No product code, no deployment.
Held for owner review of the complete PR #94 pass/fail table before merge.

---

## 2026-09-22 — Two findings from PR #94's real CI run, plus a Codespell false positive (CHG-2026-036)

**What, and why separate from CHG-2026-035:** CHG-2026-034/PR #94's first real
dispatch of `pipeline.yml` surfaced nine failures. Five are the already-filed
CHG-2026-035 migration bug (`REASSIGN OWNED BY postgres`, byte-confirmed across
`e2e-tests`, `tests-worker (mode-redis-cluster)`, `tests-web (mode-azure)`,
`e2e-server-tests`, and — from the `langfuse-web` container's own boot log,
downloaded from the run's diagnostics artifact — `test-docker-build (web)`: DB
error code `2BP01`, `routine: "shdepReassignOwned"`, matching the other four
exactly). Three (`knip`, `lint`, `tests-web-client`) are ordinary pre-existing
debt, exactly what N-51 predicted real CI would surface, tracked as issues #96
and #97. The remaining two don't fit either bucket and are recorded here:

**1. `scripts/smoke-image.sh` has no readiness retry before its health-check
`curl`.** `tests-ai-gateway` passed on the first real run (`35744928871`) and
failed on the re-run (`35747624514`) with `curl: (56) Recv failure: Connection
reset by peer` — timestamped *before* the gateway's own "listening" log line.
The script curls once, immediately after starting the container, with no wait
or retry loop. This is a pre-existing script defect, not something the
`ubuntu-latest` migration introduced — but **the possibility that this runner
type's startup-timing margin differs enough from Blacksmith's to make a
previously-rare race fire more often is not ruled out**, only that the defect
itself (no retry) is the same on any runner. Needs a readiness wait/retry loop
in the script; not fixed here.

**2. `layout.clienttest.ts`'s "stays finite on degenerate shapes" test — a
real, reproducible non-termination bug. Rated P1, owner-confirmed
2026-09-22.**

**Proven, twice, independently:** the timeline-layout algorithm does not
terminate (or is pathologically slow enough to be indistinguishable from not
terminating within vitest's window) when given a zero-width box. Checked
directly against both pipeline runs' raw job logs, not inferred from a
summary: `35744928871` — `1. 152.10s ... [failed] [retries=3]`; `35747624514`
— `1. 155.46s ... [failed] [retries=3]`. In both, every one of 4 attempts
(1 initial + `retries=3`) hit vitest's hard 30000ms timeout — never an
assertion failure, never a partial pass, in either run. The test's own input
set (`layout.clienttest.ts:110-115`) includes `{width: 0, height: 0}` and
`{width: 320, height: 0}`. This is proven in jsdom, under vitest — not
independently confirmed in a real browser.

**Inferred, not proven, and stated at lower confidence on purpose:** a
zero-width container is not an exotic input — it is what a React layout
container legitimately measures as on its very first render, before a
`ResizeObserver` reports real dimensions. *If* the production component ever
called the layout algorithm during that window, this could plausibly hang
the tab rendering a trace timeline. This is inference, not a demonstrated
production failure, and is not claimed as one.

**Checked, not left as an open question: does the production path actually
reach a zero-width box?** No — a guard exists, and it closes the gap between
the two paragraphs above. `TraceTimelineCompact.tsx` (`web/src/features/
traces/components/TraceTimelineDense/`) is the sole caller of `TimelineDense`
(itself the sole production caller of the `layout()` algorithm — confirmed by
grepping every importer of the module; `TimelineRowMetrics.tsx` and
`searchMatches.ts` reference `layout()` only in comments/types, never call
it). `TraceTimelineCompact.tsx:67-141`: `box` starts `null`; a `ResizeObserver`
via `measureRef` sets it to the measured `clientWidth`/`clientHeight`; the
render guard is `{box && box.width > 0 && box.height > 0 ? <TimelineDense
.../> : null}` — `TimelineDense`, and therefore `layout()`, is never rendered
until both dimensions are confirmed strictly positive. The exact degenerate
inputs that hang the test are structurally unreachable through this
component today.

**What this means for urgency:** the test finding is 100% valid and worth
fixing regardless — a non-terminating algorithm is a real defect, and a
future caller (a different component, a changed guard, a widget embedding
the timeline elsewhere) could reintroduce the exposure this guard currently
prevents. But it is not, right now, a live production hang — the existing
guard closes that path. P1 reflects "real, confirmed, reproducible bug in a
core algorithm, not routine test debt" without asserting an unverified
production incident.

**Also fixes a Codespell false positive found while investigating (1) and (2)**,
unrelated to either finding: `codespell` flagged `retuned` (real English — "the
three settings were retuned to 4 cores," ADR-0008's own wording) as a typo for
`returned`. Fixing the text to `returned` would have made the sentence wrong;
the correct fix is telling the tool it's wrong, not the prose. Added
`ignore_words_list: retuned` to `.github/workflows/codespell.yml`.

**Not fixed here, by design:** neither the smoke-test race nor the layout
timeout is fixed in this change — both need their own investigation
(`smoke-image.sh`'s retry logic; the layout algorithm's zero-width path) before
a fix is written, not a quick patch alongside an unrelated CI-runner change.

**Correction, same day:** issue #97 originally misattributed a
`V4MigrationEntryPoints.clienttest.tsx` assertion error to this test —
corrected directly against both runs' raw logs; #97 now points here for the
layout finding instead of describing it itself.

**Deployment status:** the Codespell fix is CI configuration only. The two
findings are documentation only — no product code changed.

## 2026-09-22 — Approval-tiers standing rule adopted (CHG-2026-037)

**What:** `acme-governance/CAIRO-Approval-Tiers-Standing-Rule.md` — a
standing Tier 1 / Tier 2 / Tier 2.5 boundary for what needs the owner's
explicit go-ahead versus what proceeds and reports afterward, for all
CAIRO/ACME-Rayin work, across every session.

**The single test:** if it's wrong, can it be undone by deleting a branch,
or does undoing it need a rollback of something live? Branch-deletable →
Tier 2 (proceed, report afterward). Needs a live rollback, a rating change,
or a merge to undo → Tier 1 (stop and ask, no exceptions).

**Tier 2.5** is the one narrow exception: a PR may be self-merged with no
owner approval only if its entire diff is a bare register-claim row (one ID,
nothing else touched) or a pure doc-typo fix — any ambiguity on any of its
four conditions defaults to Tier 1, and every 2.5 self-merge must be logged
explicitly as such.

**Why now:** written the same day PR #100 bundled a register claim with real
findings and a real fix in one commit — caught only because the owner was
reviewing before merge. Tier 2.5's condition 4 (nothing else bundled into
the claim PR) exists specifically because of that.

**First application:** this change's own claim, CHG-2026-037, was itself a
bare register-only row and was self-merged under the rule it defines
(logged in PR #103's description). This file — the actual content — is not
a bare claim, so it stays Tier 1 for merge, per the rule's own §2/§3
distinction.

**Deployment status:** documentation only. No product code, no workflow, no
rating changed.

## 2026-09-22 — P0 finding: migration bootstrap-role bug, found by CI's first real run (CHG-2026-035)

**A finding, not a change.** No fix is built or proposed for implementation here
— the owner explicitly asked for the finding and a rating first, separately from
any fix. Rated **P0**, owner-confirmed 2026-09-22.

**What fails, precisely.** Migration
`20260917090000_add_acme_guardrail_events_push_support`'s
`REASSIGN OWNED BY postgres TO rayin_migrator` statement fails on a fresh
database with:

```
Error: P3018
Database error code: 2BP01
ERROR: cannot reassign ownership of objects owned by role postgres because
they are required by the database system
```

This is Postgres's unconditional protection on its literal bootstrap/initdb
superuser — not the same bug as the membership-check failure this same
migration's own history already found and fixed (commit `6fcc72f06`,
"permission denied to reassign objects", fixed by adding
`GRANT rayin_migrator TO postgres;` beforehand). That fix does not help here:
this restriction cannot be granted around: the connecting role does not merely
lack a grant, it *is* the role Postgres refuses to reassign objects away from,
unconditionally.

**Found by CHG-2026-034/PR #94's first real `pipeline.yml` run (`35744928871`,
then reproduced identically in the re-run `35747624514`).** `db:migrate` had
never executed against a from-scratch database in this fork's history before
today, because CI never dispatched (N-51). This is the first time.

**Two facts, stated side by side — the rating is about a demonstrated failure
mode, not a claim about what's currently deployed:**

- **Proven, repeatedly, against vanilla/Docker Postgres.** Docker's official
  `postgres` image — used by every job in this fork's CI (`POSTGRES_USER`
  defaults to `postgres` in `docker-compose.dev.yml`, `docker-compose.build.yml`
  and `.env.dev.example`'s `DATABASE_URL`) and by local `docker compose up` —
  runs its default user as the literal bootstrap superuser. Every job that runs
  `db:migrate` against that setup hits this exact error, every time.
- **Not demonstrated against Azure Database for PostgreSQL Flexible Server —
  ACME's actual current deployment target.** The one real-world application of
  this migration (`acme-v4.35.0.5`, verified end-to-end per the 2026-09-17/18
  entry above) ran against the existing dev database, not a from-scratch one,
  so it couldn't have hit this either way. Checked directly (Microsoft Learn,
  "Server Concepts for Flexible Server"): the customer-created admin login
  belongs to `azure_pg_admin`, which is explicitly **not** the bootstrap
  superuser — `azure_superuser` is, and is inaccessible to the customer. The
  disposable-instance test that caught the *other* bug (`6fcc72f06`) modeled
  `azure_pg_admin`'s privileges specifically, so it didn't exercise this
  restriction either. **Whether Azure Flexible Server would hit this exact
  error on a genuinely fresh database has not been tested, in either
  direction** — this entry does not claim the live dev/production path is
  broken; it claims a failure mode exists and reproduces on demand, and that
  nothing to date has ruled out or ruled in whether the real target hits it
  too.

**Blocks PR #94 (CHG-2026-034) from a fully green run — confirmed, not
assumed.** CHG-2026-034's own scope (runner labels, three concurrency
retunes, one Buildx-action swap) never touches `docker-compose.dev*.yml` or
this migration, and CI's Postgres container has no workaround for this
restriction today. Every job in `pipeline.yml` that runs `db:migrate` or boots
an image whose entrypoint runs migrations hits this same error and fails or
gets cancelled:
`tests-web` (`-azure` confirmed failed; default and `-redis-cluster` legs
cancelled by the matrix's fail-fast before reaching it, would hit the same
step), all three `tests-worker` legs, `e2e-tests`, `e2e-server-tests`, and
`test-docker-build (web)` (its container's own entrypoint runs
`prisma migrate deploy` on boot and crash-loops on this exact error). **Neither
condition that would clear these jobs exists yet: CI's database setup carries
no non-bootstrap-role workaround, and this migration's fix has not shipped.**
CHG-2026-034 cannot reach a fully green `pipeline.yml` run on its own — its own
scope (runner infrastructure) is separately verified working by the jobs that
don't touch the database, listed in its own PR.

**Proposed fix, not implemented, needs owner review before anyone builds it.**
The migration's own comments show its actual intent: reassign ownership of the
~400 *application* tables in `public` so future migrations can `ALTER` them —
not literally every object `postgres` owns. The blanket
`REASSIGN OWNED BY postgres` statement sweeps in system-required objects it
never needed to touch. A narrower reassignment (the real application objects
specifically, not the role-level statement) is the shape proposed — not built,
not claimed correct without review.

**Why P0:** blocks the first `prisma migrate deploy` outright on any from-scratch
database where the connecting role is the bootstrap superuser — every app
container that hit it in today's run either crash-looped or hard-failed, not
degraded. Directly on the "what runs can be rebuilt on a customer platform"
theme already tracked P0 (N-26, N-27, N-38, ACME-Rayin#23). Forward-only by
this migration's own 2026-09-17/18 changelog note, so no automatic recovery
once a target hits it.

## 2026-09-23 — Guardrail hook Step 1: the verdict path (CHG-2026-014, ADR-0005)

**What:** `apply_guardrail()` in `integrations/litellm/config/cairo_guardrail_hook.py`
ended in `raise NotImplementedError` — Step 0 (the judge-key exclusion) shipped
in PR #75, and calling the guardrails service was deferred to "Step 1's next
commit." This is that commit. The hook now builds a `/v1/guard` request, reads
the verdict, and acts on it per ADR-0005 §3b.

**Source and tests only. Nothing is enabled.** No ConfigMap applied, no Secret
change, no gateway restart, no deploy. The `guardrails:` block added to
`litellm-config.yaml` ships with `default_on: false`.

**Shape, following Step 0's own reasoning rather than inventing a new one.**
The parts that decide anything are pure functions — `extract_text`,
`build_guard_payload`, `decide` — so the whole ADR-0005 §3b decision table is
provable on a bare Python with no cluster and no network, exactly as
`should_skip` already was. Only `_post_guard` does I/O, and it is a thin
overridable seam the tests substitute rather than mocking a HTTP library.

**Record mode's contract is "change nothing," so every failure proceeds:** an
unreachable service, a timeout, a non-200, an unparseable body, `httpx` absent
from the image, a missing secret, an input shape we could not read. In enforce
mode those same failures refuse (fail closed). Both directions are tested; the
two modes are the same pure function with one flag, so they cannot drift apart.
Enforce remains unreachable by configuration.

**`agent_id` is taken only from proxy-injected, authenticated metadata**
(`user_api_key_alias` and friends), never from anything caller-supplied — it
lands in an audit row, and a forgeable value would poison the evidence. When no
authenticated identifier exists the row says `unknown-agent` rather than naming
the wrong application. Tested with a request that supplies its own `agent_id`.

**Tests: 55 pass, up from 25.** `python -m unittest discover -s integrations/litellm/tests`.
The 25 Step 0 tests are unchanged and still green; one was replaced (it asserted
the verdict path raises `NotImplementedError`, which is now false by design).

**Two things found while building this that would have broken the switch-on, and
are fixed here:**

1. **The gateway has no way to authenticate to the guardrails service.**
   `/v1/guard` requires an `x-config-secret` header, and `rayin-guardrails` fails
   closed when its own copy is unset ("reject every request",
   `app/settings.py`). The gateway pod takes its whole environment from the
   `litellm-provider-keys` Secret via `envFrom`, which carries provider keys,
   `DATABASE_URL` and `LITELLM_MASTER_KEY` — **no guardrails secret**, and the
   hook had no code to read one. Added as `CAIRO_GUARDRAIL_SECRET`. Putting the
   value in the Secret is an owner-gated step, not done here. Without it the
   hook degrades safely (record mode proceeds and logs the misconfiguration)
   rather than failing requests — but it would be inspecting nothing while
   appearing to be switched on, which is why it is called out rather than left
   to be noticed later.
2. **The documented ConfigMap command would have produced a gateway that cannot
   start.** `k8s/deployment.yaml`'s `--from-file` command mounts only
   `litellm-config.yaml`. The new `guardrails:` block names
   `cairo_guardrail_hook.CairoGuardrail`, and litellm imports that class while
   *parsing* the block — before, and regardless of, `default_on`. So a ConfigMap
   carrying only the YAML does not yield a gateway with the guardrail off; it
   yields one that fails on its next restart, whenever that happens to be. The
   command now includes both files, with the reasoning recorded inline.

**Unverified, and deliberately not asserted:** the exact shape litellm hands to
`inputs` per `input_type` (hence `extract_text` being defensive — unrecognised
shapes return None, a record-mode proceed, not a crash), and that litellm
resolves `cairo_guardrail_hook.CairoGuardrail` from the ConfigMap mount. No hook
in this repository has ever been referenced from this config before
(CHG-2026-028 shipped its hook without a ConfigMap edit), so there is no local
precedent. Both are ADR-0005-A layer 2 questions, answered by the watched
restart at switch-on, not by this change.

**Open decision, owner's, not taken here:** `CAIRO_GUARDRAIL_TIMEOUT_S` defaults
to 10 and the call is synchronous, so a guardrails outage would add up to 10s to
**every** gateway request even in record mode, where nothing is being blocked.
That is a production-impacting property of a mode whose contract is to change
nothing. Lowering it, or making the record-mode call fire-and-forget, is a
deviation from ADR-0005 as approved — so it is decided before switch-on rather
than chosen unilaterally in this commit. Recorded in the config beside the flag.

**Already satisfied, so not a blocker:** the judge key's Step 0 prerequisites
(`opted_out_global_guardrails: ["cairo-guardrail"]`, model allowlist, `rpm_limit`
10) were applied live on 2026-09-22 under CHG-2026-029 and reconciled under
CHG-2026-030.

## 2026-09-23 — Guardrail hook timeout set to 2s, and why not fire-and-forget (CHG-2026-038)

**What:** `CAIRO_GUARDRAIL_TIMEOUT_S` now defaults to **2 seconds**, down from the
10 the hook shipped with. The record-mode call stays **synchronous**. Recorded as
an addendum to ADR-0005 §3c so the decision is reviewable rather than buried in a
default. Source and test only — nothing enabled, no ConfigMap, no restart.

**Precisely what was and wasn't a deviation.** ADR-0005 §3c requires "one explicit
timeout on the gateway→guardrails call" and §1 requires "an explicit **short**
timeout". Neither ever fixed a value. The 10s was this hook file's own default
from CHG-2026-014 Step 0 — a placeholder in code, not an approved number. So this
change sets a value the ADR always required and had left open, rather than
overriding an approved one. Framing it as a deviation from the ADR would be
inaccurate; the thing being corrected is the code's default.

**Why 10s could not stand.** The call sits in front of every request. At 10s a
guardrails outage adds up to 10s to *every* gateway request **in record mode** —
whose whole contract is to change nothing about what the gateway returns. A
record-mode hook that can add ten seconds has broken that contract already,
whether or not it blocks anything.

**Why not fire-and-forget, which would remove the added latency entirely.**
Because it defeats the mode's purpose. Record mode exists to measure what *would*
have happened, and the would-block count is Step 1's stated deliverable (ADR-0005
§5). Fire-and-forget drops the verdict whenever the response is slow, so the
signal goes missing exactly on slow responses and the resulting count is silently
biased low. A short bounded wait keeps the signal; the cap already buys the
latency protection fire-and-forget would trade the signal away for.

**Why 2s rather than 1s — from the measured distribution, not taste.** Post-fix
p50 is 470ms (CHG-2026-016) and **no p95 exists**. `block` verdicts can only come
from the judge/LLM path: Presidio runs first and returns early on any redaction
(ADR-0005 F7), so the fast deterministic path produces no blocks at all. The slow
tail is therefore exactly where the `would_block` signal lives. 1s is ≈2× p50 for
an LLM-backed call with no known p95 and would systematically truncate that tail —
biasing the measurement the same direction fire-and-forget does, just less
completely. 2s is ≈4× p50 and still a hard cap. The `guard_unavailable` rate
observed at 2s is itself the first real evidence of where p95 sits, which is what
Step 1 is meant to produce.

**Tests: 58, up from 55.** A timeout now provably resolves to `guard_unavailable`
rather than hanging or propagating — asserted with a bounded elapsed time, so a
regression that reinstates a hang fails the suite instead of stalling it — plus
the record/enforce split on that same outcome, a ceiling assertion that stops the
default drifting back up, and the environment override.

**Still open, and not closed by this change.** ADR-0005 F2 requires a timeout on
**both** sides — a shorter one inside guardrails on the rail's own upstream call,
so the inner can never outlive the outer. That inner timeout does not exist yet.
Until it does, a fired gateway timeout abandons the request while the guardrails
pod keeps working on it, which is the work-leak F2 describes. Bounding the outer
call is worth doing and is not a substitute for F2.

## 2026-09-23 — Finding: record mode measures the detection, not the reliability (CHG-2026-039)

**A finding, not a change.** No code here. Raised before switching the hook on
rather than after, because it changes what the switch-on is worth.

**The question that surfaced it.** Asked what would actually appear in CAIRO once
the guardrail hook goes live — a fair question, since nothing built on 2026-09-23
is running. Checked against the cluster first: the `litellm` pod has not restarted,
the live ConfigMap holds only `litellm-config.yaml` with no `guardrails` block and
no hook file, and `rayin-guardrails` logged zero `/v1/guard` calls in the
preceding two hours, only `/healthz`. So the honest answer today is "nothing, and
nothing is wrong" — but the answer *after* switch-on needed checking too.

**First answer was wrong, and is corrected here.** The initial claim was that the
would-block count would live in `kubectl logs` rather than CAIRO. That is false,
and reading `rayin-guardrails/app/events.py` rather than inferring from the hook's
own logging shows why: its opening line is *"Emits a decision event for every
`/v1/guard` call"*, and every event is pushed durably to CAIRO's Postgres
(`rayin_push.push_event_with_retry`, a detached task, with the in-memory buffer as
the reconciliation fallback). **So the would-block count will be visible** — each
one lands as a `block` row on the Guardrails page, with allows and redacts beside
it. Recording the correction because the overstated version had already reached
the HLD, and an overstated gap is as misleading as a missed one.

**What genuinely will not be visible, and why each is structural rather than an
oversight:**

1. **`guard_unavailable` cannot appear in CAIRO by construction.** When the hook's
   call times out, gets a non-200, or cannot authenticate, `rayin-guardrails`
   never receives the request — so there is no decision to emit and no event to
   push. The only record is the hook's own `log.warning`/`log.info` on gateway
   stdout. This matters more than it looks: that count is precisely the evidence
   the 2s timeout was chosen on (CHG-2026-038), and ADR-0005 F5 records that a p95
   was *not definable* against the pre-fix spread. Record mode was supposed to
   produce it, and as built it produces it only into pod logs.
2. **The added latency of the gateway→guardrails round trip is measured nowhere.**
   The hook does not time its own call; the guardrails service times nothing on
   the caller's behalf. ADR-0005 §5 Step 1 asks for "p50/p95 added latency" as a
   deliverable of this exact step.
3. **None of the §3d metrics exist** — `guardrail_calls_total{outcome}`,
   `guardrail_latency_seconds`, `guardrail_unavailable_total`. §3d names them and
   nothing emits them.

**The shape of the gap, stated plainly:** switching the hook on in record mode
will tell us **what the guardrails would have caught**. It will not tell us **how
often the guardrail was reachable, or what it cost**. Detection without
reliability or cost is half of what Step 1 is defined to produce, and it is the
half that cannot be reconstructed afterwards — an absent event leaves no trace to
count later.

**Not proposed as a blocker.** Enabling the hook is still worth doing without
this; the detection numbers are real and useful on their own. But the decision to
switch on should be made knowing which half of the measurement arrives, rather
than discovering it when the second half is asked for.

**Fix shape, not built and not reviewed.** The narrow version is to have the hook
record its own outcome where the rest of the evidence already goes, so
`guard_unavailable` and the round-trip duration become rows rather than log lines
— reusing the existing push path rather than inventing a second one. The broader
version is §3d's metrics. Which of those is right, and whether either is worth
doing before the switch-on rather than after, is the owner's call.

## 2026-09-23 — Guardrail hook emits a structured health record (CHG-2026-041)

**The interim bridge for CHG-2026-039**, so record mode is measurable at
switch-on without waiting for ADR-0009's durable capability. Source and tests
only; nothing enabled, no ConfigMap, no restart, no schema.

**What it does.** Every hook invocation now emits one line of valid JSON to
gateway stdout, carrying the two figures CHG-2026-039 identified as otherwise
unrecoverable: the outcome (including `guard_unavailable`, which by construction
can never reach CAIRO) and the measured round-trip duration. Field names are
deliberately the ones ADR-0009's table is expected to use, so the migration
reads these rather than redefining them. Correlation is `litellm_call_id` — the
same identifier `AcmeLitellmRequestLog` already keys on, so the two join without
inventing an identifier.

**Honest about what it is not.** Pod stdout is not a durable record; it is lost
on restart unless something collects it. This does not pretend otherwise. It is
strictly more than exists today, which is nothing, and it is explicitly the
bridge rather than the destination.

**Two things the tests forced out that were not in the plan:**

1. **An excluded key was invisible.** The Step 0 judge exclusion returned
   silently, so "the judge key was correctly excluded" and "the hook never ran
   at all" looked identical from outside — and those have opposite meanings for
   whether the loop prevention works. ADR-0005-A layer 3 has to verify that
   exclusion live at switch-on (B4). Exclusions are now recorded, with
   `called: false` so they stay out of the latency and availability figures,
   and they name the key they excluded so layer 3 can confirm it fired for the
   judge key and nothing else.
2. **A real clock bug.** The first implementation used `time.monotonic()`,
   whose granularity on Windows is ~15ms — a 10ms call measured as exactly
   zero, which the test caught. Switched to `time.perf_counter()`, the
   high-resolution clock Python documents for short durations. This was not
   cosmetic: it would have understated p50 at precisely the low end that
   matters, and the understatement would have looked like good news.

**`duration_ms` is null, not zero, when no call was made** (an exclusion, or a
payload that could not be built). Zero would assert an instantaneous call that
never happened; `called` disambiguates without the reader inferring it from a
null.

**Tests: 70, up from 58.**

## 2026-09-23 — ADR-0009: guardrail health events, designed (CHG-2026-040)

**Design only. Nothing built:** no migration, no endpoint, no credential, no
release. Closes the design half of CHG-2026-039.

**What it designs:** a dedicated `acme_guardrail_health_events` table recording
whether the gateway→guardrails call succeeded and how long it took, the three
ADR-0005 §3d metrics as queries over it, the credential that authorises the push,
the web-side endpoint and read-only console view, and the release sequencing.

**A separate table, not a widened enum, and §3.1 records why:** a
`guard_unavailable` is not a guardrail decision, it is the absence of one.
Widening `AcmeGuardrailEventAction` would make the decision table assert
something it does not mean — every existing query, the tiered content rules and
the dedup key all assume a decision was reached.

**Two fields where one looked sufficient.** `outcome` records what the hook did;
`failureClass` records why. The hook's `decide()` deliberately collapses every
failure to "I do not know what the guardrails think", because the response must
not depend on the cause. Diagnosis does: `AUTH_FAILURE` means a misconfigured
credential and someone must act now, `TIMEOUT` means the judge is slow and the 2s
cap is working. Both are `GUARD_UNAVAILABLE` to the request and are not the same
incident.

**Three things the design had to state rather than solve:**

1. **The credential cannot be scoped as narrowly as it should be.** Checked, not
   assumed: `ApiKeyScope` is `ORGANIZATION | PROJECT` and `ApiAccessLevel` is
   `"organization" | "project" | "scores"`. A project-scoped key can call every
   project-scoped public route — so a key issued for health pushes can also
   ingest traces and push guardrail decisions. What is achievable (dedicated key,
   `expiresAt`, project scope, identifying note, console-provisioned) is
   specified; what would actually close it is a new access level, which is a
   change to the auth model and larger than this ADR.
2. **There is no metrics substrate.** No `prom-client`, no `/metrics`, no
   Prometheus, no Alertmanager. The three §3d metrics are therefore defined as
   SQL over the table rather than emitted, which needs no new infrastructure and
   is exact rather than sampled — but it is pull-only. **There is no alerting and
   this ADR does not create it.** A readiness claim resting on this should say
   "reviewed", not "monitored".
3. **It adds unbounded growth to a store with no purge path.** One row per
   gateway request, into a system where P0-11 is open and the retention job (PR
   #51) is unmerged and gated behind ADR-0004. Health rows carry no prompt
   content, so a shorter retention is defensible here in a way it is not for
   decision rows — but the precondition is stated rather than discovered later.

**Effort, stated plainly because it was asked for plainly: 6–10 working days,
not a weekend.** §8 breaks it down and says what compressing it would cost — the
migration rehearsal, the buffering correctness, and the credential discipline.
A rushed version adds an unbounded table behind an over-scoped credential with a
push path that can add latency to every request, in service of measuring
latency. The recommendation is explicit: ship CHG-2026-041's stdout bridge this
weekend, which yields both missing figures with no schema, credential or
release, and let this proceed on its own timeline with its rehearsal intact.

**Confirmed, as the brief required (§7):** `AcmeGuardrailEventAction` is not
altered, `acme_guardrail_events` is not altered, and no existing query against
either is affected. One deliberate read-only reuse —
`AcmeGuardrailEventDirection` — with no value added to it.

**Update, same day: all four open questions answered by the owner (§10), and
the design revised to record them.**

1. **Retention — 14 days, firm, and deliberately not tied to PR #51/ADR-0004.**
   Health rows carry no prompt content at all, so P0-11's sensitivity argument
   does not transfer, and this needs neither the least-privilege cutover nor an
   archive-and-verify step — a simple age-based delete suffices. A firm target
   was chosen over an unbounded caveat because "grows without bound, addressed
   later" is how a table becomes a problem nobody owns.
2. **Alerting — "reviewed, not monitored", and nothing built.** Worker-evaluated
   thresholds were rejected as new logic with their own failure modes (an
   evaluator that silently stops evaluating is worse than none, because it looks
   like "no alerts, therefore fine") and as a repeat of the scope creep that
   turned "add a log line" into this ADR. Customer-monitoring export stays on
   Horizon 1. **Recorded with the limit of its own reasoning:** this is
   acceptable only because record mode fails *open*, so an unnoticed outage
   costs measurement data rather than availability — and it stops being
   acceptable at `enforce`, where the same outage fails requests closed.
   **Owner-confirmed as a hard gate, not a note:** ADR-0005 §5 Step 4 is
   amended by this change to carry **gate (10) — alerting on guardrail
   unavailability actually in place** — so `enforce` is not authorised until it
   holds, on the same footing as the other nine. Gate (8) already covers the
   judge model's health; it does not cover the guardrails service's
   reachability from the gateway, which is a different failure and the one this
   capability measures. "Reviewed, not monitored" is a decision about `record`
   mode only, and it expires the moment `enforce` is proposed.
3. **Credential scope — accepted as a named follow-on**, tracked as issue #115
   and cross-referenced from §5.1 so it is not later read as an oversight.
4. **Sequencing — after the guardrail switch-on, not in parallel.** The
   substantive reason, beyond cost: `failureClass` proposes seven values as a
   Postgres enum, and those seven are currently a *prediction* of how the call
   fails in practice. The bridge (CHG-2026-041) emits exactly these fields, so
   running the switch-on first replaces the prediction with evidence before it
   is committed to a schema that is awkward to change. Build does not start
   until that window has been collected and the enum corrected against it.

**One ambiguity resolved rather than guessed:** the answer named "option 3",
but §10's third choice was *accept reviewed-not-monitored* while §4.3's third
option was *real Prometheus* — opposite meanings. The accompanying reasoning
("don't build worker-evaluated thresholds now") made the intent unambiguous, so
the decision is recorded by content and the colliding numbering removed.

## 2026-09-23 — Codespell false positives unblocked (CHG-2026-042)

**What:** added `unparseable` and `pre-empt` to `ignore_words_list` in
`.github/workflows/codespell.yml`, alongside `retuned`. CI configuration only.

**Why it mattered now: the check was failing on `main` itself**, not just on a
branch — the last three `main` runs all failed — so it blocked every open PR,
including one-line documentation changes. It was flagging words that already
existed on `main`, so no PR introduced it and no PR could escape it.

**Both are false positives, and the tool is corrected rather than the prose** —
the precedent CHG-2026-036 set with `retuned`, where "fixing" the text would
have made the sentence wrong:

- **`unparseable`** — codespell prefers `unparsable`. Both are accepted English;
  `unparseable` is the form used throughout ADR-0005 and the guardrail hook,
  where it describes a judge reply the parser cannot read.
- **`pre-empt`** — codespell prefers `preempt`. `pre-empt` is the British
  spelling, which is this repository's register throughout ("behaviour",
  "organisation", "recognisers").

**Verified locally against the exact files CI flagged, rather than assumed:**
with the old list, all seven hits reproduce and codespell exits 65 — the same
failure CI reported. With the new list, exit 0. That run also confirms the
case-insensitivity claim made in the file's own comment: ADR-0009's
`UNPARSEABLE` enum value is cleared by the lowercase entry, so no separate
uppercase entry is needed.

**Overlap worth knowing about:** PR #83 (CHG-2026-027, open since 09:18 on
2026-09-22) takes the opposite approach for the same word, rewriting ADR-0005's
`unparseable` to `unparsable`. That change is now unnecessary but harmless — the
ignore entry covers the word wherever it appears, including the hook and
ADR-0009 which #83 does not touch. Whether #83 still merges is the owner's call;
nothing breaks either way.

## 2026-09-23 — CHG-2026-035 closed as invalidated: the migration was never broken on the real target

**Closing a P0 that should not have been raised.** The rating rested on an
incomplete search. Recorded in full rather than quietly corrected, because an
owner confirmed **P0** on the strength of it and the correction matters more
than the tidiness of the record.

**What the finding claimed (2026-09-22).** Migration
`20260917090000_add_acme_guardrail_events_push_support` fails
`REASSIGN OWNED BY postgres` on a from-scratch database (`P3018`/`2BP01`),
proven twice in this fork's own CI — and, critically, *"not demonstrated either
way against Azure Flexible Server, ACME's actual deployment target"*.

**Both halves were already answered in this repository, on 2026-09-19 — five
days before CI "found" it.** In two places the original search did not open:

1. `acme-governance/rollback/MIGRATION-ROLLBACK-INVENTORY.md`, the row for this
   exact migration, ends: *"Also fails on a stock Postgres image where
   `postgres` is the bootstrap superuser (found 2026-09-19); **it applies on
   Azure Flexible Server**."*
2. `acme-governance/scripts/rehearsal-db.sh`'s header explains why the rehearsal
   environment is built the way it is: *"`postgres` is a NON-superuser admin …
   and a separate bootstrap superuser `pgboot` exists. **That models Azure
   Flexible Server.** On a stock image, where `postgres` IS the bootstrap
   superuser, 20260917090000 fails at `REASSIGN OWNED BY postgres` … Found
   2026-09-19."*

A rehearsal tool had been deliberately built to model Azure **because** a stock
image misleads on precisely this point.

**The migration is confirmed working on the real production target**, on two
independent grounds:

- **Documented:** the rollback inventory states it applies on Azure Flexible
  Server.
- **Functional, and stronger:** the durable guardrail audit trail has been live
  since 2026-09-18, and a real blocked request produced a complete audit row
  carrying `event_id`, `user_id` and encrypted block-tier content — **columns
  this very migration adds**. The migration cannot have failed on the Azure
  database; rows written by its own schema exist in production.

**So the defect is in the test environment, not the migration.** CI runs stock
`docker.io/postgres:17` with `POSTGRES_USER=postgres`, which makes `postgres`
the bootstrap superuser — the one configuration the migration is documented not
to survive, and not the configuration ACME deploys to.

**Not fixed by changing the migration, deliberately.** Narrowing the `REASSIGN`
statement would have altered working, deployed, verified code — touching the
audit-table migration — to satisfy a test environment that misrepresents
production. The correction belongs in CI's Postgres setup, tracked separately.

**No live Azure test was run, and none is needed.** The owner's call, and the
right one: the existing production evidence is stronger than a fresh
disposable-instance test would be. A passing test on a throwaway instance would
prove less than audit rows already written by this migration's own columns.

**The lesson, recorded because it is a real gap in the search process.** A
finding rated on *"not demonstrated"* is a claim about the **evidence**, and it
obliges a search of where evidence is kept — not only where code is kept. The
search that produced this P0 covered the migration SQL, `ACME-CHANGELOG.md`,
Microsoft's documentation and the CI logs. It did not cover
`acme-governance/rollback/` or the rehearsal tooling, both of which existed,
both of which answered it. **Before rating any future finding on "not
demonstrated", check `acme-governance/rollback/` and any rehearsal or
verification tooling — the reason a tool exists is often the finding about to be
re-discovered.**

**Status: CHG-2026-035 closed, invalidated.** The number stays burnt per
register Rule 4. The two follow-ons it surfaced remain real and are tracked
elsewhere: the CI environment correction, and the unchanged observation that
CI's first genuine run is what surfaced all of this.

## 2026-09-23 — CI's Postgres now models Azure Flexible Server (CHG-2026-043)

**A test-environment correction. No migration, no schema, no product code, and
no change to what any developer runs locally.**

**Why.** CI ran stock `docker.io/postgres:17` with `POSTGRES_USER=postgres`,
making `postgres` the *bootstrap* superuser — the role that owns every catalog
object initdb created. Postgres refuses `REASSIGN OWNED BY <bootstrap role>`
unconditionally (`2BP01`), because those objects are pinned; no grant works
around it. Azure Flexible Server is not shaped that way: the customer admin
login belongs to `azure_pg_admin` and is explicitly **not** the bootstrap
superuser, so it owns no pinned objects and the statement succeeds.

CI was therefore running the one database shape migration `20260917090000` is
documented not to survive, and reporting a production defect that does not
exist. That is exactly what happened — raised, rated **P0**, and closed as
invalidated (CHG-2026-035). This change stops CI producing that class of false
finding.

**What it does.** A CI-only overlay, `docker-compose.ci-azure-like.yml`, layered
onto the dev compose files in CI only. It renames the container's bootstrap
superuser to `pgboot`, which frees the name `postgres` to be an ordinary admin
role, and mounts `scripts/ci/postgres-azure-like-init.sql` to create that role
(`NOSUPERUSER CREATEDB CREATEROLE`, mirroring the Azure admin login) and give it
ownership of the database and public schema it uses. Since Postgres 15 the
public schema no longer grants `CREATE` to `PUBLIC`, so without that ownership
the application could connect but not create its tables.

This is the same shape `acme-governance/scripts/rehearsal-db.sh` already builds
for migration rehearsals — whose header recorded this finding on 2026-09-19.

**An overlay rather than editing the dev compose files, deliberately.**
Changing `POSTGRES_USER`'s default in `docker-compose.dev*.yml` would reach
every developer and would not even work there: `initdb` runs only on an empty
data directory, so an existing local volume would keep `postgres` as its
bootstrap superuser while the compose file started asking for `pgboot`.
Everyone would have to `docker compose down -v` and lose local data to adopt a
change that exists purely to make CI honest. Those files are also upstream
Langfuse's, so each edit is merge friction on the next sync. The overlay keeps
the change where the problem is; local `docker compose up` is untouched.

**KNOWN AND DELIBERATE LIMITATION — CI's database naming still does not match
Azure.** The migration issues four `GRANT ... ON DATABASE langfuse` statements
with the name hardcoded, while CI connects to a database named `postgres`. That
is a *second, independent* mismatch from the bootstrap-superuser one, and it is
**not** addressed here. The init script creates `langfuse` as an **empty**
database purely so those grants resolve; nothing connects to it and nothing is
migrated into it. So: **CI's role structure now matches Azure; CI's database
naming does not.** Whether that hardcoded name is portable to a customer
deployment whose database is named differently is a separate, unproven question
filed on its own and cross-referencing ACME-Rayin#23.

**Scope:** two new ACME-owned files, plus `pipeline.yml` wiring (7 dev-compose
invocations and 5 in `test-docker-build`, whose web image runs
`prisma migrate deploy` on boot and hit the same failure). No upstream compose
or `.env` file changed.

## 2026-09-23 — Guardrail hook reads LiteLLM's real input shape, and its health record prints (CHG-2026-044)

| | |
|---|---|
| **Change ID** | CHG-2026-044 · Tier 1 · owner: Anees Ur Rahman |
| **ADR** | [ADR-0005](acme-governance/adr/ADR-0005-gateway-guardrail-hook.md) (no ADR change: this corrects the implementation, not the design) |
| **Approval** | Owner approved the fix 2026-09-23. Merge is the owner's. |
| **Dates** | Dev: source only, not applied. The switch-on attempt that found this ran 03:16–03:21 UTC and was reverted |
| **Impact** | None until the hook is switched on again. Hook file and tests only |
| **Schema change** | None |
| **Rollback** | Revert the commit. Nothing live depends on it |
| **Feature flag** | The `guardrails:` block in the gateway ConfigMap (`default_on`), unchanged |

**What happened.** The first switch-on (B2, owner-approved) applied the ConfigMap with both files and
restarted the gateway. B3 passed: LiteLLM loaded `cairo_guardrail_hook.CairoGuardrail` from the
ConfigMap mount, with `default_on: true`, record mode and the shared secret present. **B4 failed.**
Two test requests returned 200, but rayin-guardrails received no `/v1/guard` call and the gateway log
held no health record. The ConfigMap was restored from the captured anchor and the gateway restarted;
the restored config was verified identical to the anchor, and the gateway lists no guardrails. No
caller saw an error at any point.

**Three defects, all the same kind: the hook assumed shapes LiteLLM 1.100.1 does not use.** Read from
the running image, not inferred:

1. **Input.** LiteLLM's unified guardrail layer calls `apply_guardrail` with
   `GenericGuardrailAPIInputs`, a dict `{"texts": [...]}`
   (`llms/openai/chat/guardrail_translation/handler.py`). `extract_text` read a dict as a single
   chat message, looked for `content`, found none, and returned None. So every request recorded
   `guard_unreadable`, `called: false`, and nothing was inspected.
2. **Health record.** The `cairo.guardrail` logger emits at INFO, which the gateway does not print, so
   CHG-2026-041's record was silently dropped. The unit tests set the logger's level themselves, which
   is why they passed.
3. **Return value (enforce only).** LiteLLM reads `.get("texts")` from what the hook returns. An
   enforced redaction returned a bare string, which would have crashed the request rather than
   redacting it. Not reachable today; fixed because it is the same mismatch.

**Fix.**
- `extract_text` reads `{"texts": [...]}` and still reads the older shapes.
- The logger gets its own stdout handler at INFO, with propagation off, and is re-enabled if the host
  disabled it. It is set up at import and again at construction.
- A redaction is returned as `{"texts": [redacted]}`. Several texts are checked as one joined string,
  so a redaction across several cannot be mapped back onto them; that refuses rather than guesses.

**Verification.**
- `python -m unittest discover -s integrations/litellm/tests`: 79 pass (70 before, 9 new).
- Control: the new tests run against the old hook gave 5 failures and 2 errors, so they detect the
  defects.
- New `integrations/litellm/tests/in_image_check.py`, run inside the live gateway pod with the hook
  piped in and nothing written to the pod: **PASS**. LiteLLM's own input type was read, guardrails was
  called and answered `allow` in 621 ms, the input came back unchanged, and the health record printed.
  That also proves the B1 secret matches: a mismatch would have been a 401 and `guard_unavailable`.

**Lesson.** 70 passing unit tests encoded the same wrong assumption as the code. The in-image check is
now a required step before the next switch-on, alongside B4's forged-metadata test.

**Deployment status:** source only. Switching on again is B2–B5, owner-gated.

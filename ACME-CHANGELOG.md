# ACME Customization Changelog

This file catalogs every ACME-specific customization made to this Langfuse fork —
what changed, why, how it works, and its current status. It exists so this fork can
go to production with full context, not as a pile of undocumented patches.

**Convention going forward:** every ACME change lands as its own commit (never bundled
into an unrelated change), and gets an entry here in the same commit. See
`CONTRIBUTING-ACME.md` for the exact process.

**Versioning:** every change that reaches the live deployment gets an annotated git
tag at that commit, `acme-v4.33.0.N` (N incrementing: `.1`, `.2`, ...), pushed to
`origin`. The tag message lists the full current ACME feature set, so
`git clone` + `git checkout <tag>` reliably reconstructs exactly what was live at
that point — no need to replay commit history or guess which combination of patches
was actually deployed. See "Tagging convention" below for what a tag does and does
not capture.

**Base version:** Langfuse `v4.35.0` (upgraded from `v4.33.0` on 2026-09-11 — see
"Upgrade to v4.35.0" below; that was itself upgraded from `v4.17.0` on
2026-09-10, see "Upgrade to v4.33.0"), Helm chart `2.0.0` — matches what's live
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

## Outstanding, not yet done

- **Root-cause the remaining ACR build flakiness on branches carrying the
  Assurance/guardrail-persistence code** — see the 2026-09-16 follow-up
  entry above. `/dev/shm` sizing is a real, partial lever (proven: it's
  the only variable that ever converted a hang into forward progress) but
  not a complete, deterministic fix — one run hung for 90+ minutes even
  with `--shm-size=2g` on a freshly-provisioned agent. PR #8's own smoke
  test (migration + application-path validation) has not yet run because
  of this — it's still blocked, not merged.

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

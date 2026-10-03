# CHG-2026-100: Upstream Langfuse sync, v4.38.0 to v4.50.x — plan

| | |
|---|---|
| **Change ID** | CHG-2026-100 · Tier 1 (authentication, roles, migrations) |
| **Owner** | Anees Ur Rahman |
| **Status** | Plan approved by the owner on 2026-10-03. Nothing merged from upstream, built or deployed yet |
| **Date** | 2026-10-03 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | Plan: approved by the owner, 2026-10-03 ("Yes plan approved"). Each live step (the upgrade PR merge, the web release, the worker release) still needs its own owner go-ahead. No self-approval (N-47/N-48) |
| **Basis** | ACME-Rayin `main` at `a407816d5`; upstream tag `v4.50.0` (`ef1075337`); local trial merges on 2026-10-03 against `main` and again against `a407816d5`, both discarded. Same 31 conflicts both times |

## 1. Summary

CAIRO runs Langfuse v4.38.0. Upstream has shipped twelve releases since (v4.39.0 to v4.50.0, 21 Sep to 2 Oct 2026): 321 commits and 2,139 files. They include 5 Postgres migrations, 1 ClickHouse migration and 51 Enterprise-licensed files.

A trial merge of `v4.50.0` into `main` gives **31 conflicts**, almost all in screens ACME rebranded or restructured. Ten security-sensitive files merge cleanly but still need a line-by-line review.

**Recommendation:** do one planned sync, with the same method as v4.38.0 (§4). Start only after CHG-2026-089 part b is released or explicitly parked (§3). Expect about a day of conflict work, then a full role test, then two releases (web, then worker).

## 2. Why sync

**Already in CAIRO, not a reason to sync:** upstream's API-key revocation fix (#17651) and SCIM organization scoping (#17828). Both were cherry-picked under CHG-2026-076 / ADR-0012 and are live since `acme-v4.38.0.19`. The sync recognises them as already applied.

**Gained:**

| Area | Upstream change (release notes) | Value for CAIRO |
|---|---|---|
| Data integrity | The worker awaits in-flight ClickHouse writes during shutdown (#17836) | Each worker restart or release can drop trace writes today |
| Auth path | Every ingestion event authorised through one policy core (#16715); prompt public handlers through the auth seam (#17533) | Fewer side paths into project data |
| SSO | IdP-reported issuer omitted from discovery errors (#17880) | Less detail leaked on a failed sign-in |
| Cost | Anthropic 1-hour cache writes and OpenAI cache writes priced correctly (#17958, #17957) | Recorded spend closer to the bill |
| Review | Comments and annotation beside traces and sessions (#17745); unified score editing and review state (#17740); scores from the annotation sidebar (#17815) | Fits reviewer and auditor work |
| Administration | Members filtered by role (#17810); organization-level analytics view (#18082) | Useful with eight CAIRO roles and several projects. Whether the analytics view is Cloud-only is **[REQUIRES VERIFICATION]** |
| Evaluations | Evaluator execution health (#18113), model checks before save (#18145), decision-model evaluators (experimental) | Builds on CHG-2026-086 f |
| Usability | Error id in error toasts (#17427), session tool filters, 100-row pages, prompt-name prefix filter in the API (#17779) | Small |

**Not used by CAIRO:** upstream's Rust AI gateway (CAIRO uses LiteLLM; `ai-gateway/` stays behind `restrictedFlags`), Langfuse Cloud billing, skill management, regional demo redirect.

## 3. Preconditions (all before the merge starts)

1. **CHG-2026-100 on `main`** (claim #291 merged).
2. **CHG-2026-089 part b**: phase 3 (console, guardrails, gateway) released, or parked by the owner. **Met on 2026-10-03:** console `acme-v4.38.0.31`, rayin-guardrails `v0.5.0` and the gateway hook are live in dev (#277, #278, #279). The sync touches the same Guardrails and router files; running both at once doubles the review load.
3. **PD-0002 (four-week freeze)**: the owner decides whether the sync falls inside or outside it.
4. **CI**: CI/CD has failed on the last 25 `main` runs (lint, knip, web, worker and client tests, e2e). The sync cannot rely on CI. Either the owner accepts local checks (§8) as the gate, or the CI fixes land first. Owner decision.
5. **Target pinned**: `v4.50.0`, or the latest `v4.50.x` patch on the day, chosen and recorded before the merge. Never `upstream/main`.
6. Owner go-ahead for the plan.

## 4. Method (as for v4.35.0 and v4.38.0)

1. Branch `upgrade/v4.50.0` from `main`.
2. Fetch the upstream **release tag** only, then `git merge` it. Resolve conflicts (§5) by keeping ACME behaviour on upstream's new structure.
3. Land with a **merge commit**. **Never squash** an upgrade PR: that severs the merge-base with upstream, and the next sync would re-conflict on every file.
4. Label the PR `upstream-sync`. The Enterprise-boundary check (`acme-ee-boundary.yml`) then warns instead of failing, and the reviewer confirms every Enterprise file is byte-identical to the tag (§8.3).
5. Changelog entry "Upgrade to v4.50.0" with the conflict list, migrations, env and build changes, in the v4.38.0 entry's format.
6. **Nothing ACME dropped silently:** for every file both sides changed, the ACME delta after the merge must have the same number of changed lines as before, or the difference must be explained (§8.2).

## 5. Conflicts (trial merge, 31 files)

"Owner change" is the ACME change that last shaped the file. Resolution: take upstream's structure and re-apply the ACME behaviour named.

| File | Owner change | ACME behaviour to keep |
|---|---|---|
| `web/package.json` | CHG-2026-058, -063 | Scripts and the knip fix; take upstream's versions |
| `web/public/wordart-black.svg`, `wordart-white.svg` | ACME branding (pre-register) | Keep ACME assets |
| `design-system/LangfuseLogo/LangfuseLogo.tsx` | CHG-2026-081 | CAIRO logo |
| `design-system/table/columns/createBadgeTableColumn.tsx` | CHG-2026-085 | White-label naming |
| `layouts/app-layout/hooks/useFilteredNavigation.ts` | CHG-2026-073, -081 | CAIRO navigation and role filtering |
| `layouts/app-layout/variants/AuthenticatedLayout.tsx` | branding, v4.38 port | `AcmeChatWidget`, `AcmeThemeStyleInjector` |
| `layouts/default-head/getPageMetadata.ts` | CHG-2026-085 | "\| CAIRO" titles |
| `layouts/mobile-top-bar.tsx`, `layouts/page-header.tsx` | CHG-2026-080 | ACME AI in the top bar, header background |
| `layouts/routes.tsx` | CHG-2026-005, -059, -073, -074, -081, -083 | Every CAIRO route, role gate and section; the largest single conflict |
| `nav/book-a-call-button.tsx` | removed by ACME | **Keep deleted** (modify/delete) |
| `auth-credentials/components/ResetPasswordPage.tsx` | CHG-2026-085 | Naming |
| `auth/lib/createProjectMembershipsOnSignup.ts` | CHG-2026-058 | Invite-only sign-up behaviour |
| `dashboard/DashboardDetailPage.tsx`, `dashboard/ProjectHomePage.tsx` | CHG-2026-059, -085 | Role redirects (e.g. Security Analyst to Guardrails), dashboard naming |
| `dashboard/components/DashboardTable.tsx` | v4.38 port, CAIRO rename | **Deleted upstream** (modify/delete). Port the CAIRO naming to upstream's replacement table |
| `developer-tools/components/AgentToolsBanner.tsx` | CHG-2026-064 | "ACME CAIRO … Connect with us" banner |
| `filters/components/filter-builder.tsx` | CHG-2026-085 | Environments shown as `cairo-*` |
| `projects/ProjectSettingsPage.tsx` | CHG-2026-059, -065 | Role gates; upstream Audit Logs entry stays removed |
| `prompts/components/prompt-detail.tsx`, `prompts-table.tsx`, `pages/project/[projectId]/prompts/[[...folder]].tsx` | CHG-2026-059 | Prompt review dates, approval, content-free role hiding |
| `rbac/components/MembersTable.tsx` | CHG-2026-072 | **Deleted upstream** (moved to the design-system table). Port the CAIRO "Project access" column and the eight role labels to the new table |
| `traces/TracePage.tsx`, `traces/components/TraceMetadataBadges.tsx` | CHG-2026-085 | Naming |
| `pages/api/public/scim/Users/[id].ts`, `Users/index.ts` | CHG-2026-058, -059, -076 | The CHG-2026-076 cherry-pick is upstream code: take upstream; re-apply only the ACME role mapping (CHG-2026-059) |
| `pages/auth/enterprise-sso-required.tsx`, `pages/auth/sso-initiate.tsx` | CHG-2026-085 | Naming |
| `pages/organization/[organizationId]/settings/index.tsx` | CHG-2026-059 | Organization settings > Project access entry |

## 6. Clean merges that still need a line-by-line review

A clean text merge can still break behaviour. Each file below is reviewed against its ACME change, and the reviewer records the result in the PR.

| File | Why |
|---|---|
| `web/src/server/api/trpc.ts` | Holds the content-free roles' server-side allow-list middleware (CHG-2026-059) |
| `packages/shared/src/features/rbac/projectAccessRights.ts` | CAIRO role scopes (Business Analyst, Auditor, Security Analyst) |
| `web/src/features/rbac/server/membersRouter.ts` | Role assignment and project access ceilings |
| `web/src/features/public-api/server/apiAuth.ts`, `packages/shared/src/server/auth/apiKeys.ts` | Upstream reworked the API-key path (#16715, #17533); ACME's public endpoints use it |
| `web/src/server/auth.ts` | Invite-only Entra sign-up (CHG-2026-057), `AUTH_DISABLE_SIGNUP` |
| `packages/shared/prisma/schema.prisma` | ACME models (11 `acme_*` tables) beside upstream's new ones |
| `web/src/env.mjs` | 178 ACME lines of `CAIRO_*` flags |
| `web/src/server/api/root.ts` | ACME routers |
| `web/src/components/nav/AppSidebar/AppSidebar.tsx` | CAIRO sidebar |

## 7. Migrations

| Migration | What | Reversible? |
|---|---|---|
| `20260921150000_add_decision_model_eval_template_type` | `ALTER TYPE "EvalTemplateType" ADD VALUE 'DECISION_MODEL'` | **No.** Postgres cannot drop an enum value. Older code ignores it unless a row uses it |
| `20260921191000_add_evaluator_version_questions` | `evaluator_versions.questions JSONB` | Yes (drop column) |
| `20260923120000_in_app_agent_conversation_retention_index` | `CREATE INDEX CONCURRENTLY` on `in_app_agent_conversations` | Yes (drop index) |
| `20260924174440_skill_management` | New table `skills` | Yes (drop table, if empty) |
| `20261001160000_add_facet_evaluator_type` | Enum value `FACET`; `evaluators.is_built_in`; `evaluation_rules.idle_time` | Enum value **no**; columns yes |
| ClickHouse `canonical/0050_scores_trace_index_granularity` | Adds `idx_project_trace_observation_v2` on `scores`, materialises it (`mutations_sync = 2`), drops the old index | Yes via its `down.sql`. Older code is unaffected |

**Checks in the rehearsal** (`acme-governance/scripts/rehearsal-db.sh`, on a throwaway Postgres 15):
1. **Ordering.** Upstream timestamps (20260921 to 20261001160000) interleave with ACME migrations that dev has already applied (`20261001120000_add_acme_guardrail_settings`, `20261002120000_acme_guardrail_enforcement_switch`). Confirm `prisma migrate deploy` applies the older-named pending ones without refusing. **[REQUIRES VERIFICATION]** in the rehearsal.
2. **`CREATE INDEX CONCURRENTLY`** cannot run inside a transaction. Confirm Prisma applies it as upstream intends.
3. **Grants.** The new `skills` table and columns get no grant to the ACME least-privilege roles (`rayin_app_runtime` and others). The app still connects as the admin login (P0-5), so nothing breaks today. Record it on the ADR-0004 cutover list.
4. **Full order** from an empty database and from a dev-shaped database.
5. **ClickHouse 0050** on a copy with representative `scores` volume: time the materialise step (it runs at web start-up, synchronously).

Add `down.sql` and `ROLLBACK.md` under `acme-governance/rollback/` for the reversible parts, and record the two enum values as irreversible in `MIGRATION-ROLLBACK-INVENTORY.md`.

## 8. Verification before merge

### 8.1 Local checks (CI cannot be relied on, §3.4)
The recipe recorded for web checks: regenerate Prisma and rebuild `@langfuse/shared`, then `web/scripts/typecheck.mjs`, eslint on every changed ACME file, and the ACME server tests (`acme*.servertest.ts`, RBAC and public-API tests). The release build sets `NEXT_IGNORE_BUILD_ERRORS=true`, so a type error will **not** stop the image build. The local typecheck is the only gate for types.

### 8.2 ACME delta check
For every file both sides changed (65 against `a407816d5`), compare the ACME delta before and after the merge (`git diff v4.38.0 main -- <file>` against `git diff v4.50.0 upgrade/v4.50.0 -- <file>`). Any difference is explained in the PR.

### 8.3 Enterprise files byte-identical
`git diff v4.50.0 upgrade/v4.50.0 -- ee/ web/src/ee/ worker/src/ee/ packages/shared/src/server/ee/` must be empty. Paste the result in the PR.

### 8.4 Role test matrix (dev, after the web release; signed-in users)

| Screen or action | Owner | Admin | Prompt Analyst | Viewer | Security Analyst | Business Analyst | Auditor | "No access" ceiling |
|---|---|---|---|---|---|---|---|---|
| Sign-in (invite-only Entra) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Landing page and redirects | home | home | home | Spend | Guardrails | per ADR-0011 | per ADR-0011 | no project |
| Governance Controls: Guardrails, Policies card, Enforcement card | edit if listed | edit if listed | per scope | hidden | read-only | per scope | read-only | none |
| LLM Gateway: keys, models, spend | ✓ | ✓ | Spend only | Spend only | per scope | per scope | per scope | none |
| Prompts: list, detail, approve | approve | approve | edit | none | hidden | hidden | hidden | none |
| Observability: traces, sessions (content) | ✓ | ✓ | ✓ | none | **no content** | **no content** | **no content** | none |
| Reports / Logs, four tabs | ✓ | ✓ | per scope | none | ✓ | per scope | ✓ | none |
| Settings > Members, "Project access" column | ✓ | ✓ | view | none | per scope | per scope | per scope | none |
| Organization settings > Project access | ✓ | ✓ | none | none | none | none | none | none |
| New upstream screens (comments and annotation beside traces, org analytics) | check | check | check | check | **must not show content** | **must not show content** | **must not show content** | none |

"Per scope" and "per ADR-0011" are read from `projectAccessRights.ts` and ADR-0011 at test time; the expected value is written into the test record before the test. The last row is the main new risk: every new upstream screen that shows prompt or trace content must be blocked for the content-free roles, on the server as well as in the page.

### 8.5 Telemetry and egress
`TELEMETRY_ENABLED=false` in dev. Upstream changed 7 PostHog files, including a new evaluator onboarding funnel (#18075). Confirm in the browser's network panel that no PostHog request leaves the console with telemetry off. This belongs to the parked egress item (PARKED 2026-09-25).

## 9. Configuration and build

- **New env variables, all optional:** `CLICKHOUSE_EXTRA_SETTINGS`, `CLICKHOUSE_EXTRA_SETTINGS_READ_ONLY`, `CLICKHOUSE_EXTRA_SETTINGS_EVENTS_READ_ONLY`, `LANGFUSE_AI_PROVIDER`, `LANGFUSE_AI_VERTEX_LOCATION`, `LANGFUSE_OTEL_INGESTION_WORKER_SHADOW_ENABLED`. `LANGFUSE_CACHE_API_KEY_TTL_SECONDS` is already in CAIRO through CHG-2026-076. None needs setting in dev. **[REQUIRES VERIFICATION]**: confirm each default in `env.mjs` after the merge.
- **pnpm** 12.4.1 → 12.6.0 (`packageManager`, both Dockerfiles).
- **Docker build:** the image now installs `curl` and `patch` and prepares a ClickHouse source overlay for the native encoder. That adds a download at build time. Record what it fetches and from where, for the supply-chain record (Rust 1.98.0 and `packages/native` are already there since v4.38.0).
- `release.sh` checks the ACR step count against the exported Dockerfile; expect a new count.

## 10. Release (each step OWNER GATE, Tier 1)

1. Owner merges the upgrade PR (merge commit).
2. Pre-release checks, read-only: tags unused; Postgres point-in-time restore window recorded; web and worker 2/2 and 1/1 ready.
3. **Web** `acme-v4.50.0.1`: `release.sh --env <ops-repo>/envs/dev/web.env --version acme-v4.50.0.1`, dry run first. Migrations run at web start (§7). Watch the first pod's migration log; time the ClickHouse 0050 materialise.
4. **Worker** `worker-acme-v4.50.0.1`: `release.sh --env <ops-repo>/envs/dev/worker.env --version acme-v4.50.0.1` (no `worker-` prefix in `--version`).
5. `verify-deployed.sh` for web and worker; health; the role test matrix (§8.4); telemetry check (§8.5).
6. Records: changelog "Deployment status", register status, deployment record in the private ops repo, Readiness Ledger, Vision Tracker, portfolio `CLAUDE.md`.

## 11. Rollback

| Layer | How | Limits |
|---|---|---|
| Web image | `release.sh --env web.env --redeploy acme-v4.38.0.<last>` | The schema stays. Older code ignores the new columns, table and index. The two enum values remain; harmless while no row uses them, so **no decision-model or facet evaluator is created in dev until gate C passes** |
| Worker image | `release.sh --env worker.env --redeploy worker-acme-v4.38.0.<last>` | Same |
| Postgres | `down.sql` for the reversible parts (§7) | Enum values cannot be removed |
| ClickHouse | `0050` `down.sql` | Re-materialising the old index takes time |
| Everything | Point-in-time restore | Never rehearsed (H-25). Last resort |

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A new upstream screen shows content to a content-free role | Medium | High (confidentiality) | §8.4 last row; server-side allow-list review of every new tRPC procedure (`trpc.ts`) |
| An ACME behaviour dropped in a conflict | Medium | Medium | §8.2 delta check; port lists in §5 |
| Type errors hidden by `NEXT_IGNORE_BUILD_ERRORS` | Medium | Medium | §8.1 local typecheck is mandatory |
| Migration order refused or slow | Low | Medium | §7 rehearsal; timed ClickHouse step |
| Telemetry leaves the console | Low | Medium | §8.5 |
| Collision with CHG-2026-089 part b | High if run together | Medium | §3.2 |
| No CI safety net | Certain | Medium | §3.4, §8.1 |

## 13. Effort and order

1. Preconditions (§3).
2. Merge and conflict work: about one working day.
3. Migration rehearsal and rollback files: half a day.
4. Local verification and review (§6, §8.1 to §8.3): half a day.
5. Owner review and merge.
6. Web release, worker release, role test (§10): half a day with the test users available.

## 14. Open questions for the owner

1. Does the sync fall inside the PD-0002 freeze?
2. Fix CI first, or accept local checks as the gate for this sync?
3. Release CHG-2026-089 part b first (recommended), or park it?
4. Which test users exist for each role in §8.4? Business Analyst and Auditor test users are still to be invited.
5. Target: `v4.50.0`, or the newest `v4.50.x` patch at the time of the merge?

@AGENTS.md

# ACME-Rayin — CAIRO

ACME's governed-AI platform for regulated buyers (Bahrain BFSI and government): a fork of **Langfuse v4.35.0** plus ACME governance features: guardrail audit trail, prompt approvals, a Security Analyst role and branding. The upstream Langfuse guidance above (AGENTS.md) still applies; this file adds what is specific to the ACME fork.

- **This repo is public and holds the product only.** Environment values (hosts, resource names, env files, runbooks, deployment records) live in the private repo `samrayin/acme-rayin-ops`. Never commit environment-specific detail here.
- Companion service: `samrayin/rayin-guardrails` (separate repo).
- Changelog: `ACME-CHANGELOG.md`. Process: `CONTRIBUTING-ACME.md`. Data design: `POSTGRES-COMPLIANCE-FRAMEWORK.md`.

## Stack and tooling

- Node 24, pnpm 12.3.1, Turborepo. TypeScript throughout.
- `web/`: Next.js console, tRPC routers and the public REST API.
- `worker/`: BullMQ worker (queues, evaluations, exports).
- Postgres via Prisma (`packages/shared/prisma`); ClickHouse (traces); Redis; Azure Blob.
- Deployed on Azure: AKS, ACR (images are built there, never locally), Application Gateway, Entra ID SSO. Terraform module in `infra/langfuse-terraform-azure`.
- Tests: vitest (`web/vitest` projects); rayin-guardrails uses pytest.

## Commands

On Windows, run these from Git Bash. A fresh checkout needs:

```bash
pnpm install --frozen-lockfile          # the root postinstall may fail on the agent-shim script's Windows path bug; packages still install
cd packages/shared && ./node_modules/.bin/prisma generate && npm run build   # web resolves @langfuse/shared from dist/
```

| Task | Command |
|---|---|
| Unit tests (no DB) | `cd web && DOCKER_BUILD=1 DATABASE_URL=postgresql://t:t@localhost:5432/t NEXTAUTH_URL=http://localhost:3000 SALT=test CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=t CLICKHOUSE_PASSWORD=t ./node_modules/.bin/vitest run --project server-unit <files>` |
| Type check | `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json` (≈10 min). One **pre-existing** error: `AcmeAuditLogsTable.tsx(114)` |
| Lint | `cd web && ./node_modules/.bin/eslint <files>` (build `packages/eslint-plugin` first: `npm run build` there) |
| Format | `./node_modules/.bin/prettier --write <new files>`. Don't reformat existing ACME files that were already unformatted on `main` |
| Deploy | `scripts/release/release.sh --env <acme-rayin-ops>/envs/<env>/<component>.env --version acme-v4.35.0.N` |
| Roll back | `scripts/release/release.sh --env … --redeploy <tag>` |
| What is running? | `scripts/release/verify-deployed.sh --env …web.env --env …worker.env` |

`release.sh` **is** the deploy command: clean LF export → ACR build → annotated tag (commit, image, digest) → `kubectl set image …@digest`. See `scripts/release/README.md`. Never deploy with a bare `kubectl set image`; it shows up as UNTRACED.

**CI reality:** the `CI/CD` workflow (lint, Prettier, tests, Docker builds) needs `blacksmith-*` runners that aren't attached to this fork, so it never completes. Only GitHub-hosted checks run: CodeQL, Semgrep, zizmor, license, PR title and the ACME changelog check. Codespell, "Security review" and the conflict labeller fail on every PR for pre-existing reasons. **Local verification is the real gate:** run the unit tests, type check and lint yourself, and say which ones you ran.

## Architecture (ACME view)

```
apps / agents ──▶ LiteLLM gateway ──▶ rayin-guardrails (allow / redact / block) ──▶ AI model
                                              │ async push (project API key)
staff ──▶ App Gateway ──▶ CAIRO web ◀─────────┘   POST /api/public/guardrails-events
                              │                   → acme_guardrail_events (append-only, INSERT-only writer role)
                              ├── worker ─▶ ClickHouse (traces) · Redis · Blob
                              └── Postgres (app data + audit trail)
```

- **CAIRO** is the web app, the worker and their data stores. The AI gateway and guardrails are infrastructure CAIRO configures and audits.
- **Not built yet:** mandatory routing through the gateway. Callers invoke guardrails directly.
- **Guardrail audit trail, content by action:** allow is metadata only; redact adds the redacted text and findings; block adds the raw content, encrypted with AES-256-GCM (`GUARDRAILS_ENCRYPTION_KEY`).
- **Pull fallback:** `acmeGuardrailsPullBackfill.ts` persists only events that have an `event_id` and are at least 60 s old.
- **Roles:**
  - Owner, Admin, Member and Viewer as upstream.
  - **SECURITY ("Security Analyst")** sees guardrail events and audit logs, never trace content. It's enforced by a server-side allow-list, `web/src/features/rbac/server/securityRoleAllowList.ts`, in every project-access path.
  - `projectData:read` gates trace, session and score content.
- **Prompt approvals** need a second person: nobody can approve their own request.
- Full picture: the CAIRO architecture reference and the Readiness Ledger (links in `C:\Cairo-acme\CLAUDE.md`).

## Where ACME code lives

| Path | What |
|---|---|
| `web/src/features/acme-enhancements/` | All ACME UI pages, components and tRPC routers (`acme*Router.ts`), including guardrails, audit logs, prompt review/approval, theme, chat |
| `web/src/pages/api/public/guardrails-events.ts` | Audit push endpoint (project API key, scope `guardrailsEvents:create`) |
| `web/src/features/rbac/server/securityRoleAllowList.ts`, `…/hooks/useIsSecurityAnalyst.ts` | Security Analyst enforcement |
| `packages/shared/src/features/rbac/projectAccessRights.ts` | Role → scope map (ACME scopes marked `// ACME:`) |
| `packages/shared/prisma/migrations/2026091*` | ACME migrations: guardrail events, DB roles, approvals, SECURITY role |
| `integrations/` | LiteLLM gateway manifests, prompt library seed, promptfoo red-team |
| `infra/langfuse-terraform-azure/`, `deploy/customer-template/` | Terraform module and per-customer root config |
| `deploy/azure/` | Dev root config. See "Don't touch" |
| `scripts/release/` | Release and deploy scripts |

## Conventions

- **Branches:** `feat/…`, `fix/…`, `docs/…`, `chore/…` from `origin/main`. **Squash merge.** PR titles are conventional commits (`validate-pr-title`).
- **Changelog:** every PR that changes product code adds an `ACME-CHANGELOG.md` entry in the same PR. The changelog check enforces it; opt out only with the `no-changelog` label.
- **Versions:** `acme-v<upstream base>.<n>` (e.g. `acme-v4.35.0.8`). An annotated git tag at the exact built commit, created by `release.sh`. The worker's tags are `worker-acme-v…`. Versions are never reused.
- **Tags make a deployment traceable, not reproducible.** Rebuilding on a customer subscription is unproven until the Terraform end-to-end run passes (#23). Keep those two claims separate in writing.
- **Migrations:** `YYYYMMDDHHMMSS_<verb>_acme_<thing>`. Additive and nullable where rolling deploys overlap. Audit rows are never backfilled.
- **ACME changes inside upstream files** carry an `// ACME:` comment saying why. They're merge burden, so keep them few.
- **Naming:** the product is **CAIRO** (renamed from RAYIN on 2026-09-16). Env vars and service names keep `RAYIN_*` / `rayin-*` on purpose.
- **Verification wording:** say what was actually verified (synthetic smoke test, unit tests, a browser check) and what wasn't. Never imply real traffic that hasn't happened.

## Don't touch without explicit owner sign-off

- **`acme_guardrail_events`:** append-only. No UPDATE, DELETE or backfill, and no manual deletes of test rows. Removal is only by the 30-day retention job, which isn't built yet.
- **DB role grants** (migration `20260917090000`) and the writer-client isolation in `acmeGuardrailsEventsIngestService.ts`.
- **`ENCRYPTION_KEY` / `GUARDRAILS_ENCRYPTION_KEY`:** no rotation. There's no re-encryption tooling.
- **Security Analyst allow-list:** never add trace, observation, session, score, dashboard, dataset, prompt or AI-assistant procedures to it.
- **`deploy/azure` Terraform state:** **never `terraform apply`.** Reconciliation is incomplete, and an apply would recreate Key Vault, Storage and passwords.
- **Root `CLAUDE.md` is hand-written.** The agent-shim sync is patched to leave it alone. Don't turn it back into a symlink. `.agents/AGENTS.md` is upstream-owned.
- **Branch `feat/promptfoo-evals`:** its history contains large Terraform binaries. Never push it or base work on it.
- **Secrets:** never print, echo or commit values, even partially. Refer to Secrets by name.
- **Build exports:** always `git -c core.autocrlf=false -c core.eol=lf archive`. CRLF corrupts `patches/*.patch` and entrypoint scripts.
- **Working folders:** all clones, worktrees and build directories go under `C:\Cairo-acme\` (build exports: `C:\Cairo-acme\_build\`). Nothing under `C:\` root.

## Open items to know about

See `ACME-CHANGELOG.md` → "Outstanding, not yet done". The biggest:
- Terraform end-to-end run (#23).
- Callers must send `user_id` / `client_host` (#20).
- Recorded identity is caller-asserted (Ledger N-34).
- Worker image not yet released through `release.sh`.

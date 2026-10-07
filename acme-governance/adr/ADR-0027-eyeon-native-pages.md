# ADR-0027 — EYEON-native pages: the pattern, with the overview as the first

| | |
|---|---|
| **Change ID** | CHG-2026-132 |
| **Owner** | Anees Ur Rahman |
| **Affected release** | The first console release after merge (tag to be added at release) |
| **Status** | Proposed |
| **Type** | Forward |
| **Date** | 2026-10-07 |
| **Author** | Claude (EYEON build session), for the owner |
| **Approval** | Pending. The owner reviews and merges; no self-approval |
| **Commits / tag** | To be added at merge · release tag to be added at release |

## 1. Purpose
ADR-0026 adopts the EYEON prototype's look and feel as a layered build: the dark palette (slice 0), the shell (slice 1), then EYEON-native pages. The console's custom-dashboard widgets cannot build those pages: they query only trace, observation and score data in ClickHouse, while EYEON's own data (guardrail decisions, guardrail settings, gateway keys, the gateway request log) is in Postgres. So each EYEON dashboard is a page of its own, about ten of them.

Without one pattern, each page would choose its own access rule, flag, wording and charts, and a content-free role could see something it should not through one of them. This ADR fixes the pattern once, and records the overview (CHG-2026-132) as its first instance.

## 2. Scope
**In:**
- The pattern every EYEON-native page follows (§3.1 to §3.5).
- The shared EYEON UI kit in `web/src/features/acme-enhancements/components/eyeon/`.
- The overview page, its router, flag, navigation entry and tests (§3.6).

**Out:**
- The dark palette and the theme injector (ADR-0026, slice 0, `globals.css`) and the shell and sidebar restyle (slice 1).
- The other dashboards: each is its own change under this ADR.
- Pointing Home at an EYEON page (a later slice, with its own flag).
- Storybook stories for the kit, webfonts, the iris chart and the decision-flow chart (later kit additions).
- Any change to roles or scopes, and anything under `ee/` or `web/src/ee/`.

## 3. Decision

### 3.1 One read-only, metadata-only router per page
- A tRPC router in `features/acme-enhancements/server/`, named for the page (`eyeon<Page>Router.ts`), registered in `root.ts`. Queries only: no mutation, no audit write, no call to another service.
- **Access:** the page reuses the access rule of the console page it summarises and checks it before any read. Spend and cost need `llmGatewaySpend:read`; without it the field is absent from the response, not null, so no screen can show it by mistake.
- **Metadata only:** the router never selects, groups by or queries prompt or answer text, `redactedText`, `piiFindings`, `rawContentEncrypted` or a key's token hash. It returns no person's id or email that the summarised page does not already show to that role.
- **Bounded reads:** a fixed number of queries whatever the data: `groupBy` counts, and day buckets in raw SQL with bound parameters only, every one scoped to the project and the period. Event times pushed by another service are bounded by the console's future-skew allowance, as on the Guardrails page.
- **Reuse, not copies:** where a figure already exists on a console page, the new page calls that page's aggregation. A copy would drift, and the two pages would disagree.
- **Shaping in a pure module** (`eyeon<Page>.ts`) with unit tests, so the figures are tested without a database.

### 3.2 Content-free allow-list and per-role tests
- Every new procedure goes on the allow-list of each content-free role that may open the page (`securityRoleAllowList.ts`), and on no other. `contentFreeRoles.servertest.ts` then proves it exists and is a query.
- One router test per page, in the style of `acmeApplicationsDetailRouter.servertest.ts`, against a mocked Prisma:
  - every role without the page's scopes, and every content-free role not on the list, is refused before any database read (the denial cases);
  - with the flag off the page answers "switched off" without a read;
  - spend is absent without its scope;
  - every `select`, every `groupBy` key and every SQL statement is checked for content columns;
  - the number of reads does not grow with the data.
- The pinned per-role sidebar list (`acme-role-navigation.clienttest.tsx`) is updated on purpose when a page adds an entry.

### 3.3 A flag per page, with the classic fallback
- A server-only flag `CAIRO_EYEON_<PAGE>_ENABLED`, `"true"` or `"false"`, default `"false"`, declared and documented in `web/src/env.mjs`. No `NEXT_PUBLIC_` form: the flag switches with a restart, not a rebuild, and stays out of the browser bundle.
- **Off:** the page's query returns `{ enabled: false }` without a database read; the page says it is switched off and links to the classic page; the navigation entry renders nothing. The entry learns the flag from a small `status` query on the same router, allow-listed with the page, through a `menuNode` gate, which is how the LLM Gateway entry already follows `CAIRO_LITELLM_MANAGEMENT_ENABLED`.
- The classic pages stay as they are. A classic page is retired only after the owner signs its EYEON page off, in a change of its own.
- **Known limit:** the Ctrl/Cmd K "Go to" list is built from the route list and does not ask the flag, so it still lists the entry while the page is off; opening it shows the switched-off notice. The LLM Gateway entry behaves the same today.

### 3.4 Honest labels are states, not text
- The kit's figure has three states: **measured** (a value), **Not recorded** (no value at all) and **Preview** (a value, always with its tag). A page cannot render an unmeasured figure as a number, because the type has nowhere to put one.
- The wording follows the prototype's honesty rules (its README §10), which win over layout:
  - "Gateway traffic only": never a claim that every prompt is checked.
  - The mode is "Enforce mode", "Record mode" or "Not reported", always with the ceiling.
  - A decision is "Blocked" or "Redacted" only where the gateway reported enforce mode; otherwise "Would block" or "Would redact". This is CHG-2026-116's rule, and the kit reuses its function (`guardrailVerdictLabel`).
  - A count over a period says how much of it was applied: "Prompts refused", "Prompts that would be refused", or "Prompts refused or would be", with the split beside it.
  - Guardrail latency is "Not recorded". The audit log is "recorded", never tamper-proof or certified. There are no compliance claims, and the upstream product is never named.
- Each page lists what it deliberately does not show, and why.

### 3.5 The UI kit and its charts
- `components/eyeon/` holds:
  - `EyeonKpiTile`: a label, the figure in its state, an optional trend, an optional delta or status line, one line on what is counted, and an optional link;
  - `EyeonCard`: a title, one sentence on what the card tells, and an optional link and footnote;
  - the mode, decision and rating chips (`EyeonChips`);
  - the honest labels (`EyeonHonestLabels`);
  - the charts (`EyeonCharts`): a sparkline, a ring for a share, a bullet for a value against a target, and a table view.
- It is built on the console's shadcn `Card` and `Badge` and its tokens only: no new dependency, no inline styles, no arbitrary colour classes, `font-bold` as the only weight, a `title` on every truncated text, and no bitwise operators or `void`. Chart colours come through `currentColor` and token classes (`eyeonTones.ts`), so slice 0's palette applies with no change here.
- The charts are the prototype's SVG geometry, ported as typed components; the geometry is a pure module with unit tests. Every chart has an accessible name that states its figures, a hover title on each point, and, for a series, a "Show as table" view. A chart uses the accent or the status tones, never both, and a status colour always comes with words or an icon.
- Recharts stays the choice for ordinary lines and bars on later pages. Storybook stories for the kit come later; until then the kit's client test pins its states.

### 3.6 The overview, the first instance
- **Files:** the route `web/src/pages/project/[projectId]/acme-enhancements/overview.tsx` (a one-line re-export), the page `features/acme-enhancements/pages/EyeonOverviewPage.tsx`, the router `server/eyeonOverviewRouter.ts` with `server/eyeonOverview.ts`, the wording `utils/eyeonOverviewLabels.ts`, and the navigation entry `components/nav/eyeon-overview-nav-item.tsx`.
- **Queries:** `eyeonOverview.summary` `{ projectId, windowDays: 7 | 30 }` and `eyeonOverview.status` `{ projectId }`. Both are read-only, on the Auditor's allow-list, and use the Applications page's rule: `llmGateway:read` (Owner, Admin) or `evidence:read` (Auditor). Spend needs `llmGatewaySpend:read`. Security Analyst, Business Analyst, Prompt Analyst and Viewer are refused.
- **Flag:** `CAIRO_EYEON_OVERVIEW_ENABLED`, default off. "Overview" is the first entry under Governance Controls.
- **Reuse:** the Applications scorecards' reads and scoring moved, unchanged, into `loadApplicationScorecards` (`acmeApplicationsRouter.ts`), which both pages call. The scorecards query reads through `ctx.prisma` like the detail query (the same client), so a test compares the two pages' figures directly.
- **Shows**, for the last 7 or 30 days:
  - guardrail checks, prompts refused, answers withheld and redactions, each split by the mode the gateway reported, with a daily series;
  - decisions by verdict, with "Would block" kept apart from "Blocked";
  - the mode EYEON serves now, its ceiling, an enforce trial's switch-back time, and the last change of mode (when and to what, not who);
  - the share of checks decided in enforce mode;
  - the judge's no-verdict rate over 24 hours against the 1% alert;
  - the applications by rating and their top risks;
  - with the spend scope only, spend against each application key's budget.
- **Reads** (at most ten, whatever the data): the scorecards' six (two when there are no application keys), one decision `groupBy`, one daily query, the judge's `groupBy`, and the settings' mode history. While gateway management is off, the scorecards are skipped and the settings are read once on their own.
- **Not recorded, so not shown:** the guardrail's added latency; a project-level monthly budget (budgets are per key); the personal-data types behind redactions (findings are stored per event, and this page reads no content); traffic that bypasses the gateway; model health over time.
- **Left to their own pages:** approvals waiting, the live decision feed, evaluation scores, model health now, and audit events.
- Totals here count every guardrail check recorded for the project. The Applications page counts application keys only, so its totals can be lower; the page says so.

### 3.7 Alternatives rejected
- **Custom-dashboard widgets:** they reach ClickHouse only, and adding a Postgres view means changing upstream's query engine, the costliest file to keep in sync.
- **One router for every EYEON page:** pages have different audiences, so one access rule would be too wide for some of them.
- **Calling the Applications query from the overview's query** (a server-side caller): it re-runs the middleware and the access check for every call, and the tRPC guidance is to share a function instead. That is what the loader does.
- **A browser flag (`NEXT_PUBLIC_`):** it is baked into the bundle at build time and exposes deployment configuration.
- **Copying the scorecard's aggregation:** the two pages would drift and disagree.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres schema | None |
| ClickHouse | None |
| Web / API | New router `eyeonOverview` (two queries); the scorecards' reads moved into a shared loader, unchanged; two allow-list entries; one route entry; new page, kit and navigation entry |
| Worker | None |
| Infra / Terraform / Helm | None. The flag is unset (off) until an operator sets `CAIRO_EYEON_OVERVIEW_ENABLED=true` on the console |
| Integrations (LiteLLM, NeMo, promptfoo) | None |

## 5. Database change
- **Migration:** none.
- **Backfill:** none.
- **Rollback:** switch the flag off, or redeploy the previous image. Nothing is stored, so nothing is lost.

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A content-free role sees spend or content through the new page | Low | High | Allow-list entries for the Auditor only; tests for every refused role before any read, spend absent without its scope, and no content column in any select, group or SQL |
| The extracted loader changes the Applications page | Low | Medium | Moved unchanged; a test compares the two pages' figures on the same data; the detail tests still pass |
| The overview and the Applications page show different totals | Medium | Low | Stated on the page: project-wide checks against application keys only |
| The entry still appears in Ctrl/Cmd K while the flag is off | Certain while off | Low | The page shows the switched-off notice; the same as LLM Gateway today (§3.3) |
| A status colour reads alike in dark mode (Watch and redaction share yellow) | Medium | Low | Words and icons on every chip; a separate warn token is needed from slice 0 (§10) |
| Merge cost in the v4.50 sync | Medium | Low | One-line additions to `routes.tsx`, `root.ts` and `env.mjs`; everything else is in new files |

## 7. Compatibility
- Backward compatible with the previous image: yes. No schema change; with the flag off, nothing a user sees changes except that the Ctrl/Cmd K list includes the entry (§3.3).
- Upstream merge risk: `routes.tsx` (one entry), `root.ts` (one line) and `env.mjs` (one flag) are on the sync's list; the rest is in ACME folders.
- Feature flag: `CAIRO_EYEON_OVERVIEW_ENABLED`, default `"false"`. Removed once the owner signs the overview off and it becomes the default.

## 8. Client-facing notes
None until the flag is switched on. Then Owners, Admins and Auditors see "Overview" first under Governance Controls; Auditors see it without spend.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | Pending the owner's review | Router, pure-function, kit and navigation tests; the content-free role tests; a fresh typecheck; ESLint and Prettier on the changed files (see the changelog entry) |
| B — staging | `Staging: not available.` No migration to rehearse | — |
| C — post-deploy | Not yet | With the flag on: the page per role (Owner, Admin, Auditor), and refused for Security Analyst and Business Analyst |

## 10. Assumptions and open questions
1. **A warn token:** the prototype keeps "Watch" (orange) apart from redaction (yellow). The console has no orange status token, so the kit uses yellow for both, always with words. Slice 0 is asked for `--status-warn` (and `--status-neutral`).
2. **Default period:** 7 days, as the prototype; the Applications page defaults to 30. The owner may prefer one default.
3. **Ctrl/Cmd K while off:** acceptable as for LLM Gateway, or should the command list learn the flags (a change to an upstream file)?
4. **Who changed the mode:** the overview shows when and to what, not who, so it needs no masking rule for the Auditor. Should it name the person for Owners and Admins?
5. **Later pages' audiences:** a Business Analyst page (spend only) or a Security Analyst page (decisions only) needs its own allow-list entries under §3.2. This ADR does not widen any role.

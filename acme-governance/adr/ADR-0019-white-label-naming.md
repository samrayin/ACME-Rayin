# ADR-0019: White-label naming: CAIRO in page titles, and a display alias for Langfuse's internal environments

| | |
|---|---|
| **Change ID** | CHG-2026-085 · Tier 1 (client-visible: every browser tab title, and environment names across the console) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Not yet released |
| **Status** | Proposed |
| **Type** | Forward |
| **Date** | 2026-09-28 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | Pending. The owner asked for the change on 2026-09-28 and chose the environment option; merging and the dev deploy stay with the owner |
| **Commits / tag** | See the PR |

## 1. Purpose

On 2026-09-28 the owner asked for five things on the Home page to say CAIRO:
- the browser tab "Home | Langfuse";
- the organisation "ACME Langfuse";
- the project "Anees - Langfuse - Demo";
- the environment chip "langfuse-llm-as-a-judge";
- the dashboard "RayIn Home".

Three of these are names stored as data: the organisation, the project and the dashboard. They are renamed in the console and are not part of this change (§2). The other two come from code:
- **Tab titles:** Langfuse's page titles end in "| Langfuse".
- **Environment names:** Langfuse writes its own traces (evaluator runs, prompt experiments, natural-language filters, the in-app agent) under environment names that start with `langfuse-`. The console shows those names wherever it lists environments.

## 2. Scope

**In:**
- **Browser tab titles:**
  - every console page;
  - sign in and sign up;
  - reset and set password;
  - onboarding;
  - the SSO pages;
  - the error and not-found page.
- **The sign-in and password pages:** their meta description and `og:site_name`.
- **The public trace page:** its home link ("Langfuse" becomes "CAIRO").
- **How an environment name is displayed:**
  - the sidebar environment filter;
  - the filter builder;
  - the Home and dashboard environment selectors;
  - the Environment column of the traces, observations, scores, sessions, users and events tables;
  - the environment badge on a trace.

**Out:**
- **Stored environment values:**
  - `langfuse-llm-as-a-judge` stays `langfuse-llm-as-a-judge` in Postgres and ClickHouse, in saved views and filters, in URLs, and in the API;
  - the P0-8 retention purge still matches on it.
- **Renaming the organisation, project and dashboard:** data, done in the console.
- **Langfuse Cloud titles** ("| Langfuse Cloud"): these are used only when a Langfuse Cloud region is set, which CAIRO never sets.
- **Pages that name Langfuse as the upstream:**
  - the API reference ("Langfuse API Reference": it documents Langfuse's API and links to Langfuse's docs);
  - the Hugging Face sign-in page;
  - "maintained by Langfuse" labels on models and evaluator templates;
  - links to langfuse.com documentation.

## 3. Decision

- **One place names the product.** `acmeBranding.ts` exports `ACME_PRODUCT_NAME = "CAIRO"` and `acmePageTitle(page)`, which returns "page | CAIRO", or "CAIRO" when there is no page. Every changed title uses it.
- **The environment alias is a display label.**
  - `acmeEnvironmentLabel(env)` shows a name starting with `langfuse-` as `cairo-…`, for example `cairo-llm-as-a-judge`. Every other name is shown unchanged.
  - The alias uses the prefix rather than the five names in `LangfuseInternalTraceEnvironment` because Langfuse reserves the prefix: public ingestion strips `langfuse-` from customer environment names, so only Langfuse's own traces carry it. The prefix also covers `langfuse-evaluation`, which is hidden by default but is not in that enum.
  - `acmeEnvironmentOptions(options)` adds the label as the option's `displayValue`, which the shared selects and the sidebar facets already render. The value, the counts and any label already present are kept.
  - Typing "cairo" in a selector's search finds the aliased names, because the search matches on the displayed text.
- **Where it applies:**
  - the sidebar's categorical environment facet (one change in `useSidebarFilterState`, covering every table's sidebar);
  - the filter builder's environment column;
  - the Home and dashboard selectors;
  - `createBadgeTableColumn`, which today renders only environment columns;
  - `EnvironmentBadge`.
- **Correction to the claim:** the claim said this change would add a custom not-found page in place of the framework's. CAIRO already has its own error page (`_error.tsx`), which also serves not-found. The change only gives its title the "| CAIRO" suffix.
- **Rejected:**
  - *Renaming the stored environments* (a migration from `langfuse-*` to `cairo-*`): Langfuse's worker, evaluators and ingestion write and match the `langfuse-` names, including the default hidden-environment list, so every upstream upgrade would need the rename redone. P0-8's purge predicate would also have to change, and it has already been verified.
  - *Aliasing inside the shared `MultiSelect` for every value:* the component serves trace names, tags, users and more, where a value starting with `langfuse-` is not an environment.

## 4. Impacted components

| Component | Impact |
|---|---|
| Postgres schema / ClickHouse | None |
| Web / API | New `acmeBranding.ts` with a client test. Changed: `useLayoutMetadata.ts`, `getPageMetadata.ts`, `DefaultHead.tsx`, `onboarding.tsx`, `sso-initiate.tsx`, `enterprise-sso-required.tsx`, `ResetPasswordPage.tsx`, `_error.tsx`, `TracePage.tsx`, `TraceMetadataBadges.tsx`, `createBadgeTableColumn.tsx`, `filter-builder.tsx`, `useSidebarFilterState.tsx`, `ProjectHomePage.tsx`, `DashboardDetailPage.tsx`. No procedure changes |
| Worker | None |
| Infra / Terraform / Helm | None |
| Integrations | None |

## 5. Database change

None. **Rollback:** revert the commit and redeploy the previous console image
(`release.sh --redeploy <previous tag>`). No data changes.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Someone reads `cairo-llm-as-a-judge` in the console and uses it in an SDK call or API filter, where it matches nothing | Low | Low | §8 tells clients that the stored name is unchanged. The internal environments are hidden by default and are Langfuse's own traces, not something a client writes to |
| An upstream sync adds a title or an environment display that still says Langfuse | Medium | Low | The client test pins the helper and the sign-in and password titles. Proposed, not yet done: add a search for "\| Langfuse" titles and raw environment renders to the upstream-sync checklist |
| A future non-environment column uses `createBadgeTableColumn` and a value starting with `langfuse-` is relabelled | Low | Low | The code comment names the assumption. The alias only rewrites the reserved prefix |

## 7. Compatibility

- **Backward compatible:** yes. No stored value, procedure, schema, URL or permission changes. Saved views and shared links keep working.
- **Feature flag:** not needed.

## 8. Client-facing notes

- **Tab titles:** the browser tab now says CAIRO ("Home | CAIRO", "Sign in | CAIRO").
- **Internal environments:** CAIRO's own internal environments, such as the LLM-as-a-judge runs, are shown as `cairo-…`, for example `cairo-llm-as-a-judge`.
- **Stored names are unchanged:** the underlying name is still `langfuse-…`. Use that name in the SDK, the public API and exported data.

## 9. Validation (gate evidence)

| Gate | Result | Evidence |
|---|---|---|
| A: leave dev | See the PR | Typecheck, ESLint `--max-warnings 0` and Prettier on the build workstation. New `acmeBranding.clienttest.tsx` (7 tests) covers: the title helper; the self-hosted page metadata (CAIRO, never Langfuse); every `LangfuseInternalTraceEnvironment` value aliased; customer names untouched; options keeping their values and existing labels; the environment badge; and the sidebar environment facet labelling while filtering on the stored value. The facet test fails with the sidebar change reverted |
| B: staging | `Staging: not available.` | No database change |
| C: post-deploy (dev) | Planned | Read-only, in the owner's session: the tab title on Home, a table page and sign-in; the Home environment chip and its list show `cairo-llm-as-a-judge`; selecting it still filters to those traces (the URL carries `langfuse-llm-as-a-judge`); the traces table's Environment column and sidebar facet; a trace's environment badge |

## 10. Assumptions and open questions

- The organisation, project and dashboard names are renamed in the dev console on 2026-09-28, separately from this change. Nothing in code depends on them.

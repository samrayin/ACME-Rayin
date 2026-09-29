# ADR-0019: White-label naming: CAIRO in page titles, and a display alias for Langfuse's internal environments

| | |
|---|---|
| **Change ID** | CHG-2026-085 · Tier 1 (client-visible: every browser tab title, and environment names across the console) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | `acme-v4.38.0.26` (part a), `.27` (part b), `.28` (part c) |
| **Status** | Proposed |
| **Type** | Forward |
| **Date** | 2026-09-28 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | The owner asked for the change on 2026-09-28 and chose the environment option, merged #235, and approved the dev deploy ("yes to deploy"). Acceptance of this ADR is the owner's to record |
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
  - the error page. **Not** the not-found page, which Next.js serves itself (see §3).
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
- **Not-found page: correction, 2026-09-28, after the `.26` deploy.** This section first said CAIRO's own error page (`_error.tsx`) also serves not-found, so the custom not-found page in the claim was not needed. **That was wrong.** With no `pages/404`, Next.js serves its built-in static 404 page, whose tab title is "Next.js". Checked on dev after the deploy: a removed page and a made-up path both return HTTP 404 with that title. `_error.tsx`, and the "| CAIRO" title this change gives it, covers the other errors only. The claim was right: a custom not-found page is still needed. It is built in part b (§11).
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
| C: post-deploy (dev) | Passed 2026-09-28 on `acme-v4.38.0.26`, for what was checked, **except the not-found page**, which still shows the framework's title "Next.js" (§3) | Read-only, in the owner's session; nothing exported. Tab titles "Home \| CAIRO", "Dashboards \| CAIRO", "Tracing \| CAIRO". The sign-in page's server HTML has "Sign in \| CAIRO", CAIRO descriptions and `og:site_name`, and no "Langfuse". The traces sidebar environment facet lists `cairo-llm-as-a-judge` and `default`. A URL filter on the stored `langfuse-llm-as-a-judge` returns the evaluator traces, whose Environment column shows `cairo-llm-as-a-judge`. The raw name still appears inside trace metadata JSON, as expected (§2). **Not seen live:** the Home environment selector's list (its dropdown did not render in the hidden Browser pane) and the trace environment badge (the trace view on this build opens on the root observation, which has no badge); both are covered by the client tests only |

## 10. Assumptions and open questions

- **Organisation and project:** renamed in the dev console on 2026-09-28, separately from this change ("ACME CAIRO", "Anees - CAIRO - Demo"). Nothing in code depends on them.
- **Dashboard "RayIn Home":** not renamed. Correction to §1: it is a built-in dashboard, named in code (`packages/shared/src/domain/home-dashboard.ts`) and seeded by the worker at startup, not a console-editable name. Four other built-in dashboards carry the same "RayIn" prefix (`worker/src/constants/langfuse-dashboards.json`). Renaming them needs a code change and a worker release; open, awaiting the owner's decision.

## 11. Addendum 2026-09-29: part b, CAIRO's not-found page

The check after the `.26` release found that the not-found page still shows Next.js's
built-in 404 page, whose browser tab says "Next.js" (§3, §9). On 2026-09-29 the owner said
to proceed with the recommended fix.

- **New `pages/404.tsx`.** This section said Next.js serves it for every unknown URL. **That
  was wrong** (§12): unknown URLs go to the App Router.
  - **Title:** "404: This page could not be found | CAIRO".
  - **Body:** the error page's own 404: the same card, "Error 404", "This page could not be
    found." and a Return home link.
  - **Layout:** it renders without the app layout, as the error page does.
- **Why not reuse the error page:** Next.js requires the 404 page to be static and refuses
  one with `getInitialProps`. The error page's default export has one (for Sentry), so the
  new page uses the shared `CrashModal` directly.
- **Tests:** a client test checks the title, the 404 content and link, and that the page has
  no `getInitialProps` and skips the app layout.
- **Unchanged:** the error page itself, and every other decision in this ADR.
- **Not in this part:** renaming the five "RayIn …" built-in dashboards (§10). That needs a
  worker release and is still with the owner.

## 12. Addendum 2026-09-29: part c, the App Router's not-found page

**Gate C for part b failed.** On `acme-v4.38.0.27` (TRACED at `1f7fc926b`), a made-up URL
and the removed `assurance-demo` URL still returned Next.js's built-in 404, titled
"Next.js". The page's own HTML named the cause:
- **Unknown URLs go to the App Router.** `web/src/app/` exists (it holds API routes: billing
  webhooks, chat completion, the in-app agent), and with an `app/` directory Next.js serves
  every unmatched URL from the App Router.
- **Its root layout carried boilerplate.** `app/layout.tsx` still had Next.js's
  `title: "Next.js"` and `description: "Generated by Next.js"`, and there was no
  `app/not-found.tsx`.
- **So `pages/404.tsx` is not used for unknown URLs.** It is only served when a Pages Router
  page's server-side props return `notFound: true`. It stays for that.

**Part c:**
- **New `app/not-found.tsx`:** the page for every unmatched URL.
  - Its metadata sets the title "404: This page could not be found | CAIRO" and a plain
    description.
  - It renders the same 404 card as part b, from a shared client component
    (`AcmeNotFound`): "Error 404", "This page could not be found." and Return home. The
    shared button uses Radix Slot and is not a server component.
  - It imports the global stylesheet, since the App Router layout has none.
- **`app/layout.tsx`:** the boilerplate metadata is replaced by the title "CAIRO". The
  layout renders only the not-found page, because the App Router holds API routes
  otherwise. This is the only upstream file changed.
- **`pages/404.tsx`:** it now renders the shared component, with the same title.
- **Known difference:** the App Router page does not follow the user's dark theme, which
  the Pages Router app applies. It renders in the light palette.
- **Tests:** the client test also checks the App Router page's metadata and card, and that
  the layout no longer says "Next.js".
- **Not provable by those tests:** how Next.js routes unmatched URLs. Gate C on dev,
  fetching the same two URLs, is the check.

**Checked 2026-09-28 on `acme-v4.38.0.28`** (TRACED at `9860c3606`; read-only; ops record #49):
- **With `curl`, no session:** a made-up URL and the removed `assurance-demo` URL return HTTP 404 titled "404: This page could not be found | CAIRO", with the card and Return home. "Next.js" appears nowhere in the HTML.
- **In the owner's browser:** the card is styled (light palette), and Return home goes to `/`, "Organizations | CAIRO".
- **Sign-in:** its title is unchanged.
- **Not exercised:** the Pages Router `pages/404.tsx`, which needs a page to return `notFound: true`.

**Result:** passed.

## 13. Addendum 2026-09-29: part d, the built-in dashboards say CAIRO

§10 recorded that "RayIn Home" and four other built-in dashboards could not be renamed in
the console. On 2026-09-29 the owner said to proceed with renaming them.

- **Renamed:**
  - "RayIn Home" to "CAIRO Home" (`packages/shared/src/domain/home-dashboard.ts`);
  - "RayIn Latency Dashboard", "RayIn Usage Management", "RayIn Cost Dashboard" and
    "RayIn Agent Dashboard" to "CAIRO …" (`worker/src/constants/langfuse-dashboards.json`).

  IDs, definitions, widgets and descriptions are unchanged.
- **Each `updatedAt` is bumped to 2026-09-29.** The worker writes these rows at startup
  (`upsertLangfuseDashboards`) and skips a row whose stored `updatedAt` matches, so without
  the bump the rename would never reach the database. The 2026-09-10 rebrand to "RayIn"
  worked the same way.
- **When it takes effect:** when a worker built from this commit starts, which needs a
  worker release.
  - The worker in dev is `worker-acme-v4.38.0.3` (`65445bdf4`, 2026-09-24).
  - A release from `main` also carries four changes that are already live in the console:
    #209 (API-key revocation and SCIM fixes), #192 (Viewer and Auditor roles), #172 (knip
    clean-up) and #179 (project access policy).
  - The web console also embeds the Home dashboard definition as a fallback, used only when
    its row does not exist. It picks up the new name on the next console release. It does
    not need one for the rename to show.
- **Dashboards copied from these by users are untouched.** They are separate rows owned by
  their projects.
- **Tests:** a worker test checks the four template names and their `updatedAt`; a shared
  test checks "CAIRO Home" and its `updatedAt`.

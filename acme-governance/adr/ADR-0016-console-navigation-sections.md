# ADR-0016: Console navigation: section names, order, collapsing, and an opaque top bar

| | |
|---|---|
| **Change ID** | CHG-2026-081 · Tier 1 (client-visible on every console page) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | `acme-v4.38.0.23` |
| **Status** | Accepted 2026-09-27 by the owner, Anees Ur Rahman ("update the register and mark ADR-0016 accepted") |
| **Type** | Forward |
| **Date** | 2026-09-27 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | The owner asked for the change on 2026-09-27, merged #225, approved the dev deploy ("merged #225, deploy to dev and run the checks"), and accepted the ADR on 2026-09-27 |
| **Commits / tag** | `45d63243d` (#225) · `acme-v4.38.0.23` |

## 1. Purpose

The owner asked for these changes on 2026-09-27, from the Logs page:

- **Section names and order.** Rename "AI Controls" to "Governance Controls", "Security" to
  "Reports / Logs" and "ACME Enhancements" to "Settings". Move the default Settings entry into
  Settings and the default Support entry into a new Support section. Order the sections:
  Governance Controls, Observability, Evaluation, Prompt Management, Reports / Logs, Settings,
  Support.
- **Collapsing.** The Security section would not collapse. The sidebar forced any section
  holding the current page open, so the section you are in could never be closed. The section
  labels were also plain `div`s, so the keyboard could not reach them.
- **The Logs page top.** On three of the four Logs tabs (Guardrail events, Gateway changes,
  Gateway requests), rows scrolling up showed through the organization and project names and
  the page title. The page top bar is sticky, and the "Soft tint" and "Gradient" header presets
  painted it with a mostly transparent colour (6% and 12% of the accent). Checked on dev: the
  top bar's computed background was 94% transparent. The Audit logs tab did not show it
  because its table scrolls inside its own box, so that page never scrolls under the top bar.
- **The CAIRO wordmark.** "C" and "RO" in white, "AI" in colour (it was "CAI" white and "RO"
  coloured).

## 2. Scope

**In:**
- the sidebar's section names, order and membership;
- how sections collapse and expand, including from the keyboard;
- the page top bar's background presets (on every page, not only Logs);
- the CAIRO wordmark in the sidebar and the mobile top bar;
- user-visible text that named the old sections: the Logs help text, the old audit-logs
  redirect notice, and the ACME AI knowledge base.

**Out:**
- routes, URLs and page contents;
- tRPC procedures, scopes and who sees which entry (each role's entries are unchanged, and a
  test pins them);
- the Logs tables' own layout;
- browser tab titles, which still end in "Langfuse".

## 3. Decision

- **Sections, top to bottom:**

  | Section | Entries |
  |---|---|
  | Governance Controls | Guardrails, LLM Gateway, Assurance (Preview) |
  | Observability | unchanged |
  | Evaluation | unchanged |
  | Prompt Management | unchanged |
  | Reports / Logs | Logs |
  | Settings | Settings (the project's, or the organization's on organization pages), UI Customization, and the version label |
  | Support | Support (upstream's help drawer), Contact ACME Support |

  **Contact ACME Support** moves from the old ACME Enhancements section to Support rather
  than to Settings: it is a way to reach support, not a setting.
- **The order is explicit** (`ROUTE_GROUP_ORDER`), not the order routes happen to be listed.
  The list the Ctrl K menu searches follows the same order. It now covers every section: it
  had left out ACME Enhancements, so UI Customization is newly findable there.
- **Collapsing: the user's toggle always wins.** When you arrive on a page, its section opens
  once so its entry is visible. After that you can collapse it like any other. Collapsed
  sections are still remembered per browser, under the same key. Remembered states for the
  old section names are simply ignored.
- **Each section label is a real button,** so Tab and Enter or Space toggle it.
- **Every top bar preset is opaque.** "Soft tint" and "Gradient" are now drawn as an image
  over the page's solid background: they look the same, and nothing shows through. "Plain" is
  unchanged. The Gradient preset's description now says it fades into the page background.
- **Wordmark:** "C" and "RO" in white, "AI" in the accent colour, weight unchanged.
- **Rejected:**
  - *Giving the three Logs tables their own scroll box, like the audit log table:* it fixes
    only those tabs, while a see-through top bar affects every long page for anyone using a
    tinted header. It may still be worth doing so the tabs and filters stay in view.
  - *Keeping Settings and Support at the bottom of the sidebar:* the owner asked for them as
    sections in the order above.

## 4. Impacted components

| Component | Impact |
|---|---|
| Postgres schema / ClickHouse | None |
| Web / API | `routes.tsx`: section names, `ROUTE_GROUP_ORDER`, section membership; Settings and Support move from the bottom (secondary) part of the sidebar into the main part. `useFilteredNavigation.ts` uses a new `utils/groupNavigationItems.ts`. `nav-main.tsx`: collapsing and the button label. `AppSidebar.tsx`: the version label's section. `LangfuseLogo.tsx`, `topbar-brand.tsx`: the wordmark. `acmeThemePresets.ts`, `useAcmeHeaderBackgroundClassName.ts`: the opaque presets. Text: `AcmeSecurityLogsPage.tsx`, `audit-logs.tsx`, `acmeKnowledgeBase.ts`, a comment in `IntroSection.tsx` |
| Worker | None |
| Infra / Terraform / Helm | None |
| Integrations | None |

## 5. Database change

None. **Rollback:** revert the commit and redeploy the previous console image
(`release.sh --redeploy acme-v4.38.0.22`). No data changes.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Users look for Settings and Support at the bottom of the sidebar | Medium | Low | Both are labelled sections, and Ctrl K finds them |
| A "Settings" entry inside a "Settings" section reads oddly | Low | Low | The owner chose the name; the entry is the one it always was |
| Conflicts at the next upstream sync in `routes.tsx`, `nav-main.tsx`, `useFilteredNavigation.ts`, `AppSidebar.tsx`, `LangfuseLogo.tsx` or `topbar-brand.tsx` | Medium | Low | Small, commented edits; the ordering lives in one ACME constant and one ACME file |
| The top bar's new background classes are not generated in the build | Low | Medium | Gate C reads the computed background on dev |

## 7. Compatibility

- **Backward compatible:** yes. URLs are unchanged, so bookmarks and links still work. No
  schema or API change.
- **Feature flag:** not needed.
- **Remembered sidebar state:** a section the user had collapsed under its old name
  ("Security", "AI Controls", "ACME Enhancements") shows expanded once under its new name.

## 8. Client-facing notes

The sidebar sections are now Governance Controls, Observability, Evaluation, Prompt
Management, Reports / Logs, Settings and Support. Settings and Support are sections of their
own, and every section can be collapsed. The top bar no longer lets a long page show through
it.

## 9. Validation (gate evidence)

| Gate | Result | Evidence |
|---|---|---|
| A: leave dev | Passed on the build workstation | `tsc --noEmit`: only the 2 known errors in unmodified Enterprise files. ESLint `--max-warnings 0` and Prettier on every changed file: clean. `knip`: only the 2 findings already on `main`. Client tests: `nav-main.clienttest.tsx` 5 (all 5 fail against the old sidebar code), `groupNavigationItems.clienttest.ts` 3, `acmeThemePresets.clienttest.ts` 4, `acme-role-navigation.clienttest.tsx` 11 (each role's entries unchanged). Not caused by this change, and the same on `main`: `app-shell-chrome.clienttest.tsx` 3 (no tRPC context) and one case in `V4MigrationEntryPoints.clienttest.tsx`, which looks for a route titled "Upgrade Plan" that is titled "Upgrade" |
| B: staging | `Staging: not available.` | No database change |
| C: post-deploy (dev) | Passed 2026-09-27 on `acme-v4.38.0.23` | Read-only in the owner's session at 1440×900 and 375×812; the sidebar's own collapse state was restored afterwards. **Sidebar:** the seven sections in the order above, each with the entries in §3, and nothing left at the bottom. Every label is a `button`. All seven collapse and reopen, including Reports / Logs while on the Logs page. On that section, a mouse click collapsed it, Enter reopened it, Space collapsed it, and Tab moved to the next section. After a reload, the section holding the current page reopened, and a section collapsed by hand stayed collapsed. **Logs:** each of the four tabs was scrolled to its end. The top bar's computed background is fully opaque, and it paints over the content at the breadcrumb and title. **Entries:** Settings, UI Customization and Support (the help drawer) work. Contact ACME Support is a mail link; it was not clicked. The Ctrl K menu follows the new order and includes UI Customization. **Wordmark:** "AI" is in the accent colour; "C" and "RO" are white in the sidebar and in the text colour on the white mobile top bar. **Phone:** the mobile top bar is opaque, and the sidebar sheet shows the seven sections, which collapse and reopen |

## 10. Assumptions and open questions

- **Contact ACME Support stays in Support.** Decided by the owner on 2026-09-27 ("keep Contact ACME Support under Support").
- **The version label** stays in the renamed Settings section.
- **The Logs tables' own scroll box** (keeping tabs and filters in view) is left for a
  separate change if wanted.

## 11. Addendum 2026-09-27: part b, section names in white

The owner asked on 2026-09-27, from a screenshot of the sidebar, for the section names to
be white instead of grey. The shared label component draws them in the sidebar text colour
at 70% opacity; the sidebar now gives its section labels the full sidebar text colour
(white on the sidebar), so they read as clearly as the entries under them. The expand and
collapse arrow follows the same colour. Only the ACME sidebar code changes (`nav-main.tsx`);
the shared label component is untouched, so other labels keep their style. A client test
checks the class. Part b of CHG-2026-081; no other decision in this ADR changes.

# ADR-0026 — Adopting the EYEON prototype's look and feel in the fork

| | |
|---|---|
| **Change ID** | CHG-2026-130 (slice 0); later slices claim their own IDs |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Slice 0: the next console release after CHG-2026-130 merges |
| **Status** | Accepted |
| **Type** | Forward |
| **Date** | 2026-10-07 |
| **Author** | Claude (EYEON build session), for the owner |
| **Approval** | Owner, 2026-10-07: reviewed and merged #362 (slice 0) and #364 (slice 1); release approved. Not a production approval |
| **Commits / tag** | to be added per slice |

## 1. Purpose
A separate session built a clickable EYEON prototype (an overview, ten dashboards and a style guide on sample data) and a build plan for bringing its look and feel into the console. The owner decided on 2026-10-07: "the rest of the prototype's dark colours … released before 18:00. Light mode stays untouched. The bigger phases follows immediately.. Demo is not a blocker". This ADR records how the console adopts the prototype, so each slice can refer to one decision.

## 2. Scope
**In:** dark-mode tokens (slice 0); the shell and navigation restyle (slice 1); a shared EYEON UI layer (components and charts) with the EYEON overview (slice 2, ADR-0027); EYEON-native dashboards one by one, the Home repoint last; a parallel clean-up of user-visible "Langfuse" text.
**Out:** light mode's look (unchanged unless the owner decides otherwise); a separate EYEON front end; anything under `web/src/ee`; the prototype's own demo devices (role switcher, sample-data and scenario switches, right-to-left preview).

## 3. Decision
1. **A layered build inside the fork** (the prototype plan's option B), not a skin-only change (it would leave every screen's layout and data as upstream's) and not a separate front end (every upstream screen, sign-in and the content-free role allow-lists would have to be rebuilt or proxied).
2. **Shared layers first, then screens:** tokens, then the shell, then the UI layer, then each EYEON-native page with its own read-only, metadata-only route, content-free allow-list entry, per-role tests and classic fallback (ADR-0027).
3. **Slice 0, the dark palette, ships without a flag.** The plan proposed a `CAIRO_EYEON_THEME_ENABLED` flag; the owner wanted the palette live the same day, and a flag would have needed an extra settings change and restart. It changes only `globals.css`'s dark block and the dark accent presets; rollback is a redeploy of the previous image. Later slices keep the plan's flags.
4. **The accent stays the person's or project's choice** (CHG-2026-127: lime by default, Electric Cyan, Hot Pink). It is the primary colour in dark mode, so headings and primary text take it, as they take the light accent in light mode (the plan's option 0b). Charts keep the prototype's fixed lime, cyan and magenta whatever the accent, so series never repeat.
5. **Tokens from the prototype, mapped to the console's variables** (the plan's token map): near-black, faintly teal surfaces ordered page < card < muted < popover; ink greys for text; status colours kept apart from the brand accents (allow green, redact amber, block red-pink, info periwinkle); the prototype's darker active-navigation shade.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres schema | none (slice 0) |
| ClickHouse | none |
| Web / API | slice 0: `globals.css` dark block; `acmeThemePresets.ts` (dark accent shades, primary accent follows the dark accent) |
| Worker | none |
| Infra / Terraform / Helm | none for slice 0; later slices add `CAIRO_*` flags |
| Integrations (LiteLLM, NeMo, promptfoo) | none |

## 5. Database change
None for slice 0. Later slices add read-only routes and, where needed, indexes under their own ADRs.

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dark text becomes hard to read on the new surfaces | Low | Medium | A test reads the dark block from `globals.css` and checks WCAG AA (4.5:1) for body, muted, secondary, accent and sidebar text on their surfaces |
| Accent-coloured headings feel heavy | Medium | Low | Owner's choice (option 0b); switching to neutral primary text is a token change |
| Upstream pages assume grey surfaces | Medium | Low | Tokens only, no layout change; screenshot check on the owner's screens |
| Upstream sync conflicts in `globals.css` | Medium | Low | Changes are confined to variable values in the dark block |

## 7. Compatibility
Backward compatible: yes, display only. Light mode is unchanged. Rollback: redeploy the previous console image.

## 8. Client-facing notes
Dark mode looks like the EYEON prototype: near-black, crisp text, bright accents. Light mode is unchanged.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | Pass (slice 0) | 22 theme tests, including WCAG AA contrast of seven text-on-surface pairs read from `globals.css`; ESLint and Prettier |
| B — staging | `Staging: not available.` | — |
| C — post-deploy | Pending | the owner's screens in dark mode |

## 10. Open questions
1. Fonts: the prototype's Sora, Figtree and JetBrains Mono, self-hosted, or the system stack (lint allows two weights).
2. The navigation rail: after the upstream sync (CHG-2026-100) or before.
3. Whether light mode should also take the prototype's look.
4. The default theme for new users: system (today) or dark.
5. Superseding ADR-0019 §2 before the "Langfuse" text clean-up starts.

## 11. Slice 1: shell and navigation (addendum, CHG-2026-131)
**Date:** 2026-10-07. **Change:** CHG-2026-131, Tier 1. **Approval:** pending; the owner reviews and merges, no self-approval.

**What changed, dark mode only.** The console keeps its single sidebar; the prototype's look reaches it through tokens in `globals.css` and `dark:` classes.
- **Sidebar hover apart from the active item.** Hover and the active item both used `sidebar-accent`, so a hovered row looked selected. A new pair, `--sidebar-hover` and `--sidebar-hover-foreground` (with their `@theme inline` colours), now carries every hover style in `sidebar.tsx`: the menu button and its default and outline variants, hover on an open menu, the group action, the menu action and the badge, and the sub-button. Dark takes the prototype's hover, `#0C1316` (`198 29% 6.7%`) with ink-1 text, and keeps it whatever the dark accent. The active item and the pressed state keep `sidebar-accent` and the accent text; Tailwind emits `data-[active=true]` after `hover:`, so a hovered active item still looks active. `nav-main.tsx` has no hover style of its own.
- **Section labels.** A `--sidebar-label` token replaces `text-white` on the sidebar's section names (dark: ink-3). In dark mode the labels are uppercase with the prototype's 0.08em letter-spacing (new `--tracking-caps`).
- **Top bar.** In dark mode the page header is the chrome surface (`--header`) with its hairline and no shadow, and the tinted and gradient header presets are not drawn: the prototype tints only its light top bar. The mobile top bar takes the chrome surface too. Upstream's `page-header.tsx` and `mobile-top-bar.tsx` got class edits only.
- **Page header.** The title keeps the accent colour (§3.4) and its size, and takes the prototype's heading letter-spacing, -0.01em (`--tracking-heading`).
- **Card titles.** A `--card-title` colour, ink-1 in dark mode, a step brighter than body text. A colour a page passes to a card title still replaces it.

**Not changed.** Type sizes: the page title, card titles and labels keep the console's steps, because a dark-only size would reflow every page when the mode switches, and more than half of the console's card titles set their own size. The navigation rail, `AppSidebar.tsx` and `routes.tsx` wait for the upstream sync (§10.2); fonts wait for §10.1; row shape and spacing are unchanged.

**Light mode is unchanged.** Each new token's light value is what light mode already showed: `--sidebar-hover` is `--sidebar-accent` (`210 45% 23%`) and `--sidebar-hover-foreground` is `--sidebar-accent-foreground` (`173 85% 60%`), the pair hover used; `--sidebar-label` is white, as `text-white` was; `--card-title` is `currentColor`, which makes a title inherit its colour exactly as it did with no colour class. Every other new class is behind `dark:`. The light header presets keep their classes.

**Flag:** none, as for slice 0 (§3.3): display only, no data, access or schema change. **Rollback:** redeploy the previous console image.

**Tests.** The dark-palette test reads the new tokens from `globals.css`: the hover shade differs visibly from the sidebar background and from the active shade of every dark accent (CIELAB ΔE*ab of at least 3, above the usual just-noticeable difference of about 2.3); sidebar text and hover text on the hover shade, and the section labels on the sidebar, meet WCAG AA (4.5:1); card titles meet it on cards. Light-mode tests check each light value above, and that the header presets keep their light classes.

## 12. Addendum: the owner's shell decisions of 2026-10-07 (CHG-2026-134, CHG-2026-135)

### 12.1 CHG-2026-134: ACME AI removed; the user menu in its place
**Date:** 2026-10-07. **Change:** CHG-2026-134, Tier 1. **Approval:** pending; the owner reviews and merges, no self-approval. **Owner's instruction:** "Remove ACME AI completely from EYEON. we will plan for it sometime later. in that place put the user settings".

**What ACME AI is.** ACME's own in-console chat (ADR-0015, CHG-2026-080): a top-bar launcher (`AcmeChatLauncher`, "ACME AI" on desktop, an icon on the mobile top bar), a panel host in the authenticated layout (`AcmeChatWidget`) and one server procedure, `acmeChat.sendMessage`, which calls the gateway. It is not upstream's in-app agent (the "Assistant", with its Ctrl/Cmd+I shortcut), which is a separate feature. ACME AI had no keyboard shortcut of its own (Escape only closed the panel), no Ctrl/Cmd K entry and no onboarding mention.

**What changed.**
- **The console:** the launcher is gone from both top bars and the panel host from the layout. The files stay (`AcmeChatLauncher.tsx`, `AcmeChatWidget.tsx`, `acmeChatPanelStore.ts`, `acmeChatRouter.ts`, its knowledge base and prompt variants) for the later plan; their own tests still run.
- **The server:** `acmeChat.sendMessage` stays registered but refuses every caller first (`PRECONDITION_FAILED`, "ACME AI is switched off in EYEON."), before the access check, the gateway settings, the prompt, any project data or the gateway. There was no existing switch to reuse, so it is one gate at the only procedure. It is a code switch, not a `CAIRO_*` flag: the owner asked for removal, and with no launcher a flag could only re-open an API nothing in the console calls. Turning ACME AI back on is part of the later plan.
- **Upstream's assistant:** stays off through its own upstream switch, `LANGFUSE_IN_APP_AGENT_ENABLED`: on a self-hosted deployment it is off unless set to `"true"`, and the repository's deployment files do not set it (the live value was not checked). With it off, the session tells the console to hide every assistant entry point and every in-app agent route refuses before reading anything; a test pins that default. Its launcher, which also carried the Ctrl/Cmd+I shortcut, is removed from both top bars as well, so the right edge belongs to the user menu even if someone turns the switch on. Its other entry points (evaluator, v4 migration and widget prompts) and its window host are left to the switch, unedited, to keep upstream conflicts small.
- **The user menu:** the sidebar footer block (avatar, name, email and its menu) moves to the top bar's right edge, where ACME AI was. The authenticated layout builds the same items as before (account settings; v4 migration where offered; theme; feature preview where offered; regions on Langfuse Cloud only; instances where configured; sign out) and passes them through `EyeonUserMenuProvider`; `EyeonTopbarUserMenu` renders them as the footer did. Desktop shows the avatar, and from the `lg` width also the name and email; the mobile top bar shows the avatar and the full menu, replacing its short account menu, which stays as the fallback outside the authenticated layout (shared trace and session pages). The footer is switched off by a guard (`ACME_SHOW_SIDEBAR_USER_MENU`), not deleted.

**Upstream files touched,** each with an "ACME (CHG-2026-134)" comment: `page-header.tsx` and `mobile-top-bar.tsx` (the launchers replaced by the menu), `AuthenticatedLayout.tsx` (the panel host removed, the provider added), `AppSidebar.tsx` (the footer guard). All four are on the CHG-2026-100 conflict list; the edits are a few lines each, and a test fails if a sync brings either launcher back into the top bars or the layout.

**Flag:** none. **Rollback:** redeploy the previous console image. **Schema:** none.

### 12.2 CHG-2026-135: the navigation rail
**Date:** 2026-10-07. **Change:** CHG-2026-135, Tier 1. **Approval:** pending; the owner reviews and merges, no self-approval. **Owner's instruction:** "set the Category UI as per attached sample" (the prototype's navigation rail).

**This reverses CHG-2026-131 on the owner's decision.** Slice 1 (§11) kept the single sidebar and said the rail waits for the upstream sync (§10.2), because the rail restructures navigation that upstream changes often. The owner now wants the rail before the sync, so §10.2 is answered: before.

**What it does, behind `CAIRO_EYEON_RAIL_ENABLED` (server-only, default off).**
- **The rail:** a narrow column at the far left, beside the sidebar, on the sidebar's surface: Home, Governance Controls, Observability, Evaluation, Prompt Management, Reports, Logs, then a gap and Settings and Support. Each is an icon in a circle with its name under it, as in the sample: house, shield-check, activity, flask, message-square with code, file with a chart, list, sliders, life-buoy. The active category's circle is filled with the primary accent and its name sits on the same colour; in dark mode that is the person's chosen dark accent (lime, cyan or pink, through `--primary`), in light mode the sidebar's own active colours (`--sidebar-primary`, `--sidebar-accent`).
- **Choosing a category** shows that category's own list in the sidebar: its items under the category's name, with the entries that belong to no category (Go to..., Projects) above. It also goes to the category's first page this person can open, as in the prototype (owner's choice, 2026-10-07, asked to pick the best approach): one click reaches a page. Choosing the category of the page on screen only shows its list, so nobody is moved off their page. An entry that renders nothing is never a destination. After a navigation the rail follows the page's category.
- **Placement** follows the prototype's PAGES `section` values through the sidebar's groups: Governance Controls, Observability, Evaluation, Prompt Management, Settings and Support map one to one; "Reports / Logs" becomes Logs, which holds the Logs page; Home holds the project home alone; Dashboards go to Reports (owner's choice, 2026-10-07: Reports holds Dashboards now and an executive summary later, so the category is not empty and Home stays one destination); gateway health goes to Observability, matched on its path, whatever group it is given.
- **One source of truth.** The rail adds no navigation and no access rule. It sorts the sidebar's own items, the ones `routes.tsx` defines and the layout's existing filters have already passed for this person (scopes, entitlements, feature flags, product modules, `show`). A category shows only when the person can see at least one of its items. Some entries decide for themselves at render time (a `menuNode`, such as the EYEON pages' entries behind their server-only flags); the rail renders those out of sight and counts one only once it has rendered something, so an entry switched off never makes its category appear. A route added later lands in its group's category with no change; a new group fails the type check until it is placed.
- **Where it shows:** inside a project, on desktop. On a phone the sidebar sheet is unchanged, and outside a project the classic sidebar stays. The collapsed (icon) sidebar still works beside the rail.
- **Accessibility:** a `nav` landmark named "Categories" with two lists; every icon has its visible name; each category is a native button (Home a link), so it works from the keyboard, with a visible focus ring. The active category has `aria-current`: `page` when the page on screen belongs to it, `true` when the person chose another category's list on this page.

**The flag reaches the console** through a tRPC query, `eyeonShell.railStatus`, as the EYEON pages' flags do. Unlike theirs it is not project-scoped and needs no scope, only a signed-in person, because the rail is the shell around every page, not project data; it returns the one setting and reads nothing else. Not being a project procedure, it is outside the content-free roles' allow-lists and needs no entry.

**What it costs the sync (CHG-2026-100).**
- `routes.tsx` and `AppSidebar.tsx`, the two largest conflict files, are not touched by this change.
- `AuthenticatedLayout.tsx` gets a few more lines (the hook, the rail, the sidebar's items), next to CHG-2026-134's; `root.ts` gets one router and `env.mjs` one flag.
- The rail depends on three upstream shapes, and the sync must check each: the sidebar's groups (`RouteGroup`; a new or renamed group fails the type check), the filtered navigation and `NavMain`'s group rendering (the rail passes the category's name where a group name is expected), and `sidebar.tsx`'s desktop structure. The docked sidebar is fixed to the window's left edge, and the rail moves it right with a sibling selector on that structure; a test fails if the structure changes, before the two overlap on screen.

**Not built:** the prototype's pins, counts and "Phase 2" tags in the lists; its own collapse of the rail; its mobile category drawer; a Reports page. Fonts still wait for §10.1.

**Rollback:** flag off, or redeploy the previous image. **Schema:** none.

### 12.3 CHG-2026-141: ACME AI behind a flag (addendum to §12.1)
**Date:** 2026-10-07. **Change:** CHG-2026-141, Tier 1. **Approval:** pending; the owner reviews and merges, no self-approval. **Owner's instruction:** ACME AI is needed again later, and the owner asked for "the best approach considering it is required for future enhancements".

**Why a flag replaces §12.1's code switch.** §12.1 chose a code switch because the owner asked for removal and, with no launcher, a flag could only re-open an API that nothing in the console called. Now ACME AI has to be able to return, so the switch has to be something an operator can turn without a code change, a review and a new image. A server-only `CAIRO_*` flag, off by default, does that. With the flag off, the console is exactly as §12.1 left it, so a deployment that does not set the flag sees no change. The options rejected:
- **Keep the code switch:** every return would need a code change, a review and a release, and the launcher and panel would have to be wired back by hand from the history.
- **A `NEXT_PUBLIC_` flag:** it is fixed into the client bundle at build time, so it would still need a rebuild, and one image could not serve deployments with different settings. EYEON's flags are server-only.
- **The session** (as upstream's assistant uses `session.environment`): this would mean editing upstream's sign-in callback and session types, two more upstream files on the CHG-2026-100 conflict list, and it would add an ACME setting to every session.
- **Extending a query ACME AI's UI already calls:** there is none. The launcher reads only the session's roles, and the panel calls only `sendMessage`, which is a mutation.

**What changed.**
- **The flag:** `CAIRO_ACME_AI_ENABLED`, server-only, `"true"` or `"false"`, default `"false"`. `acmeAiEnabled()` in `acmeChatRouter.ts` reads it.
- **With the flag off:** ACME AI behaves as described in §12.1. There is no launcher and no panel, and `acmeChat.sendMessage` refuses every caller first with `PRECONDITION_FAILED`, before any read or gateway call.
- **With the flag on:** ACME AI behaves as it did before CHG-2026-134.
  - The launcher sits in the top bar just left of the user menu. On desktop it reads "ACME AI"; on the phone's top bar it is an icon.
  - The panel is hosted in the authenticated layout.
  - `sendMessage` runs all its checks: `projectAiAssistant:use`, the gateway settings (`RAYIN_CHAT_LLM_*`), then the prompt and the gateway.
- **How the console learns the flag:** a new query, `acmeChat.status`.
  - It is sign-in only (`authenticatedProcedure`), returns `{ enabled }`, and reads nothing else.
  - Only two components send it: the launcher (`AcmeChatTopbarLauncher`, in the top bars) and the panel host (`AcmeChatPanelHost`, in the layout). Each asks only once the person may use ACME AI in the current project (`projectAiAssistant:use`).
  - The answer is cached for 60 seconds. ACME AI counts as off while the answer is loading or if the query fails.
  - The existing `AcmeChatLauncher` and `AcmeChatWidget` are unchanged; the two new components wrap them.
- **One difference from before CHG-2026-134:** the panel host is removed when the person moves to a project where they may not use ACME AI. Before, the panel stayed in the page, hidden, so a conversation could follow the person into that project; now it does not.

**The content-free roles' allow-lists are unchanged.** Security Analyst, Business Analyst and Auditor gain nothing:
- `status` is not a project procedure, so the allow-lists, which guard project procedures, do not apply to it. It carries only the deployment's switch and no project data.
- Their console never sends it, because none of them holds `projectAiAssistant:use`.
- `sendMessage` stays off every list, so it refuses them with `FORBIDDEN` before the handler runs, with the flag on or off.
- A test still requires that no allow-list name an `acmeChat.` procedure.

**Upstream files touched,** each with an "ACME (CHG-2026-141)" comment:
- `page-header.tsx` and `mobile-top-bar.tsx`: one import and one launcher line each. The CHG-2026-134 comment there now names only the assistant.
- `AuthenticatedLayout.tsx`: one import, and the panel host is back beside the theme injector.

The CHG-2026-134 structural test now checks two things: the top bars and the layout mount ACME AI only through the two components above, and they never mount upstream's assistant launcher.

**Not changed:**
- Upstream's assistant: it is still removed from both top bars and still off through `LANGFUSE_IN_APP_AGENT_ENABLED`.
- The user menu.
- ACME AI's own behaviour: its tools, prompt, gateway call and tracing.

**Turning it on:** set `CAIRO_ACME_AI_ENABLED=true` on the console, along with the three `RAYIN_CHAT_LLM_*` settings, then restart it. Without the gateway settings, ACME AI replies that it is not configured. `deploy/azure` does not declare the flag yet. Turning ACME AI on is a separate owner decision.

**Flag:** `CAIRO_ACME_AI_ENABLED`, server-only, default off. **Rollback:** turn the flag off, or redeploy the previous console image. **Schema:** none.

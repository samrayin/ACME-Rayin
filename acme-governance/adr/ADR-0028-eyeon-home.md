# ADR-0028 — EYEON Home: the overview as the project's Home, arranged by each person

| | |
|---|---|
| **Change ID** | CHG-2026-136 |
| **Owner** | Anees Ur Rahman |
| **Affected release** | The first console release after merge (tag to be added at release) |
| **Status** | Accepted |
| **Type** | Forward |
| **Date** | 2026-10-07 |
| **Author** | Claude (EYEON build session), for the owner |
| **Approval** | Owner, 2026-10-08: reviewed and merged #374 and approved its release (console `acme-v4.38.0.45`); Home is behind `CAIRO_EYEON_HOME_ENABLED`, a separate yes. Not a production approval |
| **Commits / tag** | To be added at merge · release tag to be added at release |

## 1. Purpose
ADR-0026 plans the Home repoint as its last slice (slice 11): the project home renders EYEON's own Home instead of the classic dashboard. The owner decided on 2026-10-07: "set the over view as home.. but give few options to move the dashbaord, widgets as pre requirement", and, asked whether the Security Analyst should land on the Guardrail decisions page: "Yes- security analyst lands on this page".

This ADR records three decisions: the EYEON overview (ADR-0027) becomes the project's Home behind a flag; each person can arrange it for themselves; and where each role lands when it opens a project.

## 2. Scope
**In:**
- The flag `CAIRO_EYEON_HOME_ENABLED` and the project home that follows it (§3.1).
- Each role's landing page, the Security Analyst's included (§3.2).
- Arranging Home: moving, hiding and showing its widgets, reset (§3.3).
- Where the arrangement is kept, and its limits (§3.4).

**Out:**
- Any change to the overview's figures, its router's reads or its access rule (ADR-0027 §3.6).
- The navigation: the Home entry, the Overview entry and the Ctrl/Cmd K list stay as they are. The navigation rail (CHG-2026-135) is a separate change.
- A server-side store for arrangements (§3.4, a later change if wanted).
- Arranging any other page. The arrange controls are written so a later EYEON page could reuse them, but none does yet.
- Any change to roles or scopes, the classic Home (`ProjectHomePage.tsx` is not edited), and anything under `ee/` or `web/src/ee/`.

## 3. Decision

### 3.1 The overview as Home, behind a flag
- **Flag:** `CAIRO_EYEON_HOME_ENABLED`, `"true"` or `"false"`, default `"false"`, server-only, declared in `web/src/env.mjs` (ADR-0027 §3.3). It needs `CAIRO_EYEON_OVERVIEW_ENABLED` as well: with the overview off, Home stays classic whatever this flag says.
- **How the client learns it:** a new query, `eyeonOverview.homeStatus` `{ projectId }`, returns `{ enabled }`, true only while both flags are on. It is read-only, reads no database, uses the overview's own access rule (`llmGateway:read` or `evidence:read`) and is on the Auditor's content-free allow-list beside `eyeonOverview.status`. This is how the overview's and the Guardrail decisions page's navigation entries already learn their flags.
- **Where:** the route `web/src/pages/project/[projectId]/index.tsx`, not an upstream conflict file, now re-exports `features/acme-enhancements/pages/EyeonProjectHome.tsx` instead of `ProjectHomePage`. `EyeonProjectHome` decides the landing (§3.2) and renders either the overview, titled "Home", or the classic `ProjectHomePage`, unchanged. `ProjectHomePage.tsx`, a file the v4.50 sync touches, is not edited, and is still imported, so knip finds no orphan.
- **Off:** Home is unchanged for every role. The one difference is a small flag query for the roles that can open the overview, before Home renders. The Security Analyst's and the Auditor's landing does not follow this flag but the Guardrail decisions page's (§3.2): on a deployment where that page is already on, their landing changes as soon as this change is deployed, as the owner decided.
- **The Home entry** in the navigation still links to `/project/[projectId]`, so Home in the navigation lands on the project home, now the overview for those roles. The overview also stays at its own address, under Governance Controls › Overview.

### 3.2 Role landings
The landing logic lived in `ProjectHomePage.tsx` (an effect sending `useLandsOnGuardrails` roles, the Security Analyst and the Auditor, to `/acme-enhancements/guardrails`). It is ported to `EyeonProjectHome.tsx`, with the decision itself in a pure function, `utils/eyeonHomeLanding.ts`. These roles are sent on before any Home renders. The old effect in `ProjectHomePage.tsx` is left in place, unreachable through this route, to keep that file unedited.

| Role | Can open the overview | Lands on |
|---|---|---|
| Owner, Admin | Yes (`llmGateway:read`) | The overview as Home while EYEON Home is on; otherwise the classic Home |
| Instance admin | Yes | As Owner |
| Prompt Analyst (Member), Viewer | No | The classic Home, as before; the flag is not even asked |
| Business Analyst | No | The classic Home, as before |
| Security Analyst | No | **Guardrail decisions** while `CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED` is on, whatever EYEON Home's flag says; otherwise the Guardrails page, as before |
| Auditor | Yes (`evidence:read`) | As the Security Analyst (below) |

- **The Security Analyst** lands on the Guardrail decisions page (CHG-2026-133) while its flag is on, as the owner decided. The client learns that flag from `eyeonGuardrailDecisions.status`, already on the Security Analyst's allow-list.
- **The Auditor** shares the Security Analyst's path in the code: `useLandsOnGuardrails` returns true for both roles, and before this change both went to the Guardrails page. So the Auditor moves with the Security Analyst to Guardrail decisions while that flag is on, and does not get the overview as Home, although it can open the overview. Splitting the two roles is one condition in `eyeonHomeLanding.ts`; it is left to the owner (§10).
- **Before this change, these roles went to the Guardrails page** (`/acme-enhancements/guardrails`), not to the guardrail decision log (Logs › Guardrail decisions). That stays their landing while the decisions page is off.
- **A flag that cannot be read counts as off,** so an error falls back to the landing each role had before. While a flag is still being asked, the page shows the loading state, never the wrong Home for a moment.

### 3.3 Arranging Home
- **Arrange mode:** an "Arrange" button in the overview's header row, beside the period, turns it on. Each widget then shows a bar with its name, its place ("2 of 6") and three buttons: move earlier, move later and hide. KPI tiles move among the tiles and cards among the cards. Moving steps over hidden widgets, so every press visibly moves the widget.
- **Keyboard and screen readers:** the controls are real buttons with names that say what they do ("Move Guardrail checks later"). Focus stays on the moved widget's button, moves to the other button at either end, to "Show …" after hiding, and to "Hide …" after showing. A polite live region says where the widget went ("Guardrail checks moved to place 2 of 6."). While arranging, each widget's own content is inert, so a click on a tile cannot open its page by mistake.
- **Dragging:** the console already depends on `@dnd-kit` (provider ordering, table columns), so a widget can also be dragged by its grip with a mouse or a finger and dropped on another widget's place. No new dependency. The grip is hidden from assistive technology and takes no focus: the buttons are the keyboard path, so there is no second, different keyboard model.
- **Hidden widgets** are listed in the arrange bar, each with a "Show" button; outside arrange mode the header says how many the person has hidden.
- **Arrange mode ends** with "Reset to default" (the default order, nothing hidden, and what was stored removed; disabled when there is nothing to reset) and "Done". Every change is saved as it is made.
- **Layout:** cards keep their default widths in the three-column grid of large screens, and the last card of each row widens to fill it, so no row ends in a gap; the default order gives the overview's layout as before. Below that width everything is one column, so narrow screens work as before. The controls use the console's tokens only, so dark and light mode both apply.

### 3.4 Where the arrangement is kept: this browser
- **Store:** the browser's `localStorage`, under a versioned key per person and per project: `cairo.eyeonHomeLayout.v1:<userId>:<projectId>`. It holds only widget ids: the order of the tiles and of the cards, and which are hidden. It is never sent to the server, so nobody can change what someone else sees.
- **Precedent:** the personal theme (CHG-2026-074, `theme/usePersonalTheme.ts`) keeps a per-person choice the same way, for the same reason. Unlike the theme, the key carries the person's id, so two people sharing a browser keep their own arrangements.
- **Guarded:** every read and write is in `try`/`catch`. A browser that refuses storage (private mode, quota) still lets the person arrange the page for the visit, and the bar says the arrangement was not kept.
- **Sanitised on read:** unknown widget ids and duplicates are dropped; a widget missing from a stored order (one added since it was saved) comes back in its default place, after the widget that precedes it by default; anything unreadable gives the default arrangement.
- **Not the shared `useLocalStorage` hook:** it keeps the value of the key it mounted with when the key changes (the page stays mounted when moving between projects) and writes on every mount. A small hook (`utils/useEyeonHomeLayout.ts`) reads the key's own arrangement whenever the person or project changes and writes only when the person changes something.
- **Why not a new table:** no schema change or migration, nothing new on the server or in an allow-list, and the choice is per person only, as with the personal theme. **Limit:** the arrangement does not follow the person to another browser or device, and clearing the browser's site data resets it. A server store (a per-user preference table, its own ADR, migration and allow-list entries) can come later if people ask for it; the stored shape is versioned so it can be carried over.

### 3.5 Arrangement never changes what a role can see
- The arrangement only orders and hides what the page already received. The overview's query, its reads and its response are unchanged, and nothing new is fetched for arranging.
- A widget the server did not send cannot be shown: the spend card exists only for a viewer the server sent spend to (`llmGatewaySpend:read`). A stored arrangement that lists it, from another role or a hand edit, is ignored for that viewer, and it is not offered under "Show".
- Hiding is a personal view, not an access control: a hidden widget's figures are still in the page's response for that role, as they were before.

### 3.6 Alternatives rejected
- **A server-side preference table:** a schema change and migration for a per-person view preference, with allow-list entries for every content-free role; out of proportion now, and possible later (§3.4).
- **`react-grid-layout` (free-form resizable grid), also a dependency already:** heavier, positions by absolute coordinates with inline styles, and needs its own keyboard support. Ordering within two groups is what the owner asked for ("a few options").
- **Editing `ProjectHomePage.tsx`:** it is a v4.50 sync conflict file; the route re-export keeps it unedited.
- **A browser flag (`NEXT_PUBLIC_`):** baked in at build time, as ADR-0027 §3.7.
- **Folding the Home flag into `eyeonOverview.status`:** it would change that query's answer, which the overview's navigation entry and its tests rely on. A separate query keeps both meanings plain.

## 4. Impacted components
| Component | Impact |
|---|---|
| Postgres schema | None |
| ClickHouse | None |
| Web / API | One new read-only query (`eyeonOverview.homeStatus`, no database read) and one Auditor allow-list entry; the project home route re-exports a new home page; the overview gains arrange mode; new arrange controls in the EYEON kit; one flag in `env.mjs` |
| Browser storage | One `localStorage` key per person and project, widget ids only |
| Worker | None |
| Infra / Terraform / Helm | None. The flag is unset (off) until an operator sets `CAIRO_EYEON_HOME_ENABLED=true` on the console |
| Integrations (LiteLLM, NeMo, promptfoo) | None |

## 5. Database change
- **Migration:** none.
- **Backfill:** none.
- **Rollback:** switch `CAIRO_EYEON_HOME_ENABLED` off (or unset it) and restart the console: Home is the classic dashboard again for every role. The Security Analyst's landing follows `CAIRO_EYEON_GUARDRAIL_DECISIONS_ENABLED`; switching that off sends the role to the Guardrails page as before. Arrangements stay in each browser, unused, and apply again if the flag comes back; redeploying the previous image removes the code. Nothing is stored on the server, so nothing is lost.

## 6. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A role lands on a page it cannot use, or sees the wrong Home for a moment | Low | Medium | Landing tests per role with each flag on and off, while asking, and on error; the loading state shows until the flags are known |
| An arrangement shows a role something it may not see | Low | High | The arrangement only orders what the server sent; the spend card is offered only when present; tests cover a stored spend entry for a role without spend |
| A corrupt or hand-edited stored value breaks the page | Low | Low | Read in `try`/`catch` and sanitised; tests for corrupt JSON, unknown ids, duplicates and refused storage |
| People expect the arrangement on another device | Medium | Low | Said in the arrange bar ("kept in this browser, for you only") and here; a server store can come later |
| The Auditor's landing moves with the Security Analyst's | Certain while the decisions flag is on | Low | Recorded here and in the changelog; one condition splits them if the owner wants (§10) |
| Owners and Admins see the overview twice in the navigation (Home and Overview) | Certain while on | Low | Left to the navigation rail change; open question (§10) |
| Merge cost in the v4.50 sync | Low | Low | `ProjectHomePage.tsx` untouched; one flag in `env.mjs`, one allow-list line; the rest in ACME folders and the one-line route |

## 7. Compatibility
- Backward compatible with the previous image: yes. No schema change; with the flag off, Home is unchanged for every role. The Security Analyst's and the Auditor's landing follows the Guardrail decisions page's flag instead (§3.2).
- Upstream merge risk: `env.mjs` (one flag) and the allow-list (one line). The route file was a one-line re-export and stays one.
- Feature flag: `CAIRO_EYEON_HOME_ENABLED`, default `"false"`. Removed once the owner signs EYEON Home off and it becomes the default.

## 8. Client-facing notes
None until the flag is switched on. Then Owners and Admins open a project on the EYEON overview, titled Home, and can arrange it for themselves. With the Guardrail decisions page on, Security Analysts and Auditors open a project on that page.

## 9. Validation (gate evidence)
| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | Pending the owner's review | Pure-function tests for arranging, sanitising, widths and storage; the arrange-mode page tests (buttons, focus, persistence, refused storage, spend); the home and landing tests per role; the overview router, kit, content-free role and navigation tests; a fresh typecheck; ESLint and Prettier on the changed files (see the changelog entry) |
| B — staging | `Staging: not available.` No migration to rehearse | — |
| C — post-deploy | Not yet | With both flags on: Home per role (Owner, Admin: the overview; Member, Viewer, Business Analyst: classic); Security Analyst and Auditor on Guardrail decisions; arranging in dark and light mode and at a narrow width |

## 10. Assumptions and open questions
1. **The Auditor's landing:** it shares the Security Analyst's path, so it now goes to Guardrail decisions while that page is on. Keep that, or give the Auditor the overview as Home (it can open it), or keep it on Guardrails?
2. **The Overview entry while Home is the overview:** keep both, or hide Governance Controls › Overview while EYEON Home is on (with the navigation rail change)?
3. **The default arrangement:** the overview's order today. Should the owner set a different default (for example the cards before the tiles)?
4. **A server store:** wanted now, or only if people ask for their arrangement to follow them?
5. **Reset closes arrange mode?** Today "Reset to default" keeps arrange mode open so the person sees the result; "Done" closes it.

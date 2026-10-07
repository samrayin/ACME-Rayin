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
| **Approval** | Pending. The owner reviews and merges; not a production approval |
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

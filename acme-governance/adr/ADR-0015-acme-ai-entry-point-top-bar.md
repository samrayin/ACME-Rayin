# ADR-0015: The ACME AI entry point moves to the top bar

| | |
|---|---|
| **Change ID** | CHG-2026-080 · Tier 1 (client-visible on every console page) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | The next console release after merge (`acme-v4.38.0.N`) |
| **Status** | Proposed: awaiting the owner's review |
| **Type** | Forward |
| **Date** | 2026-09-27 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | Pending. The owner chose the approach on 2026-09-27 ("go with option 1, move it to the top bar"); the owner reviews and merges |
| **Commits / tag** | Recorded at merge · tag at release |

## 1. Purpose

ACME AI was opened from a floating round button fixed 24 px from the bottom-right corner of
every project page. It sat on top of whatever the page put in that corner. A read-only sweep of
27 console pages at 1440×900 on 2026-09-27 found it blocking controls on four:
- **Gateway changes** and **Gateway requests:** the **Older** pager button, at the end of each
  list;
- **Playground:** the settings menu, completely;
- **LLM Gateway:** a key row's **Revoke** button.

It also partly covered the standard table pager on nine more pages. A click on a covered
control opened the chat instead. The same defect on the guardrail history had already been
fixed page by page (CHG-2026-079 b).

## 2. Scope

**In:**
- the launcher, which moves to the top bar on desktop and to the mobile top bar;
- where the chat panel opens;
- keyboard behaviour (focus and Escape).

**Out:**
- what the assistant does or can read;
- its access rules;
- its server side.

## 3. Decision

- **The launcher is a top-bar button.** On desktop it reads "ACME AI" and sits beside the
  upstream Langfuse assistant's launcher. The mobile top bar gets an icon-only version. Only
  roles holding `projectAiAssistant:use` see it, as before.
- **The panel host stays in the persistent layout** (`AcmeChatWidget`), so a conversation
  survives navigation and closing the panel. The launcher and the host share the open state
  through a small store. This is the pattern upstream uses for its own assistant: its launcher
  sits in the page header and its window host in the layout.
- **The panel opens under the top bar,** right-aligned below the launcher, never taller than the
  space left on screen. It is a non-modal dialog, labelled "ACME AI". The launcher has
  `aria-expanded` and `aria-controls`, focus moves to the message box on open, and Escape
  closes it.
- **Rejected:**
  - *Reserving space at the bottom of every page:* it fixes lists that end under the button,
    but not full-height layouts such as the Playground, whose own footer sits in that corner.
  - *Moving the floating button elsewhere, or making it draggable:* any fixed spot over the
    content can cover something.
  - *Patching pages one at a time:* it's never finished, and it can't reach upstream pages we
    don't otherwise touch.

## 4. Impacted components

| Component | Impact |
|---|---|
| Postgres schema / ClickHouse | None |
| Web / API | New `AcmeChatLauncher.tsx` (launcher and visibility hook) and `acmeChatPanelStore.ts` (open state). `AcmeChatWidget.tsx`: no floating button; the panel opens under the top bar; focus and Escape. `page-header.tsx` and `mobile-top-bar.tsx` (upstream files): one launcher line each. The guardrail history pager keeps its left alignment |
| Worker | None |
| Infra / Terraform / Helm | None |
| Integrations | None |

## 5. Database change

None. **Rollback:** revert the commit and redeploy the previous console image
(`release.sh --redeploy <previous tag>`). No data changes.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Users can't find the assistant after it moves | Low | Low | A labelled button in the top bar, visible on every project page |
| The open panel covers the right-hand end of the page's title row | Medium | Low | It's an overlay the user opened; Escape or the launcher closes it |
| A conflict in `page-header.tsx` or `mobile-top-bar.tsx` at the next upstream sync | Medium | Low | One import and one line each, next to upstream's own launcher |

## 7. Compatibility

- **Backward compatible:** yes. No schema or API change.
- **Feature flag:** not needed. The change only moves where an existing feature is opened.

## 8. Client-facing notes

ACME AI is opened from an "ACME AI" button in the top bar (an icon on mobile) instead of a
round button in the bottom-right corner. Nothing on any page is hidden behind it any more.

## 9. Validation (gate evidence)

| Gate | Result | Evidence |
|---|---|---|
| A: leave dev | See the PR | Typecheck, ESLint `--max-warnings 0`, Prettier and `knip` on the build workstation; a client test (`AcmeChatLauncher.clienttest.tsx`) for opening, focus, Escape, the launcher's state and hiding it from roles without access |
| B: staging | `Staging: not available.` | No database change |
| C: post-deploy (dev) | Passed 2026-09-27 on `acme-v4.38.0.22` | The 27-page sweep was repeated at 1440×900, read-only, in the owner's session. The launcher is in the top bar on all 26 project pages, with no floating button, and nothing in the bottom-right corner is covered. The four controls it used to block (Older on Gateway changes and Gateway requests, the Playground settings menu, Revoke on LLM Gateway) are clickable. The panel opens under the launcher, focuses the message box and closes on Escape. A typed draft survived an in-app navigation and reopening; no message was sent |

## 10. Assumptions and open questions

- **A keyboard shortcut** for ACME AI (upstream's assistant uses Mod+I) is left for later.
- **The table pager's partial overlap** on the nine upstream pages goes away with the
  floating button; nothing else changes on those pages.

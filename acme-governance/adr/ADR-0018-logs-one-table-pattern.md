# ADR-0018: One table pattern for the Logs page

| | |
|---|---|
| **Change ID** | CHG-2026-084 · Tier 1 (client-visible: every tab of the Logs page) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Not yet released |
| **Status** | Proposed |
| **Type** | Forward |
| **Date** | 2026-09-27 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | Pending. The owner asked for the change on 2026-09-27; merging and the dev deploy stay with the owner |
| **Commits / tag** | See the PR |

## 1. Purpose

The Logs page's four tabs looked and behaved differently:

| Tab | Before |
|---|---|
| Audit logs | the shared table with its toolbar (row height), standard pagination footer, and its own scroll box |
| Guardrail events | a hand-built table in a card, with Newer and Older buttons; a row opened a details dialog |
| Gateway changes | a hand-built table in a card, with Newer and Older buttons; a row expanded in place to show JSON |
| Gateway requests | two hand-built tables in cards (this project's keys, and keys CAIRO did not issue), each with Newer and Older buttons; cells carried a second line of detail |

The owner asked for all four to follow one pattern.

## 2. Scope

**In:** how the four tabs render: the table, toolbar, paging, row details, and the loading,
empty and error states.

**Out:**
- the tRPC procedures, their filters, the export and its audit entry;
- who may see or export what (ADR-0011, ADR-0013);
- the reconciliation status card on Gateway requests, which stays as it is, above the table.

## 3. Decision

- **One component, `AcmeLogTable`, used by all four tabs.** In order, from the top:
  1. a one-line description;
  2. an optional filter row;
  3. the shared toolbar, with a summary (counts, a scope switch) on the left and actions
     (Export) and row height on the right;
  4. an optional notice;
  5. the shared `DataTable`, in the shared table card, with the standard pagination footer.
- **Paging stays as each procedure pages; only the footer is shared.**
  - Audit logs, Gateway changes and Gateway requests page by offset, with page numbers.
  - Guardrail events keeps its keyset paging (ADR-0013). The footer runs in cursor mode:
    previous and next, no jumping to a page number. Changing the page size starts again from
    the newest page.
  - Every tab offers 20, 50 or 100 rows a page (the procedures cap a page at 100), default 50.
- **A row opens its details.** Guardrail events keeps its existing details dialog. Gateway
  changes and Gateway requests get a shared details panel (`AcmeLogDetailDialog`): labelled
  fields, then the raw JSON on request. Gateway changes no longer expand in place.
- **Small rows are single-line.** The second line of detail each Gateway requests cell used to
  carry (duration, key alias, provider, tokens in and out, cache) moved into the row's details.
- **Gateway requests is one table with a scope switch** ("This project's keys" / "Keys CAIRO
  did not issue") instead of two tables. The second scope is still for organisation owners
  only; anyone else sees the server's explanation in the table.
- **Errors are shown.** The shared table draws loading rows whenever it has no rows, errors
  included, so a failed load used to look like a load that never finished (the Audit logs tab
  had this too). `AcmeLogTable` shows the error message in the table instead.
- **Two small honesty fixes made while here:**
  - the User column on Guardrail events and the End user column on Gateway requests say, in
    a header tooltip, that the value is reported by the calling application and not verified;
  - the Audit logs Actor tooltip no longer says "within Langfuse".
- **Rejected:**
  - *Moving the guardrail filters into the upstream filter builder:* its filter model would need
    translating to the history procedure's filter, for no gain the owner asked for.
  - *Offset paging for Guardrail events:* ADR-0013 rejected it because new events shift pages.

## 4. Impacted components

| Component | Impact |
|---|---|
| Postgres schema / ClickHouse | None |
| Web / API | New `AcmeLogTable.tsx` (the pattern, the details panel, paging helpers) with a client test. `AcmeAuditLogsTable.tsx`, the guardrail events log in `AcmeGuardrailsTable.tsx`, `EventsTab` in `AcmeLitellmGateway.tsx`, and `AcmeLitellmRequestLogs.tsx` render through it. The guardrail details dialog's stale "Security > Logs" text now says "Reports / Logs > Logs". No procedure changes |
| Worker | None |
| Infra / Terraform / Helm | None |
| Integrations | None |

## 5. Database change

None. **Rollback:** revert the commit and redeploy the previous console image
(`release.sh --redeploy <previous tag>`). No data changes.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Keyset paging through the shared footer misbehaves (a skipped or repeated page) | Low | Medium | The paging rule is a pure function with tests; gate C pages forward and back on dev |
| Column widths and row height are remembered per browser under new table names | Low | Low | Defaults apply on first use |
| A conflict with CHG-2026-082, which edits the Guardrails page in the same file | Medium | Low | That change edits the Continuous Assurance card; this one edits the events log further down the file |

## 7. Compatibility

- **Backward compatible:** yes. No procedure, schema or permission change.
- **Feature flag:** not needed.

## 8. Client-facing notes

All four Logs tabs now look and work the same way: one table with the same toolbar, row
height, paging and a details panel when you click a row. Gateway requests shows one list at
a time, with a switch between this project's keys and keys CAIRO did not issue.

## 9. Validation (gate evidence)

| Gate | Result | Evidence |
|---|---|---|
| A: leave dev | See the PR | Typecheck, ESLint `--max-warnings 0`, Prettier and knip on the build workstation. New `AcmeLogTable.clienttest.tsx`: the paging helpers (forward, back, page size, value or function updates), the data mapping, rendering, row click, the error and empty states, and the details panel |
| B: staging | `Staging: not available.` | No database change |
| C: post-deploy (dev) | Planned | Read-only, in the owner's session: each tab shows the same layout; paging forward and back (Guardrail events in cursor mode, the others with page numbers); page size; a row's details; the Guardrail events filters, counts, "hide test traffic" and Export as before; the Gateway requests scope switch; the top bar stays clear when scrolling |

## 10. Assumptions and open questions

- Column visibility (hiding columns) is not offered yet; the toolbar supports it if wanted.

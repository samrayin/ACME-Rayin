# ADR-0013: Guardrail event history: paging, filters and an audited export

| | |
|---|---|
| **Change ID** | CHG-2026-079 · Tier 1 (audit data, authorisation, client-visible) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | The next console release after merge (`acme-v4.38.0.N`) |
| **Status** | Proposed: awaiting the owner's review |
| **Type** | Forward |
| **Date** | 2026-09-27 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | Pending. The owner reviews and merges; no self-approval |
| **Commits / tag** | Recorded at merge · tag at release |

## 1. Purpose

Every guardrail decision is stored in Postgres (`acme_guardrail_events`), pushed there by
`rayin-guardrails` at decision time. But both screens that show them read only the newest 50
rows: the Guardrails page's totals and the Security › Logs table. Nothing older could be
viewed or exported in CAIRO. On 2026-09-27 about 100 events from a post-deploy test run pushed
every real event off the list, although all of them were still stored. The Guardrails page's
Total / Blocked / Redacted / Allowed cards were also counted over those 50 rows only.

## 2. Scope

**In:**
- a paged, filtered read of the stored history;
- a CSV export of what a filter matches;
- the Security › Logs guardrail view and the Guardrails page totals;
- an audit-log resource type for exports;
- the Security Analyst allow-list entry for the read.

**Out:**
- how long events are kept (the 30-day retention job is separate);
- forwarding to a SIEM;
- content in exports (redacted text, PII findings, encrypted blocked content);
- any schema change.

## 3. Decision

- **Read from Postgres, not the service's buffer.** The first page still pulls the
  `rayin-guardrails` buffer, best-effort, so events whose push failed are backfilled as
  before. If the pull fails, the view says so and still shows everything stored.
- **Keyset paging:** newest first by decision time, with the row id breaking ties; 50 rows a
  page (at most 100). Offset paging was rejected because new events shift the pages.
- **Filters:**
  - a date range ("From" inclusive; "To" includes that whole day, in the viewer's time zone);
  - action and direction;
  - agent contains and user contains;
  - hide test traffic.

  The counts shown cover every row the filter matches, not the page.
- **Test traffic** means agent names starting `promptfoo-` or `guard-probe-`, which CAIRO's own
  test runs use. It is hidden only when the viewer asks, and the number hidden is shown. Agent
  names are set by the caller, so hiding them by default would let a caller keep events out of
  the default view by choosing such a name.
- **The Guardrails page totals** count the last 30 days on the server.
- **Export:**
  - **Content:** a CSV of what the filter matches, newest first. Metadata only: time, action,
    direction, policy, agent, user, machine, trace id, event id and source.
  - **Cap:** 10,000 rows. The UI says when an export was cut short.
  - **Audit:** the audit log is written before any row is returned. The entry records resource
    `acmeGuardrailEvents`, action `export`, and the filter, row count and whether it was cut
    short. If that write fails, the export fails.
  - **Cells:** a cell never starts as a spreadsheet formula, because agent, user and machine
    values come from the caller. The file starts with a UTF-8 marker, so Arabic names open
    correctly.
- **Who:**
  - **Browsing the history:** Owner and Admin (`projectGuardrails:read`), and the Security
    Analyst and Auditor through their allow-lists.
  - **Exporting:** Owner and Admin only. The export writes the audit log, so it is a mutation,
    and ADR-0011 §4 limits the content-free roles to read-only procedures. The page hides the
    button for those roles, and the server refuses them.
- **Rejected:**
  - *Export as a query:* it would be read-only in name only, and a refetch would write
    duplicate audit entries.
  - *A server-side file or batch-export job:* too much machinery for at most 10,000 metadata
    rows.
  - *Hiding test traffic by default:* see above.

## 4. Impacted components

| Component | Impact |
|---|---|
| Postgres schema | None. Uses the existing `(project_id, event_time)` index |
| ClickHouse | None |
| Web / API | `acmeGuardrailsRouter`: new `eventHistory` (query) and `exportEventHistory` (mutation); `recentEvents` keeps its behaviour, sharing the buffer and row helpers. New `acmeGuardrailsHistory.ts` (filters) and `utils/guardrailEventsCsv.ts`. `AcmeGuardrailsTable.tsx`: the Security › Logs view and the page totals. `auditLog.ts`: resource type `acmeGuardrailEvents`. `securityRoleAllowList.ts`: `acmeGuardrails.eventHistory` |
| Worker | None |
| Infra / Terraform / Helm | None |
| Integrations (LiteLLM, NeMo, promptfoo) | `rayin-guardrails` unchanged. The history's first page pulls up to 200 buffered events (the whole buffer) instead of 50 |

## 5. Database change

None. **Rollback:** revert the commit and redeploy the previous console image
(`release.sh --redeploy <previous tag>`). No data is changed, so nothing is lost on rollback.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The first page's poll (every 10 s) runs a count and a group-by over the filter | Low | Low | Indexed on project and time. Hundreds of rows today. Revisit near a million |
| Substring filters on agent and user aren't indexed | Low | Low | Same volume argument. A trigram index can follow if needed |
| An export is bulk personal data (user ids, machine names) | Medium | Medium | Owner and Admin only, audited before it's served, capped, metadata only |
| A caller-set value turns into a formula in a spreadsheet | Medium | Medium | Cells are neutralised (tested) |
| Upstream merge conflicts | Low | Low | ACME files, plus one line in `auditLog.ts`'s resource union |

## 7. Compatibility

- **Backward compatible:** yes. No schema or public API change. `recentEvents` stays, now
  unused by the UI. It can be removed in a later change.
- **Feature flag:** not needed. The change only reads stored data, and the export is gated and
  audited.

## 8. Client-facing notes

Security › Logs › Guardrail events shows the whole stored history, with filters, pages and
(for Owners and Admins) a CSV export. The Guardrails page totals now cover the last 30 days and
link to the history.

## 9. Validation (gate evidence)

| Gate | Result | Evidence |
|---|---|---|
| A: leave dev | Passed on the build workstation | `pnpm run typecheck`: passed (2 known, tolerated errors in unmodified Enterprise files). ESLint `--max-warnings 0` on every changed file: clean. `knip`: only the 2 findings already on `main`. Unit tests: `acmeGuardrailsHistory` 6, `securityRoleAllowList` 34, `contentFreeRoles` 25 (65 passed); `guardrailEventsCsv` 3 passed. The router against a real Postgres couldn't run locally (no container runtime) |
| B: staging | `Staging: not available.` | No migration, so no rehearsal. Rollback is a redeploy of the previous tag |
| C: post-deploy (dev, after an owner-approved deploy) | Pending | 1. The history pages through every stored event, and the counts match a read-only SQL count. 2. Each filter narrows the list, and "hide test traffic" shows how many it hid. 3. An export as Admin downloads the rows and adds an `export` entry to the audit log. 4. A Security Analyst sees the history but no export button |

## 10. Assumptions and open questions

- **Owner decision:** should the Security Analyst and Auditor be able to export? That needs an
  ADR-0011 amendment, allowing an audited mutation on the content-free roles' lists.
- **How far back the history goes** is whatever is stored. The 30-day retention job decides
  that.
- **Test traffic by prefix** is a convention. A test-run marker set by the eval runner itself
  would be sturdier.
- **`recentEvents`** can be removed once nothing depends on it.

# ADR-0017: Removing the Assurance (Preview) demo

| | |
|---|---|
| **Change ID** | CHG-2026-083 · Tier 1 (client-visible: a console page goes away) |
| **Owner** | Anees Ur Rahman |
| **Affected release** | Not yet released |
| **Status** | Proposed |
| **Type** | Forward |
| **Date** | 2026-09-27 |
| **Author** | Claude session (Opus 5.5) for Anees Ur Rahman |
| **Approval** | Pending. The owner asked for the removal on 2026-09-27; merging and the dev deploy stay with the owner |
| **Commits / tag** | See the PR |

## 1. Purpose

Assurance (Preview) was added on 2026-09-15 as a fast demo of an Asset Inventory and
Assurance feature. It showed the guardrails' live on/off state, plus a table of IT Ops assets
whose risk ratings were classified by hand. Its own code comment said to remove it once the
real features ship, "rather than let a demo linger as if it were the shipped thing". They
haven't shipped, and the demo was still in the Governance Controls section of every
project's sidebar. A review of the console on 2026-09-27 found that a hand-classified IT Ops
demo sitting beside real controls weakens the product's credibility with bank buyers, and
the owner asked for it to go.

## 2. Scope

**In:**
- the sidebar entry;
- the page (`/project/[projectId]/acme-enhancements/assurance-demo`);
- its components (`AcmeAssuranceDemoPage.tsx`, `AcmeAssuranceDemoTable.tsx`);
- its tRPC router (`acmeAssuranceDemoRouter.ts`) and its registration in `root.ts`;
- the router's two entries in the Security Analyst allow-list.

**Out:**
- the Guardrails page and its Continuous Assurance card (CHG-2026-082 handles that card);
- any real Asset Inventory or Assurance feature, which stays future work;
- historical records that mention the demo (changelog, ADR-0016), which stay as written.

## 3. Decision

- **Remove it completely,** not hide it behind a flag. It has no data of its own (its assets
  were hard-coded), so nothing is lost, and the code stays in git history if a demo is ever
  wanted again.
- **No redirect.** The old URL now returns "not found". It was a preview linked only from the
  sidebar, and redirecting it to another page would suggest the feature moved.
- **Rejected:**
  - *Keeping it behind a feature flag or in a demo organisation:* it still ships in the image
    and still needs maintaining, for a feature that doesn't exist.

## 4. Impacted components

| Component | Impact |
|---|---|
| Postgres schema / ClickHouse | None |
| Web / API | `routes.tsx` (entry and icon import), `root.ts` (router), `securityRoleAllowList.ts` (two entries); four files deleted. The per-role sidebar test drops the entry |
| Worker | None |
| Infra / Terraform / Helm | None |
| Integrations | None. The live guardrail state it showed is still on the Guardrails page |

## 5. Database change

None. **Rollback:** revert the commit and redeploy the previous console image
(`release.sh --redeploy <previous tag>`). No data changes.

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Someone used the demo in a sales conversation | Low | Low | The code is in git history; a demo can be rebuilt from it, outside the product |
| A bookmark to the old URL | Low | Low | It shows "not found"; the sidebar no longer links to it |

## 7. Compatibility

- **Backward compatible:** yes for everything that remains. Two tRPC procedures are removed;
  nothing else calls them.
- **Feature flag:** not needed.

## 8. Client-facing notes

The Assurance (Preview) demo is removed from the Governance Controls section.

## 9. Validation (gate evidence)

| Gate | Result | Evidence |
|---|---|---|
| A: leave dev | See the PR | Typecheck, ESLint, Prettier and knip on the build workstation. The per-role sidebar test (`acme-role-navigation.clienttest.tsx`) no longer expects the entry. The Security Analyst allow-list tests pass without the two removed procedures |
| B: staging | `Staging: not available.` | No database change |
| C: post-deploy (dev) | Planned | Read-only, in the owner's session: the entry is gone from the sidebar for Owner, Security Analyst and Auditor; the old URL shows "not found"; the Guardrails page and its live state are unaffected |

## 10. Assumptions and open questions

- A real Asset Inventory, if built, gets its own change and ADR.

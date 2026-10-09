# ADR-0030 — EYEON Home as a command centre for an executive and a security lead

| | |
|---|---|
| **Change ID** | CHG-2026-147 |
| **Owner** | Anees Ur Rahman |
| **Affected release** | The first console release after merge (tag to be added at release) |
| **Status** | Proposed |
| **Type** | Forward; supersedes ADR-0028 §3.1's "the overview as Home" and §3.3's arrangement format |
| **Date** | 2026-10-09 |
| **Author** | Claude (EYEON build session), for the owner |
| **Approval** | Pending. The owner reviews and merges; no self-approval. Not a production approval |
| **Commits / tag** | To be added at merge · release tag to be added at release |

## 1. Purpose
The owner, 2026-10-09: "My home page needs complete revamping.. it should have useful information. refer to the Reports - Dashboard - Home for reference only.. my CEO wants revamping.. create amazing dasboard with useful infomraiton.. you should be able to move the widgets across.. You need to act as a CEO + CISO".

Since ADR-0028, EYEON Home has been the overview: six guardrail tiles and five cards. It answers "what did the guardrails do", but not the three questions a leader opens Home with:
- Are we safe?
- What does AI cost us, and is it used?
- What needs me?

This ADR makes Home a command centre built around those questions.

## 2. Scope
**In:** what Home shows (§3.1), where its figures come from (§3.2), the attention queue (§3.3), arranging it (§3.4) and its honesty rules (§3.5).

**Out:**
- **Unchanged pages:** the overview page itself, which keeps its own arrangement, and every EYEON page's reads and access rules.
- **Unchanged routing:** the flag (still `CAIRO_EYEON_HOME_ENABLED`, needing the overview's) and the role landings of ADR-0028 §3.2. The Security Analyst and the Auditor still land as before.
- **Not added:** a server-side store for arrangements, and any composite "risk score".

## 3. Decisions

### 3.1 What Home shows, top to bottom
1. **Briefing.**
   - **Greeting:** a greeting by the viewer's clock.
   - **The line on what needs you:** "4 things need your attention.", or "All clear" when nothing does.
   - **Sentences:** one each on activity, the guardrails, the month's spend and model health. Each figure is highlighted.
   - **Chips:** the mode chip, plus "Gateway traffic only" and "Metadata only".
   - **Three rings,** each a share a page states exactly:
     - checks decided in enforce mode;
     - gateway calls answered without error;
     - models that passed the last health check.
2. **Headline figures:** AI calls, spend this month, risks flagged (with how many were let through), the enforced share, applications (with those needing action) and healthy models. Each opens its page.
3. **Widgets,** arrangeable (§3.4):
   - Needs your attention;
   - Guardrail posture;
   - Risks stopped and let through;
   - Spend this month;
   - AI adoption;
   - Gateway and models;
   - What the guardrails caught;
   - Control integrity;
   - Top applications;
   - Applications at risk;
   - Model mix;
   - Closest to budget;
   - What EYEON cannot see.

### 3.2 Figures come only from the EYEON pages' own summaries
Home has no router and no reads of its own. It asks the summaries of the overview, Spend, Gateway health, Guardrail decisions, and Enforcement and policy, for the same period.

- **Each summary only for a role that opens its page:**
  - Spend for `llmGatewaySpend:read`;
  - the two guardrail pages for `projectGuardrails:read`;
  - the overview and Gateway health under Home's own rule (`llmGateway:read` or `evidence:read`).
- **Every figure matches the page it links to,** and no role sees more on Home than on those pages. The routers' allow-lists, tests and metadata-only reads (ADR-0027) cover Home with no new server surface.
- **A switched-off page** answers "not enabled" without reading. Its widgets say so.
- **Cost:** at most five summaries per load, each with a fixed number of reads (about forty bounded queries in all), cached for a minute. This is accepted over a dedicated router that would duplicate their logic and could drift from their figures.

### 3.3 "Needs your attention"
A ranked list, "Act now" before "Watch". Each item names the figure behind it and links to its page.
- **Act now:**
  - risky prompts or answers not stopped (outside enforce mode);
  - the judge's no-verdict rate above its alert level;
  - applications rated "Act now";
  - failing models;
  - guardrail pods off the current settings;
  - a gateway replica reporting another mode;
  - keys over budget;
  - failed calls at the scorecard's red level.
- **Watch:**
  - keys past 80% of budget;
  - personal data not redacted outside enforce mode;
  - applications without a spending limit;
  - failed calls at the amber level;
  - stale guardrail pods;
  - the request log behind.
- **Thresholds:** they are the Applications scorecard's (`SCORECARD_THRESHOLDS`) and the pages' own, not new ones.
- **Missing sources:** a source the viewer cannot open adds nothing. One that failed to load is named under the list ("Not checked here"), so an empty list never hides a gap.

### 3.4 Arranging, for oneself
The same model as ADR-0028 §3.3 and §3.4, extended:
- **Moving:** every widget moves anywhere in one grid, by dragging its grip or with its buttons. It no longer moves only within its group.
- **Sizing:** each widget can be a third, two thirds or the full width ("Wider" and "Narrower" buttons). The last widget of a row still widens to fill it.
- **Views:** three starting points.
  - **Everything:** every widget.
  - **Executive:** money, adoption and applications first; the security detail hidden.
  - **Security:** posture, what was caught and control integrity first; the money hidden.

  Choosing a view replaces the arrangement. Any change after that makes it "Your arrangement".
- **Storage:** kept per person and project in this browser only, under a new versioned key (`cairo.eyeonCommandCentre.v1:<user>:<project>`). It is never sent to the server, changes nothing anyone else sees and widens no role. The overview's ADR-0028 arrangement is untouched.
- **Accessibility as before:** real buttons for every action, focus follows the moved widget, changes are announced, and content is inert while arranging.

### 3.5 Honesty
- **No invented figures:** no composite score is shown. The rings are exact shares, and an empty share draws an empty track with its reason, never 0%.
- **Gaps in words:** a widget whose source is loading, switched off, failed or not recorded (for example, the request log off) says so in words.
- **"What EYEON cannot see":** a standing widget that names what the figures miss: traffic that bypasses the gateway, the end user's identity, and content (by design).

## 4. Consequences
- **What Home does:** it answers the leader's questions first and every figure is one click from its evidence. A role sees on Home only what its pages already show it.
- **Overview page:** it stays as the guardrail-focused view at its own entry. Its `asHome` mode is no longer used by Home; removing it is a later clean-up.
- **Loading:** Home's load is the sum of up to five page summaries. If that shows up in latency, a later change can add a combined read behind the same access rules.
- **Rollback:** revert the commit (Home returns to the overview), or switch `CAIRO_EYEON_HOME_ENABLED` off (the classic Home). No data or schema change.

## 5. Verification
- **Unit tests** cover the attention queue, the briefing, the rings, the links, the views, sizing, sanitising a stored arrangement and storage that refuses.
- **Rendering tests** cover role differences (no spend without its scope, no guardrail widgets without theirs), honest states, moving, resizing, hiding and showing, reset, inert content and reading back an arrangement.
- **Storybook stories** cover Owner (dev as of 2026-10-09), Auditor, Enforcing and Loading. They were checked in a real browser at 1440 px and 375 px (no horizontal scroll), with a real mouse drag, a resize and the Security view.
- **Not yet verified:** Home on real data in dev, which needs the owner's on-screen check after release.

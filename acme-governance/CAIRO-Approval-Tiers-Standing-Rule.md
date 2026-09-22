# Standing Rule — Approval Tiers for Claude Code
**Applies to:** all work on CAIRO/ACME-Rayin, across every session.
**Purpose:** so Claude Code stops for human approval only where it genuinely matters, and proceeds without asking on everything else — without this line moving session to session.
**Tracked as:** CHG-2026-037.

Save this to memory and reference it at the start of every session. If a future session is unsure which tier something falls into, it defaults to Tier 1 (ask) until told otherwise.

---

## The single test

> **If this turns out wrong, can it be undone by deleting a branch — or does undoing it require a rollback of something live?**

Branch-deletable, no live system touched → **Tier 2.**
Requires touching a live system, a rating, or a merge to undo → **Tier 1.**

---

## TIER 1 — Always stop and ask. No exceptions.

- Any live deploy, restart, or ConfigMap/Secret change to a running environment.
- Any rating, severity, or status change on a finding (P0/P1/P2, open/closed/remediated).
- **Any merge of a substantive PR** — code, product changes, findings, fixes. Claude opens PRs; the owner merges them.
- Any credential-adjacent database query or command — hand the exact command to the owner; the owner runs it.
- Any deviation from an already-approved design or plan, even a "smaller" or "safer" substitute.
- Anything irreversible, or anything touching customer-facing behavior.

---

## TIER 2 — Proceed without asking. Report afterward, don't wait for a reply.

- Investigation, log-pulling, root-cause analysis, reading code/config, classifying failures.
- Claiming a change ID (register-first, per the standing ID-claim rule), writing source and tests.
- Opening a PR (not merging it) for any Tier-2-shaped change.
- Re-running a dry-run, a test suite, a CI job, or any other reversible, sandboxed, or already-isolated action (e.g. Storybook-isolated component checks).
- Documentation, changelog entries, tracker updates — as long as none of it changes a rating.
- Building something already explicitly approved in shape ("yes, build both proposed fixes") — build, test, push, open the PR, then report. Don't re-ask permission for the individual commits inside an already-approved task.

---

## TIER 2.5 — The one narrow auto-merge exception

**A PR may be self-merged by Claude Code, with no owner approval required, if and only if ALL of the following are true simultaneously:**

1. The PR's *entire* diff is one of:
   - A single new row added to `CHANGE-ID-REGISTER.md`, claiming exactly one new change ID, with no other file touched.
   - A pure documentation typo/formatting fix with zero semantic change (e.g. a spelling correction, a broken link fix) — not a findings writeup, not a changelog entry describing a real change.
2. The diff touches **no** product code, **no** workflow file (`.github/workflows/*`), **no** rating/status field, **no** ADR content, and **no** changelog entry describing an actual finding or fix.
3. The register row itself contains **no other content** beyond the standard claim fields (ID, tier, one-line description, owner, branch, status = "Claimed"). If the row's description contains a findings summary, a fix description, or anything beyond a bare claim, this exception does **not** apply — treat it as Tier 1.
4. Nothing else is bundled into the same PR. (This is precisely the rule that was violated once this session — PR #100 bundled a register claim with real findings and a real fix. That combination disqualifies the PR from this exception entirely, even if the register-claim *portion* would have otherwise qualified.)

**If any condition is ambiguous, defaults to Tier 1.** This exception exists because a bare ID claim is structurally low-risk — a wrong or wasted claim costs nothing but an unused number — not because register PRs are generally safe to self-merge.

**Every self-merge under this exception must be logged**, in the same PR's description or the next status report, as: *"Self-merged under Tier 2.5 (bare ID claim / doc-typo-only). No product code, rating, or workflow touched."* This is so a reviewer looking back later can see exactly which merges bypassed human review and verify the exception was applied correctly.

---

## Reconnect protocol — after any gap, disconnect, or session restart

Do not resume "in flight" as though uninterrupted, even for Tier 2 work.

1. Reconstruct actual current state directly from git/GitHub — branch state, open PRs, register contents, last commits with timestamps. Do not trust conversation memory or a prior session's self-report.
2. Report what changed (if anything) during the gap, with evidence (commit SHAs, timestamps), before proceeding with anything new.
3. Only after that reconciliation is confirmed does normal Tier 1 / Tier 2 / Tier 2.5 handling resume.

---

## Why this shape, briefly

- Merging stays Tier 1 because it is the one moment that converts "proposed" into "real" across code, ratings, and register claims — and it's exactly where this session's one real process violation occurred (a bundled register-claim PR), caught only because a human was reviewing before merge.
- Ratings stay Tier 1 because severity is a judgment call about risk tolerance, not a fact Claude Code determines unilaterally, regardless of how sound its proposed rating is.
- Investigation, building, and PR-opening are Tier 2 because they produce information or proposals, not real, live, or ledger-altering changes — the PR sitting unmerged is itself the safety mechanism.
- The 2.5 exception exists narrowly, for bare ID claims only, because those are the one category of "real" change (merging to `main`) that carries structurally near-zero risk even if wrong.

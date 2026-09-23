# Critical Finding Resolution Standard
**Applies to:** any ledger finding rated P0 or P1, and any finding that gates enforcement of a security or compliance control (e.g. guardrail enforcement, data retention, access control).
**Status:** Standing procedure. Reference this document automatically whenever a new critical finding is proposed, investigated, or closed.
**Owner of ratings and closure decisions:** Anees Ur Rahman, always. No session — build, governance, or audit — closes or re-rates a critical finding unilaterally.

---

## Why this exists

On 2026-09-20/21, several critical findings were found, fixed, and nearly mis-fixed in the same session. The pattern that recurred, in different forms, roughly five times:

- A finding was diagnosed correctly, but the first proposed fix addressed the *symptom* rather than the *root cause* (e.g. proposing a judge-model swap for N-56, when the actual defect was an unregistered/mismatched output parser one layer deeper).
- A fix for one finding silently exposed a second, previously dormant one (fixing N-56 without also fixing F7 would have converted a masked PII bypass into a live one).
- Claims of "verified" or "merged" were made on the strength of a local log or a command's exit code, not the actual remote/live state — caught only because someone checked the primary source before acting further.
- A candidate fix (a new judge model) was tested against a simplified stand-in rather than the real code path, which would have hidden a real defect (reasoning-channel token consumption breaking `max_tokens: 4`) until it broke in a live restart.

None of these were caused by carelessness. They were caused by skipping one of the checks below under time or momentum pressure. This document exists so the checks happen by default, not by memory.

---

## The five-question test — apply to every critical finding, both when diagnosing and when proposing a fix

### 1. Root cause, or symptom?
State explicitly which one the proposed fix addresses. If it's a symptom fix, say so plainly and record the root cause as still open, even if the symptom fix ships.

*Example from this engagement:* Swapping the guardrail's judge model would have made the false-positive rate look better without touching the actual defect (no parser registered for the judge's response format). The fix had to go one layer deeper — read the actual parsing code, not just try a different model.

### 2. What does this fix newly expose?
A fix that closes one finding can make a second, previously dormant one live. Before closing a finding, ask what was silently protecting the system against a different defect, and whether that protection disappears once this fix ships.

*Example:* The guardrail's jailbreak detector blocked 100% of prompts, which — as an accident, not a control — meant a separate PII-based bypass could never actually be exploited. Fixing the jailbreak detector without also fixing the PII bypass would have turned a dormant hole into a live one.

### 3. Verified against the running system, or assumed from documentation/design/a prior report?
No fix, merge, or rotation is reported as complete on the strength of a command's exit code, a local git log, or documentation about how a system is supposed to behave. Verify against:
- The actual remote state (fresh fetch, contents API, or equivalent — not a cached local view)
- The actual running pod/service (logs, live config, direct primary-source read)
- The actual database/ledger content (query it, don't infer it)

If verification is not possible before reporting, say so explicitly rather than reporting success provisionally.

### 4. Can this be tested in isolation, with zero blast radius, before it touches anything live?
Before any change that affects a live, shared, or production-adjacent system:
- Design a test that proves the fix works without applying it to the live system.
- Only after the isolated test passes, apply the change to the live system, with a stated rollback.
- If no such isolated test is possible, say so and treat the live application itself as the test — with an explicit, pre-agreed rollback trigger.

### 5. Who is the independent reviewer?
No critical finding is rated, closed, or confirmed-fixed by the same person or session that built the fix, without an explicit, logged exception.
- Ratings (P0/P1/P2, open/closed/remediated) are the owner's decision, always — never auto-applied by a build session, even when the evidence clearly points to a particular rating.
- Where a second technical reviewer exists (a parallel session, an external audit pass), critical findings should pass through that reviewer before being marked resolved.
- If no second reviewer is available, the owner personally reviews the evidence before closure — this document is not a substitute for that review, it is what makes the review efficient.

---

## Required structure for every critical finding write-up

**A. Resolution**
The actual fix. State explicitly whether it is:
- **Structural** — removes the defect's precondition entirely (e.g., separating two guardrail checks so one cannot short-circuit the other), or
- **Patch** — works, but leaves the underlying mechanism fragile (e.g., tuning a prompt against a model whose output format may still drift).

Prefer structural fixes. If only a patch is available, say so and record the structural fix as a tracked follow-up, not an implied future improvement.

**B. What it might newly expose**
The second-order question from test 2, above. State explicitly what becomes newly reachable, newly trusted, or newly load-bearing once this fix ships — and whether that needs its own finding.

**C. Verification plan**
How this will be proven, specifically, ideally isolated and zero-risk before touching anything live. Name the exact check (a log line, a database query, a direct API call, a specific test corpus) — not "we will monitor it."

**D. Sequencing and ownership**
Classify what kind of blocker this actually is, since conflating these produces false timelines:
- **Engineering** — a change to code or config.
- **Procurement** — requires purchasing, licensing, or a paid tier.
- **Infrastructure** — requires provisioning (e.g., a multi-node cluster, a staging environment).
- **Organizational** — requires a decision or a person, not code (e.g., naming a second human approver).

State which category applies. A roadmap that treats a procurement blocker as if it will resolve at engineering speed is the single most common way a timeline goes wrong.

**E. What "done" looks like**
A concrete, checkable condition — not a general target.
- Weak: "Guardrail enforcement ships."
- Strong: "False-positive rate ≤ X% on a defined finance-vocabulary corpus, AND true-positive rate ≥ Y% on a defined attack corpus, both measured by an automated suite, both passing in CI before the change merges."

If a numeric target cannot yet be set (data doesn't exist yet), say that explicitly, and record establishing the number as its own step before "done" can be defined.

---

## Escalation rule

If any of the five questions cannot be answered — verification isn't possible yet, no isolated test exists, no second reviewer is available — **do not treat the finding as closed or the fix as safe to apply.** Say explicitly which question is unanswered, and treat that as the actual blocker, rather than proceeding on the answered questions alone.

---

## Standing exceptions

- **Register-only / documentation-only changes** (claiming an ID, fixing stale text, adding a cross-reference) do not require the full structure above — apply judgment, but do not let this exception quietly expand to cover substantive fixes.
- **Ratings, deletions, and anything touching a live gateway, database, or credential store** never qualify for a lighter-weight process, regardless of how routine they start to feel after repetition.

# CAIRO — Vision Tracker
**Purpose:** single source of truth for "are we there yet," updated at every stage. Not a changelog — a status board. The changelog and ledger remain the detailed record; this file answers one question fast: what's done, what's next, what's blocking.

**Last updated:** 2026-09-22 (PR #85 and PR #86 / CHG-2026-030 merged to `main`; not yet deployed. Also: N-51 root cause confirmed and two fix paths compared, CHG-2026-033 / ADR-0008 — separate Thread 2, no product code touched)
**Update rule:** Claude Code updates this file at the end of every work session or major milestone, before reporting back. If it hasn't been touched in a session where status changed, that's a process miss — flag it.

---

## The one-sentence vision, scored

> Every prompt is checked by guardrails. Every decision lands in an append-only audit trail. People review it in one console.

| Clause | Status | Evidence |
|---|---|---|
| Prompts are checked | 🟡 **Works in isolation, not in the live flow** | 0% false positives / 100% detection, measured 2026-09-21 (32-prompt corpus). Nothing in the live gateway path calls it yet. |
| Decisions are recorded, append-only | 🔴 **Two demonstrated gaps** | (1) Key config changes via raw API bypass CAIRO's audit trail entirely — P1, found 2026-09-22. (2) Append-only not enforced at DB level (P0-5) — app connects as admin, not least-privilege. |
| Reviewed in one console | 🟡 **Fix merged, not yet deployed** | Console correctly detects drift. CHG-2026-030 (fixes it): PR #86 merged to `main` 2026-09-22T13:27Z (commit `e881eb13`) — **not yet running anywhere; no deploy authorized or executed.** The console still cannot reconcile drift today, and Rotate still makes it worse until this ships to a live environment. |

**Honest one-line summary:** The components now work. The gateway is not yet "in action" as the vision describes — no live prompt is inspected today.

---

## The path to "gateway live in action" — four steps

| Step | What it is | Status | Blocking? |
|---|---|---|---|
| **Step 0** | Guardrail's judge model excluded from its own inspection (stop the gateway calling itself in a loop) | 🟡 Designed (ADR-0005-A), unit-tested 25/25 green. **Live key's prerequisite data now correct** (opt-out metadata, model allowlist, rpm cap all applied 2026-09-22, part of CHG-2026-029) — the exclusion **hook itself** is still not wired into the gateway | Blocks Step 1 |
| **Step 1** | The hook itself, wired into the gateway, **record mode only** (logs decisions, blocks nothing) | ⬜ Not started | Blocks Step 2/3 |
| **Step 2** | Make the audit trail durable / tamper-resistant | ⬜ Not started | Blocks Step 3 |
| **Step 3** | Flip to **enforce** mode (actually blocks bad prompts) | ⬜ Not started, no date | Needs latency budget + multi-node infra |

---

## Active work right now

| Change | What | Status |
|---|---|---|
| **CHG-2026-030 / ADR-0007** | Wire `updateKeyLimits()` to a Keys page edit dialog — the fix for the console defect above | 🟢 **Merged.** PR #86 merged to `main` 2026-09-22T13:27:21Z, commit `e881eb13`. **Not deployed** — `release.sh` has not been run, no ConfigMap change, no restart. Confirmed the push-to-main "Deploy to ECS" workflow that fired on this merge targets AWS ECS staging, unmodified upstream tooling irrelevant to this Azure/AKS fork — not a CAIRO deploy. |
| **CHG-2026-029** | Judge key drift (models/rpm_limit wrong in CAIRO's own DB; live gateway state is already correct) | 🔴 **Blocked**, narrowed — the fix is merged; now waiting on it to actually ship (`release.sh`) to a running environment, then the owner uses the new UI to reconcile CAIRO's record |
| **CHG-2026-031** | This file — adopted as a fourth standing record alongside the changelog, ledger and readiness-auditor prompt | 🟢 Merged (PR #87) |
| **CHG-2026-033 / ADR-0008** | N-51: why `pipeline.yml` never runs (zero registered runners, `blacksmith-*` labels needing an app this personal-account repo can't install), two fix paths compared (provision Blacksmith vs. move to `ubuntu-latest`) | 🟡 Written, owner to pick a path — no workflow file changed, nothing implemented yet |

---

## Findings this work surfaced (rated, tracked, not swept under)

| ID | What | Rating | Status |
|---|---|---|---|
| (unnamed, pending Ledger transcription) | Key config changes via raw LiteLLM API bypass CAIRO's audit trail entirely. Escalated 2026-09-22: **no reconciliation UI exists at all**, for anyone — the audited backend function is fully built and has zero frontend call sites. Rotate makes it worse: it silently reverts any drifted key to CAIRO's stale values. | **P1** | Open. **Deploying CHG-2026-030 does not close this** — it only unblocks CHG-2026-029's reconciliation of the drift already caused. The bypass itself needs the separate, not-yet-scoped "operator-accessible audited path for LiteLLM key mutations" backlog item. Becomes P0 at first customer deployment with external cluster access. |
| N-56 | Guardrail false-block defect | P1 | **Root cause fixed & measured**, not yet formally closed (needs 2nd corpus run + judge data-use terms confirmed) |
| P0-5 | Append-only not enforced at DB level | P0 | Open |
| P0-11 | No deletion path in any data store | P0 | Open — blocks Langfuse tracing re-enablement (ADR-0006) |
| N-20 | Inert Langfuse tracing callback | — | Closed (removed 2026-09-21) |
| N-51 | Heavy CI (`pipeline.yml`) has never run for any change in this fork's history — all test evidence to date is local, not CI-verified | — | Root cause confirmed 2026-09-22 (CHG-2026-033 / ADR-0008): zero registered runners, `blacksmith-*` labels need an app blocked by this repo's personal-account ownership. Two fix paths compared, owner to pick; not yet fixed |

---

## Explicitly parked — not being worked, and why

| Item | Why parked |
|---|---|
| **Langfuse gateway tracing (ADR-0006)** | Blocked on metadata-stripping hook (design done, not built) + P0-11 (no deletion path). Confirmed 2026-09-22: not the right time. |
| **Guardrail hook build (Step 1)** | Blocked on Step 0's hook being wired in — the live key's own data is ready, the hook code is not. |
| **Enforce mode (Step 3)** | No latency budget exists yet; single-node cluster makes fail-closed a single point of failure. |

---

## How to read this file

- 🟢 Done and verified live
- 🟡 In progress / partially true / built-but-not-applied
- 🔴 Blocked or a known active gap
- ⬜ Not started

**Next update trigger:** when CHG-2026-030 is actually deployed (`release.sh` run) to a live environment, or when the owner completes the CAIRO-DB reconciliation through it — whichever comes first.

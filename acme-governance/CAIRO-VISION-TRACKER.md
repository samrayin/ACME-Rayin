# CAIRO — Vision Tracker
**Purpose:** single source of truth for "are we there yet," updated at every stage. Not a changelog — a status board. The changelog and ledger remain the detailed record; this file answers one question fast: what's done, what's next, what's blocking.

**Last updated:** 2026-09-23. **2026-09-22:** CHG-2026-030 deployed as `acme-v4.38.0.6`; the judge key was reconciled through it and CHG-2026-029 is closed, confirmed against `acme_litellm_keys`/`acme_litellm_events` directly. Thread 2: **N-51 actually fixed, not just designed** — CHG-2026-034 (PR #94) merged to `main` 2026-09-22T20:30:39Z, `pipeline.yml`'s heavy jobs now run on `ubuntu-latest`, confirmed by a real green-and-red pipeline run, not YAML validity alone. CHG-2026-036 (PR #100) also merged — two more findings from that real run (P1 `layout.clienttest.ts` non-termination bug, still open; `smoke-image.sh` readiness gap, fixed) plus a Codespell false positive. Both of CHG-2026-036's CI-blocking fixes (`smoke-image.sh` retry, `tests-storybook` worker count) shipped inside PR #94, owner-approved after isolated-rerun investigation. **CHG-2026-037 adopted**, same evening: a standing Tier 1/Tier 2/Tier 2.5 approval-boundary rule for all future work on this repo (`acme-governance/CAIRO-Approval-Tiers-Standing-Rule.md`), written the day PR #100 bundled a register claim with real content in one commit. **2026-09-23:** the as-is HLD (`product-decisions/CAIRO-HLD-2026-09-23.html`, outside this repo) synced to current state — N-51 fixed, ADR-0007/0008 added, CHG-2026-035's P0 given equal weight to the still-open drift-prevention/Rotate gap, version bumped to 3. No new facts, no rating changes — a documentation sync of what this tracker already records.
**Update rule:** Claude Code updates this file at the end of every work session or major milestone, before reporting back. If it hasn't been touched in a session where status changed, that's a process miss — flag it.

---

## The one-sentence vision, scored

> Every prompt is checked by guardrails. Every decision lands in an append-only audit trail. People review it in one console.

| Clause | Status | Evidence |
|---|---|---|
| Prompts are checked | 🟡 **Works in isolation, not in the live flow** | 0% false positives / 100% detection, measured 2026-09-21 (32-prompt corpus). Nothing in the live gateway path calls it yet. |
| Decisions are recorded, append-only | 🔴 **Two demonstrated gaps** | (1) Key config changes via raw API bypass CAIRO's audit trail entirely — P1, found 2026-09-22. (2) Append-only not enforced at DB level (P0-5) — app connects as admin, not least-privilege. |
| Reviewed in one console | 🟢 **Fix deployed and used** | CHG-2026-030 deployed as `acme-v4.38.0.6` (digest `sha256:08083ee3...2957`), health-checked, traced. Owner used the new Edit dialog against the judge key; reconciliation confirmed directly against `acme_litellm_keys` (`models`/`rpm_limit`/`updated_at` all match live state) and `acme_litellm_events` (matched `INTENT`/`OUTCOME`/`success` pair). The console can now reconcile drift it detects — the gap this row tracked is closed. Rotate's stale-value hazard (it reads `models`/`rpm_limit` from CAIRO's own DB row, not live state) is unchanged and still real on any other drifted key. |

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
| **CHG-2026-030 / ADR-0007** | Wire `updateKeyLimits()` to a Keys page edit dialog — the fix for the console defect above | 🟢 **Deployed.** `release.sh` run 2026-09-22: rollback anchor captured (`acme-v4.38.0.5`, digest `sha256:55b267ae...843b8`) before deploy, tag-before-deploy sequence followed, digest-pinned `kubectl set image` to `acme-v4.38.0.6` (digest `sha256:08083ee3...2957`), rollout completed, health check HTTP 200, independently re-verified `TRACED` against the live cluster. Then used live by the owner (see CHG-2026-029). |
| **CHG-2026-029** | Judge key drift (models/rpm_limit wrong in CAIRO's own DB; live gateway state is already correct) | 🟢 **Closed, 2026-09-22.** Owner used the new Edit dialog; dialog pre-filled correctly from live state. Confirmed directly against the database, not the UI's word alone: `acme_litellm_keys` now `models={groq-safeguard,nvidia-nemotron}`, `rpm_limit=10`, `updated_at` moved off the stale 2026-09-20 row; `acme_litellm_events` has the matched `INTENT`/`OUTCOME`/`success` pair for `key.update` that was missing on the original raw-API change. |
| **CHG-2026-031** | This file — adopted as a fourth standing record alongside the changelog, ledger and readiness-auditor prompt | 🟢 Merged (PR #87) |
| **CHG-2026-033 / ADR-0008** | N-51: why `pipeline.yml` never runs (zero registered runners, `blacksmith-*` labels needing an app this personal-account repo can't install), two fix paths compared (provision Blacksmith vs. move to `ubuntu-latest`) | 🟢 Owner picked path (b) 2026-09-22 — implemented and merged, see CHG-2026-034 |
| **CHG-2026-034** | Implements ADR-0008 path (b): heavy `pipeline.yml` jobs moved to `ubuntu-latest` | 🟢 **Merged.** PR #94 merged to `main` 2026-09-22T20:30:39Z (`d6d55b4c`). Confirmed by a real full pipeline run after both owner-approved follow-up fixes shipped: 10 jobs pass for real (including `tests-ai-gateway` and `tests-storybook`, both previously flaky, both fixed). Remaining red jobs all have a known, already-tracked cause — CHG-2026-035's migration bug, or pre-existing debt (`knip` #96, `tests-web-client` #97, `lint` warnings) |
| **CHG-2026-036** | Two more PR #94 findings (`smoke-image.sh` readiness gap, `layout.clienttest.ts` non-termination) plus a Codespell false positive | 🟢 **Own content merged** (PR #100, 2026-09-22T18:16:41Z). The `smoke-image.sh` fix and a `tests-storybook` worker-count retune (owner-approved) shipped inside PR #94, not a separate PR. The `layout.clienttest.ts` finding (item 2, P1) itself is **not fixed** — see the findings table below |
| **CHG-2026-035** | P0 finding: migration `20260917090000_add_acme_guardrail_events_push_support` fails `REASSIGN OWNED BY postgres` on a from-scratch database where the connecting role is Postgres's bootstrap superuser | 🔴 **Open, PR #99 unmerged.** Proven on vanilla/Docker Postgres (blocks several CHG-2026-034 CI jobs); not demonstrated against Azure Flexible Server, ACME's actual target, either way. Fix proposed (narrow the `REASSIGN` to application objects only), not built, not reviewed |
| **CHG-2026-037** | Standing Tier 1/Tier 2/Tier 2.5 approval-boundary rule for all future work (`acme-governance/CAIRO-Approval-Tiers-Standing-Rule.md`) | 🟢 **Merged.** Claim (PR #103) self-merged under its own Tier 2.5, logged explicitly; content (PR #104) merged 2026-09-22T21:02:49Z. Supersedes ad-hoc judgment calls on what needs owner approval going forward |

---

## Findings this work surfaced (rated, tracked, not swept under)

| ID | What | Rating | Status |
|---|---|---|---|
| (unnamed, pending Ledger transcription) | Key config changes via raw LiteLLM API bypass CAIRO's audit trail entirely. Escalated 2026-09-22: the reconciliation UI (CHG-2026-030) is now deployed and was used to fix the drift it caused — but that closes CHG-2026-029, not this finding. | **P1** | **Still open**, unaffected by CHG-2026-030 shipping or CHG-2026-029 closing. Nothing stops a future raw `/key/update` call from bypassing the audit trail again — only the separate, not-yet-scoped "operator-accessible audited path for LiteLLM key mutations" backlog item closes this. Becomes P0 at first customer deployment with external cluster access. |
| N-56 | Guardrail false-block defect | P1 | **Root cause fixed & measured**, not yet formally closed (needs 2nd corpus run + judge data-use terms confirmed) |
| P0-5 | Append-only not enforced at DB level | P0 | Open |
| P0-11 | No deletion path in any data store | P0 | Open — blocks Langfuse tracing re-enablement (ADR-0006) |
| N-20 | Inert Langfuse tracing callback | — | Closed (removed 2026-09-21) |
| N-51 | Heavy CI (`pipeline.yml`) has never run for any change in this fork's history — all test evidence to date is local, not CI-verified | — | **Fixed and merged, 2026-09-22** (CHG-2026-034, PR #94, `d6d55b4c`). No longer true as stated: CI now dispatches and produces real pass/fail on every PR. That real dispatch is exactly what surfaced CHG-2026-035 (P0, open) and CHG-2026-036 item 2 (P1, open) below, plus issues #96/#97 — the predicted effect of fixing N-51, not a new problem |
| CHG-2026-036 (2) | `layout.clienttest.ts`'s timeline-layout algorithm does not terminate on a zero-width box — proven in both real CI runs, every attempt, jsdom | **P1** | Owner-confirmed 2026-09-22. Not a live production hang: checked directly, `TraceTimelineCompact.tsx`'s `box.width > 0 && box.height > 0` guard is the sole gate on the sole production caller of `layout()`, so the degenerate input is structurally unreachable today. Real bug, worth fixing; not urgent by exposure |

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

**Next update trigger:** when CHG-2026-035 (P0, migration bootstrap-role bug) or CHG-2026-036 item 2 (P1, `layout.clienttest.ts`) gets a fix, or the next milestone on Step 1 (guardrail hook build) or the P1 audit-bypass backlog item.

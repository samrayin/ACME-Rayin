# Change ID and ADR number register

**The only place a `CHG-YYYY-NNN` or `ADR-NNNN` is allocated.** More than one
person or agent works in this repository at the same time; on 2026-09-19 two
sessions each picked "the next number" on their own and collided twice in one
day. IDs are never reused (`CHANGE-PROCEDURE.md` §1), so a collision costs a
renumbering.

## Rule
1. **Claim before use.** Add one row below, on `main`, in a pull request that
   contains nothing else, and merge it **before** the ID appears in any commit,
   branch, ADR, changelog entry or PR title. An ID that is not in this file on
   `main` is not yours.
2. Take the next free number. Do not skip, do not reserve ranges.
3. If two claims race, the one merged first wins; the other takes the next number.
4. A claim is never deleted. If the change is dropped, set its status to
   `Abandoned`; the number stays burnt.
5. Before choosing a number, also run `git fetch` and `gh pr list --state open`:
   a claim PR may be open but not yet merged.

Status values: `Claimed` (allocated, work not merged) · `Merged` · `Abandoned`.

## Change IDs

| ID | Tier | Title | Claimed by | Branch / PR | Status |
|---|---|---|---|---|---|
| CHG-2026-001 | — | Change-governance procedure adopted | Anees Ur Rahman | #33 | Merged |
| CHG-2026-002 | — | CI: fix or gate the three checks that failed on every PR | Anees Ur Rahman | #34 | Merged |
| CHG-2026-003 | — | CI: make the AI security review a gate that fails closed | Anees Ur Rahman | `ci/security-review-real-gate` · #36 | Claimed |
| CHG-2026-004 | 2 | This register | Anees Ur Rahman | #37 | Merged |
| CHG-2026-005 | 1 | CAIRO manages the LiteLLM gateway: keys, teams, budgets, models, spend | Anees Ur Rahman | `feat/cairo-litellm-management` · #41 | Merged |
| CHG-2026-006 | 2 | LiteLLM gateway image pinned by digest | Anees Ur Rahman | #39 | Merged |
| CHG-2026-007 | 2 | Change procedure tiered by risk; one-command rehearsal database; migration rollback inventory | Anees Ur Rahman | #40 | Merged |
| CHG-2026-008 | 1 | LiteLLM request-log receiver, append-only mirror and reconciliation (designed in ADR-0003) | Anees Ur Rahman | #42 → #45 | Merged |
| CHG-2026-009 | 1 | Enable the LiteLLM logging callback towards the CAIRO receiver (designed in ADR-0003) | Anees Ur Rahman | `feat/litellm-request-log-callback` · #46 (draft) | Claimed — source ready, held at the gateway-restart gate |
| CHG-2026-010 | 1 | Least-privilege database cutover: web and worker connect as `rayin_app_runtime`, not the admin login (Readiness Ledger P0-5, P0-6; ops gap list B9) | Anees Ur Rahman | `docs/adr-0004-least-privilege-cutover` · #44 (draft) | Claimed — design only, build not approved |
| CHG-2026-011 | 1 | LLM Gateway console fixes found in the first dev browser pass: error toast for non-owners, false gateway-side-admin badge, wording that overstated the append-only control, NUL byte in a source file (covered by ADR-0003; no new ADR) | Anees Ur Rahman | `fix/litellm-gateway-ui-pass` · #48 | Merged |
| CHG-2026-012 | 2 | Records catch-up, documentation only: this register's rows for CHG-2026-005, -008, -009, -010, -011 and ADR-0003 brought in line with what is merged; changelog line for release `acme-v4.38.0.3` | Anees Ur Rahman | `docs/records-catchup-chg-2026-012` · #53 | Claimed |
| CHG-2026-013 | 2 | Changelog "Outstanding" section: two statements that were no longer true (worker traceability; worker / LiteLLM / rayin-proxy listed as untagged). Found during CHG-2026-012 and split out of it because they were outside its registered scope | Anees Ur Rahman | `docs/changelog-outstanding-corrections` · #55 | Claimed |
| CHG-2026-014 | 1 | Enforce the guardrail on the LiteLLM gateway path: a custom guardrail hook calling `rayin-guardrails`, with an explicit timeout, a measured latency budget, and a staged move from record-only to fail-closed (Readiness Ledger H-01 / N-38; designed in ADR-0005) | Anees Ur Rahman | `docs/claim-chg-2026-014` | Claimed |
| CHG-2026-015 | 1 | Add `groq-judge` and `gemini-judge` to the LiteLLM model list alongside `nvidia-nemotron`, reading their keys from the gateway Secret. **Source only** — no ConfigMap edit and no gateway restart, both of which stay a separate owner gate. Prompted by the judge path having no quota headroom (ADR-0005 F3) | Anees Ur Rahman | `docs/claim-chg-2026-015` | Claimed |
| CHG-2026-016 | 1 | Close N-56's actual mechanism: swap the guardrail judge to `openai/gpt-oss-safeguard-20b` and reshape the `self_check_input` prompt so the first token conforms to `is_content_safe` (first two words, fallthrough is unsafe). Spans `ACME-Rayin` (gateway model entry) and `rayin-guardrails` (prompt, max_tokens, stop). **Source only** — no ConfigMap, no Secret change, no restart | Anees Ur Rahman | `fix/n56-judge-model-and-prompt` | Claimed |
| CHG-2026-017 | 2 | Commit the benign-prompt false-positive corpus, its summariser and its runbook — the N-56 measurement harness — which existed only as untracked files on a single workstation. Test scaffolding and documentation only: no product code, no cluster dependency, nothing deployable. Also records that `gateway-eval.yaml` changes meaning, not behaviour, once the ADR-0005 hook ships | Anees Ur Rahman | `chore/chg-2026-017-promptfoo-benign-corpus` · #64 | Claimed |
| CHG-2026-018 | 1 | ADR-0005 amendment: F7's preferred fix becomes two independent gateway guardrails (PII and jailbreak) so the short-circuit is structurally impossible; **F10** added — the hook makes the gateway call itself via the rail's judge model, a day-one blocker in `record` as much as `enforce`, gated by a new Step 0; **F11** added, recording the guardrail opt-out as admin-only and withdrawing the concern that it was caller-controlled. Documentation only, no implementation | Anees Ur Rahman | `docs/chg-2026-018-adr-0005-amendment` · #65 | Claimed |
| CHG-2026-020 | 1 | First traceable release of `rayin-guardrails` through `release.sh`: deploys the merged CHG-2026-016 rail fix (`max_tokens` 512, reshaped `self_check_input` prompt) and, via an owner-executed Secret patch applied beforehand, brings the pod up already repointed to `groq-safeguard` — one rollout, no untested intermediate combination. Closes ADR-0005 gate **F4** (mutable, untraceable image). Tier 1: one guardrails restart, owner-gated. Closure of N-56 is NOT claimed here — that needs the benign-corpus run with both numbers | Anees Ur Rahman | `docs/claim-chg-2026-020` | Claimed |
| CHG-2026-021 | 2 | Corrections to CHG-2026-017's own content, found by executing it: `RUNNING-BENIGN-EVAL.md` pins `node:20-alpine` while pinning `promptfoo@0.123.0`, which requires Node >= 22.22.0 — the install succeeds and the binary then refuses to start; and its command chain sends `npm` to `/dev/null`, so the failure is silent for anyone following the procedure. Also corrects the CHG-2026-017 changelog entry, which describes the runbook as the procedure that produced the 2026-09-20 measurement — a claim the evidence does not support | Anees Ur Rahman | `docs/claim-chg-2026-021` | Claimed |
| CHG-2026-022 | 1 | ADR-0005 Step 0 decision: the guardrail judge **stays on the gateway** and is excluded from the hook by admin-configured key metadata (option b), reversing the ADR's previous preference for bypassing the gateway — which was recorded before the gateway's governance controls were measured. Records what (b) costs (recursion prevention now depends on configuration staying correct, not on structure) and adds two standing conditions: the judge key must be the only key carrying an F11 opt-out, and its `models=all` grant must be narrowed to an allowlist. Design only, no implementation | Anees Ur Rahman | `docs/claim-chg-2026-022` | Claimed |
| CHG-2026-023 | 1 | ADR-0005 Step 0 exclusion design, written up formally: the discriminator is **authenticated key-level metadata** (model name never exempts; a caller-set marker is forgeable), the in-hook check fails toward inspection, the judge key is capped at `rpm_limit` 10 for the flip window so a runaway terminates and is detectable, and a three-layer test (unit, `default_on: false` integration, post-flip equality assertions) joins recurring release verification. Records the prerequisite judge-key change and a current violation of the judge-model hygiene invariant. Design only — no hook, no key edit, no cluster change | Anees Ur Rahman | `docs/claim-chg-2026-023` | Claimed |
| CHG-2026-024 | 1 | Remove the inert Langfuse callback registration from the gateway config (Readiness Ledger **N-20**, audit **H-26**). `success_callback`/`failure_callback` have been registered since the gateway was configured while the pod holds no `LANGFUSE_*` variables, so the integration the config advertises has never delivered anything and fails silently. Closed by **removal**, which is the ledger's own recommended fix: re-add deliberately when a named credential owner and an approval gate exist. Enabling instead was assessed and rejected — without CHG-2026-009's `turn_off_message_logging` it would write full prompt and completion text into a store with no reachable purge path (**P0-11**). Config change plus one gateway restart, owner-gated | Anees Ur Rahman | `docs/claim-chg-2026-024` | Claimed |
| CHG-2026-025 | 2 | Disable the upstream sidebar promotional notifications, including the persistent "Star Langfuse" popup shown to users on deployments where the v4 upgrade UI is off, which is the self-hosted default. The `github-star` entry has no `createdAt`, so it never expires and reappears in every new browser until dismissed, and its badge is fetched from a third-party image host by every user’s browser. UI-only, no schema, no cluster change. Ships in a web image, so the release is a separate owner gate | Anees Ur Rahman | `docs/claim-chg-2026-025` | Claimed |
| CHG-2026-026 | 1 | Enable Langfuse tracing on the LiteLLM gateway so every request is a trace in CAIRO and token cost is captured there. Tier 1: it changes what data is persisted, and the persisted stores have no deletion path (Readiness Ledger P0-11). **ADR first: no configuration change until the owner approves the ADR.** Reverses the re-enablement conditions recorded when the callback was removed (CHG-2026-024, N-20) — the ADR must say so plainly | Anees Ur Rahman | `docs/claim-chg-2026-026` | Claimed |
| CHG-2026-030 | 1 | New frontend feature, not a hotfix and not part of CHG-2026-029: wire the existing, working, audited `updateKeyLimits()`/`updateKey` procedure to an edit action on the Keys page, scoped narrowly to `models` and `rpm_limit` only — no new fields, no metadata editing, no extension of the backend function's scope. This is what unblocks CHG-2026-029's closure; it is not part of that change's own record. Design first (ADR-0007), then source and tests — **no live restart or deploy without the owner's explicit go-ahead**, same gate discipline as every other Tier 1 change | Anees Ur Rahman | `docs/chg-2026-030-adr-0007-key-limits-edit-ui` | Claimed |

## ADR numbers

| ADR | Change ID | Title | Status |
|---|---|---|---|
| ADR-0000 | — | Baseline (system as of 2026-09-19), reserved in `adr/README.md`, not yet written | Claimed |
| ADR-0001 | CHG-2026-002 | Fix or gate the three CI checks that failed on every PR | Merged |
| ADR-0002 | CHG-2026-003 | Security review as a real gate | Claimed |
| ADR-0003 | CHG-2026-005 | CAIRO as the single control plane for LiteLLM: management and request-log capture | Merged (revision 9) |
| ADR-0004 | CHG-2026-010 | Least-privilege database cutover | Claimed |
| ADR-0005 | CHG-2026-014 | Enforcing the guardrail on the gateway path: hook, timeout, latency budget, record-only before fail-closed | Claimed — revision pending in CHG-2026-018 |
| ADR-0006 | CHG-2026-026 | Gateway tracing into CAIRO: what is written, where, what it costs in retention, and how it is turned off | Claimed — written, Gate A passed, still Proposed. Exhaustive audit (2026-09-22) found ~12 unredacted metadata fields/mechanisms, not 4 — a content leak (`metadata.prompt`) and an unbounded wildcard (`trace_`-prefixed keys). Mitigation shape decided (allowlist, scoped in ADR §11) — hook not yet built |
| ADR-0007 | CHG-2026-030 | Key limits edit UI: where it lives, what it shows, how it avoids silently clearing budget/duration/token fields it doesn't expose | Claimed |

The rows above for CHG-2026-001 to -003 and ADR-0000 to -0002 were reconstructed
on 2026-09-19 from `main` and every branch on the remote; they were not claimed
through this file.

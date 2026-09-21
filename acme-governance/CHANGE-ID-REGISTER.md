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
| CHG-2026-018 | 1 | ADR-0005 amendment: F7's preferred fix becomes two independent gateway guardrails (PII and jailbreak) so the short-circuit is structurally impossible; **F10** added — the hook makes the gateway call itself via the rail's judge model, a day-one blocker in `record` as much as `enforce`, gated by a new Step 0; **F11** added, recording the guardrail opt-out as admin-only and withdrawing the concern that it was caller-controlled. Documentation only, no implementation | Anees Ur Rahman | `docs/chg-2026-018-adr-0005-amendment` | Claimed |

## ADR numbers

| ADR | Change ID | Title | Status |
|---|---|---|---|
| ADR-0000 | — | Baseline (system as of 2026-09-19), reserved in `adr/README.md`, not yet written | Claimed |
| ADR-0001 | CHG-2026-002 | Fix or gate the three CI checks that failed on every PR | Merged |
| ADR-0002 | CHG-2026-003 | Security review as a real gate | Claimed |
| ADR-0003 | CHG-2026-005 | CAIRO as the single control plane for LiteLLM: management and request-log capture | Merged (revision 9) |
| ADR-0004 | CHG-2026-010 | Least-privilege database cutover | Claimed |
| ADR-0005 | CHG-2026-014 | Enforcing the guardrail on the gateway path: hook, timeout, latency budget, record-only before fail-closed | Claimed — revised 2026-09-21 (CHG-2026-018) |

The rows above for CHG-2026-001 to -003 and ADR-0000 to -0002 were reconstructed
on 2026-09-19 from `main` and every branch on the remote; they were not claimed
through this file.

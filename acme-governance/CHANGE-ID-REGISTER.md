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
| CHG-2026-005 | 1 | CAIRO manages the LiteLLM gateway: keys, teams, budgets, models, spend | Anees Ur Rahman | `feat/cairo-litellm-management` | Claimed |
| CHG-2026-006 | 2 | LiteLLM gateway image pinned by digest | Anees Ur Rahman | `chore/pin-litellm-image-digest` | Claimed |
| CHG-2026-007 | 2 | Change procedure tiered by risk; one-command rehearsal database; migration rollback inventory | Anees Ur Rahman | `docs/procedure-tiering-and-rehearsal-script` | Claimed |

## ADR numbers

| ADR | Change ID | Title | Status |
|---|---|---|---|
| ADR-0000 | — | Baseline (system as of 2026-09-19), reserved in `adr/README.md`, not yet written | Claimed |
| ADR-0001 | CHG-2026-002 | Fix or gate the three CI checks that failed on every PR | Merged |
| ADR-0002 | CHG-2026-003 | Security review as a real gate | Claimed |
| ADR-0003 | CHG-2026-005 | CAIRO as the single control plane for LiteLLM: management and request-log capture | Claimed |

The rows above for CHG-2026-001 to -003 and ADR-0000 to -0002 were reconstructed
on 2026-09-19 from `main` and every branch on the remote; they were not claimed
through this file.

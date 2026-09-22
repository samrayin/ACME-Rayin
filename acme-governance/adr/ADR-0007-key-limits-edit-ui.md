# ADR-0007 — Key limits edit UI: wiring `updateKeyLimits()` to the Keys page

| | |
|---|---|
| **Change** | CHG-2026-030 · Tier 1 · owner: Anees Ur Rahman |
| **Status** | **Design accepted; built.** Source and tests written per §6, verified locally (§9). **No live restart or deploy — owner's explicit go-ahead still required**, unchanged from the original gate. |
| **Separate from** | CHG-2026-029, which stays the record of the drift and its cause. This change is what unblocks CHG-2026-029's closure — it is not part of that change's own record. |
| **Related** | `updateKeyLimits()` / `acmeLitellm.updateKey` (`acmeLitellmService.ts`, `acmeLitellmRouter.ts:283`, CHG-2026-005) — the audited backend function this wires up, unmodified. ADR-0005-A (why `metadata` editing is deliberately out of reach here, not an oversight). |

## 1. The problem, verified not assumed

`updateKeyLimits()` is a complete, working, audited tRPC procedure (`acmeLitellm.updateKey`) — read-merge-write, `auditedMutation()`-wrapped, keeps `acme_litellm_keys` in sync with LiteLLM. Grepped the entire `web/src` tree for any call to it: zero matches. The Keys page (`AcmeLitellmGateway.tsx`) already renders a `DriftBadge` (line 129) when CAIRO's record disagrees with LiteLLM's live state, and already offers `Rotate`/`Revoke` actions — no `Edit`. CAIRO detects and displays a problem it has never given anyone a way to fix.

## 2. Scope

**In:** an edit action for an existing key's `models` and `rpm_limit`, calling `acmeLitellm.updateKey` exactly as it exists today.

**Out, deliberately:** `maxBudget`, `budgetDuration`, `tpmLimit` (the procedure accepts these too, but this UI does not expose them for editing — see §4 for why they still have to be *sent*, unchanged, on every submit). `metadata` / `opted_out_global_guardrails` (ADR-0005-A's judge-key exclusion design depends on that field being admin-set through a controlled path; this generic edit UI is not that path, and widening scope here would undermine ADR-0005-A's own reasoning, not just add convenience). No change to `updateKeyLimits()` itself, and no new fields added to `KeyLimits`.

## 3. Where it lives

A `Dialog` (not `AlertDialog` — that pattern is reserved for confirm/cancel, this has real inputs), triggered by a new `Edit` button in each row's action group, next to `Rotate`/`Revoke`. Matches the existing `SecretRevealDialog` structure (`Dialog` / `DialogHeader` / `DialogBody` / `DialogFooter`) already proven in this file — no new dialog primitive, no new pattern to learn.

**Not inline-in-row:** the row is already dense (status, drift badge, spend, actions); two editable fields plus a save/cancel pair does not fit without redesigning the table. **Not a drawer:** nothing else in this file uses one, and a modal dialog is the established pattern for a single-key action here (`SecretRevealDialog` already sets that precedent for this exact table).

## 4. What it shows, and a correctness hazard this exposed

**Shows the drift explicitly, not just that it exists.** The dialog's editable fields pre-fill from LiteLLM's **live** values, not CAIRO's stale ones — the reconciliation target is "make CAIRO match the gateway," and pre-filling from the stale row would make the admin retype the correct model names from memory, a real error surface during exactly the kind of correction this exists for. CAIRO's currently-stored values are shown alongside, read-only, labeled plainly (e.g. "CAIRO currently records: —" next to the live-prefilled input), so the admin sees both, not just one.

**This needs a small additive read-side change, found by checking, not assumed.** `listKeys()` (`acmeLitellmService.ts:795-843`) already fetches every key's live LiteLLM state server-side to compute `driftFields` — but only forwards `liveSpend` and `lastActive` to the frontend; the live `models`/`rpmLimit` values themselves are discarded after the comparison. Showing them in the dialog means adding two fields (`liveModels`, `liveRpmLimit`) to the object this function already returns — reusing the `live` value already in memory, zero new backend calls, zero new tRPC procedures. **This is a change to the `keys` list query's response shape, not to `updateKeyLimits()`** — it doesn't touch the write path or widen what the audited function accepts, so it doesn't conflict with the "no extension of backend scope" instruction, which was about the mutation, not the read. Flagged here explicitly rather than silently bundled in, since it's still a real (if small) scope decision: **owner call — include it, or ship the dialog pre-filling from CAIRO's stale values instead and accept the retype-from-memory risk.**

**A second, independent hazard found while checking the submit path.** `limitsInput` (`acmeLitellmRouter.ts:63-75`, shared by `createKey` and `updateKey`) has a Zod `.default()` on every field — `models` defaults to `[]`, `maxBudget`/`budgetDuration`/`tpmLimit` default to `null`. For `createKey` that's correct (nothing exists yet). For `updateKey`, **omitting a field from the request does not leave it unchanged — Zod fills the default, and the mutation sends that default to LiteLLM**, silently clearing any existing budget, budget duration, or token-per-minute limit on the key. The dialog must therefore read the row's *current* `maxBudget`/`budgetDuration`/`tpmLimit` (already present on `KeyRow`, no fetch needed) and resubmit them unchanged on every save, even though only `models`/`rpm_limit` are shown as editable. Not optional — without this, the first use of this feature on any key that has a budget set would silently delete it.

## 5. Does it need new tRPC wiring

**No new mutation.** `acmeLitellm.updateKey` is called directly, unmodified, exactly as designed for this purpose. **Possibly a small read-shape addition** (§4, `liveModels`/`liveRpmLimit` on the existing `keys` query) — owner's call whether that ships now or the dialog pre-fills from CAIRO's stale record instead.

## 6. Decision

**Accepted and built, 2026-09-22.** Owner confirmed §4 (ship the live-value read) plus every other point unchanged. Built:
1. `listProjectKeys()` (`acmeLitellmService.ts`) now returns `liveModels`/`liveRpmLimit` per row, reusing the `live` object already fetched to compute `driftFields` — no new backend call.
2. An `Edit` button per row (status `ACTIVE` only, matching `Rotate`'s own gating), next to `Rotate`/`Revoke`.
3. `EditLimitsDialog`, modeled on `SecretRevealDialog`'s structure: shows CAIRO's current record as read-only context (with a bold call-out when it disagrees with the gateway), editable `models`/`rpm_limit` inputs pre-filled from **live** state — falling back to CAIRO's row only when `row.drift` is `"unknown"`/`"missing"` (no valid live comparison exists), with a visible warning banner in that case, never silently. Does not reuse `LimitsFields` wholesale — a narrower field set for just these two, mirroring its model-picker/input patterns.
4. Submission goes through one exported pure function, `buildUpdateKeyLimitsInput(projectId, row, newModels, newRpmLimit)` — deliberately factored out so there is exactly one place that can get the "carry the three unexposed fields through unchanged" rule wrong, not one per call site, and so it is unit-testable without rendering the component.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Omitted fields silently wiped by Zod defaults (§4) | Always resubmit the three non-edited fields unchanged; a test asserts this explicitly (§9) |
| Admin retypes a live model name incorrectly during reconciliation | Pre-fill from live state if §4's read addition ships; otherwise flagged as an accepted risk of the simpler build |
| This UI becomes a backdoor to edit `metadata` later, undermining ADR-0005-A | Out of scope, stated explicitly (§2); a future change touching `metadata` here needs its own ADR reasoning against ADR-0005-A's design, not a quiet addition to this form |
| Live restart/deploy happens before the owner is ready | Source and tests only; this ADR does not authorize a release. Separate gate, same as every other Tier 1 change |

## 8. Compatibility

Backward compatible — additive only. No schema change (no new Prisma fields; `models`/`rpmLimit` already exist on `AcmeLitellmKey`). No migration. `updateKeyLimits()` is called with its existing, unchanged signature.

## 9. Validation

| Gate | Result | Evidence |
|---|---|---|
| A — leave dev | **Passed, 2026-09-22** | Typecheck: `tsc --noEmit --skipLibCheck`, exit 0. Tests: 6/6 client tests pass (`AcmeLitellmGateway.clienttest.tsx`), 28/28 backend tests pass (`acmeLitellmService.servertest.ts`, 26 pre-existing + 2 new), no regression. Lint: `eslint --max-warnings 0`, exit 0, clean. **Rendered in a real headless browser**: `EditLimitsDialog` + `KeyRow` exported, `EditLimitsDialog.stories.tsx` added (test/preview-only, three variants built from the actual CHG-2026-029 judge-key drift scenario), run via `DOCKER_BUILD=1 vitest run --project storybook` — 3/3 pass on retry (first attempt hit a diagnosed, not guessed, Vite dependency-reoptimization race, not a real defect). Still not manually clicked through by the owner in an actual browser window — that review is separate and still pending, per the owner's explicit hold on merging #86 |
| B — staging | Not available | Standing note, same as every other change in this fork |
| C — post-deploy | Pending, and **gated separately** | Not authorized by this ADR. A real reconciliation (the judge key) is the first live use, and that is the owner's action once this ships, not part of this change |

## 10. Client-facing notes

None — internal console feature, not visible to any customer-facing surface.

## 11. Assumptions and open questions

- **Owner decision needed (§4):** ship the live-value read addition now, or accept stale-value pre-fill for this first version and add live comparison later. Both are small; the live-value version is safer for the specific reconciliation this exists to unblock.
- Whether the dialog should also surface `drift`/`driftFields` text directly (e.g. "CAIRO and the gateway disagree on: models, rpmLimit") rather than just showing both values side by side and letting the admin compare — a presentation detail, not a scope question, left to implementation.

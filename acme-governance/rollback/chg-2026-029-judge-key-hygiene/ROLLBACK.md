# Rollback — CHG-2026-029 (judge-key hygiene)

**Target:** `cairo-guardrails-judge-rotation-2026-09-20-7fe9a9d4`
(token `41516476c17dae288b893f75966ea6254191a10f4dbb86949e8187ff8dd082f8`)

**Snapshot:** `SNAPSHOT-2026-09-22.json` in this folder — full pre-edit key state,
captured verbatim from `GET /key/list?return_full_object=true`, 2026-09-22.

## What changes

| Field | Before (snapshot) | After |
|---|---|---|
| `models` | `[]` (unrestricted) | `["groq-safeguard", "nvidia-nemotron"]` |
| `rpm_limit` | `null` | `10` |
| `metadata` | 6 `cairo_*` fields only | same 6 fields **+** `opted_out_global_guardrails: ["cairo-guardrail"]` |

## How it is applied (two separate mechanisms, deliberately not one)

1. **`models` and `rpm_limit`** — through CAIRO's own key-management UI/API
   (`updateKeyLimits()`, CHG-2026-005), **unmodified**. It already supports both
   fields natively and keeps CAIRO's `acmeLitellmKey` DB row in sync automatically.
   No code change.
2. **`opted_out_global_guardrails`** — a separate, minimal read-merge-write against
   LiteLLM's `/key/update` directly, deliberately **not** routed through
   `updateKeyLimits()`, which states its own scope as "CAIRO only ever touches
   `cairo_*` keys" (`acmeLitellmService.ts` docstring). This field isn't `cairo_*`
   and isn't tracked in CAIRO's DB at all, so there is no drift risk either way —
   it is simply out of that function's stated scope.

## How to roll back

Re-apply `SNAPSHOT-2026-09-22.json` verbatim: `models: []`, `rpm_limit: null`,
`metadata` reset to the 6 `cairo_*` fields only (drop `opted_out_global_guardrails`).
One `/key/update` call, same token. No data is lost by rolling back — this key
carries no request history or spend records of its own that the edit would affect.

## Risk if this key is currently load-bearing

`rayin-guardrails`' judge calls (per `guardrails_engine.py`, `GUARDRAILS_LLM_API_KEY`)
route through **a different key** — this repo's own `credential-handling-hard-rules`
memory confirms `GUARDRAILS_LLM_API_KEY` is the operational judge credential, and
per this same key list, `rayin-guardrails-llm` / `rayin-guardrails` are separate,
distinct entries. Narrowing `cairo-guardrails-judge-rotation-2026-09-20-7fe9a9d4`'s
model grant should not interrupt live traffic — **not independently verified against
which key `GUARDRAILS_LLM_API_KEY` actually resolves to today; confirm before
applying if that mapping has changed since the 2026-09-20 rotation.**

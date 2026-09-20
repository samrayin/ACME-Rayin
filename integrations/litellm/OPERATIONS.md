# LiteLLM ↔ CAIRO: operations note

How to tell whether the integration is healthy, what the reconcile gap count
means, and what to do when it is not zero. Product-level: nothing here names an
environment. Environment values live in the private operations repository.
Design: `acme-governance/adr/ADR-0003-cairo-litellm-control-plane.md`.

## The moving parts
| Part | Where | Flag |
|---|---|---|
| Management (keys, teams, budgets, models, spend, change record) | CAIRO web → LiteLLM management API, server-side, with the master key | `CAIRO_LITELLM_MANAGEMENT_ENABLED` (web) |
| Request-log **push** | LiteLLM `cairo_request_log_callback` → CAIRO `POST /api/public/litellm-request-logs` | the `callbacks:` line in the gateway config; receiver behind `CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED` (web) |
| Request-log **reconciliation** | CAIRO worker, every 5 minutes → LiteLLM `GET /spend/logs/v2` | `CAIRO_LITELLM_REQUEST_LOG_INGEST_ENABLED` (worker) |

Push is fast and **best-effort**: the gateway never delays or fails a model call
for it. It tries a batch up to four times over about 7 seconds and then drops
it. Reconciliation is slow and **complete**: it is what makes the record whole,
and the only thing that tells you when it is not.

## Is it healthy? Five checks, all from the LLM Gateway page
1. **No red or yellow banner at the top.** "Unreachable" = CAIRO cannot reach
   the gateway's management API; the page is read-only and keys already issued
   keep working. "Changes are disabled: the change record is not configured" =
   the writer database connection is missing; CAIRO refuses to change anything
   it cannot record first.
2. **Requests tab → "Is this list complete?" is green** ("Complete as of the last
   reconciliation").
3. **Last reconciliation is less than 15 minutes old.** Older, and the page says
   "Completeness unknown" in red: the worker job is not running or cannot read
   the gateway.
4. **"Arrived in 24 h" shows pushed records.** If every record is "reconciled"
   and none is "pushed", the page says "Push is not delivering": the callback
   is off, misconfigured, or cannot reach CAIRO.
5. **Keys tab → the Gateway column says "In sync".** "Drifted" or "Missing in
   gateway" means someone changed or deleted a key directly in LiteLLM, around
   CAIRO. CAIRO shows what changed, not who: that is a reason to restrict who
   holds the master key.

From the gateway side: `GET /health/readiness` is healthy with the database
connected, and `GET /active/callbacks` lists a `GenericAPILogger`.

## What the gap count means
Each reconciliation pass counts the requests the gateway's own spend logs hold
for the checked window that CAIRO's mirror did not, by `request_id` or
`litellm_call_id`. It then inserts them (marked "reconciled") and records the
count. So:

- **0** — every request in the window had already arrived by push.
- **Non-zero, push off** — expected. Every request arrives this way.
- **Non-zero, push on** — the push lost those requests and reconciliation
  recovered them. **Nothing is missing from the mirror**; what you have learned
  is that push is dropping events. A reconciled row carries fewer fields than a
  pushed one and arrived up to about 7 minutes late.

The gap count is **not** a count of requests missing from the mirror now. The
states that mean "may be missing" are the red ones: reconciliation stale,
`failure`, or `partial`.

## When the gap count is not zero (and push is on)
1. **Small and occasional, around a CAIRO deployment or restart:** expected.
   The gateway retries for about 7 seconds; a rollout takes longer. No action.
2. **Every pass, steadily:** push is failing. In order:
   - CAIRO web log for `acmeLitellm ingest`. "rejected records that do not match
     the closed schema" means the gateway is sending a field CAIRO does not
     know, almost always after a **LiteLLM upgrade**. The log gives field paths
     and codes, never values. Fix: update the receiver's schema for the new
     LiteLLM version, release, and the gap closes. Until then reconciliation
     carries everything. `acmeLitellm ingest failed` with an error name and code
     means the receiver could not write: check the writer database connection
     and the writer role's password.
   - HTTP 401 at the receiver: the gateway's `CAIRO_INGEST_SECRET` and CAIRO's
     `CAIRO_LITELLM_INGEST_SECRET` differ. Rotating it means changing both and
     **restarting the gateway pod**.
   - HTTP 404: the receiver's flag is off on web. HTTP 429: more than 240 calls
     a minute to one web pod; find out what is calling it.
   - Gateway log for `Generic API Logger`: connection refused or timeout means a
     network path or Service name problem between the two namespaces.
3. **The count is large after an outage:** expected, once. It is the backlog
   being recovered. Check the next pass returns to 0.

## When reconciliation itself is red
- **`failure`, "LiteLLM returned 401/403":** the master key CAIRO's worker holds
  is wrong or was rotated. **`failure`, connection error:** the worker cannot
  reach the gateway.
- **`partial`, "more than 20,000 rows":** the window held more than one pass
  reads. It catches up over following passes only if traffic per 5 minutes is
  below that; if it never clears, the page size and ceiling need raising.
- **`partial`, "row(s) could not be read":** the gateway returned a spend-log
  row without a usable id or start time. Those requests are not mirrored. Rare;
  report it.
- **Nothing recorded at all for more than 15 minutes:** the worker is down, the
  flag is off on the worker, or the writer connection is missing (the job
  refuses to write through the general connection).

What nobody can recover: a request the gateway never wrote to its own spend
logs (its database was down), or a spend-log row deleted before the next pass.

## Things that need a gateway pod restart
Enabling or removing the callback; changing `CAIRO_INGEST_SECRET` or
`CAIRO_REQUEST_LOG_ENDPOINT`; any change to `litellm-config.yaml`. The image is
pinned by digest, so a restart does not change the gateway version. Upgrading
the gateway means choosing a new digest deliberately **and** checking the
receiver's closed schema against the new version's payload first
(a throwaway pod with a mock model and a local sink does this in two minutes
without touching the live gateway).

## Known limits, so nobody is surprised
- The append-only guarantee on CAIRO's record tables holds only where the
  application connects as the runtime role, not as the database admin login.
- End user and source address in a request record are what the caller reported.
- Spend is what the gateway calculated from its price list; a free-tier model
  reads $0.00 however much it is used.
- Per-model budgets, native key rotation, tags and the gateway's own audit log
  are LiteLLM Enterprise features and are not used.

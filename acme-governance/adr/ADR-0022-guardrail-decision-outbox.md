# ADR-0022 — A durable outbox for guardrail decisions

| | |
|---|---|
| **Change** | CHG-2026-099 · Tier 1 · owner: Anees Ur Rahman |
| **Status** | **Proposed — design only.** Nothing here is built. No migration, no dependency, no credential, no release. |
| **Closes** | Readiness Ledger **P0-10** — a failed audit push loses the record |
| **Related** | CHG-2026-098 (the scheduled backfill, which narrows this gap but cannot close it) · ADR-0009 (guardrail *health* events — a different problem, see §7) · **P0-5** (append-only not enforced) · **P0-11** (no deletion path) · CHG-2026-088 (two replicas, which halved the existing fallback) |
| **Decides** | Whether rayin-guardrails gains durable local state, and of what kind |

---

## 1. The problem, verified not assumed

Every claim below was read from the code on 2026-10-03, not inferred.

**The push gives up.** `rayin-guardrails/app/rayin_push.py` sets `_MAX_ATTEMPTS = 3`
with `_BACKOFF_SECONDS = [0.5, 2.0, 5.0]` and a 5 s per-attempt timeout — about 17.5 s
worst case. On final failure it logs at ERROR and returns. Deliberately: the module's
contract is that the live `/v1/guard` decision must never be delayed by the push, and
that is correct and should not change.

**The documented safety net does not exist.** `rayin_push.py`'s own docstring says:

> If all retries are exhausted, the event is NOT lost: events.emit() already appended
> it to the in-memory ring buffer … so the existing pull-based reconciliation (RAYIN's
> dashboard polling GET /v1/events) picks it up on its next poll.

There is no such reconciliation. `persistPullBackfill` is called from exactly two tRPC
procedures in `acmeGuardrailsRouter.ts`. Both run when a **human opens the Guardrails
page**. There is no worker job, no cron, no schedule. The sentence describes an
intention, not a mechanism.

**The buffer it would read is small, volatile and per-pod.**
`_RECENT_EVENTS_MAXLEN = 200`, in memory, and `recent_events()` is documented as
resetting on pod restart.

**And since CHG-2026-088 there are two replicas.** The buffer is per-pod; the console
fetches `/v1/events` through the Service, which load-balances to **one** of them. A
page view can only ever drain whichever pod it lands on. The second replica's buffer is
unreachable by any current code path. Adding a replica for resilience halved this
fallback, and nothing records that.

### 1.1 The three ways a record dies today

| # | Path | Closed by the backfill (CHG-2026-098)? |
|---|---|---|
| 1 | Push exhausts retries; 200 further events rotate the buffer before anyone looks | **Yes**, if the interval is shorter than the rotation |
| 2 | Push exhausts retries; the pod restarts before anyone looks | **No** |
| 3 | Push exhausts retries; the event sits on the replica the Service didn't route to | **No** |

The backfill is worth doing — it converts "recovered only if a human happens to look"
into "recovered within one interval" — but two of the three paths survive it, and both
survivors are the ones that bite during an incident, which is exactly when pushes fail
and pods restart.

---

## 2. What an outbox has to be

Write the decision to durable storage **before** attempting the push; delete it when
the push is acknowledged; drain what remains on a schedule and at startup.

Two properties decide the design:

**(a) It must not share a failure domain with the thing it protects against.** The
failure being defended is "CAIRO's ingest endpoint or the network to it is
unavailable". An outbox that answers a network failure with another network call has
only moved the problem.

**(b) It must be drained by something that can see every copy.** This is what the
per-replica gap is really about. Either the store is shared, or each pod drains its own.

---

## 3. Options

### A — Shared Redis

A Redis list or stream. There is already a `redis` service in `rayin-platform`, and
LiteLLM has its own password-protected instance (CHG-2026-088 b).

- **For:** shared across replicas, so path 3 closes for free and any pod can drain.
  Survives a guardrails pod restart. Cheap to build. Operationally familiar here.
- **Against:** it is a **network dependency answering a network failure** — property
  (a) is only partly satisfied. It is a different failure domain from CAIRO's Postgres,
  which is a genuine improvement, but a cluster-wide network event takes both.
  Durability then depends on Redis persistence (AOF/RDB) being configured and on it not
  being treated as a cache by whoever operates it next. A Redis configured as a cache
  is an outbox that silently isn't one.
- **New for this service:** a dependency, a client library, and a credential.

### B — Local durable file, per pod

Append decisions to a file (or small SQLite database) on a PersistentVolume. Each pod
drains its own on a timer and at startup.

- **For:** fully satisfies property (a) — no network is involved at the moment of
  failure, which is the moment that matters. Survives restart. Each pod draining its
  own closes path 3 by construction.
- **Against:** the heaviest operationally. A Deployment with two replicas cannot share
  a ReadWriteOnce volume, so this means either ReadWriteMany storage or converting
  rayin-guardrails to a StatefulSet — and the handover documentation already records
  that **no StatefulSet or node-drain procedure exists** for this platform. Node loss
  loses the volume unless the storage class is networked. A full disk becomes a new
  failure mode on the live request path, which must be bounded and alarmed.

### C — Local file on `emptyDir`

- **For:** no infrastructure at all.
- **Against:** dies with the pod, so path 2 stays open. Strictly better than a 200-entry
  ring buffer but not an outbox, and calling it one would be the same category of
  overstatement this ADR exists to correct.

### D — Managed queue (Azure Storage Queue / Service Bus)

- **For:** genuinely durable, operated by someone else, drains from anywhere.
- **Against:** a new cloud dependency and new outbound egress, which lands directly on
  the **parked egress-allowlist item**. A guardrails pod gaining a path out to a cloud
  service is a decision about the product's network posture, not a storage choice, and
  it should not arrive as a side effect of fixing an audit gap.

---

## 4. Recommendation

**B is architecturally correct; A is what is proportionate today.**

B is the only option that fully satisfies property (a), and if CAIRO were running a
customer's regulated workload that is what should be built. It is also the option whose
true cost is a StatefulSet conversion on a platform that has never drilled one.

A is a real improvement over the present state on all three loss paths, is buildable in
days rather than weeks, and does not touch the egress decision. Its honest limitation —
a shared failure domain — should be written into the Ledger entry rather than
discovered later, and the Redis it uses must be configured and documented as a durable
store, not a cache.

**C is rejected.** **D is rejected until the egress item is unparked**, at which point
it is worth revisiting, because it is the only option that survives losing the cluster.

This recommendation is a judgement about proportion, and proportion depends on facts
the author does not hold — the first customer's audit requirements, and what the CBB
rulebook mapping will demand of record durability. The owner decides.

---

## 5. What is in scope when this is built

- The outbox write, before the push, on the path that already builds the push payload.
- Deletion on acknowledgement, and a drain on a timer and at startup.
- A bound on the store, and what happens when it is reached — **the one thing that must
  not happen is the live guard decision failing because the outbox is full.** Shedding
  the oldest entry, with a counter, is likely right, and that counter is itself an audit
  fact.
- A visible, queryable depth and oldest-entry age. An outbox nobody can see the depth of
  is an outbox nobody knows has stopped draining.
- Correcting `rayin_push.py`'s docstring, which currently describes a mechanism that
  does not exist.

## 6. What is out of scope

- The decision semantics, the retry policy and the 17.5 s budget. All stay.
- Enforce mode, and anything in ADR-0005-B.
- P0-5 (append-only) and P0-11 (deletion). An outbox makes records *arrive*; it says
  nothing about whether they can later be altered or removed, and it must not be
  described as progress on either.
- The gateway-to-guardrails failure path. That is ADR-0009's subject, see below.

## 7. Why this is not ADR-0009

ADR-0009 covers the case where the gateway's call to `/v1/guard` times out, is refused
or fails to authenticate. **No decision is ever reached**, so there is nothing to
persist; what is missing is a health record of the absence. ADR-0009 §1 says so
explicitly, and asserts that the decision push is durable — an assertion §1 of this
document shows does not hold.

The two are complementary and neither substitutes for the other. ADR-0009 remains
`Proposed`, blocked on owner approval and on a real record-mode window, and its §8
states it is 6–10 working days.

## 8. Open questions for the owner

1. **A or B** — proportionate now, or correct now? §4 recommends A and says why, and the
   answer may change once the first customer's requirements are known.
2. **If A: is the existing `redis` in `rayin-platform` the right instance**, or does the
   audit path get its own? Sharing with a cache-shaped workload risks someone later
   tuning it as a cache.
3. **What is the bound**, and is shedding the oldest acceptable? A bounded outbox that
   sheds is still a record-losing system, just a slower and countable one.
4. **Does a shed record need to be an audit event in its own right?** It is the only
   durable trace that something was lost.
5. **Is the per-replica gap (path 3) rated separately**, since it exists today
   independently of this ADR and was introduced by CHG-2026-088?

## 9. Provenance

Written by Claude on 2026-10-03, after reading `rayin_push.py`, `events.py`,
`acmeGuardrailsRouter.ts`, `acmeGuardrailsPullBackfill.ts` and `app/settings.py` on that
date. The three loss paths in §1.1 and the absence of a scheduled reconciliation were
verified from the code; the per-replica gap was verified from the running cluster (two
`rayin-guardrails` pods behind one Service).

§3's trade-offs and §4's recommendation are judgement, not fact. Nothing here rates or
closes a finding; ratings remain the owner's.

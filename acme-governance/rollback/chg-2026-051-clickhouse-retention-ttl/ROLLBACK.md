# Rollback plan — CHG-2026-051 ClickHouse retention TTL

| | |
|---|---|
| **Change ID** | CHG-2026-051 |
| **Design** | `product-decisions/PD-0005` (private), phase 1 · no ADR: a table setting on standard ClickHouse, no schema or application change |
| **Forward** | `scripts/retention/clickhouse-retention-ttl.sh apply --days 30` |
| **Rollback** | `scripts/retention/clickhouse-retention-ttl.sh remove` |
| **Test status** | **Tested 2026-09-23 on a throwaway table** in dev ClickHouse (scratch database created and dropped). `MODIFY TTL` rendered as `TTL start_time + toIntervalDay(30)`, and `REMOVE TTL` cleared it |
| **Data lost on rollback** | None from the rollback itself. **Rows the TTL has already deleted cannot be restored**: the rollback stops future deletion only |

## Before applying: hard prerequisite
The P0-8 incident evidence export (CHG-2026-050) must be complete, with its manifest hash recorded. `materialize_ttl_after_modify` is on, so `apply` deletes rows older than the period immediately.

## When to roll back
- A table's TTL is found on the wrong column, or with the wrong period.
- The owner decides retention must pause, for example a legal hold or an audit request.

The owner decides.

## Order of operations
1. `clickhouse-retention-ttl.sh remove`: drops the TTL on every listed table. Takes seconds and is online.
2. `clickhouse-retention-ttl.sh verify`: now reports `MISSING` for every table, which is expected after a rollback.
3. Record in the deployment record what was already deleted: counts before and after, by table.

## Verification after rollback
- [ ] `system.tables.engine_full` for each table has no `TTL`.
- [ ] Row counts stop falling at the next merge.

#!/usr/bin/env bash
# ClickHouse retention TTL for CAIRO's trace tables (CHG-2026-051, PD-0005 phase 1).
#
# Rows older than the retention period are deleted by ClickHouse itself. This is
# ACME's own setting on standard ClickHouse, not Langfuse's Enterprise retention
# code, which stays unused (PD-0005 §1).
#
# Usage:
#   clickhouse-retention-ttl.sh apply  [--days N]   set the TTL (N >= 30, default 30)
#   clickhouse-retention-ttl.sh verify [--days N]   exit 1 unless every table has it
#   clickhouse-retention-ttl.sh remove              rollback: drop the TTL
#
# Env: NAMESPACE (default langfuse), POD (default langfuse-clickhouse-0-0-0),
#      DATABASE (default default).
#
# Run `verify` after every Langfuse upgrade: an upstream migration that recreates
# a table drops its TTL silently.
#
# Before the FIRST apply in an environment holding incident data, export it
# (CHG-2026-050). materialize_ttl_after_modify is on, so apply deletes old rows at once.
set -euo pipefail

NAMESPACE=${NAMESPACE:-langfuse}
POD=${POD:-langfuse-clickhouse-0-0-0}
DATABASE=${DATABASE:-default}
FLOOR_DAYS=30
DAYS=30

# table:time-column. The time column must be the one the row's age is judged by.
TABLES=(
  events_core:start_time
  events_full:start_time
  observations:start_time
  traces:timestamp
  scores:timestamp
  blob_storage_file_log:created_at
)

MODE=${1:-}
shift || true
while (($#)); do
  case $1 in
    --days) DAYS=$2; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

case $MODE in apply | verify | remove) ;; *) sed -n '2,20p' "$0"; exit 2 ;; esac
if ! [[ $DAYS =~ ^[0-9]+$ ]] || ((DAYS < FLOOR_DAYS)); then
  echo "Refusing: --days must be a whole number >= $FLOOR_DAYS (got '$DAYS')." >&2
  exit 1
fi

ch() { kubectl -n "$NAMESPACE" exec "$POD" -- clickhouse-client -q "$1"; }

exists() { [[ $(ch "EXISTS TABLE $DATABASE.$1") == 1 ]]; }

ttl_of() {
  ch "SELECT engine_full FROM system.tables WHERE database='$DATABASE' AND name='$1'" |
    grep -oE 'TTL .*' || true
}

rc=0
for entry in "${TABLES[@]}"; do
  table=${entry%%:*}
  col=${entry##*:}
  if ! exists "$table"; then
    echo "skip    $table (not present)"
    continue
  fi
  want="$col + toIntervalDay($DAYS)"
  case $MODE in
    apply)
      ch "ALTER TABLE $DATABASE.$table MODIFY TTL $col + INTERVAL $DAYS DAY DELETE"
      echo "applied $table: $col + $DAYS days"
      ;;
    remove)
      if [[ -n $(ttl_of "$table") ]]; then
        ch "ALTER TABLE $DATABASE.$table REMOVE TTL"
        echo "removed $table"
      else
        echo "none    $table"
      fi
      ;;
    verify)
      got=$(ttl_of "$table")
      if [[ $got == *"$want"* ]]; then
        echo "ok      $table: $want"
      else
        echo "MISSING $table: want '$want', found '${got:-no TTL}'" >&2
        rc=1
      fi
      ;;
  esac
done

if [[ $MODE == verify ]]; then
  ((rc == 0)) && echo "All trace tables carry the $DAYS-day retention TTL." ||
    echo "Retention TTL missing or different. Re-run: $0 apply --days $DAYS" >&2
fi
exit $rc

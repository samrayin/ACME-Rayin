#!/usr/bin/env bash
# Throwaway, Azure-like Postgres for migration and rollback rehearsals
# (CHANGE-PROCEDURE.md §3, Gate B compensating control).
#
#   acme-governance/scripts/rehearsal-db.sh up
#   acme-governance/scripts/rehearsal-db.sh rehearse <migration_name>
#   acme-governance/scripts/rehearsal-db.sh down
#
# `rehearse` runs up -> down -> up for one migration and prints PASS/FAIL per
# step with UTC timestamps; paste that into the migration's ROLLBACK.md.
# It calls `up` itself if the database is not there yet. Always finish with
# `down`, and record in ROLLBACK.md that the namespace was used and removed.
#
# Why it looks like this (do not "simplify"):
#  - Postgres 15, database named `langfuse`, admin login named `postgres`:
#    migration 20260917090000 hardcodes both names.
#  - `postgres` is a NON-superuser admin (CREATEROLE, CREATEDB) that owns the
#    database, and a separate bootstrap superuser `pgboot` exists. That models
#    Azure Flexible Server. On a stock image, where `postgres` IS the bootstrap
#    superuser, 20260917090000 fails at `REASSIGN OWNED BY postgres`
#    ("cannot reassign ownership of objects owned by role postgres because
#    they are required by the database system"). Found 2026-09-19.
#  - No real data and no real credential: the password is random per run and
#    is only ever written to a file under the system temp directory.
#
# Needs: kubectl (current context = the dev cluster), node/npx, python.
# Env: REHEARSAL_NS (default cairo-rehearsal), REHEARSAL_PORT (default 55432).
set -euo pipefail

NS="${REHEARSAL_NS:-cairo-rehearsal}"
PORT="${REHEARSAL_PORT:-55432}"
POD="rehearsal-pg"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${TMPDIR:-${TEMP:-/tmp}}/cairo-rehearsal-${NS}"
PW_FILE="${STATE_DIR}/pw"
PF_PID_FILE="${STATE_DIR}/port-forward.pid"
SCHEMA="${REPO_ROOT}/packages/shared/prisma/schema.prisma"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() { printf '%s  %s\n' "$(now)" "$*"; }

db_url() { printf 'postgresql://postgres:%s@localhost:%s/langfuse' "$(cat "${PW_FILE}")" "${PORT}"; }

psql_boot() { kubectl -n "${NS}" exec -i "${POD}" -- sh -c "psql -U pgboot -d ${1:-langfuse} -X -At -P pager=off -v ON_ERROR_STOP=1 -f - 2>&1"; }

port_forward_alive() {
  [ -f "${PF_PID_FILE}" ] && kill -0 "$(cat "${PF_PID_FILE}")" 2>/dev/null
}

start_port_forward() {
  if port_forward_alive; then return; fi
  kubectl -n "${NS}" port-forward "pod/${POD}" "${PORT}:5432" >"${STATE_DIR}/port-forward.log" 2>&1 &
  echo $! >"${PF_PID_FILE}"
  for _ in $(seq 1 60); do
    if grep -q "Forwarding from" "${STATE_DIR}/port-forward.log" 2>/dev/null; then return; fi
    if ! kill -0 "$(cat "${PF_PID_FILE}")" 2>/dev/null; then break; fi
    sleep 0.5
  done
  # Say why, here: `down` removes the log. The usual cause is another
  # port-forward still holding the port (set REHEARSAL_PORT, or stop it).
  echo "port-forward to localhost:${PORT} did not come up:" >&2
  cat "${STATE_DIR}/port-forward.log" >&2 || true
  exit 1
}

cmd_up() {
  mkdir -p "${STATE_DIR}"
  say "context: $(kubectl config current-context)  namespace: ${NS}"
  if kubectl -n "${NS}" get pod "${POD}" >/dev/null 2>&1; then
    say "pod already exists; reusing it"
  else
    python -c "import secrets;print(secrets.token_urlsafe(24),end='')" >"${PW_FILE}"
    kubectl create namespace "${NS}" >/dev/null
    kubectl label namespace "${NS}" purpose=throwaway-migration-rehearsal --overwrite >/dev/null
    kubectl -n "${NS}" run "${POD}" --image=postgres:15 --restart=Never \
      --env="POSTGRES_USER=pgboot" --env="POSTGRES_PASSWORD=$(cat "${PW_FILE}")" \
      --env="POSTGRES_DB=bootstrap" --labels="app=${POD}" >/dev/null
    kubectl -n "${NS}" wait --for=condition=Ready "pod/${POD}" --timeout=180s >/dev/null
    sleep 4 # the image restarts postgres once after initdb
    psql_boot bootstrap >/dev/null <<EOF
CREATE ROLE postgres WITH LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD '$(cat "${PW_FILE}")';
CREATE DATABASE langfuse OWNER postgres;
EOF
    say "created: $(echo "select version()" | psql_boot | cut -d' ' -f1-2); postgres = non-superuser admin, owns database langfuse"
  fi
  start_port_forward
  say "ready on localhost:${PORT}. Connection string (not printed): run  eval \"\$(${BASH_SOURCE[0]} env)\""
}

cmd_env() {
  [ -f "${PW_FILE}" ] || { echo "not up" >&2; exit 1; }
  printf 'export DATABASE_URL=%q DIRECT_URL=%q\n' "$(db_url)" "$(db_url)"
}

prisma() { (cd "${REPO_ROOT}/packages/shared" && DATABASE_URL="$(db_url)" DIRECT_URL="$(db_url)" npx prisma "$@" --schema "${SCHEMA}" 2>&1); }

step() { # step <label> <expected-grep> <command...>
  local label="$1" expect="$2"; shift 2
  local started out
  started="$(now)"
  # Pass/fail is the expected text, not the exit code: `migrate status`
  # exits non-zero when a migration is pending, which is the expected state
  # right after a rollback.
  out="$("$@" || true)"
  if grep -q "${expect}" <<<"${out}"; then
    printf '| %s | `%s` | PASS | %s |\n' "${label}" "$*" "${started}"
  else
    printf '| %s | `%s` | **FAIL** | %s |\n' "${label}" "$*" "${started}"
    printf '%s\n' "${out}" | tail -15 >&2
    exit 1
  fi
}

applied() { echo "select count(*) from _prisma_migrations where migration_name='${1}' and finished_at is not null and rolled_back_at is null" | psql_boot; }

cmd_rehearse() {
  local name="${1:?usage: rehearse <migration_name>}"
  local down="${REPO_ROOT}/acme-governance/rollback/${name}/down.sql"
  [ -d "${REPO_ROOT}/packages/shared/prisma/migrations/${name}" ] || { echo "no such migration: ${name}" >&2; exit 1; }
  [ -f "${down}" ] || { echo "missing ${down}" >&2; exit 1; }
  cmd_up >&2
  echo "| Step | Command | Result | Started (UTC) |"
  echo "|---|---|---|---|"
  step "Up" "successfully applied\|No pending migrations" prisma migrate deploy
  [ "$(applied "${name}")" = "1" ] || { echo "| Up check | migration row present | **FAIL** | $(now) |"; exit 1; }
  echo "| Up check | migration row present | PASS | $(now) |"
  step "Down" "executed successfully" prisma db execute --file "${down}"
  [ "$(applied "${name}")" = "0" ] || { echo "| Down check | migration row removed | **FAIL** | $(now) |"; exit 1; }
  echo "| Down check | migration row removed | PASS | $(now) |"
  step "Status after down (pending again)" "${name}" prisma migrate status
  step "Up again" "successfully applied" prisma migrate deploy
  step "Status after up again" "up to date" prisma migrate status
}

cmd_down() {
  if port_forward_alive; then kill "$(cat "${PF_PID_FILE}")" 2>/dev/null || true; fi
  if kubectl get namespace "${NS}" >/dev/null 2>&1; then
    kubectl delete namespace "${NS}" --wait=true >/dev/null
    say "namespace ${NS} deleted"
  else
    say "namespace ${NS} not present"
  fi
  rm -rf "${STATE_DIR}"
}

case "${1:-}" in
  up) cmd_up ;;
  env) cmd_env ;;
  rehearse) shift; cmd_rehearse "$@" ;;
  down) cmd_down ;;
  *) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

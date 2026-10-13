#!/usr/bin/env bash
# Run a command with a dedicated ACR build pool that exists only for that command.
#
# A dedicated build pool bills for every second it exists, whether or not a
# build is running. This wrapper creates the pool, runs the command (normally
# release.sh), and deletes the pool when the command ends, so a release window
# cannot leave a billed pool running. The pool is deleted when the command
# succeeds, when it fails, and on INT, TERM and HUP. It cannot help if this
# process is killed with SIGKILL or the machine loses power: use --check and
# --close for that case, and watch the daily cost email.
#
# Environment-specific values (registry, pool name) come from the same env
# file release.sh uses, kept outside this repository.
set -uo pipefail

usage() {
  cat <<'EOF'
Usage:
  with-build-pool.sh --env FILE [--tier S3] [--count 1] [--dry-run] -- COMMAND [ARG...]
      Create the pool named by AGENT_POOL in FILE, run COMMAND, delete the pool.
      The exit status is COMMAND's. Refuses to start if the pool already exists
      (another release window may be open).
  with-build-pool.sh --env FILE --check
      Exit 0 and say so if the pool does not exist. Exit 1 and print its tier,
      count, state, creation time and age if it does.
  with-build-pool.sh --env FILE --close
      Delete the pool if it exists. Exit 0 if it is gone afterwards.

Env file variables (the file release.sh uses):
  REGISTRY     required
  AGENT_POOL   required (the pool to create and delete)

Options:
  --tier S1|S2|S3|I6   pool size, default S3 (8 vCPU; the web image needs it)
  --count N            number of instances, default 1
  --dry-run            print what would be done and call nothing

Environment overrides (seconds):
  BUILD_POOL_POLL_SECONDS    default 10
  BUILD_POOL_CREATE_TIMEOUT  default 900
  BUILD_POOL_DELETE_TIMEOUT  default 600

Exit status: COMMAND's; 2 usage or refused to start; 70 the pool could not be
confirmed deleted (remove it yourself, the message names the command).
EOF
}

ENV_FILE="" MODE=run TIER=S3 COUNT=1 DRY_RUN=0
need_value() { [[ $1 -ge 2 ]] || { echo "Missing value for $2" >&2; exit 2; }; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) need_value $# --env; ENV_FILE=$2; shift 2 ;;
    --tier) need_value $# --tier; TIER=$2; shift 2 ;;
    --count) need_value $# --count; COUNT=$2; shift 2 ;;
    --check) MODE=check; shift ;;
    --close) MODE=close; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    --) shift; break ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z $ENV_FILE || ! -r $ENV_FILE ]]; then
  echo "--env FILE is required and must be readable" >&2
  usage >&2
  exit 2
fi
if [[ $MODE == run && $# -eq 0 ]]; then
  echo "No command given after --" >&2
  usage >&2
  exit 2
fi
case "$TIER" in
  S1) VCPU=2 ;;
  S2) VCPU=4 ;;
  S3) VCPU=8 ;;
  I6) VCPU=64 ;;
  *) echo "--tier must be S1, S2, S3 or I6" >&2; exit 2 ;;
esac
[[ $COUNT =~ ^[1-9][0-9]*$ ]] || { echo "--count must be a positive integer" >&2; exit 2; }

POLL=${BUILD_POOL_POLL_SECONDS:-10}
CREATE_TIMEOUT=${BUILD_POOL_CREATE_TIMEOUT:-900}
DELETE_TIMEOUT=${BUILD_POOL_DELETE_TIMEOUT:-600}
for v in "$POLL" "$CREATE_TIMEOUT" "$DELETE_TIMEOUT"; do
  [[ $v =~ ^[0-9]+$ ]] || { echo "Timeouts and poll interval must be whole seconds" >&2; exit 2; }
done

# shellcheck disable=SC1090
REGISTRY=$(source "$ENV_FILE" >/dev/null 2>&1; printf '%s' "${REGISTRY:-}")
# shellcheck disable=SC1090
AGENT_POOL=$(source "$ENV_FILE" >/dev/null 2>&1; printf '%s' "${AGENT_POOL:-}")
NAME_RE='^[A-Za-z0-9][A-Za-z0-9_-]*$'
[[ $REGISTRY =~ $NAME_RE ]] || { echo "REGISTRY is missing or malformed in $ENV_FILE" >&2; exit 2; }
[[ $AGENT_POOL =~ $NAME_RE ]] || { echo "AGENT_POOL is missing or malformed in $ENV_FILE" >&2; exit 2; }

say() { printf '[build-pool] %s\n' "$*" >&2; }

# Prints "TIER COUNT STATE CREATED" or "absent". Non-zero on any other failure,
# so an auth or network error is never mistaken for "the pool is gone".
pool_info() {
  local out
  if out=$(az acr agentpool show --registry "$REGISTRY" --name "$AGENT_POOL" \
    --query "join(' ', [to_string(tier), to_string(count), to_string(provisioningState), to_string(systemData.createdAt)])" \
    -o tsv --only-show-errors 2>&1); then
    printf '%s\n' "$out"
    return 0
  fi
  if grep -qiE 'ResourceNotFound|was not found|could not be found' <<<"$out"; then
    echo absent
    return 0
  fi
  printf '%s\n' "$out" >&2
  return 1
}

# Deletes the pool and confirms it is gone. Returns 0 only when it is absent.
delete_and_verify() {
  local attempt info deadline
  for attempt in 1 2 3; do
    if info=$(pool_info) && [[ $info == absent ]]; then
      return 0
    fi
    say "deleting pool '$AGENT_POOL' (attempt $attempt of 3)"
    az acr agentpool delete --registry "$REGISTRY" --name "$AGENT_POOL" --yes \
      --only-show-errors >&2 || true
    deadline=$((SECONDS + DELETE_TIMEOUT))
    while ((SECONDS < deadline)); do
      if info=$(pool_info) && [[ $info == absent ]]; then
        return 0
      fi
      sleep "$POLL"
    done
  done
  return 1
}

age_text() { # $1 = ISO creation time
  local t now
  t=$(date -d "$1" +%s 2>/dev/null) || return 0
  now=$(date +%s)
  awk -v s=$((now - t)) 'BEGIN { printf "%.1f hours", s / 3600 }'
}

CLOSE_CMD="az acr agentpool delete --registry $REGISTRY --name $AGENT_POOL --yes"

# ---- check and close modes ---------------------------------------------------
if [[ $MODE == check || $MODE == close ]]; then
  if ((DRY_RUN)); then
    say "[dry-run] would $MODE pool '$AGENT_POOL' in registry '$REGISTRY'"
    exit 0
  fi
  info=$(pool_info) || { say "could not read the pool state"; exit 2; }
  if [[ $info == absent ]]; then
    say "no build pool '$AGENT_POOL' in registry '$REGISTRY'"
    exit 0
  fi
  read -r p_tier p_count p_state p_created <<<"$info"
  say "build pool '$AGENT_POOL' EXISTS: tier $p_tier, count $p_count, state $p_state, created $p_created ($(age_text "$p_created") ago)"
  if [[ $MODE == check ]]; then
    say "it bills while it exists; remove it with: $CLOSE_CMD"
    exit 1
  fi
  if delete_and_verify; then
    say "pool '$AGENT_POOL' deleted and confirmed absent"
    exit 0
  fi
  say "ERROR: could not confirm the pool is deleted. Remove it now: $CLOSE_CMD"
  exit 70
fi

# ---- run mode ----------------------------------------------------------------
if ((DRY_RUN)); then
  say "[dry-run] az acr agentpool create --registry $REGISTRY --name $AGENT_POOL --tier $TIER --count $COUNT"
  say "[dry-run] would run: $*"
  say "[dry-run] $CLOSE_CMD"
  exit 0
fi

CREATED=0 CHILD="" SIGNALLED=0 CMD_STATUS=0 T_START=0

on_signal() {
  SIGNALLED=$1
  [[ -n $CHILD ]] && kill -TERM "$CHILD" 2>/dev/null
  return 0
}
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap 'on_signal 129' HUP

report_cost() {
  local elapsed=$((SECONDS - T_START))
  # $0.0001 per vCPU-second, the rate the pool's own bill reconciles to. An estimate.
  awk -v s="$elapsed" -v v="$VCPU" -v c="$COUNT" \
    'BEGIN { printf "[build-pool] window open %d min %d s on %d x %d vCPU; about $%.2f at $0.0001 per vCPU-second (estimate)\n", s / 60, s % 60, c, v, s * v * c * 0.0001 }' >&2
}

close_pool() {
  local rc=$?
  trap - EXIT
  if ((CREATED)); then
    if delete_and_verify; then
      say "pool '$AGENT_POOL' deleted and confirmed absent"
    else
      say "ERROR: could not confirm the pool is deleted. It bills while it exists. Remove it now: $CLOSE_CMD"
      rc=70
    fi
    report_cost
  fi
  exit "$rc"
}
trap close_pool EXIT

if ! info=$(pool_info); then
  say "could not read the pool state; not starting"
  exit 2
fi
if [[ $info != absent ]]; then
  say "pool '$AGENT_POOL' already exists ($info). Another release window may be open."
  say "Not creating or deleting anything. See: with-build-pool.sh --env $ENV_FILE --check"
  exit 2
fi

T_START=$SECONDS
CREATED=1 # set before the call, so a half-created pool is cleaned up too
say "creating pool '$AGENT_POOL' (tier $TIER, count $COUNT) in registry '$REGISTRY'"
if ! az acr agentpool create --registry "$REGISTRY" --name "$AGENT_POOL" \
  --tier "$TIER" --count "$COUNT" --only-show-errors >&2; then
  say "pool creation failed; nothing was run"
  exit 1
fi
deadline=$((SECONDS + CREATE_TIMEOUT))
while :; do
  if info=$(pool_info) && [[ $info != absent ]]; then
    read -r _ _ p_state _ <<<"$info"
    [[ $p_state == Succeeded ]] && break
    [[ $p_state == Failed ]] && { say "pool provisioning failed; nothing was run"; exit 1; }
  fi
  if ((SECONDS >= deadline)); then
    say "pool not ready after ${CREATE_TIMEOUT}s; nothing was run"
    exit 1
  fi
  sleep "$POLL"
done
say "pool ready; running: $*"

exec 3<&0
"$@" <&3 &
CHILD=$!
wait "$CHILD"
CMD_STATUS=$?
grace=0
while kill -0 "$CHILD" 2>/dev/null; do
  if ((SIGNALLED && grace >= 30)); then
    kill -KILL "$CHILD" 2>/dev/null
  fi
  wait "$CHILD" 2>/dev/null
  CMD_STATUS=$?
  grace=$((grace + 1))
  ((SIGNALLED)) && sleep 1
done
CHILD=""
if ((SIGNALLED)); then
  say "interrupted (signal); closing the window"
  exit "$SIGNALLED"
fi
exit "$CMD_STATUS"

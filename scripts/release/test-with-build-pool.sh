#!/usr/bin/env bash
# Tests for with-build-pool.sh against a fake `az`. No cloud access, no cost.
# Prints a PASS/FAIL table and exits non-zero if any case fails.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WRAP="$HERE/with-build-pool.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

cat >"$TMP/bin/az" <<'FAKE'
#!/usr/bin/env bash
echo "$*" >>"$FAKE_LOG"
[[ $1 == acr && $2 == agentpool ]] || { echo "unexpected call: $*" >&2; exit 9; }
case "$3" in
  show)
    if [[ -f $FAKE_STATE ]]; then echo "S3 1 Succeeded 2026-10-13T08:00:00+00:00"; exit 0; fi
    echo "ERROR: (ResourceNotFound) The Resource 'x' under resource group 'y' was not found." >&2
    exit 3 ;;
  create)
    touch "$FAKE_STATE"
    if [[ ${FAKE_CREATE_FAIL:-0} == 1 ]]; then echo "ERROR: create failed" >&2; exit 1; fi
    exit 0 ;;
  delete)
    n=$(cat "$FAKE_DEL_FAILS" 2>/dev/null || echo 0)
    if ((n > 0)); then echo $((n - 1)) >"$FAKE_DEL_FAILS"; echo "ERROR: delete failed" >&2; exit 1; fi
    rm -f "$FAKE_STATE"
    exit 0 ;;
esac
exit 9
FAKE
chmod +x "$TMP/bin/az"

printf 'REGISTRY=testreg\nAGENT_POOL=testpool\n' >"$TMP/env"
export PATH="$TMP/bin:$PATH"
export FAKE_LOG="$TMP/log" FAKE_STATE="$TMP/pool" FAKE_DEL_FAILS="$TMP/delfails"
export BUILD_POOL_POLL_SECONDS=0 BUILD_POOL_CREATE_TIMEOUT=5 BUILD_POOL_DELETE_TIMEOUT=1

PASS=0 FAIL=0
reset() { rm -f "$FAKE_LOG" "$FAKE_STATE" "$FAKE_DEL_FAILS"; : >"$FAKE_LOG"; unset FAKE_CREATE_FAIL; }
verbs() { grep -oE '^acr agentpool (show|create|delete)' "$FAKE_LOG" | awk '{print $3}' | tr '\n' ' '; }
check() { # name, condition-exit-code, detail
  if [[ $2 -eq 0 ]]; then PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; else FAIL=$((FAIL + 1)); printf 'FAIL  %s  (%s)\n' "$1" "$3"; fi
}
run() { bash "$WRAP" "$@" >"$TMP/out" 2>&1; echo $?; }

# 1. success: pool created, command run, pool deleted, status 0
reset
rc=$(run --env "$TMP/env" -- true)
[[ $rc == 0 && ! -f $FAKE_STATE ]] ; check "success: exit 0 and pool deleted" $? "rc=$rc state=$([[ -f $FAKE_STATE ]] && echo present || echo absent)"
grep -q 'acr agentpool create .*--tier S3 --count 1' "$FAKE_LOG"; check "success: created with --tier S3 --count 1 (default tier is S1 in az)" $? "$(grep create "$FAKE_LOG")"
grep -q 'acr agentpool delete .*--yes' "$FAKE_LOG"; check "success: deleted with --yes" $? ""

# 2. command fails: pool still deleted, status propagated
reset
rc=$(run --env "$TMP/env" -- bash -c 'exit 7')
[[ $rc == 7 && ! -f $FAKE_STATE ]]; check "failure: exit status 7 propagated and pool deleted" $? "rc=$rc"

# 3. pool already exists: refuse, run nothing, delete nothing
reset; touch "$FAKE_STATE"
rc=$(run --env "$TMP/env" -- bash -c "touch $TMP/ran")
[[ $rc == 2 && -f $FAKE_STATE && ! -f $TMP/ran ]]; check "existing pool: refused (2), command not run, pool left alone" $? "rc=$rc ran=$([[ -f $TMP/ran ]] && echo yes || echo no)"
! grep -q 'agentpool delete' "$FAKE_LOG"; check "existing pool: no delete call" $? ""
rm -f "$TMP/ran"

# 4. interrupted: TERM while the command runs
reset
rm -f "$TMP/cmdpid"
bash "$WRAP" --env "$TMP/env" -- bash -c "echo \$\$ > '$TMP/cmdpid'; exec sleep 30" >"$TMP/out" 2>&1 &
WP=$!
for _ in $(seq 1 100); do [[ -s $TMP/cmdpid ]] && break; sleep 0.1; done
[[ -s $TMP/cmdpid ]]; check "TERM: the command started (pid file written)" $? "no pid file"
CP=$(cat "$TMP/cmdpid" 2>/dev/null)
kill -0 "$CP" 2>/dev/null; check "TERM: the command is alive before the signal" $? "pid $CP not running"
kill -TERM "$WP" 2>/dev/null
wait "$WP"; rc=$?
[[ $rc == 143 && ! -f $FAKE_STATE ]]; check "TERM: exit 143 and pool deleted" $? "rc=$rc"
! kill -0 "$CP" 2>/dev/null; check "TERM: the command was stopped too" $? "pid $CP still running"

# 5. create fails: nothing run, half-made pool cleaned, non-zero
reset; export FAKE_CREATE_FAIL=1
rc=$(run --env "$TMP/env" -- bash -c "touch $TMP/ran")
[[ $rc != 0 && ! -f $TMP/ran && ! -f $FAKE_STATE ]]; check "create fails: non-zero, command not run, partial pool removed" $? "rc=$rc"
unset FAKE_CREATE_FAIL; rm -f "$TMP/ran"

# 6. delete keeps failing: exit 70 and the message names the manual command
reset; echo 99 >"$FAKE_DEL_FAILS"
rc=$(run --env "$TMP/env" -- true)
[[ $rc == 70 ]] && grep -q 'Remove it now: az acr agentpool delete' "$TMP/out"; check "delete fails: exit 70 with the manual command in the message" $? "rc=$rc"
rm -f "$FAKE_DEL_FAILS" "$FAKE_STATE"

# 7. --check
reset
rc=$(run --env "$TMP/env" --check); [[ $rc == 0 ]]; check "--check: absent returns 0" $? "rc=$rc"
touch "$FAKE_STATE"
rc=$(run --env "$TMP/env" --check); [[ $rc == 1 ]] && grep -q 'EXISTS' "$TMP/out"; check "--check: present returns 1 and says EXISTS" $? "rc=$rc"

# 8. --close
rc=$(run --env "$TMP/env" --close); [[ $rc == 0 && ! -f $FAKE_STATE ]]; check "--close: removes a present pool" $? "rc=$rc"
rc=$(run --env "$TMP/env" --close); [[ $rc == 0 ]]; check "--close: absent is fine" $? "rc=$rc"

# 9. --dry-run makes no az call
reset
rc=$(run --env "$TMP/env" --dry-run -- true)
[[ $rc == 0 && ! -s $FAKE_LOG ]]; check "--dry-run: exit 0 and no az calls" $? "rc=$rc calls=$(wc -l <"$FAKE_LOG")"

# 10. usage errors
rc=$(run --env "$TMP/env"); [[ $rc == 2 ]]; check "no command: exit 2" $? "rc=$rc"
rc=$(run --env "$TMP/env" --tier S9 -- true); [[ $rc == 2 ]]; check "bad tier: exit 2" $? "rc=$rc"
printf 'REGISTRY=testreg\n' >"$TMP/env-nopool"
rc=$(run --env "$TMP/env-nopool" -- true); [[ $rc == 2 ]]; check "env file without AGENT_POOL: exit 2" $? "rc=$rc"

# 11. the cost line is printed with the window
reset
run --env "$TMP/env" -- true >/dev/null
grep -q 'estimate' "$TMP/out"; check "cost estimate line printed" $? ""

echo
echo "passed: $PASS   failed: $FAIL"
[[ $FAIL -eq 0 ]]

#!/usr/bin/env bash
# CHG-2026-096: decide the "Security review" check from the action's results file.
# Usage: check-results.sh <results.json>
# Exit 1 (fail closed) on a missing, empty, errored or unreadable result, and on any
# HIGH or CRITICAL finding. MEDIUM and LOW findings stay in the PR comment for the
# security agent's review and the owner. Used by the review job and by its self-test.
set -u
results="${1:?usage: check-results.sh <results.json>}"

if [ ! -s "$results" ]; then
  echo "::error::No security review result was produced; failing closed."
  exit 1
fi
if jq -e '.error' "$results" > /dev/null 2>&1; then
  echo "::error::The security review reported an error; failing closed."
  exit 1
fi
if ! jq -e '.findings | type == "array"' "$results" > /dev/null 2>&1; then
  echo "::error::The security review result has no readable findings list; failing closed."
  exit 1
fi
blocking=$(jq '[.findings[] | ((.severity // "") | ascii_upcase) | select(. == "HIGH" or . == "CRITICAL")] | length' "$results") || {
  echo "::error::Could not read the findings' severities; failing closed."
  exit 1
}
total=$(jq '.findings | length' "$results")
if [ "$blocking" -gt 0 ]; then
  echo "::error::$blocking high or critical finding(s) of $total; see the review comment on this pull request."
  exit 1
fi
echo "No high or critical finding ($total finding(s) in all; see the review comment, if any)."

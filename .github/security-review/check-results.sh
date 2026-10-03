#!/usr/bin/env bash
# CHG-2026-096: decide the "Security review" check from the action's results file.
# Usage: check-results.sh <results.json>
# Exit 1 (fail closed) unless the file is exactly one JSON document, has no
# `error`, has a findings list, says the review completed, and every finding is
# MEDIUM or LOW. HIGH, CRITICAL, missing and unknown severities all block.
# MEDIUM and LOW findings stay in the PR comment for the security agent's review
# and the owner. Used by the review job and by its self-test.
set -u
results="${1:?usage: check-results.sh <results.json>}"

fail() { echo "::error::$1; failing closed."; exit 1; }

[ -s "$results" ] || fail "No security review result was produced"

# Exactly one JSON document (review CHG096-6: two documents made the counts
# multi-line, and the comparison below then fell through to a pass).
docs=$(jq -s 'length' "$results" 2>/dev/null) || fail "The security review result is not valid JSON"
[ "$docs" = "1" ] || fail "The security review result holds $docs JSON documents, not one"

if jq -e '.error' "$results" > /dev/null 2>&1; then
  fail "The security review reported an error"
fi
jq -e '.findings | type == "array"' "$results" > /dev/null 2>&1 \
  || fail "The security review result has no readable findings list"

# The review must say it completed (review CHG096-1). When the model's answer
# holds no readable JSON, the action writes an empty findings list with
# review_completed false and exits 0; that must not pass.
jq -e '.analysis_summary.review_completed == true' "$results" > /dev/null 2>&1 \
  || fail "The security review did not report that it completed"

# Only MEDIUM and LOW pass (review CHG096-2): a missing, misspelt or unknown
# severity blocks, as HIGH and CRITICAL do.
blocking=$(jq '[.findings[] | (.severity | if type == "string" then ascii_upcase else "" end) | select(. != "MEDIUM" and . != "LOW")] | length' "$results" 2>/dev/null) \
  || fail "Could not read the findings' severities"
total=$(jq '.findings | length' "$results" 2>/dev/null) || fail "Could not count the findings"
for count in "$blocking" "$total"; do
  case "$count" in
    '' | *[!0-9]*) fail "The finding counts are not whole numbers" ;;
  esac
done

if [ "$blocking" -gt 0 ]; then
  echo "::error::$blocking of $total finding(s) are HIGH, CRITICAL, or have a missing or unknown severity; see the review comment on this pull request."
  exit 1
fi
echo "Review completed; no blocking finding ($total MEDIUM or LOW finding(s); see the review comment, if any)."

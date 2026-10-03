#!/usr/bin/env bash
# CHG-2026-096: decide the "Security review" check from the action's results file.
# Usage: check-results.sh <results.json>
# Exit 1 (fail closed) unless the file is exactly one JSON document, has no
# `error`, has a findings list and an excluded-findings list, shows no finding
# excluded by directory, says the review completed, and every finding is MEDIUM
# or LOW. That includes findings the
# action excluded before reporting, except those its model filter judged to be
# false positives under CAIRO's filtering rules. HIGH, CRITICAL, missing and
# unknown severities all block. MEDIUM and LOW findings stay in the PR comment
# for the security agent's review and the owner. Used by the review job and by
# its self-test.
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
# The action always writes this list when a review finishes (review R282-1).
jq -e '.filtering_summary.excluded_findings_details | type == "array"' "$results" > /dev/null 2>&1 \
  || fail "The security review result has no readable list of excluded findings"
# This workflow excludes no directories. The action appends a directory-excluded
# finding to that list as the model wrote it, so it could pose as a filter
# exclusion below (review R285-4). None may exist.
jq -e '.filtering_summary.filter_analysis.directory_excluded_count == 0' "$results" > /dev/null 2>&1 \
  || fail "The security review result does not show zero findings excluded by directory, and this workflow excludes none"

# The review must say it completed (review CHG096-1). When the model's answer
# holds no readable JSON, the action writes an empty findings list with
# review_completed false and exits 0; that must not pass.
jq -e '.analysis_summary.review_completed == true' "$results" > /dev/null 2>&1 \
  || fail "The security review did not report that it completed"

# A finding blocks unless its severity is MEDIUM or LOW (review CHG096-2): a
# missing, misspelt or unknown severity blocks, as HIGH and CRITICAL do.
blocks='select(.severity | if type == "string" then ascii_upcase else "" end | . != "MEDIUM" and . != "LOW")'
# Findings the action excluded before reporting (review R282-1). Those its model
# filter judged to be false positives, under CAIRO's filtering rules, are not
# counted; a finding excluded any other way is. Only the filter's own wrapper
# shape counts as a filter exclusion (review R285-4).
by_filter='type == "object" and .filter_stage == "claude_api" and (.finding | type == "object")'
excluded=".filtering_summary.excluded_findings_details[] | select(($by_filter) | not) | (.finding // .)"

blocking=$(jq "[.findings[] | $blocks] | length" "$results" 2>/dev/null) \
  || fail "Could not read the findings' severities"
hidden=$(jq "[$excluded | $blocks] | length" "$results" 2>/dev/null) \
  || fail "Could not read the excluded findings' severities"
total=$(jq '.findings | length' "$results" 2>/dev/null) || fail "Could not count the findings"
filtered=$(jq "[.filtering_summary.excluded_findings_details[] | select($by_filter)] | length" "$results" 2>/dev/null) \
  || fail "Could not count the excluded findings"
for count in "$blocking" "$hidden" "$total" "$filtered"; do
  case "$count" in
    '' | *[!0-9]*) fail "The finding counts are not whole numbers" ;;
  esac
done

if [ "$blocking" -gt 0 ] || [ "$hidden" -gt 0 ]; then
  if [ "$blocking" -gt 0 ]; then
    echo "::error::$blocking of $total reported finding(s) are HIGH, CRITICAL, or have a missing or unknown severity; see the review comment on this pull request."
  fi
  if [ "$hidden" -gt 0 ]; then
    echo "::error::$hidden finding(s) that the review action excluded before reporting are HIGH, CRITICAL, or have a missing or unknown severity. They are not in the review comment:"
    # One JSON line each, indented, so no text from the review can start a
    # workflow command or a new line of its own.
    jq -r "[$excluded | $blocks][] | \"  - \" + ({file, line, severity, category} | tojson)" "$results" 2>/dev/null || true
  fi
  exit 1
fi
echo "Review completed; no blocking finding ($total MEDIUM or LOW finding(s) reported; $filtered excluded as false positives under CAIRO's filtering rules)."

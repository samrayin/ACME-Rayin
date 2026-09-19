#!/usr/bin/env python3
"""ACME: enforcement step for the "Security review" workflow.

The upstream action (anthropics/claude-code-security-review) is fail-open. If the scan
errors it prints a warning and reports 0 findings; if the model's reply cannot be parsed
it returns an empty findings list with review_completed=false and exits 0; and if it
finds vulnerabilities it only comments on the PR. In every case the job ends green.
This script turns the check into a gate:

  * the scan must have COMPLETED (analysis_summary.review_completed is true) and
    produced a valid result, otherwise FAIL. "Could not review" is never "clean";
  * any finding at or above the blocking severity FAILS the job;
  * a finding with a missing or unrecognised severity is blocking: unknown is not safe;
  * findings that upstream's false-positive filter removed are surfaced as warnings when
    they are at or above the threshold, because that filter is an LLM pass that is shown
    the PR title and body, which the PR author controls.

Usage: security_review_gate.py <results.json> [blocking-severity]
  blocking-severity: HIGH (default) | MEDIUM | LOW
Exit codes: 0 pass, 1 blocking findings, 2 scan did not complete or result invalid.
Standard library only, so it runs on a bare runner and in the unit tests.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

EXIT_PASS = 0
EXIT_FINDINGS = 1
EXIT_INCOMPLETE = 2

ORDER = ["LOW", "MEDIUM", "HIGH"]
MAX_DESCRIPTION = 1000


class Incomplete(Exception):
    """The scan outcome is unknown, so the gate must fail closed."""


def esc_data(value: object) -> str:
    """Escape a workflow-command message. Finding text is model output steered by PR
    content, so it must not be able to inject commands such as ::stop-commands::."""
    return str(value).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def esc_prop(value: object) -> str:
    """Escape a workflow-command property (file=, line=, title=)."""
    return esc_data(value).replace(":", "%3A").replace(",", "%2C")


def blocking_levels(threshold: str) -> set[str]:
    level = str(threshold or "HIGH").strip().upper()
    if level not in ORDER:
        raise Incomplete(f"Unknown blocking severity '{threshold}' (expected HIGH, MEDIUM or LOW).")
    return set(ORDER[ORDER.index(level):])


def load_results(path: Path) -> dict:
    if not path.is_file():
        raise Incomplete(f"No results file at '{path}'.")
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        raise Incomplete(f"Results file '{path}' is empty.")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise Incomplete(f"Results file is not valid JSON ({exc.msg}).") from exc
    if not isinstance(data, dict):
        raise Incomplete("Results file is not a JSON object.")
    if data.get("error") is not None:
        raise Incomplete(f"The scanner reported an error: {str(data['error'])[:400]}")
    if not isinstance(data.get("findings"), list):
        raise Incomplete("Results have no 'findings' list, so the scan outcome is unknown.")
    summary = data.get("analysis_summary")
    if not isinstance(summary, dict) or summary.get("review_completed") is not True:
        raise Incomplete(
            "The scanner did not confirm that the review completed "
            "(analysis_summary.review_completed is not true). An empty findings list from an "
            "unparsed or interrupted review is not a clean result."
        )
    return data


def severity_of(finding: dict) -> str:
    return str(finding.get("severity") or "UNKNOWN").strip().upper()


def is_blocking(severity: str, levels: set[str]) -> bool:
    return severity in levels or severity not in ORDER


def annotation(kind: str, finding: dict, severity: str, prefix: str = "") -> str:
    description = str(finding.get("description") or finding.get("category") or "finding")
    description = " ".join(description.split())[:MAX_DESCRIPTION]
    try:
        line = max(int(finding.get("line") or 1), 1)
    except (TypeError, ValueError):
        line = 1
    return (
        f"::{kind} file={esc_prop(finding.get('file') or 'unknown')},line={line},"
        f"title={esc_prop(f'Security review [{severity}]')}::{esc_data(prefix + description)}"
    )


def as_dicts(items: object) -> list[dict]:
    if not isinstance(items, list):
        return []
    return [i if isinstance(i, dict) else {"description": str(i)} for i in items]


def evaluate(path: Path, threshold: str = "HIGH") -> tuple[int, list[str]]:
    """Return (exit_code, log_lines). Pure function, used by the tests."""
    try:
        levels = blocking_levels(threshold)
        data = load_results(path)
    except Incomplete as exc:
        return EXIT_INCOMPLETE, [
            "::error title=Security review did not complete::"
            + esc_data(f"{exc} Failing closed: an unreviewed change must not show a passing security check.")
        ]

    findings = as_dicts(data["findings"])
    lines: list[str] = []
    blocking = 0
    for finding in findings:
        severity = severity_of(finding)
        if is_blocking(severity, levels):
            blocking += 1
            lines.append(annotation("error", finding, severity))

    # Findings removed by upstream's LLM false-positive filter never reach `findings`.
    filtering = data.get("filtering_summary")
    excluded = as_dicts(filtering.get("excluded_findings_details")) if isinstance(filtering, dict) else []
    suppressed = 0
    for item in excluded:
        finding = item.get("finding") if isinstance(item.get("finding"), dict) else item
        severity = severity_of(finding)
        if is_blocking(severity, levels):
            suppressed += 1
            lines.append(annotation("warning", finding, severity, "Removed by the false-positive filter, check by hand: "))

    level = str(threshold).strip().upper()
    summary = (
        f"Security review: {len(findings)} finding(s), {blocking} blocking at threshold {level}; "
        f"{suppressed} at or above the threshold were removed by the false-positive filter."
    )
    if blocking:
        lines.append(
            "::error::"
            + esc_data(
                f"Security review gate FAILED. {summary} Fix them, or have the owner record an "
                "accepted-risk decision in the PR."
            )
        )
        return EXIT_FINDINGS, lines
    lines.append(f"Security review gate passed: the review completed. {summary}")
    return EXIT_PASS, lines


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else Path("claudecode-results.json")
    threshold = argv[2] if len(argv) > 2 and argv[2] else "HIGH"
    code, lines = evaluate(path, threshold)
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))

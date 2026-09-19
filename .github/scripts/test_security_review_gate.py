"""ACME: tests for security_review_gate.py.

Run: python -m unittest discover -s .github/scripts -p "test_*.py" -v
No network and no API key needed; the gate is fed fixture results.
"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import security_review_gate as gate  # noqa: E402

DONE = {"files_reviewed": 3, "review_completed": True}


def results(findings, **extra):
    return {"findings": findings, "analysis_summary": dict(DONE), **extra}


class GateTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.dir = Path(self._dir.name)

    def tearDown(self):
        self._dir.cleanup()

    def write(self, content) -> Path:
        path = self.dir / "results.json"
        path.write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
        return path

    def code(self, content, threshold="HIGH") -> int:
        return gate.evaluate(self.write(content), threshold)[0]

    # --- a completed scan ---
    def test_clean_completed_scan_passes(self):
        self.assertEqual(self.code(results([])), gate.EXIT_PASS)

    def test_high_finding_fails(self):
        finding = {"file": "a.ts", "line": 4, "severity": "HIGH", "description": "raw SQL"}
        self.assertEqual(self.code(results([finding])), gate.EXIT_FINDINGS)

    def test_medium_passes_at_default_threshold(self):
        self.assertEqual(self.code(results([{"severity": "MEDIUM"}])), gate.EXIT_PASS)

    def test_medium_fails_when_threshold_is_medium(self):
        self.assertEqual(self.code(results([{"severity": "MEDIUM"}]), "MEDIUM"), gate.EXIT_FINDINGS)

    def test_high_still_fails_when_threshold_is_low(self):
        self.assertEqual(self.code(results([{"severity": "HIGH"}]), "LOW"), gate.EXIT_FINDINGS)

    def test_severity_and_threshold_are_case_insensitive(self):
        self.assertEqual(self.code(results([{"severity": "high"}]), "high"), gate.EXIT_FINDINGS)

    def test_missing_severity_is_blocking(self):
        self.assertEqual(self.code(results([{"description": "no severity"}])), gate.EXIT_FINDINGS)

    def test_unrecognised_severity_is_blocking(self):
        self.assertEqual(self.code(results([{"severity": "CRITICAL"}])), gate.EXIT_FINDINGS)

    def test_non_string_severity_is_blocking(self):
        self.assertEqual(self.code(results([{"severity": 3}])), gate.EXIT_FINDINGS)

    def test_non_dict_and_null_findings_are_blocking(self):
        self.assertEqual(self.code(results(["something odd"])), gate.EXIT_FINDINGS)
        self.assertEqual(self.code(results([None])), gate.EXIT_FINDINGS)

    # --- the fail-open path upstream leaves: an unparsed review looks like "0 findings" ---
    def test_empty_findings_without_review_completed_fails_closed(self):
        unparsed = {"findings": [], "analysis_summary": {"files_reviewed": 0, "review_completed": False}}
        self.assertEqual(self.code(unparsed), gate.EXIT_INCOMPLETE)

    def test_missing_analysis_summary_fails_closed(self):
        self.assertEqual(self.code({"findings": []}), gate.EXIT_INCOMPLETE)

    def test_truthy_but_not_true_review_completed_fails_closed(self):
        almost = {"findings": [], "analysis_summary": {"review_completed": "true"}}
        self.assertEqual(self.code(almost), gate.EXIT_INCOMPLETE)

    # --- a scan that did not complete must fail closed ---
    def test_scanner_error_fails_closed(self):
        self.assertEqual(self.code({"error": "Claude API returned 401"}), gate.EXIT_INCOMPLETE)

    def test_error_wins_even_with_a_completed_empty_result(self):
        self.assertEqual(self.code(results([], error="timeout")), gate.EXIT_INCOMPLETE)

    def test_findings_not_a_list_fails_closed(self):
        self.assertEqual(self.code({"findings": None, "analysis_summary": DONE}), gate.EXIT_INCOMPLETE)

    def test_non_json_fails_closed(self):
        self.assertEqual(self.code("not json at all"), gate.EXIT_INCOMPLETE)

    def test_json_array_fails_closed(self):
        self.assertEqual(self.code("[]"), gate.EXIT_INCOMPLETE)

    def test_empty_file_fails_closed(self):
        self.assertEqual(self.code(""), gate.EXIT_INCOMPLETE)

    def test_missing_file_fails_closed(self):
        self.assertEqual(gate.evaluate(self.dir / "absent.json")[0], gate.EXIT_INCOMPLETE)

    def test_unknown_threshold_fails_closed(self):
        self.assertEqual(self.code(results([]), "CRITICAL"), gate.EXIT_INCOMPLETE)

    # --- findings removed by upstream's LLM false-positive filter ---
    def test_filtered_high_finding_is_warned_not_blocking(self):
        removed = {"finding": {"file": "b.ts", "line": 9, "severity": "HIGH", "description": "ssrf"}, "reason": "fp"}
        data = results([], filtering_summary={"excluded_findings_details": [removed]})
        code, lines = gate.evaluate(self.write(data))
        self.assertEqual(code, gate.EXIT_PASS)
        self.assertTrue(any(line.startswith("::warning ") and "false-positive filter" in line for line in lines))
        self.assertIn("1 at or above the threshold were removed", lines[-1])

    def test_filtered_low_finding_is_not_warned(self):
        data = results([], filtering_summary={"excluded_findings_details": [{"finding": {"severity": "LOW"}}]})
        _, lines = gate.evaluate(self.write(data))
        self.assertFalse(any(line.startswith("::warning ") for line in lines))

    def test_directory_excluded_high_finding_bare_shape_is_warned(self):
        # Upstream records directory-excluded findings bare, without a {"finding": ...} wrapper.
        bare = {"file": "x/.cache/e.ts", "line": 2, "severity": "HIGH", "description": "rce"}
        data = results([], filtering_summary={"excluded_findings_details": [bare]})
        code, lines = gate.evaluate(self.write(data))
        self.assertEqual(code, gate.EXIT_PASS)
        self.assertTrue(any(line.startswith("::warning file=x/.cache/e.ts,line=2") for line in lines))

    def test_upstream_top_level_output_shape(self):
        # The keys upstream's github_action_audit.py prints: pr_number, repo, findings,
        # analysis_summary (the model's own object) and filtering_summary.
        data = {
            "pr_number": 12,
            "repo": "owner/name",
            "findings": [],
            "analysis_summary": {"files_reviewed": 4, "high_severity": 0, "review_completed": True},
            "filtering_summary": {"total_original_findings": 0, "excluded_findings": 0, "kept_findings": 0,
                                  "filter_analysis": {}, "excluded_findings_details": []},
        }
        self.assertEqual(self.code(data), gate.EXIT_PASS)
        data["findings"] = [{"file": "a.py", "line": 1, "severity": "HIGH", "category": "sqli",
                             "description": "d", "exploit_scenario": "e", "recommendation": "r", "confidence": 0.9}]
        self.assertEqual(self.code(data), gate.EXIT_FINDINGS)

    def test_malformed_filtering_summary_is_ignored_safely(self):
        self.assertEqual(self.code(results([], filtering_summary="nope")), gate.EXIT_PASS)

    # --- annotations: finding text is model output steered by PR content ---
    def test_annotation_names_file_and_line(self):
        finding = {"file": "web/x.ts", "line": 12, "severity": "HIGH", "description": "multi\nline"}
        _, lines = gate.evaluate(self.write(results([finding])))
        self.assertIn("file=web/x.ts,line=12", lines[0])
        self.assertIn("multi line", lines[0])

    def test_workflow_command_injection_is_escaped(self):
        finding = {
            "file": "a.ts,line=1::stop-commands::x\n::add-mask::y",
            "line": "7; rm -rf",
            "severity": "HIGH\n::error::forged",
            "description": "x\r\n::stop-commands::tok 100%",
        }
        code, lines = gate.evaluate(self.write(results([finding])))
        self.assertEqual(code, gate.EXIT_FINDINGS)
        for line in lines:
            self.assertNotIn("\n", line)
            self.assertNotIn("\r", line)
        first = lines[0]
        # A command is only parsed at the start of a line, and there is only one line.
        self.assertTrue(first.startswith("::error "))
        # The properties section (between the first two "::") must hold exactly three
        # properties and no raw ":" or "," smuggled in from the finding.
        properties = first[len("::error "):].split("::", 1)[0]
        self.assertEqual(properties.count(","), 2)
        self.assertNotIn(":", properties)
        self.assertIn("line=1,", first)  # non-integer line falls back to 1
        self.assertIn("100%25", first)

    def test_description_is_truncated(self):
        finding = {"severity": "HIGH", "description": "A" * 5000}
        _, lines = gate.evaluate(self.write(results([finding])))
        self.assertLessEqual(len(lines[0]), gate.MAX_DESCRIPTION + 200)

    def test_incomplete_message_is_escaped(self):
        _, lines = gate.evaluate(self.write({"error": "boom\n::stop-commands::t"}))
        self.assertNotIn("\n", lines[0])

    def test_main_uses_exit_codes(self):
        path = self.write(results([{"severity": "HIGH"}]))
        # Capture stdout: main() prints "::error::" workflow commands, which GitHub would
        # otherwise show as error annotations on a passing self-test job.
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(gate.main(["gate", str(path)]), gate.EXIT_FINDINGS)
            self.assertEqual(gate.main(["gate", str(path), ""]), gate.EXIT_FINDINGS)  # empty arg -> default HIGH
        self.assertIn("::error::Security review gate FAILED", out.getvalue())


if __name__ == "__main__":
    unittest.main()

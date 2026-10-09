"""Tests for the "Langfuse" text guard (CHG-2026-146, ADR-0029).

Run from the repository root, standard library only::

    python3 -m unittest discover -s scripts/ci/tests -v

They pin the matching rules (the same as the scan recorded in ADR-0029) and
the baseline logic: a hit is new only beyond what the baseline allows for that
file and category, moved lines are not new, and --shrink only ever removes.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import check_langfuse_text as guard  # noqa: E402


class ScannedPaths(unittest.TestCase):
    def test_in_scope(self):
        for path in [
            "web/src/features/x/Banner.tsx",
            "web/src/pages/api/docs.ts",
            "packages/shared/src/server/a.js",
            "worker/src/app.jsx",
            "web/src/features/slack/app_manifest.json",
            "web/src/content/page.mdx",
            "web/src/static/page.html",
        ]:
            self.assertTrue(guard.is_scanned_path(path), path)

    def test_out_of_scope(self):
        for path in [
            "web/public/index.html",  # not a root
            "ee/src/a.ts",
            "web/src/ee/features/a.tsx",  # Enterprise code
            "worker/src/ee/a.ts",
            "web/src/__tests__/a.ts",
            "web/src/__e2e__/a.spec.ts",
            "web/src/a.test.ts",
            "web/src/a.spec.tsx",
            "web/src/a.clienttest.tsx",
            "web/src/a.servertest.ts",
            "web/src/a.stories.tsx",
            "packages/shared/src/node_modules/x/a.js",
            "packages/shared/src/generated/a.ts",
            "web/src/.next/a.js",
            "web/src/README.md",
            "web/src/styles.css",
            "web/src/config.mts",
            "web/srcx/a.ts",
        ]:
            self.assertFalse(guard.is_scanned_path(path), path)


class LineRules(unittest.TestCase):
    def test_visible_text(self):
        for line in [
            "Langfuse just got an update",
            '  title="Maintained by Langfuse"',
            'heading="Langfuse-managed evaluators"',
            "{isLangfuse ? 'Langfuse' : 'User'}",
        ]:
            self.assertEqual(guard.classify_line(line), ["text"], line)

    def test_not_visible_text(self):
        for line in [
            "<LangfuseLogo />",  # identifier
            'import { x } from "@langfuse/shared";',
            "LANGFUSE_INIT_ORG_ID=1",  # setting name
            "langfuse_last_used_auth_method",
            "// Langfuse comment",
            "  /* Langfuse */",
            "   * Langfuse in a doc comment",
            "  {/* Langfuse in JSX */}",
            'import Langfuse from "langfuse";',
            'export { Langfuse } from "langfuse";',
            'const Langfuse = require("langfuse");',
            "LangfuseIcon",
        ]:
            self.assertEqual(guard.classify_line(line), [], line)

    def test_links(self):
        for line in [
            'href="https://langfuse.com/docs"',
            "https://static.langfuse.com/video.mp4",
            "see LANGFUSE.COM",
        ]:
            self.assertEqual(guard.classify_line(line), ["link"], line)

    def test_both(self):
        self.assertEqual(
            guard.classify_line("Learn more about Langfuse at https://langfuse.com/docs"),
            ["text", "link"],
        )

    def test_attribution_line(self):
        self.assertEqual(guard.classify_line("<p>Built on open-source Langfuse (MIT)</p>"), ["attribution"])
        self.assertEqual(
            guard.classify_line("Built on open-source Langfuse (MIT). See Langfuse docs."),
            ["text"],
        )
        self.assertEqual(guard.classify_line("Built on Langfuse (MIT)"), ["text"])

    def test_comment_link_not_counted(self):
        self.assertEqual(guard.classify_line("// https://langfuse.com/docs"), [])

    def test_long_lines_are_fingerprinted_exactly(self):
        short = "x" * guard.LONG_LINE
        self.assertEqual(guard.entry_text(f"  {short}  "), short)
        long_a = "Langfuse " + "a" * 500
        long_b = "Langfuse " + "a" * 499 + "b"
        key_a = guard.entry_text(long_a)
        self.assertTrue(key_a.startswith(long_a[: guard.LONG_LINE_PREFIX] + " ... ["))
        self.assertIn(f"{len(long_a)} chars, sha256 ", key_a)
        self.assertLess(len(key_a), guard.LONG_LINE)
        self.assertEqual(key_a, guard.entry_text("   " + long_a))
        self.assertNotEqual(key_a, guard.entry_text(long_b))

    def test_scan_text_line_numbers_trim_and_crlf(self):
        content = "a\r\n    Langfuse here  \r\nb\r\n<a href='https://langfuse.com'>x</a>\n"
        self.assertEqual(
            guard.scan_text("web/src/a.tsx", content),
            [
                ("web/src/a.tsx", 2, "text", "Langfuse here"),
                ("web/src/a.tsx", 4, "link", "<a href='https://langfuse.com'>x</a>"),
            ],
        )


def hit(path, number, category, text):
    return (path, number, category, text)


class Baseline(unittest.TestCase):
    P = "web/src/a.tsx"

    def test_exact_match_is_clean(self):
        entries = {self.P: {"text": ["Langfuse one", "Langfuse two"]}}
        hits = [hit(self.P, 3, "text", "Langfuse two"), hit(self.P, 9, "text", "Langfuse one")]
        self.assertEqual(guard.compare(entries, hits), ([], []))

    def test_moved_lines_are_not_new(self):
        entries = {self.P: {"text": ["Langfuse one"]}}
        new, stale = guard.compare(entries, [hit(self.P, 120, "text", "Langfuse one")])
        self.assertEqual((new, stale), ([], []))

    def test_new_text_new_file_and_new_category(self):
        entries = {self.P: {"text": ["Langfuse one"]}}
        hits = [
            hit(self.P, 1, "text", "Langfuse one"),
            hit(self.P, 2, "text", "Langfuse new"),
            hit(self.P, 2, "link", "https://langfuse.com"),
            hit("web/src/b.tsx", 5, "text", "Langfuse one"),
        ]
        new, stale = guard.compare(entries, hits)
        self.assertEqual(
            new,
            [
                hit(self.P, 2, "link", "https://langfuse.com"),
                hit(self.P, 2, "text", "Langfuse new"),
                hit("web/src/b.tsx", 5, "text", "Langfuse one"),
            ],
        )
        self.assertEqual(stale, [])

    def test_multiset_extra_copy_is_new_and_reported_last(self):
        entries = {self.P: {"text": ["Langfuse x"]}}
        hits = [hit(self.P, 10, "text", "Langfuse x"), hit(self.P, 4, "text", "Langfuse x")]
        new, stale = guard.compare(entries, hits)
        self.assertEqual(new, [hit(self.P, 10, "text", "Langfuse x")])
        self.assertEqual(stale, [])

    def test_stale_entries_with_counts(self):
        entries = {self.P: {"text": ["Langfuse x", "Langfuse x", "Langfuse y"]}, "web/src/gone.tsx": {"link": ["l"]}}
        new, stale = guard.compare(entries, [hit(self.P, 1, "text", "Langfuse x")])
        self.assertEqual(new, [])
        self.assertEqual(
            stale,
            [
                (self.P, "text", "Langfuse x", 1),
                (self.P, "text", "Langfuse y", 1),
                ("web/src/gone.tsx", "link", "l", 1),
            ],
        )

    def test_shrink_removes_only_stale_and_never_adds(self):
        entries = {self.P: {"text": ["Langfuse x", "Langfuse x", "Langfuse y"]}, "web/src/gone.tsx": {"link": ["l"]}}
        hits = [hit(self.P, 1, "text", "Langfuse x"), hit(self.P, 2, "text", "Langfuse brand new")]
        new, stale = guard.compare(entries, hits)
        shrunk = guard.shrink(entries, stale)
        self.assertEqual(shrunk, {self.P: {"text": ["Langfuse x"]}})
        self.assertEqual(new, [hit(self.P, 2, "text", "Langfuse brand new")])
        # Never adds: every shrunk occurrence was already in the baseline.
        before = guard.entry_rows(entries)
        for row in guard.entry_rows(shrunk):
            self.assertIn(row, before)
        self.assertLessEqual(len(guard.entry_rows(shrunk)), len(before))

    def test_attribution_allowed_once_never_baselined(self):
        line = "<p>Built on open-source Langfuse (MIT)</p>"
        one = [hit("web/src/about.tsx", 3, "attribution", line)]
        self.assertEqual(guard.compare({}, one), ([], []))
        two = one + [hit("web/src/banner.tsx", 8, "attribution", line)]
        new, _ = guard.compare({}, two)
        self.assertEqual(new, sorted(two))
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "b.json"
            file.write_text(json.dumps({"entries": {"web/src/a.tsx": {"attribution": [line]}}}), encoding="utf-8")
            with self.assertRaises(ValueError):
                guard.load_baseline(file)

    def test_counts_per_root_and_total(self):
        rows = [("web/src/a.tsx", "text"), ("web/src/a.tsx", "text"), ("worker/src/b.ts", "link")]
        table = guard.counts(rows)
        self.assertEqual(table["text"]["web/src"], (2, 1))
        self.assertEqual(table["text"]["total"], (2, 1))
        self.assertEqual(table["link"]["worker/src"], (1, 1))
        self.assertEqual(table["link"]["packages/shared/src"], (0, 0))

    def test_load_baseline_rejects_bad_shapes(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "b.json"
            for bad in ['{"entries": []}', '{"entries": {"a": {"other": []}}}', '{"entries": {"a": {"text": [1]}}}', "[]"]:
                file.write_text(bad, encoding="utf-8")
                with self.assertRaises(ValueError, msg=bad):
                    guard.load_baseline(file)


@unittest.skipUnless(shutil.which("git"), "git is not available")
class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        self.write("web/src/a.tsx", "const a = 1;\n<p>Langfuse old</p>\n// Langfuse comment\n")
        self.write("web/src/a.clienttest.tsx", "Langfuse in a test\n")
        self.write("web/src/ee/b.tsx", "Langfuse in Enterprise code\n")
        self.baseline = self.repo / "baseline.json"
        self.baseline.write_text(
            json.dumps({"entries": {"web/src/a.tsx": {"text": ["<p>Langfuse old</p>"]}, "worker/src/gone.ts": {"link": ["https://langfuse.com"]}}}),
            encoding="utf-8",
        )

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, path, content):
        file = self.repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding="utf-8")

    def run_guard(self, *extra):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = guard.main(["--repo", str(self.repo), "--baseline", str(self.baseline), *extra])
        return code, out.getvalue()

    def test_clean_tree_passes_and_reports_stale(self):
        code, out = self.run_guard()
        self.assertEqual(code, 0)
        self.assertIn("Baseline entries that no longer occur: 1", out)
        self.assertIn("No new hits.", out)

    def test_new_text_fails_with_location_and_help(self):
        self.write("web/src/c.tsx", "<p>Welcome to Langfuse</p>\n")
        code, out = self.run_guard()
        self.assertEqual(code, 1)
        self.assertIn("web/src/c.tsx:1 [text] <p>Welcome to Langfuse</p>", out)
        self.assertIn("How to fix:", out)

    def test_shrink_drops_stale_but_never_adds_the_new_hit(self):
        self.write("web/src/c.tsx", "<p>Welcome to Langfuse</p>\n")
        code, _ = self.run_guard("--shrink")
        self.assertEqual(code, 1)
        data = json.loads(self.baseline.read_text(encoding="utf-8"))
        self.assertEqual(data["entries"], {"web/src/a.tsx": {"text": ["<p>Langfuse old</p>"]}})

    def test_missing_baseline_is_a_usage_error(self):
        self.baseline.unlink()
        code, _ = self.run_guard()
        self.assertEqual(code, 2)


class RepositoryBaseline(unittest.TestCase):
    """The committed baseline parses, and its paths are all in scope."""

    def test_committed_baseline_is_well_formed(self):
        file = Path(__file__).resolve().parents[3] / guard.DEFAULT_BASELINE
        data = guard.load_baseline(file)
        for path in data["entries"]:
            self.assertTrue(guard.is_scanned_path(path), path)
        self.assertEqual(data["entries"], guard.normalise_entries(data["entries"]))


if __name__ == "__main__":
    unittest.main()

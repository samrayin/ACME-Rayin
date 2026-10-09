#!/usr/bin/env python3
"""ACME (CHG-2026-146, ADR-0029): no NEW user-visible "Langfuse" text.

EYEON is built on Langfuse. ADR-0029 says the screens say EYEON or use neutral
wording, while internal names and the MIT notice stay as they are. The existing
"Langfuse" text and langfuse.com links are removed in phases; until then this
guard holds the line: it fails on any hit that is not in a frozen baseline
(acme-governance/langfuse-text-baseline.json), so nothing new is added while
the old hits are cleaned up.

Method (the read-only scan recorded in ADR-0029; heuristic, but reproducible):
- Files: tracked (and untracked, not ignored) .ts/.tsx/.js/.jsx/.mdx/.html/.json
  files under web/src, packages/shared/src and worker/src, excluding tests
  (__tests__, __e2e__, *.test.*, *.spec.*, *.clienttest.*, *.servertest.*),
  stories (*.stories.*), Enterprise code (any ee/ directory), generated or
  vendored folders (node_modules, generated, .next) and *.md files.
- Visible text ("text"): a line containing the word "Langfuse" (capital L,
  whole word, so LangfuseLogo, @langfuse/... and LANGFUSE_* do not count) that
  is not a comment line (//, /*, *, {/*) and not an import, export-from or
  require line.
- Links ("link"): a line containing "langfuse.com" (any case, any subdomain),
  with the same file and line exclusions.
- The attribution line "Built on open-source Langfuse (MIT)", which ADR-0029
  allows once, on the About / Open-source licences page: a line whose only
  "Langfuse" is inside that phrase is not "text". It is never baselined, and a
  second copy anywhere in the scan fails the check.

The baseline maps each path to its categories, and each category to a list of
the trimmed line texts (a multiset), so moving lines within a file does not
break it. A hit is new when its text occurs in that file and category more
often than the baseline allows. A trimmed line longer than 240 characters
(test fixtures and prompts hold lines of up to 77,000) is kept as its first 160
characters plus its length and a SHA-256 of the whole line: still an exact
match, without copying those lines into the baseline.

Usage (from anywhere in the repository):
    python3 scripts/ci/check_langfuse_text.py            check; exit 1 on new hits
    python3 scripts/ci/check_langfuse_text.py --shrink   also drop baseline entries
                                                         that no longer occur
    python3 scripts/ci/check_langfuse_text.py --list     print every hit
--shrink only ever removes entries. Nothing in this script adds to the baseline.

Exit codes: 0 = no new hits, 1 = new hits, 2 = usage or baseline error.
Standard library only, like the other ACME CI checks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOTS = ("web/src", "packages/shared/src", "worker/src")
CATEGORIES = ("text", "link")
DEFAULT_BASELINE = "acme-governance/langfuse-text-baseline.json"
LONG_LINE = 240
LONG_LINE_PREFIX = 160

# ADR-0029: the one sanctioned visible mention, for the About / Open-source
# licences page. A line whose only "Langfuse" is inside this exact phrase counts
# as "attribution", not "text": it is never baselined, and the whole scan may
# hold it once. A second copy fails the check.
ATTRIBUTION = "Built on open-source Langfuse (MIT)"
ATTRIBUTION_ALLOWED = 1

CATEGORY_NAMES = {
    "text": 'visible "Langfuse" text',
    "link": "langfuse.com links",
    "attribution": f'copy of the attribution line "{ATTRIBUTION}" (allowed once)',
}

# The same patterns as the scan recorded in ADR-0029.
EXCLUDE = re.compile(
    r"(^|/)(__tests__|__e2e__|ee|node_modules|generated|\.next)(/|$)"
    r"|\.(test|spec|clienttest|servertest|stories)\.[jt]sx?$"
    r"|\.md$"
)
KEEP_EXT = re.compile(r"\.(tsx?|jsx?|mdx|html|json)$")
WORD = re.compile(r"\bLangfuse\b")
LINK = re.compile(r"langfuse\.com", re.I)
COMMENT = re.compile(r"^\s*(//|/\*|\*|\{/\*)")
IMPORT = re.compile(r"^\s*(import\b|export\s+.*\bfrom\b|.*\brequire\()")

HOW_TO_FIX = """How to fix:
- Say EYEON (ACME_PRODUCT_NAME in web/src/features/acme-enhancements/utils/acmeBranding.ts)
  or use neutral wording ("Built-in", "the console", "this project").
- Do not link to langfuse.com: EYEON may run air-gapped, where those links are dead ends.
- Internal names stay as they are (LANGFUSE_* settings, @langfuse/* packages, SDK snippets,
  identifiers). If one is flagged, write it so it is not visible text, or ask the reviewer.
- Never add new text to the baseline by hand. If a file only moved, its existing entries
  move with it under the new path, in the same PR, for the reviewer to check.
See ADR-0029 (acme-governance/adr/ADR-0029-langfuse-text.md)."""


def is_scanned_path(path: str) -> bool:
    """True when a repository path (forward slashes) is in the scan's scope."""
    if not any(path == root or path.startswith(root + "/") for root in ROOTS):
        return False
    return bool(KEEP_EXT.search(path)) and not EXCLUDE.search(path)


def root_of(path: str) -> str:
    for root in ROOTS:
        if path.startswith(root + "/"):
            return root
    return "other"


def classify_line(line: str) -> list[str]:
    """The categories a single source line counts in: none, "text" (or
    "attribution"), "link", or both."""
    if COMMENT.match(line) or IMPORT.match(line):
        return []
    found = []
    if WORD.search(line):
        rest = line.replace(ATTRIBUTION, "")
        found.append("attribution" if rest != line and not WORD.search(rest) else "text")
    if LINK.search(line):
        found.append("link")
    return found


def entry_text(line: str) -> str:
    """How a line is recorded: trimmed, and fingerprinted when very long."""
    text = line.strip()
    if len(text) <= LONG_LINE:
        return text
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    return f"{text[:LONG_LINE_PREFIX]} ... [{len(text)} chars, sha256 {digest}]"


def scan_text(path: str, content: str) -> list[tuple[str, int, str, str]]:
    """Hits in one file's content: (path, line number, category, recorded text)."""
    hits = []
    for number, raw in enumerate(content.split("\n"), start=1):
        line = raw[:-1] if raw.endswith("\r") else raw
        for category in classify_line(line):
            hits.append((path, number, category, entry_text(line)))
    return hits


def list_files(repo: Path) -> list[str]:
    """Tracked files plus untracked files that are not ignored, under the roots."""
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"]
        + list(ROOTS),
        cwd=repo,
        capture_output=True,
        check=True,
    ).stdout
    paths = sorted({p for p in out.decode("utf-8").split("\0") if p})
    return [p for p in paths if is_scanned_path(p) and (repo / p).is_file()]


def scan(repo: Path) -> list[tuple[str, int, str, str]]:
    hits = []
    for path in list_files(repo):
        data = (repo / path).read_bytes()
        if b"\0" in data:  # binary, as git grep -I skips it
            continue
        hits.extend(scan_text(path, data.decode("utf-8", errors="replace")))
    return hits


def hits_to_entries(hits) -> dict[str, dict[str, list[str]]]:
    """Group hits into the baseline's shape: path -> category -> sorted texts."""
    entries: dict[str, dict[str, list[str]]] = {}
    for path, _number, category, text in hits:
        entries.setdefault(path, {}).setdefault(category, []).append(text)
    return normalise_entries(entries)


def normalise_entries(entries) -> dict[str, dict[str, list[str]]]:
    out: dict[str, dict[str, list[str]]] = {}
    for path in sorted(entries):
        cats = {c: sorted(entries[path][c]) for c in CATEGORIES if entries[path].get(c)}
        if cats:
            out[path] = cats
    return out


def load_baseline(file: Path) -> dict:
    with open(file, encoding="utf-8") as handle:
        data = json.load(handle)
    entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, dict):
        raise ValueError('the baseline has no "entries" object')
    for path, cats in entries.items():
        if not isinstance(cats, dict) or not set(cats) <= set(CATEGORIES):
            raise ValueError(f"baseline entry {path!r} must map only {CATEGORIES} to lists")
        for category, texts in cats.items():
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                raise ValueError(f"baseline entry {path!r} {category!r} must be a list of strings")
    return data


def compare(entries, hits):
    """(new hits, stale baseline entries) for a baseline's entries and a scan's hits.

    A text may occur in a file and category as often as the baseline lists it.
    Extra occurrences are new; the later ones by line number are reported.
    Baseline occurrences with no match are stale: (path, category, text, count).
    The attribution line is never baselined: more than ATTRIBUTION_ALLOWED
    copies makes every copy new.
    """
    by_key: dict[tuple[str, str], list[tuple[str, int, str, str]]] = {}
    attributions = []
    for hit in hits:
        if hit[2] == "attribution":
            attributions.append(hit)
        else:
            by_key.setdefault((hit[0], hit[2]), []).append(hit)
    new = list(attributions) if len(attributions) > ATTRIBUTION_ALLOWED else []
    stale = []
    keys = set(by_key) | {(p, c) for p, cats in entries.items() for c in cats}
    for path, category in sorted(keys):
        allowed = Counter(entries.get(path, {}).get(category, []))
        found = sorted(by_key.get((path, category), []), key=lambda h: h[1])
        seen: Counter = Counter()
        for hit in found:
            seen[hit[3]] += 1
            if seen[hit[3]] > allowed[hit[3]]:
                new.append(hit)
        for text, count in sorted(allowed.items()):
            if count > seen[text]:
                stale.append((path, category, text, count - seen[text]))
    new.sort(key=lambda h: (h[0], h[1], h[2]))
    return new, stale


def shrink(entries, stale) -> dict[str, dict[str, list[str]]]:
    """The baseline's entries without the stale occurrences. Never adds anything."""
    remove = Counter({(p, c, t): n for p, c, t, n in stale})
    out: dict[str, dict[str, list[str]]] = {}
    for path, cats in entries.items():
        for category, texts in cats.items():
            kept = []
            for text in texts:
                if remove[(path, category, text)] > 0:
                    remove[(path, category, text)] -= 1
                else:
                    kept.append(text)
            if kept:
                out.setdefault(path, {})[category] = kept
    return normalise_entries(out)


def counts(rows) -> dict[str, dict[str, tuple[int, int]]]:
    """(lines, files) per category and root, plus "total", from hits or baseline rows.

    rows are (path, category) pairs, one per occurrence.
    """
    result: dict[str, dict[str, tuple[int, int]]] = {}
    for category in CATEGORIES:
        per_root: dict[str, tuple[int, int]] = {}
        for root in list(ROOTS) + ["total"]:
            picked = [p for p, c in rows if c == category and (root == "total" or root_of(p) == root)]
            per_root[root] = (len(picked), len(set(picked)))
        result[category] = per_root
    return result


def entry_rows(entries):
    return [(p, c) for p, cats in entries.items() for c, texts in cats.items() for _ in texts]


def print_counts(title: str, table) -> None:
    print(title)
    for category in CATEGORIES:
        parts = []
        for root in list(ROOTS) + ["total"]:
            lines, files = table[category][root]
            parts.append(f"{root} {lines} lines in {files} files")
        print(f"  {CATEGORY_NAMES[category]}: " + "; ".join(parts))


def escape_annotation(value: str, property_value: bool = False) -> str:
    value = value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    if property_value:
        value = value.replace(":", "%3A").replace(",", "%2C")
    return value


def write_baseline(file: Path, data: dict, entries) -> None:
    data = dict(data)
    data["entries"] = entries
    with open(file, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--shrink", action="store_true", help="remove baseline entries that no longer occur")
    parser.add_argument("--list", action="store_true", help="print every hit")
    parser.add_argument("--repo", type=Path, help="repository root (default: this script's repository)")
    parser.add_argument("--baseline", type=Path, help=f"baseline file (default: {DEFAULT_BASELINE})")
    args = parser.parse_args(argv)
    # Source lines may hold any character; a Windows console's code page cannot
    # print them all.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    repo = (args.repo or Path(__file__).resolve().parents[2]).resolve()
    baseline_file = args.baseline or (repo / DEFAULT_BASELINE)
    try:
        data = load_baseline(baseline_file)
    except (OSError, ValueError) as error:
        print(f"error: cannot use the baseline {baseline_file}: {error}", file=sys.stderr)
        return 2
    entries = normalise_entries(data["entries"])

    hits = scan(repo)
    new, stale = compare(entries, hits)
    in_ci = os.environ.get("GITHUB_ACTIONS") == "true"

    print('EYEON "Langfuse" text guard (ADR-0029, CHG-2026-146)')
    print("Roots: " + ", ".join(ROOTS))
    print_counts("Found in this tree:", counts([(h[0], h[2]) for h in hits]))
    print_counts("Baseline (allowed):", counts(entry_rows(entries)))
    attributions = sum(1 for h in hits if h[2] == "attribution")
    print(f'Attribution line "{ATTRIBUTION}": {attributions} (allowed: {ATTRIBUTION_ALLOWED})')

    if args.list:
        print("\nEvery hit:")
        for path, number, category, text in sorted(hits):
            print(f"  {path}:{number} [{category}] {text}")

    if stale:
        total = sum(s[3] for s in stale)
        print(f"\nBaseline entries that no longer occur: {total}")
        for path, category, text, count in stale:
            suffix = f" (x{count})" if count > 1 else ""
            print(f"  {path} [{category}] {text}{suffix}")
        if args.shrink:
            shrunk = shrink(entries, stale)
            write_baseline(baseline_file, data, shrunk)
            print(f"Removed them from {baseline_file}.")
            print_counts("Baseline after --shrink:", counts(entry_rows(shrunk)))
        else:
            print("Run with --shrink to remove them, and commit the smaller baseline.")
            if in_ci:
                print(
                    f"::warning::Baseline entries that no longer occur: {total}. Run "
                    "scripts/ci/check_langfuse_text.py --shrink and commit the smaller baseline."
                )
    elif args.shrink:
        print("\nNothing to shrink: every baseline entry still occurs.")

    if new:
        print(f"\nNew hits not in the baseline: {len(new)}")
        for path, number, category, text in new:
            print(f"  {path}:{number} [{category}] {text}")
            if in_ci:
                message = f"New {CATEGORY_NAMES[category]} (ADR-0029): {text}"
                print(
                    f"::error file={escape_annotation(path, True)},line={number}::"
                    + escape_annotation(message)
                )
        print()
        print(HOW_TO_FIX)
        return 1

    print("\nNo new hits.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

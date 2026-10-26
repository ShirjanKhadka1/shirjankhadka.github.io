#!/usr/bin/env python3
"""One-time chain-swap for the 38 in-scope blog articles (ROUTE A).

Replaces ONLY asset-chain lines in each article's <head>/scripts:
  - DELETE the ../../css/style.css link line (retired old kit)
  - DELETE the css/theme.css link line (retired old kit)
  - BUMP nd-chrome.css to the current raw-SHA-1 stamp (path form kept)
  - INSERT /css/nd-cinema.css (current stamp) after nd-editorial-theme
  - INSERT /css/nd-blog.css (current stamp) after nd-chrome.css
  - REPLACE ../../js/main.js with /js/nd-blog.js (current stamp);
    articles without main.js get nd-blog.js appended after nd-chrome.js
Article TEXT, titles, dates, figures and every other line are untouched.
The script verifies per article that the diff contains ONLY chain lines
and prints a per-article stat. It refuses to write an article whose
post-swap diff contains any non-chain line.

Usage: python3 tools/chain-swap-blog.py [--dry-run]
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRY = "--dry-run" in sys.argv


def sha1_8(path):
    return hashlib.sha1(Path(path).read_bytes()).hexdigest()[:8]


CHROME = sha1_8(ROOT / "css/nd-chrome.css")
CINEMA = sha1_8(ROOT / "css/nd-cinema.css")
BLOG_CSS = sha1_8(ROOT / "css/nd-blog.css")
BLOG_JS = sha1_8(ROOT / "js/nd-blog.js")

STYLE_RE = re.compile(r'^.*<link rel="stylesheet" href="[^"]*css/style\.css\?v=[a-f0-9]+"[^>]*>\n?', re.M)
THEME_RE = re.compile(r'^.*<link rel="stylesheet" href="[^"]*css/theme\.css\?v=[a-f0-9]+"[^>]*>\n?', re.M)
EDITORIAL_RE = re.compile(r'^(.*<link rel="stylesheet" href="[^"]*css/nd-editorial-theme\.css\?v=[a-f0-9]+"[^>]*>)', re.M)
CHROME_RE = re.compile(r'^(.*<link rel="stylesheet" href="[^"]*css/nd-chrome\.css\?)v=[a-f0-9]+("[^>]*>)', re.M)
MAIN_RE = re.compile(r'^(.*<script src="[^"]*js/main\.js\?v=[a-f0-9]+"[^>]*></script>)', re.M)
CHROME_JS_RE = re.compile(r'^(.*<script src="[^"]*js/nd-chrome\.js\?v=[a-f0-9]+"[^>]*></script>)', re.M)

CHAIN_PATTERNS = ("css/style.css", "css/theme.css", "css/nd-chrome.css",
                  "css/nd-cinema.css", "css/nd-blog.css", "js/main.js", "js/nd-blog.js")


def is_chain_line(line):
    return any(p in line for p in CHAIN_PATTERNS)


def swap(text, slug):
    orig = text
    ops = []
    text, n = STYLE_RE.subn("", text)
    if n:
        ops.append(f"removed style.css x{n}")
    text, n = THEME_RE.subn("", text)
    if n:
        ops.append(f"removed theme.css x{n}")
    if 'css/nd-cinema.css' not in text:
        text, n = EDITORIAL_RE.subn(r'\1\n  <link rel="stylesheet" href="/css/nd-cinema.css?v=' + CINEMA + '">', text)
        if n:
            ops.append("inserted nd-cinema.css")
    text, n = CHROME_RE.subn(r'\1v=' + CHROME + r'\2', text)
    if n:
        ops.append(f"bumped nd-chrome.css to {CHROME}")
    if 'css/nd-blog.css' not in text:
        text, n = CHROME_RE.subn(r'\1v=' + CHROME + r'\2\n  <link rel="stylesheet" href="/css/nd-blog.css?v=' + BLOG_CSS + '">', text, count=1)
        if n:
            ops.append("inserted nd-blog.css")
    js_skipped = False
    if 'js/nd-blog.js' not in text:
        text, n = MAIN_RE.subn('<script src="/js/nd-blog.js?v=' + BLOG_JS + '" defer></script>', text)
        if n:
            ops.append("replaced main.js with nd-blog.js")
        else:
            text, n = CHROME_JS_RE.subn(r'\1\n<script src="/js/nd-blog.js?v=' + BLOG_JS + '" defer></script>', text, count=1)
            if n:
                ops.append("appended nd-blog.js after nd-chrome.js (no main.js)")
            else:
                # No script tail at all (truncated upstream file): CSS chain
                # only. Appending scripts at EOF would invent structure the
                # publisher must rebuild; the article stays readable and the
                # progress bar stays inert (scaleX 0). Flagged, not repaired.
                js_skipped = True
                ops.append("SKIPPED js: no script tail (truncated upstream file)")
    return text, ops, orig, js_skipped


def diff_chain_only(before, after):
    """True iff every differing line is a chain line."""
    import difflib
    for line in difflib.unified_diff(before.splitlines(), after.splitlines(), lineterm=""):
        if line.startswith(("---", "+++", "@@")):
            continue
        if line[:1] in "+-" and not is_chain_line(line[1:]):
            return False, line
    return True, None


def main():
    idx = json.loads((ROOT / "data/blog-index.json").read_text())
    scope = sorted(a["slug"] for a in idx["articles"] if a["in_scope"])
    print(f"stamps: chrome={CHROME} cinema={CINEMA} blog-css={BLOG_CSS} blog-js={BLOG_JS}")
    print(f"scope: {len(scope)} articles")
    bad = 0
    for slug in scope:
        path = ROOT / "blog" / slug / "index.html"
        before = path.read_text()
        after, ops, _, js_skipped = swap(before, slug)
        ok, offending = diff_chain_only(before, after)
        removed = sum(1 for line in before.splitlines() if line not in after.splitlines())
        added = sum(1 for line in after.splitlines() if line not in before.splitlines())
        status = "OK" if ok else "NON-CHAIN-DIFF"
        if not ok:
            bad += 1
        print(f"{status} {slug}: -{removed} +{added} :: {'; '.join(ops)}"
              + ("" if ok else f" :: OFFENDING: {offending[:120]}"))
        if ok and not DRY:
            path.write_text(after)
        # Post-swap invariants
        post = after
        assert "css/style.css" not in post, slug
        assert "css/theme.css" not in post, slug
        assert "css/nd-blog.css" in post, slug
        assert "js/main.js" not in post, slug
        assert f"nd-chrome.css?v={CHROME}" in post, slug
        if not js_skipped:
            assert "js/nd-blog.js" in post, slug
    print(f"done: {len(scope) - bad}/{len(scope)} chain-only" + (" (dry run, nothing written)" if DRY else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

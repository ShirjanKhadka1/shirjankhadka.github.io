#!/usr/bin/env python3
"""set-asset-version.py — unify every site asset cache-bust version.

    python3 tools/set-asset-version.py [TOKEN] [--check]

Rewrites the ?v= value on every same-site .css/.js reference to ONE token
(default: today's release token, passed as argv[1] — e.g. 20261023c) in:

  * *.html files      — src=/href= attribute values (third-party URLs,
                        i.e. http://, https:// and protocol-relative //,
                        are NEVER touched; non-css/js URLs are untouched)
  * *.js files        — string literals like '/js/nepse-daily.js?v=20261023d'
  * tools/*.js, *.py  — the page generators emit asset references with
                        hardcoded versions; rewriting them too means the
                        next regeneration comes out unified instead of
                        re-fragmenting the versions.

tests/ is excluded (fixtures must stay byte-stable) and so is .git.
Two tools are excluded by name: tools/rollout-g2-transform.py (a completed
one-off migration whose version constants are historical record — rewriting
them would corrupt its find/replace pairs) and
tools/update-asset-versions.py (the older content-hash versioning tool;
it computes stamps at runtime and its docstring examples are not asset
references). Markdown notes are never touched — their ?v= mentions are
historical prose, not references.

FUTURE FLOW (how this stays unified):
  1. Pick ONE token per release (date + letter, e.g. 20261023c).
  2. After any page-generator run (stock pages, wrap archive, actions,
     signals) and before committing, run this script with that token.
  3. Commit the result together with the asset changes. Browsers then
     hold exactly one cached copy of each asset per release instead of
     one per historical version string (the 2026-10-23 audit found 102
     distinct versions; Waves A/G/D brought the tree to this one).

--check changes nothing and exits non-zero unless the distinct literal
?v= values across the processed scope are exactly {TOKEN}.
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKIP_DIRS = {".git", "tests", "node_modules"}
SKIP_FILES = {"tools/rollout-g2-transform.py", "tools/update-asset-versions.py"}
TOKEN_DEFAULT = "20261023c"

ATTR_RE = re.compile(r"""((?:src|href)\s*=\s*)(["'])([^"']*)\2""")
ASSET_Q_RE = re.compile(r"(\.(?:css|js))\?v=([^&\"']*)")
LITERAL_RE = re.compile(r"(\.(?:css|js))\?v=([A-Za-z0-9._-]+)")


def is_third_party(url):
    return url.startswith(("http://", "https://", "//"))


def rewrite_html(text, token):
    n = 0

    def sub(m):
        nonlocal n
        prefix, quote, url = m.group(1), m.group(2), m.group(3)
        if is_third_party(url):
            return m.group(0)
        new, k = ASSET_Q_RE.subn(lambda mm: mm.group(1) + "?v=" + token, url)
        n += k
        return prefix + quote + new + quote

    return ATTR_RE.sub(sub, text), n


def rewrite_literals(text, token):
    return LITERAL_RE.subn(lambda mm: mm.group(1) + "?v=" + token, text)


def iter_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, ROOT)
            if rel.replace(os.sep, "/") in SKIP_FILES:
                continue
            if fn.endswith(".html"):
                yield p, rel, "html"
            elif fn.endswith(".js") and (rel.startswith("js" + os.sep)
                                         or rel.startswith("tools" + os.sep)):
                yield p, rel, "literal"
            elif fn.endswith(".py") and rel.startswith("tools" + os.sep):
                yield p, rel, "literal"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check_only = "--check" in sys.argv
    token = args[0] if args else TOKEN_DEFAULT

    changed_files = 0
    total_rewrites = 0
    for path, rel, kind in iter_files():
        try:
            with open(path, "r", encoding="utf-8", newline="") as f:
                text = f.read()
        except (UnicodeDecodeError, OSError) as e:
            print("skip (unreadable): %s (%s)" % (rel, e))
            continue
        if kind == "html":
            new, n = rewrite_html(text, token)
        else:
            new, n = rewrite_literals(text, token)
        if n and new != text:
            changed_files += 1
            total_rewrites += n
            if not check_only:
                with open(path, "w", encoding="utf-8", newline="") as f:
                    f.write(new)

    # Verification: distinct literal ?v= values left in the processed scope.
    remaining = {}
    for path, rel, kind in iter_files():
        try:
            with open(path, "r", encoding="utf-8", newline="") as f:
                text = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        for m in re.finditer(r"\.(?:css|js)\?v=([A-Za-z0-9._-]+)", text):
            if kind == "html":
                # only count attribute contexts in html (skip inline text)
                pass
            remaining.setdefault(m.group(1), 0)
            remaining[m.group(1)] += 1

    print("token: %s" % token)
    print("files changed: %d, references rewritten: %d"
          % (changed_files, total_rewrites))
    print("distinct ?v= values in scope afterwards: %s"
          % (sorted(remaining) if remaining else "[]"))
    if check_only:
        ok = set(remaining) == {token}
        print("check: %s" % ("OK — exactly one version" if ok else "FAIL"))
        return 0 if ok else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

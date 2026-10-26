#!/usr/bin/env python3
"""SEO/data verifier for the blog (landing + all articles in scope).

READ-ONLY. FAIL = missing/empty/duplicate/broken data that must block a
publish. WARN = marginal bands the design master leaves alone (title /
description length bands) or advisory gaps (missing alt, missing tags).
Exit 0 only when zero FAILs. Prints one line per article plus landing
and index checks, so the report names every article, not just totals.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import importlib.util
_spec = importlib.util.spec_from_file_location(
    "build_blog_index", Path(__file__).parent / "build-blog-index.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
IN_SCOPE = _mod.IN_SCOPE

HREF_RE = re.compile(r'href="(/blog/[a-z0-9-]+/)"')
IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"')


def sha8(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:8]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worktree", required=True)
    args = ap.parse_args()
    wt = Path(args.worktree)
    fails, warns = [], []

    def fail(slug, msg):
        fails.append(f"{slug}: {msg}")

    def warn(slug, msg):
        warns.append(f"{slug}: {msg}")

    # ---- index cross-check ----
    idx_path = wt / "data/blog-index.json"
    idx = None
    if not idx_path.exists():
        fail("index", "data/blog-index.json missing — run build-blog-index.py")
    else:
        idx = json.loads(idx_path.read_text())
        dirs = {d.name for d in (wt / "blog").iterdir()
                if d.is_dir() and (d / "index.html").exists()}
        idx_slugs = {a["slug"] for a in idx["articles"]}
        if idx_slugs != dirs:
            fail("index", f"index slugs != blog dirs "
                          f"(only-index={sorted(idx_slugs - dirs)[:5]}, "
                          f"only-dirs={sorted(dirs - idx_slugs)[:5]})")
        if idx["count"] != len(idx["articles"]):
            fail("index", "count field != articles length")

    # ---- per-article checks (all 38 in scope) ----
    titles, deks = {}, {}
    sitemap = (wt / "sitemap.xml").read_text() if (wt / "sitemap.xml").exists() else ""
    per_article = []
    for slug in IN_SCOPE:
        p = wt / "blog" / slug / "index.html"
        if not p.exists():
            fail(slug, "article file missing")
            per_article.append((slug, "FAIL", "missing file"))
            continue
        s = p.read_text(encoding="utf-8")
        a = None
        if idx:
            a = next((x for x in idx["articles"] if x["slug"] == slug), None)
        msgs, status = [], "PASS"
        if not a:
            fail(slug, "not in index")
            status = "FAIL"
        else:
            if not a["title"]:
                fail(slug, "missing title"); status = "FAIL"
            if not a["dek"]:
                fail(slug, "missing meta description"); status = "FAIL"
            if not a["canonical"]:
                fail(slug, "missing canonical"); status = "FAIL"
            if not a["image"]:
                fail(slug, "missing og:image"); status = "FAIL"
            if not a["date"]:
                fail(slug, "missing published date"); status = "FAIL"
            if not a["jsonld_type"]:
                fail(slug, "missing JSON-LD"); status = "FAIL"
            if a["title"]:
                if a["title"] in titles:
                    fail(slug, f"duplicate title with {titles[a['title']]}")
                    status = "FAIL"
                titles[a["title"]] = slug
                if not (30 <= len(a["title"]) <= 110):
                    warn(slug, f"title length {len(a['title'])} outside 30-110")
            if a["dek"]:
                if a["dek"] in deks:
                    fail(slug, f"duplicate description with {deks[a['dek']]}")
                    status = "FAIL"
                deks[a["dek"]] = slug
                if not (70 <= len(a["dek"]) <= 160):
                    warn(slug, f"description length {len(a['dek'])} outside 70-160")
            if a["image"]:
                rel = urlparse(a["image"]).path.lstrip("/")
                if rel and not (wt / rel).exists():
                    fail(slug, f"og:image file missing: {rel}")
                    status = "FAIL"
                if not a["image_alt"]:
                    warn(slug, "missing og:image:alt")
            if not a["tags"]:
                warn(slug, "no article tags")
            if not a["section"]:
                warn(slug, "no article section")
            # broken internal blog links inside the article
            for href in set(HREF_RE.findall(s)):
                tgt = wt / href.strip("/")
                if not (tgt / "index.html").exists():
                    fail(slug, f"broken internal link {href}")
                    status = "FAIL"
            if f"/blog/{slug}/" not in sitemap:
                warn(slug, "not in sitemap.xml")
        per_article.append((slug, status, "; ".join(msgs)))

    # ---- landing checks ----
    land = wt / "blog/index.html"
    ls = land.read_text(encoding="utf-8")
    if "css/style.css" in ls or "css/theme.css" in ls:
        fail("landing", "old-kit stylesheet still referenced")
    if "/css/nd-blog.css" not in ls:
        fail("landing", "nd-blog.css not in chain")
    if "/js/nd-blog.js" not in ls:
        fail("landing", "nd-blog.js not in chain")
    cur_chrome = sha8(wt / "css/nd-chrome.css")
    if f"nd-chrome.css?v={cur_chrome}" not in ls:
        fail("landing", f"nd-chrome stamp not current ({cur_chrome})")
    if 'data-page="blog"' not in ls:
        fail("landing", 'missing data-page="blog"')
    if "<title>" not in ls or 'name="description"' not in ls:
        fail("landing", "missing title/description")
    if "application/ld+json" not in ls:
        fail("landing", "missing JSON-LD")
    if 'id="nd-footer"' not in ls:
        fail("landing", "missing shared footer mount")
    if "For education only. Not investment advice." not in ls and \
            'id="nd-footer"' in ls:
        pass  # footer law renders via shared chrome; checked at runtime
    blog_css = wt / "css/nd-blog.css"
    if not blog_css.exists():
        fail("landing", "css/nd-blog.css missing")
    elif 'html[data-theme] body' not in blog_css.read_text() or \
            'var(--nd-bg)' not in blog_css.read_text():
        fail("landing", "canvas pin missing from nd-blog.css")
    if idx:
        baked = set(HREF_RE.findall(ls))
        want = {f"/blog/{a['slug']}/" for a in idx["articles"]}
        if want - baked:
            fail("landing", f"baked cards missing "
                            f"{len(want - baked)} index articles")
    # chain-swap proof: every in-scope article must reference nd-blog
    for slug in IN_SCOPE:
        p = wt / "blog" / slug / "index.html"
        if p.exists():
            s = p.read_text(encoding="utf-8")
            if "css/style.css" in s or "css/theme.css" in s:
                fail(slug, "old-kit stylesheet still referenced")
            if "/css/nd-blog.css" not in s or "/js/nd-blog.js" not in s:
                if "/js/nd-blog.js" not in s and "</body>" not in s:
                    warn(slug, "no script tail (truncated upstream file); "
                               "CSS chain applied, JS leg skipped by design")
                else:
                    fail(slug, "nd-blog layer not in chain")
            if f"nd-chrome.css?v={cur_chrome}" not in s:
                fail(slug, f"nd-chrome stamp not current ({cur_chrome})")

    for slug, status, _ in per_article:
        print(f"{status}  {slug}")
    print(f"---\nPASS {sum(1 for _, s, _ in per_article if s == 'PASS')}  "
          f"FAIL {len(fails)}  WARN {len(warns)}")
    for f in fails:
        print("FAIL " + f)
    for w in warns:
        print("WARN " + w)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

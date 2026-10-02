#!/usr/bin/env python3
"""Idempotent sitemap.xml upsert for shirjankhadka.com.np.

Adds a <url> entry to the root sitemap.xml only if the URL is not already
present. Never rewrites, reorders, or drops existing entries -- this script
exists so the daily blog job can append new article URLs without risking a
destructive sitemap rewrite (as happened 2026-10-01, dropping 21 entries).

Usage:
    python3 tools/sitemap-upsert.py <url> [<lastmod> [<changefreq> [<priority>]]]
    python3 tools/sitemap-upsert.py --verify   # report count + any duplicate <loc>

Defaults: lastmod=today (UTC), changefreq=monthly, priority=0.9.
"""
import re
import sys
import os
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SM = os.path.join(ROOT, "sitemap.xml")

URL_OPEN = re.compile(r"<url>\s*\n(.*?)\n\s*</url>", re.S)


def load():
    with open(SM, encoding="utf-8") as f:
        return f.read()


def save(xml):
    with open(SM, "w", encoding="utf-8") as f:
        f.write(xml)


def upsert(url, lastmod, changefreq, priority):
    xml = load()
    if re.search(r"<loc>" + re.escape(url) + r"</loc>", xml):
        print(f"present: {url}")
        return
    block = (
        "  <url>\n"
        f"    <loc>{url}</loc>\n"
        f"    <lastmod>{lastmod}</lastmod>\n"
        f"    <changefreq>{changefreq}</changefreq>\n"
        f"    <priority>{priority}</priority>\n"
        "  </url>"
    )
    # Insert new article entries right before the WAVE8 generated block so
    # manually-curated and generated sections stay grouped.
    marker = "  <!-- WAVE8-GENERATED-START -->"
    if marker in xml:
        xml = xml.replace(marker, block + "\n" + marker, 1)
    else:
        xml = xml.replace("</urlset>", block + "\n</urlset>", 1)
    save(xml)
    print(f"added: {url}")


def verify():
    xml = load()
    locs = re.findall(r"<loc>(.*?)</loc>", xml)
    dupes = sorted({u for u in locs if locs.count(u) > 1})
    print(f"urls: {len(locs)}  unique: {len(set(locs))}  duplicates: {dupes or 'none'}")
    return not dupes


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--verify":
        sys.exit(0 if verify() else 1)
    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):
        print(__doc__)
        sys.exit(2)
    url = sys.argv[1]
    lastmod = sys.argv[2] if len(sys.argv) > 2 else date.today().isoformat()
    changefreq = sys.argv[3] if len(sys.argv) > 3 else "monthly"
    priority = sys.argv[4] if len(sys.argv) > 4 else "0.9"
    upsert(url, lastmod, changefreq, priority)


if __name__ == "__main__":
    main()

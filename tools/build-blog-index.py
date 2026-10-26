#!/usr/bin/env python3
"""Build data/blog-index.json from the published blog articles.

READ-ONLY over article files: this script never writes to blog/*.html.
It extracts only author-published metadata (title, dek, dates, section,
tags, image, JSON-LD) plus derived counts (words, reading minutes) and
figures quoted in the article's own meta description (Rs amounts and
percentages only — years, dates and bare counts are never treated as
figures). Related symbols are exact tag matches against the verdicts
symbol set — never fuzzy, never guessed.

Output is deterministic modulo the top-level `generated` timestamp:
articles sort date-desc, slug-asc; JSON keys sorted.
"""
import argparse
import html
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

IN_SCOPE = [
    "nepal-soybean-oil-reexport-trade", "sebon-institutional-investor-policy-2083",
    "nrb-act-amendment-autonomy", "nepal-sovereign-wealth-fund",
    "nepse-bonus-share-listing-explained", "api-equity-research",
    "sypnl-equity-research", "swbbl-equity-research",
    "nepal-bank-nbl-company-analysis",
    "himalayan-laghubitta-hlbsl-company-analysis",
    "city-hotel-limited-company-analysis", "nrb-wallet-limit-50-festival-cash",
    "ippan-opposes-sebon-ipo-rules", "nrb-foreign-exchange-relaxation-explained",
    "sebon-promoter-notice-reversal-explained",
    "sebon-15-day-notice-rule-market-overhang",
    "nepse-capital-gains-tax-cut-explained",
    "sebon-intraday-trading-concept-paper-explained", "nrb-microfinance-crackdown",
    "nepse-finance-committee-capital-market-debate",
    "sebon-broker-strengthening-policy-2083",
    "sebon-promoter-15-day-notice-concept-paper",
    "nepal-remittance-growth-fewer-workers", "nepal-inflation-tripled-explained",
    "adb-cuts-nepal-growth-forecast", "nepal-two-speed-economy",
    "fdi-commitments-plunge-66-percent", "nrb-excess-liquidity",
    "nepal-september-tourist-arrivals-defy-floods", "gold-tola-price-kathmandu",
    "nepal-record-external-surplus-explained", "nrb-rate-cut-monetary-review",
    "nepse-book-closure-dividend-eligibility-explained", "nepse-new-benchmark-index",
    "nepse-ransomware-shutdown-explained", "bhdc-trading-suspension-explained",
    "nea-force-majeure-dana-kushma-seven-hydro-projects",
    "nepse-hydropower-flood-damage-five-companies-disclose",
]

META_RE = re.compile(
    r'<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"', re.S)
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
BODY_START = '<div class="article-body">'
TAGS_START = '<div class="article-tags"'
TAG_STRIP = re.compile(r"<[^>]+>")
WS = re.compile(r"\s+")
RS_RE = re.compile(r"Rs\s*([\d,]+(?:\.\d+)?)\s*(billion|crore|lakh|arab|million)?")
PCT_RE = re.compile(r"([\d,]+(?:\.\d+)?)\s*%")
LD_RE = re.compile(
    r'<script type="application/ld\+json">(.*?)</script>', re.S)


def clean(t):
    return WS.sub(" ", html.unescape(TAG_STRIP.sub(" ", t or ""))).strip()


def extract(path, universe_symbols):
    s = path.read_text(encoding="utf-8")
    metas = {}
    for k, v in META_RE.findall(s):
        metas.setdefault(k, []).append(html.unescape(v))
    og_title = (metas.get("og:title") or [None])[0]
    h1 = H1_RE.search(s)
    title_tag = TITLE_RE.search(s)
    title = og_title or (clean(h1.group(1)) if h1 else None) or (
        clean(title_tag.group(1)).rsplit(" | ", 1)[0] if title_tag else None)
    dek = (metas.get("description") or [None])[0]
    pub = (metas.get("article:published_time") or [None])[0]
    mod = (metas.get("article:modified_time") or [None])[0]
    section = (metas.get("article:section") or [None])[0]
    tags = metas.get("article:tag", [])
    image = (metas.get("og:image") or [None])[0]
    image_alt = (metas.get("og:image:alt") or [None])[0]
    canonical = (metas.get("og:url") or [None])[0]
    bi = s.find(BODY_START)
    ti = s.find(TAGS_START, bi) if bi >= 0 else -1
    body_txt = s[bi + len(BODY_START):ti] if bi >= 0 and ti > bi else ""
    words = len(clean(body_txt).split()) if body_txt else 0
    figures = []
    if dek:
        for m in RS_RE.finditer(dek):
            figures.append({"text": m.group(0),
                            "value": m.group(1).replace(",", ""),
                            "unit": "Rs " + (m.group(2) or "")})
        for m in PCT_RE.finditer(dek):
            figures.append({"text": m.group(0),
                            "value": m.group(1).replace(",", ""),
                            "unit": "%"})
    ld_type, ld_date = None, None
    ld = LD_RE.search(s)
    if ld:
        try:
            obj = json.loads(ld.group(1))
            ld_type = obj.get("@type")
            ld_date = obj.get("datePublished")
        except json.JSONDecodeError:
            ld_type = "UNPARSEABLE"
    rel = [t for t in tags if t in universe_symbols]
    return {
        "slug": path.parent.name,
        "title": title,
        "dek": dek,
        "date": (pub or "")[:10],
        "published": pub,
        "modified": mod,
        "section": section,
        "tags": tags,
        "image": image,
        "image_alt": image_alt,
        "canonical": canonical,
        "words": words,
        "reading_min": max(1, round(words / 200)) if words else 0,
        "figures": figures,
        "related_symbols": rel,
        "jsonld_type": ld_type,
        "jsonld_date": ld_date,
        "in_scope": path.parent.name in IN_SCOPE,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worktree", required=True)
    args = ap.parse_args()
    wt = Path(args.worktree)
    verdicts = json.loads((wt / "nepse-chart/data/verdicts.json").read_text())
    universe = set(verdicts["verdicts"].keys())
    articles = []
    for d in sorted((wt / "blog").iterdir()):
        idx = d / "index.html"
        if d.is_dir() and idx.exists() and d.name != "index.html":
            articles.append(extract(idx, universe))
    # date-desc, slug-asc: slug sort first, then stable date sort keeps it
    articles.sort(key=lambda a: a["slug"])
    articles.sort(key=lambda a: a["date"] or "", reverse=True)
    out = {
        "generated": datetime.now(ZoneInfo("Asia/Kathmandu")).isoformat(),
        "count": len(articles),
        "in_scope_count": sum(1 for a in articles if a["in_scope"]),
        "articles": articles,
    }
    dest = wt / "data/blog-index.json"
    dest.write_text(json.dumps(out, indent=1, sort_keys=True,
                               ensure_ascii=False) + "\n", encoding="utf-8")
    missing = [s for s in IN_SCOPE
               if s not in {a["slug"] for a in articles}]
    print(f"blog-index: {len(articles)} articles "
          f"({out['in_scope_count']} in scope)")
    if missing:
        print("MISSING in-scope slugs: " + ", ".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Bake the /blog/ landing snapshot from data/blog-index.json.

One-time rebuild tool (not a cron piece): the live landing re-renders
from the index JSON client-side, so new articles appear without a
landing rebuild. This script only produces the no-JS snapshot:
featured (newest) + rail (next 4) + ALL grid cards (no-JS full archive;
the JS pager shows 12/page)
from the verdicts batch.

Usage: python3 tools/build-blog-landing.py  (run from the worktree root)
Writes blog/index.html. Deterministic except the baked "as of" date,
which comes from the index's newest article and the wave1 snapshot.
"""
import hashlib
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def sha1_8(path):
    return hashlib.sha1(Path(path).read_bytes()).hexdigest()[:8]


def fmt_date(iso):
    if not iso:
        return ""
    y, m, d = iso[:10].split("-")
    months = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"]
    return f"{months[int(m) - 1]} {int(d)}, {int(y)}"


def esc(s):
    return html.escape(str(s or ""), quote=True)


def money(n):
    if n is None:
        return "—"
    return "Rs " + f"{float(n):,.2f}"


def main():
    idx = json.loads((ROOT / "data/blog-index.json").read_text())
    arts = idx["articles"]
    verdicts = json.loads((ROOT / "nepse-chart/data/verdicts.json").read_text())
    wave1 = json.loads((ROOT / "nepse-chart/data/wave1.json").read_text())
    batch = verdicts.get("asof", "")
    vd = verdicts.get("verdicts", {})

    chrome_stamp = sha1_8(ROOT / "css/nd-chrome.css")
    cinema_stamp = sha1_8(ROOT / "css/nd-cinema.css")
    blog_css_stamp = sha1_8(ROOT / "css/nd-blog.css")
    blog_js_stamp = sha1_8(ROOT / "js/nd-blog.js")
    editorial_stamp = sha1_8(ROOT / "css/nd-editorial-theme.css")

    feat, rail = arts[0], arts[1:5]
    grid = arts  # all 63 baked: no-JS readers get the full archive; the
    # JS pager shows 12/page without rebuilding the grid on first paint
    newest_date = fmt_date(feat.get("date"))
    total = len(arts)

    sections = {}
    for a in arts:
        sections[a.get("section") or "Markets"] = sections.get(a.get("section") or "Markets", 0) + 1
    sec_opts = [f'<option value="All">All sections ({total})</option>']
    for s in sorted(sections):
        sec_opts.append(f'<option value="{esc(s)}">{esc(s)} ({sections[s]})</option>')

    def card(a):
        img = ""
        if a.get("image"):
            img = (f'<div class="mag-fimg"><img loading="lazy" width="1200" height="630" '
                   f'src="{esc(a["image"])}" alt="{esc(a.get("image_alt") or a["title"])}"></div>')
        mins = f' · {a["reading_min"]} min read' if a.get("reading_min") else ""
        return (f'<a class="mag-card reveal" href="/blog/{esc(a["slug"])}/">{img}'
                f'<div class="mag-card-body"><p class="mag-kicker">{esc(a.get("section") or "Markets")}</p>'
                f'<h3>{esc(a["title"])}</h3>'
                f'<p class="mag-dek">{esc(a.get("dek") or "")}</p>'
                f'<p class="mag-meta">{esc(fmt_date(a.get("date")))}{mins}</p></div></a>')

    def rail_row(a):
        img = ""
        if a.get("image"):
            img = (f'<img loading="lazy" width="1200" height="630" src="{esc(a["image"])}" '
                   f'alt="{esc(a.get("image_alt") or a["title"])}">')
        return (f'<a class="mag-row" href="/blog/{esc(a["slug"])}/">{img}<div>'
                f'<h4>{esc(a["title"])}</h4>'
                f'<p class="mag-meta">{esc(fmt_date(a.get("date")))} · {esc(a.get("section") or "")}</p>'
                f'</div></a>')

    feat_mins = f' · {feat["reading_min"]} min read' if feat.get("reading_min") else ""
    feat_img = ""
    if feat.get("image"):
        feat_img = (f'<div class="mag-fimg"><img width="1200" height="630" src="{esc(feat["image"])}" '
                    f'alt="{esc(feat.get("image_alt") or feat["title"])}"></div>')
    feat_html = (f'<a class="mag-featured" href="/blog/{esc(feat["slug"])}/">{feat_img}'
                 f'<p class="mag-kicker">{esc(feat.get("section") or "Markets")}</p>'
                 f'<h3>{esc(feat["title"])}</h3>'
                 f'<p class="mag-dek">{esc(feat.get("dek") or "")}</p>'
                 f'<p class="mag-meta">{esc(fmt_date(feat.get("date")))}{feat_mins}</p></a>')

    start_slugs = ["nepal-two-speed-economy", "nepse-capital-gains-tax-cut-explained",
                   "nepse-ransomware-shutdown-explained"]
    by_slug = {a["slug"]: a for a in arts}
    start_html = ""
    for i, s in enumerate(start_slugs, 1):
        a = by_slug[s]
        start_html += (f'<a class="mag-start-item reveal" href="/blog/{esc(s)}/">'
                       f'<span class="mag-num">{i}</span><div><h4>{esc(a["title"])}</h4>'
                       f'<p>{esc(a.get("dek") or "")}</p></div></a>')

    m = wave1["market"]
    ix = m["index"]
    mkt_change = f'{ix["change"]:+.2f} ({ix["pct"]:+.2f}%)'
    mkt_cls = "up" if ix["change"] > 0 else ("down" if ix["change"] < 0 else "")
    mkt_state = "Session closed" if m.get("close") else "Session open"
    mkt_date = fmt_date(m.get("date") or wave1.get("asof"))

    title = "Market Wrap | Nepse Decode — NEPSE analysis, company research & Nepali economy"
    desc = ("Nepse Decode's market wrap: NEPSE company analyses, market explainers and "
            "Nepali economy breakdowns with real data and cited sources, newest first.")
    og_image = feat.get("image") or "https://shirjankhadka.com.np/assets/images/blog/hlbsl-company-analysis.jpg"

    itemlist = ",\n".join(
        f'    {{"@type": "ListItem", "position": {i + 1}, "url": "https://shirjankhadka.com.np/blog/{esc(a["slug"])}/", "headline": {json.dumps(a["title"])}}}'
        for i, a in enumerate(arts[:12]))  # first page only; full list is in the grid

    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<script>try{{var t=localStorage.getItem('sk-theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t)}}catch(e){{}}</script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <link rel="canonical" href="https://shirjankhadka.com.np/blog/">
  <meta name="theme-color" content="#0A0C10">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Nepse Decode">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="https://shirjankhadka.com.np/blog/">
  <meta property="og:image" content="{esc(og_image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  <meta name="twitter:image" content="{esc(og_image)}">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="stylesheet" href="/css/nd-tokens.css">
  <link rel="stylesheet" href="/css/fonts.css">
  <link rel="stylesheet" href="/css/nd-editorial-theme.css?v={editorial_stamp}">
  <link rel="stylesheet" href="/css/nd-cinema.css?v={cinema_stamp}">
  <link rel="stylesheet" href="/css/nd-chrome.css?v={chrome_stamp}">
  <link rel="stylesheet" href="/css/nd-blog.css?v={blog_css_stamp}">
  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": "Nepse Decode Market Wrap",
    "url": "https://shirjankhadka.com.np/blog/",
    "author": {{ "@type": "Person", "name": "Shirjan Khadka", "url": "https://shirjankhadka.com.np/" }},
    "description": {json.dumps(desc)}
  }}
  </script>
  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Latest market wrap articles",
    "itemListElement": [
{itemlist}
    ]
  }}
  </script>
</head>
<body data-page="blog">

  <a class="skip-link" href="#main">Skip to content</a>

  <div id="nd-header"></div>

  <main id="main">
    <div class="bl-wrap">
      <div class="mag-masthead">
        <p class="kicker">Market Wrap</p>
        <h1>Notes on markets &amp; finance</h1>
        <p class="lede">Writing on the NEPSE and the Nepali financial world. New articles published regularly.</p>
        <p class="bl-countline" id="blCountline">{total} articles · newest {esc(newest_date)}</p>
        <p class="bl-fresh" id="blFreshLine">Loading the article index…</p>
      </div>

      <section class="bl-market" data-bl-market aria-label="NEPSE session">
        <span class="bl-mkt-label">NEPSE</span>
        <span class="bl-mkt-value">{ix["value"]:.2f}</span>
        <span class="bl-mkt-change {mkt_cls}">{esc(mkt_change)}</span>
        <span class="bl-mkt-note">NEPSE · {mkt_state} · as of {esc(mkt_date)}</span>
      </section>

      <!-- NEPSE ticker: rendered from the validated NepseData snapshot by
           /js/nepse-ticker.js. Hidden until real data arrives. -->
      <div class="index-ticker-wrap" id="indexTickerWrap" hidden>
        <div class="index-ticker" aria-label="NEPSE symbol prices">
          <div class="ticker-track" id="indexTickerTrack"></div>
        </div>
        <p class="index-ticker-note" id="indexTickerNote"></p>
      </div>

      <!-- Latest -->
      <section class="mag-section" aria-label="Latest articles">
        <div class="mag-head">
          <h2>Latest</h2>
          <p>The newest analysis, first</p>
        </div>
        <div class="mag-lead">
          <div id="blFeatured">{feat_html}</div>
          <div class="mag-rail">
            <p class="mag-rail-head">More recent</p>
            <div id="blRail">
            {''.join(rail_row(a) for a in rail)}
            </div>
          </div>
        </div>
      </section>

      <!-- Start here: editor's entry path -->
      <section class="mag-section" aria-label="Start here">
        <div class="mag-head">
          <h2>Start here</h2>
          <p>Three pieces that explain the market best</p>
        </div>
        <div class="mag-start">
          {start_html}
        </div>
      </section>

      <!-- All articles: search + filter + sort + pager, rendered from the index -->
      <section class="mag-section" aria-label="All articles">
        <div class="mag-head">
          <h2>All articles</h2>
          <p id="blCount">{total} of {total}</p>
        </div>
        <div class="bl-controls">
          <input type="search" id="blSearch" placeholder="Search titles, deks and tags…" aria-label="Search articles">
          <select id="blSection" aria-label="Filter by section">
            {''.join(sec_opts)}
          </select>
          <select id="blSort" aria-label="Sort order">
            <option value="new">Newest first</option>
            <option value="old">Oldest first</option>
          </select>
        </div>
        <div class="mag-grid" id="blGrid">
          {''.join(card(a) for a in grid)}
        </div>
        <div class="bl-pager">
          <button type="button" id="blPrev" disabled>Prev</button>
          <span class="bl-showing" id="blShowing">Showing 1–{min(12, total)} of {total}</span>
          <button type="button" class="bl-next" id="blNext">Next</button>
        </div>
      </section>


    </div>
  </main>

  <div id="nd-footer"></div>

  <script src="/js/nepse-market-config.js?v=4e6270bd"></script>
  <script src="/js/nepse-format.js?v=a5edf573"></script>
  <script src="/js/nepse-data.js?v=3ff7ecb3"></script>
  <script src="/js/nepse-ticker.js" defer></script>
  <script src="/js/theme-toggle.js?v=6a6a46c6" defer></script>
  <script src="/js/nd-chrome.js?v=74c1c8b7" defer></script>
  <script src="/js/nd-blog.js?v={blog_js_stamp}" defer></script>
</body>
</html>
"""
    (ROOT / "blog/index.html").write_text(doc)
    print(f"wrote blog/index.html ({len(doc)} bytes)")
    print(f"stamps: editorial={editorial_stamp} cinema={cinema_stamp} chrome={chrome_stamp} "
          f"blog-css={blog_css_stamp} blog-js={blog_js_stamp}")
    print(f"featured={feat['slug']} rail={[a['slug'] for a in rail]} grid={len(grid)}")


if __name__ == "__main__":
    sys.exit(main())

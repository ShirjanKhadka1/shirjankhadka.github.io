#!/usr/bin/env python3
"""Build bilingual (EN/NE) Nepse Decode news article pages.

Usage:
    python3 tools/build-bilingual-article.py <story.json>
    python3 tools/build-bilingual-article.py nepse-news/demo-citizens-bank-dividend.json

Input: a story-definition JSON (see schema in README section below).
Outputs (under the repo root):
    blog/<slug>/index.html        English page,  <html lang="en">
    ne/blog/<slug>/index.html     Nepali page,   <html lang="ne">
    blog/sitemap-news.xml         extended with both URLs (+ <lastmod>)

Spec: research_notes/newsroom-competitive-study-2026-09-29/spec.md sections 2 (bilingual)
and 5 (SEO checklist). Component order follows the article template at
nepse-news/article-template.html.

Bilingual model: separate URL pairs, no JS toggle, no ?lang= params, no
auto-redirect. Reciprocal hreflang (en / ne / x-default -> EN), self canonical
per language, separate NewsArticle JSON-LD with inLanguage per page.

Story JSON schema (all *_en / *_ne pairs required unless marked optional):
{
  "slug": "citizens-bank-dividend-4-percent",
  "section_en": "Dividends", "section_ne": "labhansh",            # breadcrumb label
  "kicker_en": "News", "kicker_ne": "samachar",
  "headline_en": "...", "headline_ne": "...",
  "dek_en": "...", "dek_ne": "...",
  "seo_title_en": "...", "seo_title_ne": "...",                  # <=60 chars each
  "seo_desc_en": "...", "seo_desc_ne": "...",                    # <=155 chars each
  "author": {"name": "S. Karki", "initials": "SK",
             "role_en": "Markets Reporter", "role_ne": "...",
             "bio_en": "...", "bio_ne": "...",
             "page": "/author/s-karki/"},                        # NE page auto-rewritten to /ne/...
  "published_iso": "2026-09-23T09:15:00+05:45",
  "published_display_en": "23 Sep 2026, 09:15 NPT",
  "published_display_ne": "...",                                 # Devanagari digits in NE prose
  "updated_iso": null,                                           # optional; null => dateModified = published
  "updated_display_en": null, "updated_display_ne": null,        # optional
  "reviewer": {"name_en": "R. Sharma, Editor", "name_ne": "..."},
  "trust": {"label_en": "NEPSE notice - 22 Sep 2026",
            "label_ne": "...",
            "pdf_url": "https://...pdf"},                        # real official PDF required at publish
  "hero": {"alt_en": "...", "alt_ne": "...",
           "caption_en": "...", "caption_ne": "...",
           "credit_en": "Photo: X / Wikimedia Commons (CC BY-SA 4.0).",
           "credit_ne": "..."},                                  # photographer by NAME, never just "Wikimedia"
  "glance_en": ["<strong>3.80%</strong> bonus shares ..."],       # inline HTML allowed
  "glance_ne": ["..."],
  "checked": [{"claim_en": "...", "claim_ne": "...",
               "source_en": "Nepal Stock Exchange (NEPSE)", "source_ne": "...",
               "doc_en": "...", "doc_ne": "...",
               "on_en": "23 Sep 2026 by S. Karki", "on_ne": "...",
               "pdf_url": "https://...pdf"}],
  "body_html_en": "<h2>...</h2><p>...</p><!--math-->...",          # trusted HTML; first company
  "body_html_ne": "...",                                         # mention uses explicit <a class="ticker" href="/stocks/SYM/">SYM</a>
  "math": {"title_en": "...", "title_ne": "...",                 # optional
           "headers_en": ["Component","Math","You receive"], "headers_ne": ["...","...","..."],
           "rows": [{"cells_en": ["a","b","c"], "cells_ne": ["..."], "result": false}],
           "note_en": "...", "note_ne": "..."},
  "takeaways_en": ["..."], "takeaways_ne": ["..."],
  "sources": [{"title_en": "...", "title_ne": "...",
               "authority_en": "Issued via Nepal Stock Exchange.",
               "authority_ne": "...",
               "pdf_url": "https://...pdf"}],
  "tags": [{"label_en": "Citizens Bank", "label_ne": "...", "slug": "citizens-bank"}],
  "related": [{"kind_en": "SAME COMPANY", "kind_ne": "...",
               "title_en": "...", "title_ne": "...",
               "url": "/blog/some-story/"}],                     # /blog/... auto-rewritten to /ne/blog/... on NE page
  "corrections": [],                                             # optional; [{date_en, date_ne, text_en, text_ne}]
  "corrections_email": "corrections@shirjankhadka.com.np",       # optional
  "disclaimer_en": "...", "disclaimer_ne": "...",                # optional; defaults to house disclaimer
  "chrome": {"en": {...}, "ne": {...}}                           # optional per-story chrome overrides
}

Numerals: English prose uses Latin digits + Indian grouping (Rs 1,68,665.00);
Nepali prose uses Devanagari digits + Nepali units (Rs stays "Rs"/"ru" per house
style -- the translator decides; the generator never converts digits).
"""

import html
import json
import os
import re
import sys
from html.parser import HTMLParser
from urllib.parse import quote

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://shirjankhadka.com.np"
BRAND = "Nepse Decode"

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "source", "track", "wbr", "param"}

# ----------------------------------------------------------------------------
# Chrome strings (UI labels). Content lives in the story JSON; these are the
# fixed interface words. A story may override any key via story["chrome"].
# ----------------------------------------------------------------------------
STRINGS = {
    "en": {
        "home": "Home", "news": "News",
        "toggle_current": "EN", "toggle_other": "नेपाली", "toggle_other_lang": "ne",
        "share_label": "Share", "copy_link": "Copy link", "copied": "Copied",
        "glance_title": "At a glance",
        "checked_title": "What we checked",
        "checked_claim": "Claim checked", "checked_source": "Official source",
        "checked_doc": "Document", "checked_on": "Checked on",
        "checked_open": "Open the official document &rarr;",
        "trust_verified": "Verified from official records",
        "view_pdf": "View official PDF &rarr;",
        "takeaways_title": "Why it matters",
        "sources_title": "Official sources",
        "related_title": "Related stories",
        "more_by": "More by {name} &rarr;",
        "corrections_title": "Corrections and updates",
        "no_corrections": "No corrections yet.",
        "corrections_tail": "If you spot an error, {link} and we will check it against the official document.",
        "report_error": "report it",
        "report_error_mailto": "mailto:{email}?subject=Correction: {slug}",
        "comments_title": "Comments",
        "comments_note": "Comments are moderated. Sourcing challenges are welcome and will be answered with links to the official documents.",
        "comments_soon": "Commenting opens at publish",
        "by_published": "Published", "by_updated": "Updated", "by_reviewed": "Reviewed by",
        "updated_none": "not yet",
        "footer_tag": "Beneath the surface. Free forever, no paywall. Ads keep the lights on.",
        "disclaimer_head": "Not investment advice.",
        "disclaimer_body": ("This story reports a verified corporate announcement and explains its "
                            "mechanics. It is not a recommendation to buy, sell or hold any security. "
                            "Market prices move for many reasons; consult a licensed investment adviser before acting."),
    },
    "ne": {
        "home": "होम", "news": "समाचार",
        "toggle_current": "नेपाली", "toggle_other": "EN", "toggle_other_lang": "en",
        "share_label": "सेयर गर्नुहोस्", "copy_link": "लिङ्क कपी गर्नुहोस्", "copied": "कपी भयो",
        "glance_title": "एक नजरमा",
        "checked_title": "हामीले के जाँच्यौँ",
        "checked_claim": "जाँचिएको दाबी", "checked_source": "आधिकारिक स्रोत",
        "checked_doc": "कागजात", "checked_on": "जाँच मिति",
        "checked_open": "आधिकारिक कागजात खोल्नुहोस् &rarr;",
        "trust_verified": "आधिकारिक अभिलेखबाट प्रमाणित",
        "view_pdf": "आधिकारिक PDF हेर्नुहोस् &rarr;",
        "takeaways_title": "किन महत्त्वपूर्ण छ",
        "sources_title": "आधिकारिक स्रोतहरू",
        "related_title": "सम्बन्धित समाचार",
        "more_by": "{name}का थप लेख &rarr;",
        "corrections_title": "सच्याइएका विवरण र अद्यावधिक",
        "no_corrections": "अहिलेसम्म कुनै सच्याइएको छैन।",
        "corrections_tail": "त्रुटि देख्नुभयो भने {link}, हामी आधिकारिक कागजातसँग जाँच्नेछौँ।",
        "report_error": "रिपोर्ट गर्नुहोस्",
        "report_error_mailto": "mailto:{email}?subject=Correction: {slug}",
        "comments_title": "टिप्पणीहरू",
        "comments_note": "टिप्पणीहरू मोडरेट गरिन्छ। स्रोतसम्बन्धी चुनौती स्वागत छ, आधिकारिक कागजातको लिङ्कसहित जवाफ दिइनेछ।",
        "comments_soon": "प्रकाशनसँगै टिप्पणी खुल्नेछ",
        "by_published": "प्रकाशित", "by_updated": "अद्यावधिक", "by_reviewed": "समीक्षा",
        "updated_none": "छैन",
        "footer_tag": "सतहभन्दा गहिरो। सधैँ निःशुल्क, कुनै पेवाल छैन। विज्ञापनले खर्च धान्छ।",
        "disclaimer_head": "लगानी सल्लाह होइन।",
        "disclaimer_body": ("यो समाचारले प्रमाणित कर्पोरेट घोषणाको रिपोर्ट गर्छ र त्यसको "
                            "कार्यविधि बुझाउँछ। कुनै धितोपत्र किन्ने, बेच्ने वा होल्ड गर्ने सिफारिस होइन। "
                            "बजार मूल्य धेरै कारणले चल्छ; कदम चाल्नुअघि इजाजतपत्रप्राप्त लगानी सल्लाहकारसँग परामर्श गर्नुहोस्।"),
    },
}

REQUIRED = ["slug", "kicker_en", "kicker_ne", "headline_en", "headline_ne",
            "dek_en", "dek_ne", "seo_title_en", "seo_title_ne",
            "seo_desc_en", "seo_desc_ne", "author", "published_iso",
            "published_display_en", "published_display_ne",
            "reviewer", "trust", "hero", "glance_en", "glance_ne",
            "checked", "body_html_en", "body_html_ne",
            "takeaways_en", "takeaways_ne", "sources", "tags", "related"]


def esc(s):
    return html.escape(str(s), quote=True)


def S(story, lang, key):
    """Chrome string with per-story override support."""
    ov = (story.get("chrome") or {}).get(lang) or {}
    if key in ov:
        return ov[key]
    return STRINGS[lang][key]


def L(story, lang, base):
    """Language-suffixed story field, e.g. L(story, 'ne', 'headline')."""
    return story[f"{base}_{lang}"]


def page_urls(slug):
    en = f"{SITE}/blog/{slug}/"
    ne = f"{SITE}/ne/blog/{slug}/"
    return en, ne

# ----------------------------------------------------------------------------
# CSS — Private Ledger luxury theme, mirroring nepse-news/article-template.html
# plus Nepali typography hooks (spec section 2): 18px+ / line-height 1.8 on
# Devanagari body copy, NO letter-spacing or uppercase on Devanagari text.
# Font stack: Mukta / Noto Sans Devanagari self-hosted woff2 when available,
# system Devanagari fonts as fallback (see bilingual-notes.md).
# ----------------------------------------------------------------------------
CSS = """
:root{
  --ink:#0C1F16; --pine:#14382A; --emerald:#1E6B4A; --emerald-deep:#155236;
  --gold:#C6A86B; --gold-soft:#E9DCC0; --gold-faint:#F4EDDD;
  --ivory:#FAF8F2; --paper:#FFFFFF;
  --hairline:rgba(12,31,22,.14); --hairline-soft:rgba(12,31,22,.08);
  --muted:#66705F; --faint:#9AA096;
  --radius:16px;
  --shadow:0 12px 40px rgba(12,31,22,.08);
  --serif:'Fraunces',Georgia,'Times New Roman',serif;
  --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  --dev:'Mukta','Noto Sans Devanagari','Nirmala UI','Mangal',sans-serif;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--sans);color:var(--ink);background:var(--ivory);
  -webkit-font-smoothing:antialiased;line-height:1.65;font-size:16px}
img{max-width:100%;height:auto;display:block}
a{color:var(--emerald)}
a:focus-visible{outline:2px solid var(--gold);outline-offset:3px;border-radius:6px}
.topbar{background:rgba(250,248,242,.92);backdrop-filter:blur(14px);
  border-bottom:1px solid var(--hairline);position:sticky;top:0;z-index:50}
.topbar-in{max-width:760px;margin:0 auto;padding:0 20px;height:62px;
  display:flex;align-items:center;gap:12px}
.wordmark{font-family:var(--serif);font-weight:600;font-size:18px;color:var(--ink);
  text-decoration:none;display:flex;align-items:center;gap:9px}
.wordmark .g{color:var(--gold)}
.iceberg{width:26px;height:26px;flex:none}
.article{max-width:760px;margin:0 auto;padding:28px 20px 64px}
.crumb{font-size:12.5px;color:var(--muted);margin-bottom:18px}
.crumb a{color:var(--muted);text-decoration:none}
.crumb a:hover{color:var(--emerald)}
.kicker{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.18em;
  color:var(--emerald-deep);border:1px solid var(--emerald);border-radius:999px;
  padding:5px 14px;margin-bottom:16px;background:#fff}
h1.headline{font-family:var(--serif);font-weight:600;font-size:30px;
  line-height:1.25;letter-spacing:-.01em;margin-bottom:12px}
.dek{font-size:17px;color:#3d4a41;line-height:1.6;margin-bottom:20px;
  border-left:3px solid var(--gold);padding-left:14px}
.lang-toggle{display:flex;align-items:center;gap:10px;font-size:14px;
  margin-bottom:18px;color:var(--muted)}
.lang-toggle a{color:var(--emerald);font-weight:600;text-decoration:none;
  padding:4px 10px;border-radius:8px;border:1px solid var(--hairline)}
.lang-toggle a[aria-current="page"]{background:var(--pine);color:#fff;border-color:var(--pine)}
.lang-toggle .sep{color:var(--faint)}
.byline{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13.5px;color:var(--muted);
  padding:12px 0;border-top:1px solid var(--hairline-soft);
  border-bottom:1px solid var(--hairline-soft);margin-bottom:0}
.byline strong{color:var(--ink);font-weight:600}
.trust{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;
  background:var(--pine);color:#f2f5ef;border-radius:12px;
  padding:13px 16px;margin:14px 0 6px;font-size:14px;line-height:1.5}
.trust .tick{color:var(--gold);font-weight:700}
.trust .doc{color:var(--gold-soft)}
.trust a.btn{margin-left:auto;background:var(--gold);color:var(--ink);
  font-weight:700;font-size:13px;padding:8px 14px;border-radius:999px;
  text-decoration:none;white-space:nowrap}
.trust a.btn:hover{background:var(--gold-soft)}
.share{display:flex;align-items:center;gap:10px;margin:16px 0 22px;font-size:13.5px;color:var(--muted);flex-wrap:wrap}
.share a{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--hairline);
  border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:var(--ink);
  text-decoration:none;background:#fff;cursor:pointer}
.share a:hover{border-color:var(--gold)}
.hero{margin:0 0 8px;border-radius:var(--radius);overflow:hidden;
  box-shadow:var(--shadow);background:#e8e4d8}
.hero picture{display:block}
figcaption{font-size:13px;color:var(--muted);padding:10px 4px 0;line-height:1.55}
figcaption .credit{color:var(--faint)}
.glance{background:#fff;border:1px solid var(--hairline);border-radius:var(--radius);
  padding:20px 22px;margin:26px 0;box-shadow:var(--shadow)}
.glance h2{font-size:13px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--emerald-deep);margin-bottom:12px}
.glance ul{list-style:none}
.glance li{padding:9px 0 9px 26px;position:relative;font-size:15.5px;
  border-bottom:1px solid var(--hairline-soft)}
.glance li:last-child{border-bottom:0}
.glance li::before{content:"";position:absolute;left:2px;top:16px;width:8px;height:8px;
  background:var(--gold);transform:rotate(45deg)}
.glance strong{font-variant-numeric:tabular-nums}
.checked{border:1.5px solid var(--emerald);border-radius:var(--radius);
  padding:20px 22px;margin:26px 0;background:#f4faf6}
.checked h2{font-size:13px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--emerald-deep);margin-bottom:12px}
.checked dl{display:grid;grid-template-columns:130px 1fr;gap:8px 14px;font-size:14.5px;margin-bottom:14px}
.checked dl:last-of-type{margin-bottom:0}
.checked dt{color:var(--muted);font-weight:600}
.checked dd{margin:0}
.checked .doc-link{margin-top:12px}
.checked .doc-link a{font-weight:700}
.body{font-size:16.5px;line-height:1.75;color:#22302a}
.body p{margin:0 0 18px}
.body h2{font-family:var(--serif);font-size:22px;font-weight:600;line-height:1.35;
  margin:34px 0 12px;color:var(--ink)}
.ticker{display:inline-block;font-family:ui-monospace,'SF Mono',Menlo,monospace;
  font-size:.82em;font-weight:700;background:var(--gold-faint);color:var(--pine);
  border:1px solid var(--gold);border-radius:6px;padding:1px 8px;
  text-decoration:none;vertical-align:baseline}
.ticker:hover{background:var(--gold-soft)}
a.claim-src{font-size:.8em;vertical-align:super;text-decoration:none;
  border-bottom:1px dotted var(--emerald)}
.math{background:var(--ink);color:#eef3ec;border-radius:var(--radius);
  padding:22px;margin:26px 0}
.math h3{font-size:13px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--gold);margin-bottom:14px}
.math table{width:100%;border-collapse:collapse;font-size:15px}
.math th,.math td{text-align:left;padding:9px 4px;border-bottom:1px solid rgba(255,255,255,.12);
  font-variant-numeric:tabular-nums}
.math th{color:var(--gold-soft);font-weight:600;font-size:13px}
.math tr:last-child th,.math tr:last-child td{border-bottom:0}
.math .res td{color:var(--gold);font-weight:700}
.math .note{font-size:13px;color:#b9c4b6;margin-top:12px;line-height:1.6}
.takeaways{margin:30px 0;padding:0;list-style:none;counter-reset:tw}
.takeaways li{counter-increment:tw;position:relative;padding:14px 0 14px 54px;
  border-bottom:1px solid var(--hairline-soft);font-size:16px;line-height:1.65}
.takeaways li:last-child{border-bottom:0}
.takeaways li::before{content:counter(tw);position:absolute;left:0;top:12px;
  width:36px;height:36px;border-radius:50%;background:var(--pine);color:#fff;
  font-family:var(--serif);font-weight:600;font-size:16px;
  display:flex;align-items:center;justify-content:center}
.takeaways-head{font-family:var(--serif);font-size:22px;font-weight:600;margin:34px 0 6px}
.sources{background:#fff;border:1px solid var(--hairline);border-radius:var(--radius);
  padding:20px 22px;margin:30px 0}
.sources h2{font-size:13px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--emerald-deep);margin-bottom:12px}
.sources ol{margin-left:20px;font-size:14.5px;line-height:1.7}
.sources li{margin-bottom:10px}
.sources .auth{color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:10px;margin:26px 0}
.tags a{font-size:13.5px;font-weight:600;color:var(--emerald-deep);
  border:1px solid var(--hairline);background:#fff;border-radius:999px;
  padding:7px 15px;text-decoration:none}
.tags a:hover{border-color:var(--gold)}
.related{margin:34px 0}
.related h2{font-family:var(--serif);font-size:22px;font-weight:600;margin-bottom:14px}
.rel-grid{display:grid;gap:14px}
.rel-card{display:flex;gap:14px;background:#fff;border:1px solid var(--hairline);
  border-radius:12px;padding:14px;text-decoration:none;color:var(--ink)}
.rel-card:hover{border-color:var(--gold)}
.rel-card h3{font-size:15px;line-height:1.45;font-weight:600;margin-bottom:4px}
.rel-card .rk{font-size:11.5px;letter-spacing:.12em;color:var(--emerald-deep);font-weight:700}
.author{display:flex;gap:16px;background:var(--pine);color:#eef3ec;
  border-radius:var(--radius);padding:22px;margin:34px 0}
.author .face{width:64px;height:64px;flex:none;border-radius:50%;
  background:var(--gold);color:var(--pine);font-family:var(--serif);
  font-weight:700;font-size:24px;display:flex;align-items:center;justify-content:center}
.author h3{font-size:17px;margin-bottom:4px}
.author .role{font-size:13px;color:var(--gold-soft);margin-bottom:8px}
.author p{font-size:14px;line-height:1.6;color:#cfd8cc}
.author a{color:var(--gold-soft);font-size:13.5px;font-weight:600}
.corrections{border-top:1px solid var(--hairline);margin-top:34px;padding-top:20px;
  font-size:14px;color:var(--muted)}
.corrections h2{font-size:15px;color:var(--ink);margin-bottom:8px}
.corrections a{font-weight:600}
.corrections ul{margin:8px 0 8px 20px}
.disclaimer{background:var(--gold-faint);border-radius:12px;padding:16px 18px;
  font-size:13px;line-height:1.65;color:#5a5240;margin:24px 0}
.comments{border:1px dashed var(--hairline);border-radius:var(--radius);
  padding:22px;margin:24px 0;text-align:center}
.comments h2{font-family:var(--serif);font-size:19px;margin-bottom:8px}
.comments p{font-size:14px;color:var(--muted);max-width:52ch;margin:0 auto 12px}
.comments .soon{display:inline-block;background:#fff;border:1px solid var(--hairline);
  border-radius:999px;padding:8px 18px;font-size:13px;font-weight:600;color:var(--muted)}
footer.site{border-top:1px solid var(--hairline);margin-top:20px;
  padding:26px 20px 40px;text-align:center;font-size:13px;color:var(--muted)}
footer.site .wordmark{justify-content:center;margin-bottom:8px}

/* ---- Nepali typography: Devanagari never gets letter-spacing or uppercase,
   body copy is 18px+ with generous leading (spec section 2). ---- */
html[lang="ne"] .body, html[lang="ne"] .dek, html[lang="ne"] .takeaways li,
html[lang="ne"] .glance li, html[lang="ne"] .author p, html[lang="ne"] .comments p{
  font-family:var(--dev);font-size:18px;line-height:1.8}
html[lang="ne"] h1.headline, html[lang="ne"] .body h2,
html[lang="ne"] .takeaways-head, html[lang="ne"] .related h2,
html[lang="ne"] .comments h2, html[lang="ne"] .author h3{
  font-family:var(--dev);letter-spacing:0}
html[lang="ne"] .kicker, html[lang="ne"] .glance h2, html[lang="ne"] .checked h2,
html[lang="ne"] .sources h2, html[lang="ne"] .math h3, html[lang="ne"] .rel-card .rk{
  letter-spacing:0;text-transform:none;font-family:var(--dev);font-size:14px}
html[lang="ne"] .lang-toggle, html[lang="ne"] .byline, html[lang="ne"] .trust,
html[lang="ne"] .share, html[lang="ne"] figcaption, html[lang="ne"] .checked,
html[lang="ne"] .sources, html[lang="ne"] .tags, html[lang="ne"] .corrections,
html[lang="ne"] .disclaimer{font-family:var(--dev)}

@media (min-width:700px){
  h1.headline{font-size:38px}
  .rel-grid{grid-template-columns:1fr 1fr 1fr}
  .rel-card{flex-direction:column}
  .checked dl{grid-template-columns:170px 1fr}
}
"""

ICEBERG_SVG = ('<svg class="iceberg" viewBox="0 0 32 32" aria-hidden="true">'
               '<path d="M16 3 L26 22 L6 22 Z" fill="#14382A"/>'
               '<path d="M16 3 L21 13 L11 13 Z" fill="#C6A86B"/>'
               '<rect x="4" y="22" width="24" height="3" rx="1.5" fill="#1E6B4A"/></svg>')


# ----------------------------------------------------------------------------
# Component renderers
# ----------------------------------------------------------------------------
def head_block(story, lang, self_url, other_url):
    en_url, ne_url = page_urls(story["slug"])
    other_lang = "ne" if lang == "en" else "en"
    title = f"{L(story, lang, 'seo_title')} | {BRAND}"
    # SEO guard: keep meta/OG descriptions <=180 chars (word boundary).
    def trim180(s):
        s = (s or "").strip()
        if len(s) <= 180: return s
        cut = s[:177].rsplit(" ", 1)[0]
        return cut
    desc = trim180(L(story, lang, "seo_desc"))
    dek = trim180(L(story, lang, "dek"))
    og_img = f"{SITE}/assets/images/blog/{story['slug']}-og.jpg"
    pdfs = []
    for d in story.get("sources", []):
        u = d.get("pdf_url", "")
        if u and not u.startswith("#") and u not in pdfs:
            pdfs.append(u)
    for c in story.get("checked", []):
        u = c.get("pdf_url", "")
        if u and not u.startswith("#") and u not in pdfs:
            pdfs.append(u)
    mod = story.get("updated_iso") or story["published_iso"]
    ld = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": L(story, lang, "headline"),
        "description": L(story, lang, "dek"),
        "image": [og_img],
        "datePublished": story["published_iso"],
        "dateModified": mod,
        "inLanguage": lang,
        "author": {"@type": story["author"].get("type", "Person"), "name": story["author"]["name"],
                   "jobTitle": story["author"][f"role_{lang}"]},
        "publisher": {"@type": "Organization", "name": BRAND,
                      "logo": {"@type": "ImageObject",
                               "url": f"{SITE}/assets/logo.png"}},
    }
    if pdfs:
        ld["citation"] = pdfs
    ld_json = json.dumps(ld, ensure_ascii=False, indent=2)
    return f"""<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{self_url}">
<link rel="alternate" hreflang="en" href="{en_url}">
<link rel="alternate" hreflang="ne" href="{ne_url}">
<link rel="alternate" hreflang="x-default" href="{en_url}">
<meta property="og:type" content="article">
<meta property="og:title" content="{esc(L(story, lang, 'headline'))}">
<meta property="og:description" content="{esc(dek)}">
<meta property="og:image" content="{og_img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{esc(story['hero'][f'alt_{lang}'])}">
<meta property="og:url" content="{self_url}">
<meta property="og:locale" content="{'en_US' if lang == 'en' else 'ne_NP'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0A0C10">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261003a">
<link rel="stylesheet" href="/css/nd-chrome.css?v=20261004a">
<script type="application/ld+json">
{ld_json}
</script>
<style>{CSS}</style>
</head>"""


def toggle_block(story, lang, self_url, other_url):
    other_lang = "ne" if lang == "en" else "en"
    cur = S(story, lang, "toggle_current")
    oth = S(story, lang, "toggle_other")
    return (f'<div class="lang-toggle" aria-label="Language">\n'
            f'    <a href="{self_url}" aria-current="page" lang="{lang}">{esc(cur)}</a>'
            f'<span class="sep">|</span>'
            f'<a href="{other_url}" lang="{other_lang}">{esc(oth)}</a>\n'
            f'  </div>')


def byline_block(story, lang):
    a = story["author"]
    upd = story.get(f"updated_display_{lang}") or S(story, lang, "updated_none")
    reviewer = story["reviewer"][f"name_{lang}"]
    if lang == "ne":
        bits = [f"<strong>{esc(a['name'])}</strong>द्वारा, {esc(a[f'role_{lang}'])}",
                f"{S(story, lang, 'by_published')}: {esc(story[f'published_display_{lang}'])}",
                f"{S(story, lang, 'by_updated')}: {esc(upd)}",
                f"{esc(reviewer)}द्वारा {S(story, lang, 'by_reviewed')}"]
    else:
        bits = [f"By <strong>{esc(a['name'])}</strong>, {esc(a[f'role_{lang}'])}",
                f"{S(story, lang, 'by_published')} {esc(story[f'published_display_{lang}'])}",
                f"{S(story, lang, 'by_updated')}: {esc(upd)}",
                f"{S(story, lang, 'by_reviewed')} {esc(reviewer)}"]
    return '<div class="byline">\n    ' + "\n    ".join(f"<span>{b}</span>" for b in bits) + "\n  </div>"


def trust_block(story, lang):
    t = story["trust"]
    return (f'<div class="trust">\n'
            f'    <span class="tick">&#10003;</span>\n'
            f'    <span>{esc(S(story, lang, "trust_verified"))} &mdash; '
            f'<span class="doc">{esc(t[f"label_{lang}"])}</span></span>\n'
            f'    <a class="btn" href="{esc(t["pdf_url"])}">{S(story, lang, "view_pdf")}</a>\n'
            f'  </div>')


def share_block(story, lang, self_url):
    headline = L(story, lang, "headline")
    q = quote
    fb = f"https://www.facebook.com/sharer/sharer.php?u={q(self_url, safe='')}"
    x = f"https://twitter.com/intent/tweet?text={q(headline, safe='')}&url={q(self_url, safe='')}"
    wa = f"https://wa.me/?text={q(headline + ' ' + self_url, safe='')}"
    copy_label = S(story, lang, "copy_link")
    copied = S(story, lang, "copied")
    return (f'<div class="share" aria-label="{esc(S(story, lang, "share_label"))}">\n'
            f'    <span>{esc(S(story, lang, "share_label"))}</span>\n'
            f'    <a href="{fb}" target="_blank" rel="noopener">Facebook</a>\n'
            f'    <a href="{x}" target="_blank" rel="noopener">X</a>\n'
            f'    <a href="{wa}" target="_blank" rel="noopener">WhatsApp</a>\n'
            f'    <a href="{self_url}" data-copy-link data-copied="{esc(copied)}">{esc(copy_label)}</a>\n'
            f'  </div>')


def hero_block(story, lang):
    slug = story["slug"]
    h = story["hero"]
    base = f"/assets/images/blog/{slug}"
    return (f'<figure class="hero">\n'
            f'    <picture>\n'
            f'      <source type="image/webp" srcset="{base}-800.webp 800w, {base}-1200.webp 1200w, {base}-1600.webp 1600w" sizes="(max-width: 760px) 100vw, 760px">\n'
            f'      <img src="{base}-1200.jpg" srcset="{base}-800.jpg 800w, {base}-1200.jpg 1200w" sizes="(max-width: 760px) 100vw, 760px"\n'
            f'        width="1200" height="630" fetchpriority="high" alt="{esc(h[f"alt_{lang}"])}">\n'
            f'    </picture>\n'
            f'    <figcaption>{h[f"caption_{lang}"]} <span class="credit">{h[f"credit_{lang}"]}</span></figcaption>\n'
            f'  </figure>')


def glance_block(story, lang):
    items = "\n".join(f"      <li>{it}</li>" for it in story[f"glance_{lang}"])
    return (f'<aside class="glance" aria-label="{esc(S(story, lang, "glance_title"))}">\n'
            f'    <h2>{esc(S(story, lang, "glance_title"))}</h2>\n'
            f'    <ul>\n{items}\n    </ul>\n  </aside>')


def checked_block(story, lang):
    parts = [f'<aside class="checked" aria-label="{esc(S(story, lang, "checked_title"))}">',
             f'    <h2>{esc(S(story, lang, "checked_title"))}</h2>']
    for c in story["checked"]:
        parts.append("    <dl>")
        for key, label_key in (("claim", "checked_claim"), ("source", "checked_source"),
                               ("doc", "checked_doc"), ("on", "checked_on")):
            parts.append(f'      <dt>{esc(S(story, lang, label_key))}</dt><dd>{esc(c[f"{key}_{lang}"])}</dd>')
        parts.append("    </dl>")
    first_pdf = story["checked"][0].get("pdf_url", "#")
    parts.append(f'    <p class="doc-link"><a href="{esc(first_pdf)}">{S(story, lang, "checked_open")}</a></p>')
    parts.append("  </aside>")
    return "\n".join(parts)


def math_block(story, lang):
    m = story.get("math")
    if not m:
        return ""
    headers = "".join(f"<th>{esc(h)}</th>" for h in m[f"headers_{lang}"])
    rows = []
    for r in m["rows"]:
        cls = ' class="res"' if r.get("result") else ""
        tds = "".join(f"<td>{c}</td>" for c in r[f"cells_{lang}"])
        rows.append(f"      <tr{cls}>{tds}</tr>")
    note = f'\n      <p class="note">{esc(m[f"note_{lang}"])}</p>' if m.get(f"note_{lang}") else ""
    return (f'<div class="math" aria-label="{esc(m[f"title_{lang}"])}">\n'
            f'      <h3>{esc(m[f"title_{lang}"])}</h3>\n'
            f'      <table>\n        <tr>{headers}</tr>\n' + "\n".join(rows) +
            f'\n      </table>{note}\n    </div>')


def body_block(story, lang):
    html_body = story[f"body_html_{lang}"]
    if "<!--math-->" in html_body:
        html_body = html_body.replace("<!--math-->", math_block(story, lang))
    elif story.get("math"):
        html_body = html_body.rstrip() + "\n" + math_block(story, lang)
    return f'<div class="body">\n{html_body}\n  </div>'


def takeaways_block(story, lang):
    items = "\n".join(f"    <li>{t}</li>" for t in story[f"takeaways_{lang}"])
    return (f'<h2 class="takeaways-head">{esc(S(story, lang, "takeaways_title"))}</h2>\n'
            f'  <ol class="takeaways">\n{items}\n  </ol>')


def sources_block(story, lang):
    items = []
    for s in story["sources"]:
        auth = f' <span class="auth">{esc(s[f"authority_{lang}"])}</span>'
        link = f' <a href="{esc(s["pdf_url"])}">{S(story, lang, "view_pdf")}</a>'
        items.append(f'      <li><strong>{esc(s[f"title_{lang}"])}</strong>.{auth}{link}</li>')
    return (f'<section class="sources" aria-label="{esc(S(story, lang, "sources_title"))}">\n'
            f'    <h2>{esc(S(story, lang, "sources_title"))}</h2>\n'
            f'    <ol>\n' + "\n".join(items) + '\n    </ol>\n  </section>')


def lang_url(url, lang):
    """Rewrite a /blog/ or /author/ URL to its /ne/ counterpart on NE pages."""
    if lang == "ne":
        for prefix in ("/blog/", "/author/", "/tag/"):
            if url.startswith(prefix):
                return "/ne" + url
    return url


def tags_block(story, lang):
    links = "".join(
        f'<a href="{esc(lang_url(f"/tag/{t["slug"]}/", lang))}">{esc(t[f"label_{lang}"])}</a>'
        for t in story["tags"])
    return f'<div class="tags" aria-label="Tags">\n    {links}\n  </div>'


def related_block(story, lang):
    cards = []
    for r in story["related"]:
        url = lang_url(r["url"], lang)
        cards.append(
            f'      <a class="rel-card" href="{esc(url)}">\n'
            f'        <span><span class="rk">{esc(r[f"kind_{lang}"])}</span>'
            f'<h3>{esc(r[f"title_{lang}"])}</h3></span>\n'
            f'      </a>')
    return (f'<section class="related" aria-label="{esc(S(story, lang, "related_title"))}">\n'
            f'    <h2>{esc(S(story, lang, "related_title"))}</h2>\n'
            f'    <div class="rel-grid">\n' + "\n".join(cards) + '\n    </div>\n  </section>')


def author_block(story, lang):
    a = story["author"]
    page = lang_url(a.get("page", "/"), lang)
    more = S(story, lang, "more_by").replace("{name}", esc(a["name"]))
    return (f'<div class="author">\n'
            f'    <span class="face" aria-hidden="true">{esc(a.get("initials", "?"))}</span>\n'
            f'    <div>\n'
            f'      <h3>{esc(a["name"])}</h3>\n'
            f'      <p class="role">{esc(a[f"role_{lang}"])}</p>\n'
            f'      <p>{esc(a[f"bio_{lang}"])}</p>\n'
            f'      <a href="{esc(page)}">{more}</a>\n'
            f'    </div>\n'
            f'  </div>')


def corrections_block(story, lang):
    parts = [f'<section class="corrections" aria-label="{esc(S(story, lang, "corrections_title"))}">',
             f'    <h2>{esc(S(story, lang, "corrections_title"))}</h2>']
    corrs = story.get("corrections") or []
    if corrs:
        parts.append("    <ul>")
        for c in corrs:
            parts.append(f'      <li><strong>{esc(c[f"date_{lang}"])}:</strong> {esc(c[f"text_{lang}"])}</li>')
        parts.append("    </ul>")
    else:
        parts.append(f'    <p>{esc(S(story, lang, "no_corrections"))} '
                     f'{esc(S(story, lang, "by_published"))} {esc(story[f"published_display_{lang}"])}.</p>')
    email = story.get("corrections_email", "corrections@shirjankhadka.com.np")
    mailto = S(story, lang, "report_error_mailto").replace("{email}", email).replace("{slug}", story["slug"])
    link = f'<a href="{esc(mailto)}">{esc(S(story, lang, "report_error"))}</a>'
    parts.append(f'    <p>{S(story, lang, "corrections_tail").replace("{link}", link)}</p>')
    parts.append("  </section>")
    return "\n".join(parts)


def disclaimer_block(story, lang):
    head = story.get(f"disclaimer_head_{lang}") or S(story, lang, "disclaimer_head")
    body = story.get(f"disclaimer_body_{lang}") or S(story, lang, "disclaimer_body")
    return (f'<div class="disclaimer">\n'
            f'    <strong>{esc(head)}</strong> {esc(body)}\n'
            f'  </div>')


def comments_block(story, lang):
    return (f'<section class="comments" aria-label="{esc(S(story, lang, "comments_title"))}">\n'
            f'    <h2>{esc(S(story, lang, "comments_title"))}</h2>\n'
            f'    <p>{esc(S(story, lang, "comments_note"))}</p>\n'
            f'    <span class="soon">{esc(S(story, lang, "comments_soon"))}</span>\n'
            f'  </section>')


def render_page(story, lang):
    en_url, ne_url = page_urls(story["slug"])
    self_url = en_url if lang == "en" else ne_url
    other_url = ne_url if lang == "en" else en_url
    parts = [
        "<!DOCTYPE html>",
        f'<html lang="{lang}">',
        head_block(story, lang, self_url, other_url),
        "<body>",
        '<div id="nd-header"></div>',
        '<main class="article">',
        (f'  <nav class="crumb" aria-label="Breadcrumb"><a href="/">{esc(S(story, lang, "home"))}</a> / '
         f'<a href="/nepse-news/">{esc(S(story, lang, "news"))}</a> / {esc(story[f"section_{lang}"])}</nav>'),
        f'  <p class="kicker">{esc(L(story, lang, "kicker"))}</p>',
        f'  <h1 class="headline">{esc(L(story, lang, "headline"))}</h1>',
        f'  <p class="dek">{esc(L(story, lang, "dek"))}</p>',
        toggle_block(story, lang, self_url, other_url),
        byline_block(story, lang),
        trust_block(story, lang),
        share_block(story, lang, self_url),
        hero_block(story, lang),
        glance_block(story, lang),
        checked_block(story, lang),
        body_block(story, lang),
        takeaways_block(story, lang),
        sources_block(story, lang),
        tags_block(story, lang),
        related_block(story, lang),
        author_block(story, lang),
        corrections_block(story, lang),
        disclaimer_block(story, lang),
        comments_block(story, lang),
        "</main>",
        '<div id="nd-footer"></div>',
        '<script src="/js/nd-chrome.js?v=20261003a" defer></script>',
        """<script>
document.addEventListener('click', function (e) {
  var a = e.target.closest('a[data-copy-link]');
  if (!a) return;
  e.preventDefault();
  var done = function () { a.textContent = a.getAttribute('data-copied'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(a.href).then(done, done);
  } else { done(); }
});
</script>""",
        "</body>",
        "</html>",
    ]
    return "\n".join(parts)

# ----------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------
class WellFormedChecker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append((tag, self.getpos()))

    def handle_startendtag(self, tag, attrs):
        pass  # self-closing: nothing to push

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f"stray </{tag}> at {self.getpos()}")
            return
        if self.stack[-1][0] == tag:
            self.stack.pop()
            return
        # search for a match deeper in the stack (lenient recovery)
        names = [t for t, _ in self.stack]
        if tag in names:
            while self.stack and self.stack[-1][0] != tag:
                bad, pos = self.stack.pop()
                self.errors.append(f"unclosed <{bad}> opened at {pos}, closed by </{tag}>")
            self.stack.pop()
        else:
            self.errors.append(f"stray </{tag}> at {self.getpos()}")

    def close(self):
        super().close()
        for tag, pos in self.stack:
            self.errors.append(f"unclosed <{tag}> opened at {pos}")


def validate_page(html_text, lang, en_url, ne_url):
    """Returns (errors, warnings)."""
    errors, warnings = [], []
    checker = WellFormedChecker()
    checker.feed(html_text)
    checker.close()
    errors.extend(checker.errors)

    h1s = len(re.findall(r"<h1[\s>]", html_text))
    if h1s != 1:
        errors.append(f"expected exactly 1 <h1>, found {h1s}")

    self_url = en_url if lang == "en" else ne_url
    other_url = ne_url if lang == "en" else en_url
    for needle, what in [
        (f'<link rel="canonical" href="{self_url}">', "self canonical"),
        (f'<link rel="alternate" hreflang="en" href="{en_url}">', 'hreflang="en"'),
        (f'<link rel="alternate" hreflang="ne" href="{ne_url}">', 'hreflang="ne"'),
        (f'<link rel="alternate" hreflang="x-default" href="{en_url}">', 'hreflang="x-default"'),
        (f'<html lang="{lang}">', f'html lang="{lang}"'),
        (f'"inLanguage": "{lang}"', f'JSON-LD inLanguage "{lang}"'),
        (f'<a href="{other_url}"', "toggle link to other language"),
        ('aria-current="page"', "aria-current on active toggle"),
    ]:
        if needle not in html_text:
            errors.append(f"missing {what}")

    if f'hreflang="en" href="{ne_url}"' in html_text or f'hreflang="ne" href="{en_url}"' in html_text:
        errors.append("crossed hreflang targets (en points at NE url or vice versa)")

    if 'href="#official-pdf"' in html_text or 'href="#"' in html_text:
        warnings.append("placeholder PDF/anchor link present -- replace with the real official PDF before publish")
    return errors, warnings


def validate_story(story):
    missing = [k for k in REQUIRED if k not in story]
    if missing:
        return [f"story JSON missing required keys: {', '.join(missing)}"]
    errs = []
    for lang in ("en", "ne"):
        if len(story[f"seo_title_{lang}"]) > 60:
            errs.append(f"seo_title_{lang} is {len(story[f'seo_title_{lang}'])} chars (>60)")
        if len(story[f"seo_desc_{lang}"]) > 155:
            errs.append(f"seo_desc_{lang} is {len(story[f'seo_desc_{lang}'])} chars (>155)")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", story["slug"]):
        errs.append("slug must be lowercase ASCII hyphenated")
    for lang in ("en", "ne"):
        h1s = len(re.findall(r"<h1[\s>]", story[f"body_html_{lang}"]))
        if h1s:
            errs.append(f"body_html_{lang} contains <h1> ({h1s}) -- body must not add headings above h2")
    return errs


# ----------------------------------------------------------------------------
# Sitemap (blog/sitemap-news.xml) — upsert both language URLs with <lastmod>
# ----------------------------------------------------------------------------
def update_sitemap(story):
    sm_path = os.path.join(REPO, "blog", "sitemap-news.xml")
    en_url, ne_url = page_urls(story["slug"])
    lastmod = story["published_iso"][:10]
    entries = {}
    if os.path.exists(sm_path):
        xml = open(sm_path, encoding="utf-8").read()
        for m in re.finditer(
                r"<url>\s*<loc>(.*?)</loc>\s*<lastmod>(.*?)</lastmod>"
                r"\s*<changefreq>(.*?)</changefreq>\s*<priority>(.*?)</priority>\s*</url>",
                xml, re.S):
            entries[m.group(1)] = (m.group(2), m.group(3), m.group(4))
    entries[en_url] = (lastmod, "monthly", "0.7")
    entries[ne_url] = (lastmod, "monthly", "0.7")
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc in sorted(entries):
        lm, cf, pr = entries[loc]
        lines.append("  <url>")
        lines.append(f"    <loc>{loc}</loc>")
        lines.append(f"    <lastmod>{lm}</lastmod>")
        lines.append(f"    <changefreq>{cf}</changefreq>")
        lines.append(f"    <priority>{pr}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    os.makedirs(os.path.dirname(sm_path), exist_ok=True)
    open(sm_path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    return sm_path, len(entries)


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    if len(sys.argv) != 2:
        print("usage: python3 tools/build-bilingual-article.py <story.json>", file=sys.stderr)
        sys.exit(2)
    story_path = sys.argv[1]
    if not os.path.isabs(story_path):
        story_path = os.path.join(REPO, story_path)
    story = json.load(open(story_path, encoding="utf-8"))

    story_errors = validate_story(story)
    if story_errors:
        print(json.dumps({"ok": False, "stage": "story", "errors": story_errors}, indent=2))
        sys.exit(1)

    slug = story["slug"]
    en_url, ne_url = page_urls(slug)
    pages = {"en": render_page(story, "en"), "ne": render_page(story, "ne")}

    all_errors, all_warnings = [], []
    for lang, html_text in pages.items():
        e, w = validate_page(html_text, lang, en_url, ne_url)
        all_errors.extend([f"[{lang}] {x}" for x in e])
        all_warnings.extend([f"[{lang}] {x}" for x in w])
    if all_errors:
        print(json.dumps({"ok": False, "stage": "render", "errors": all_errors,
                          "warnings": all_warnings}, indent=2, ensure_ascii=False))
        sys.exit(1)

    out_en = os.path.join(REPO, "blog", slug, "index.html")
    out_ne = os.path.join(REPO, "ne", "blog", slug, "index.html")
    for path, lang in ((out_en, "en"), (out_ne, "ne")):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(pages[lang])

    sm_path, sm_count = update_sitemap(story)
    print(json.dumps({
        "ok": True,
        "slug": slug,
        "en": os.path.relpath(out_en, REPO),
        "ne": os.path.relpath(out_ne, REPO),
        "en_bytes": len(pages["en"].encode("utf-8")),
        "ne_bytes": len(pages["ne"].encode("utf-8")),
        "sitemap": os.path.relpath(sm_path, REPO),
        "sitemap_urls": sm_count,
        "warnings": all_warnings,
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

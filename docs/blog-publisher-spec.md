# Blog publisher spec — design-system chain + SEO contract

**Owner:** the blog-writing agent (article text, `tools/build-bilingual-article.py`,
and all blog publishing crons are theirs). This document is a handoff, NOT an
edit to their builder: adopt these rules on the next article builds and the
pages will match the rebuilt `/blog/` landing automatically.

**What changed on the design side (2026-10-26, ROUTE A):** the `/blog/`
landing was rebuilt on the design system and the 38 listed articles received
a one-time chain-swap (CSS/JS chain lines only — zero text changes). The new
shared layer is `css/nd-blog.css` + `js/nd-blog.js`. The landing renders,
filters, sorts and pages from `data/blog-index.json`, so a new article
appears on the landing as soon as the index rebuilds — no landing edit needed.

## 1. Required chain (every article, every build)

```html
<link rel="stylesheet" href="/css/nd-tokens.css">
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=<stamp>">
<link rel="stylesheet" href="/css/nd-cinema.css?v=<stamp>">
<link rel="stylesheet" href="/css/nd-chrome.css?v=<stamp>">
<link rel="stylesheet" href="/css/nd-blog.css?v=<stamp>">
...
<script src="/js/theme-toggle.js?v=<stamp>" defer></script>
<script src="/js/nd-chrome.js?v=<stamp>" defer></script>
<script src="/js/nd-blog.js?v=<stamp>" defer></script>
```

Rules:

- **Stamps are RAW-content SHA-1, first 8 characters**, recomputed from the
  file bytes at build time. Never copy a stamp from an older build, and
  never use a git blob hash (different hash). Current stamps at the
  2026-10-26 rebuild: chrome `69b323cf`, cinema `857a8acb`,
  editorial `b875f30d` — recompute on every build; these values will move.
- **Never reference `css/style.css` or `css/theme.css` again.** Both are
  retired for the blog family. Never reference `js/main.js` on article
  pages: the progress bar, reveals and share behaviour now live in
  `nd-blog.js`.
- **Do not edit `nd-blog.css` / `nd-blog.js`.** They are owned by the
  design side. If a style or behaviour is missing, flag it; do not fork it.
- **Do not hand-edit baked article output** without mirroring the change
  into the builder (design-master Part 7 rule).

## 2. Required template elements

- `<div class="progress-bar" id="progressBar" aria-hidden="true"></div>`
  immediately after the skip link. Four research articles currently ship
  without it (`api-equity-research`, `sypnl-equity-research`,
  `swbbl-equity-research`, `nepal-bank-nbl-company-analysis`) and get no
  reading-progress bar because of it. Every other template already has it.
- Keep the hand-built `.sf` footer. Its note MUST carry the footer law
  **verbatim** on next builds (currently paraphrased):
  > "For education only. Not investment advice."
  > "Not affiliated with Nepal Stock Exchange Ltd."
- `theme-color` MUST be `#0A0C10` (dark cinema default) on next builds.
  The old `#FAF8F4` is the retired cream surface; the chain-swap left it
  untouched on existing articles by design, but no new article should
  ship it.
- After this deploy lands, the per-article inline `<style>` blocks for
  `.sf`, `.td-toolsbox`, `.td-incta` and `.td-table` may be REMOVED from
  the builder: `nd-blog.css` §10 now owns those components with
  theme-scoped rules that beat inline styles. Do not remove them before
  the deploy, and do not reintroduce cream values (`#FAF8F2`, `#E7DFCE`)
  or the retired green (`#0B3D2E`, `#0B6B4A`) anywhere.

## 3. Required SEO fields (checked by `tools/verify-blog.py`)

Every article must carry, all populated and accurate:

- `<title>` 30–110 characters, unique across the blog.
- `meta[name="description"]` 70–160 characters, unique across the blog.
  (16 existing articles currently WARN on length — see §5. Length targets
  apply to NEW articles; do not rewrite existing descriptions to chase them.)
- `link[rel="canonical"]` — absolute, `https://shirjankhadka.com.np/blog/<slug>/`.
- Open Graph: `og:type=article`, `og:title`, `og:description`, `og:url`,
  `og:image` (1200×630) + `og:image:alt`. The landing card uses `og:image`
  as its image, so a missing or broken `og:image` means a imageless card.
- Twitter: `summary_large_image` + title + description + image.
- Article meta: `article:published_time`, `article:modified_time`,
  `article:section`, one `article:tag` per tag.
- One JSON-LD block, type `NewsArticle`, with headline, `datePublished`,
  `dateModified`, author (Person, Shirjan Khadka) and image.
- Every internal `/blog/` link must resolve; every article must be in
  `sitemap.xml`.

## 4. Index contract (how the landing finds new articles)

`data/blog-index.json` is rebuilt from the published files by
`tools/build-blog-index.py` (daily runner, verifier-gated). The builder
reads, per article: slug (from path), title (og:title, else h1, else
`<title>`), dek (meta description), date (JSON-LD date, else published
time), section, tags, image + alt (og tags), canonical, and figures
(Rs amounts and percentages found in the meta description ONLY — years,
dates and bare counts are never treated as figures). Keep those fields
populated and truthful: a missing description means no dek, no figures
strip and a weaker landing card. Related symbols are exact tag matches
against the verdicts symbol set — tag a company with its exact symbol to
get the live-price row on the article.

## 5. Known defects the publisher must fix (design side cannot)

1. **`nepse-bonus-share-listing-explained` is truncated upstream.** The
   published file ends at line 315 inside a `<style>` block: no `.sf`
   footer markup, no script tail, no `</body>`/`</html>`. The chain-swap
   applied the CSS chain only; the JS leg was skipped by design. Rebuild
   this article whole from the builder.
2. **Title/description length warnings (targets for new articles):**
   descriptions over 160 chars — sebon-institutional-investor-policy-2083
   (178), nrb-act-amendment-autonomy (211), nepal-sovereign-wealth-fund
   (176), swbbl-equity-research (175), ippan-opposes-sebon-ipo-rules
   (173), nrb-foreign-exchange-relaxation-explained (161),
   sebon-15-day-notice-rule-market-overhang (164),
   sebon-promoter-15-day-notice-concept-paper (196),
   nepal-remittance-growth-fewer-workers (162),
   nepal-september-tourist-arrivals-defy-floods (163),
   nepal-record-external-surplus-explained (182),
   nrb-rate-cut-monetary-review (191),
   nepse-hydropower-flood-damage-five-companies-disclose (180);
   titles over 110 chars — api-equity-research (138),
   sypnl-equity-research (138),
   nea-force-majeure-dana-kushma-seven-hydro-projects (112).
3. **Progress-bar div missing** on the four articles listed in §2.

## 6. What the design side owns (do not touch)

The landing page (`blog/index.html` structure, filters, pager,
market strip), `css/nd-blog.css`, `js/nd-blog.js`,
`data/blog-index.json`, `tools/build-blog-index.py`,
`tools/verify-blog.py`, `tools/build-blog-landing.py`,
`tools/chain-swap-blog.py` and the index-rebuild runner. Article text,
article titles, dates and figures are never changed by the design side;
figures shown on articles come only from each article's own description.

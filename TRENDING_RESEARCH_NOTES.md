# Trending Research Layer — notes (branch `feature/trending-research`)

Equity-research layer for the Trending Stocks page (`/nepse-trending/`), per the
owner's bar: every trending stock carries FINANCIAL ANALYSIS + MANAGEMENT
ANALYSIS with written reasons tying the activity signal to the numbers.
Educational framing only — no DCF, no targets, no buy/sell calls, no invented figures.

## What was built

1. **`tools/build_trending_research.py`** (new)
   Emits `nepse-chart/data/trending-research.json` for the **top 40** trending
   stocks by activity score (page shows top 30; the extra 10 cover tone-filter
   views). Per stock:
   - `financial`: TTM EPS, P/E, P/BV, BVPS, ROE, earnings yield, revenue,
     net profit, net worth (all 2 decimals) + sector P/E & P/BV medians +
     multi-quarter net-profit/EPS trend direction (up to 8 quarters, ±5% band).
   - `management`: dividend years in last-5 FY window, latest bonus+cash,
     AGM count, rights/auction counts — **only** from the archive.
   - `analyst_note`: 2–4 deterministic sentences connecting the activity
     reasons to the financial/management picture, ending with the honest
     "activity is attention, not a verdict" frame.
   - Loss-making years are stated plainly ("earnings multiples do not apply");
     missing fundamentals / missing corp history each get an honest fallback
     sentence instead of invented content.

2. **`tools/build_trending_value.py`** (extended, 12 lines at the end)
   Calls `build_trending_research.main(REPO)` after trending.json/value.json are
   written, wrapped in try/except so research can never break the main build.
   **This is the build-chain integration**: whenever the trending builder runs,
   research rebuilds automatically. No workflow changes were needed (no
   workflow references the trending builder today; it runs via the data cron).

3. **`nepse-trending/index.html`** (extended, all changes delimited)
   - New 10th table column "Research" with a per-row toggle button.
   - Expanding a row inserts a panel row (`colspan=10`) with two cards
     (Financial analysis | Management & governance) + Analyst note + footer.
   - **Lazy loading**: `trending-research.json` (~64 KB) is fetched ONCE on the
     first expand — initial page weight is byte-identical to before.
   - Honest states: loading shimmer, fetch-failure message, and a fallback for
     rows outside the compiled top 40.
   - All additions are wrapped in `<!-- RESEARCH-LAYER-START -->` /
     `<!-- RESEARCH-LAYER-END -->` HTML comments and `// RESEARCH-LAYER-*` JS
     comments for clean merging with the dark-mode and responsive branches.
   - Spacing follows the design-system scale (`--s2`–`--s8`), single column on
     mobile, two cards ≥760px. Light-mode appearance of everything else is
     untouched.

## Data sources used (all figures trace to these)

| Source | Used for |
|---|---|
| `nepse-chart/data/trending.json` | top-40 selection, rank, tone, activity reasons |
| `nepse-chart/data/fundamentals.json` (281 cos, Q4 FY 2082/2083) | EPS TTM, P/E, revenue, net profit, reserves, paid-up |
| `nepse-chart/data/quarterly.json` (351 syms, ≤12 qtrs, NPR thousands) | net-profit & EPS trend direction |
| `nepse-chart/data/value.json` (192 scored) | sector-median P/E and P/BV context |
| `nepse-chart/data/corp-history.json` (408 cos) | dividends, AGMs, rights, auctions |
| `nepse-chart/data/live.json` | LTP fallback for P/BV |

## Management-analysis: what was possible vs the gap

- **Possible (built)**: dividend consistency (years with payouts in last-5 FY
  window + latest bonus/cash split), AGM count/regularity, rights-issue and
  auction-sale history. These are genuine governance signals and are all
  sourced from the archive.
- **GAP — promoter/ownership %**: no file in our datasets carries
  promoter-vs-public shareholding per scrip. It is **not estimated or
  invented anywhere**; the panel states this explicitly. If a reliable
  ownership dataset is added later, `build_management()` is the single place
  to wire it in.

## Verification done on this branch

- `python3 tools/build_trending_research.py` → 40 stocks (37 with fundamentals,
  40 with corp history); no advice-language words in any note (scanned).
- `node --check` on the page script: OK. `researchPanelHTML` executed in node
  against a real entry: financial card, management card, note, EPS and trend
  figures all render.
- Full `build_trending_value.py` could not run end-to-end in this clean
  worktree (its broker-floorsheet DB is generated data, absent from origin);
  both scripts compile, and the research builder runs standalone. The chained
  call will execute in the normal build environment where the DB exists.

## Integration points (for the merge)

- `nepse-trending/index.html`: RESEARCH-LAYER comment blocks (CSS, `<th>`,
  row toggle cell, JS lazy-load + panel renderer, `initResearch()` call).
- `tools/build_trending_value.py`: trailing RESEARCH LAYER block.
- New files: `tools/build_trending_research.py`,
  `nepse-chart/data/trending-research.json`.
- Deploy note: `trending-research.json` must ship alongside the page; it is
  fetched relative to `/nepse-chart/data/`.

## Deliberately left alone

- The activity scoring formula and table layout are unchanged.
- No promoter/ownership estimates, no DCF, no price targets, no advice.
- No changes to `value.json`, `trending.json`, workflows, or the dark-mode
  branch's CSS regions.

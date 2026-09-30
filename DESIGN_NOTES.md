# DESIGN NOTES — NEPSE suite (Nepse Decode)

Owner's standing bar (2026-10-01): **generous, breathable spacing everywhere;
pages must never feel crowded.** These notes record every spacing/design
decision so they persist across sessions — improvements are remembered, not redone.

## Spacing scale (source of truth)

Defined in `css/nepse-design-system.css` (`:root`). Always use these tokens,
never magic numbers:

| Token  | Value | Use |
|--------|-------|-----|
| `--s1` | 4px   | hairline gaps, icon nudges |
| `--s2` | 8px   | tight intra-component gaps |
| `--s3` | 12px  | default small gap |
| `--s4` | 16px  | card padding (mobile), paragraph gaps |
| `--s5` | 20px  | — |
| `--s6` | 24px  | section-to-section on desktop |
| `--s8` | 32px  | section rhythm (mobile safety net), card padding (desktop) |
| `--s10`| 40px  | hero / major block separation |

## Section rhythm

- Major content blocks (`<section>`) are separated by at least `--s8` (32px)
  on mobile and `--s8`–`--s10` on desktop. When in doubt, add air — the owner
  explicitly prefers whitespace over density.
- Page headers (kicker → H1 → dek → meta line) use a stepped rhythm:
  kicker `--s2` below, H1 `--s3` below, dek `--s4` below. Never stack
  heading + body text without a breathing gap.
- Data tables sit inside a card/panel with `--s4`–`--s8` padding, and the
  panel itself gets `--s6`+ margin from surrounding copy.

## Component rules

- **Tabs / pills / filter buttons** (tone tabs, period bars, view tabs):
  touch hit-area minimum **44px height** on screens ≤760px
  (see safety net §2). Spacing between pills: `--s2` minimum.
- **Tables**: cells keep `10px 12px` minimum padding on small screens —
  dense financial tables must stay readable on a phone, never squashed.
  Every data table lives in a horizontal-scroll wrapper
  (`.scrollx` / `.sc-table-wrap` / `.tbl-scroll`); the *page* never scrolls
  sideways (guard §1).
- **As-of / freshness labels**: every auto-refreshing page shows a visible
  freshness line (as-of date, "refreshes automatically"). Stale data must
  never masquerade as live.
- **Loading vs error states**: loading placeholders ("Loading data…") render
  instantly with first paint; a failed *background* refresh keeps the last
  good render on screen (silent), it never flashes an error or blanks the
  page. Only a failed *initial* load shows the error state.

## Responsive safety net (2026-10-01, `css/nepse-design-system.css` tail)

Additive-only block, appended 2026-10-01 on branch `feature/responsive-autoupdate`:

1. `overflow-x: clip` on `html,body` ≤760px — kills page-level sideways
   scroll; `clip` (not `hidden`) preserves `position: sticky`.
2. 44px minimum tap targets for tab/pill/sortable-header controls ≤760px.
3. Table cell padding floor `10px 12px` ≤640px; scroll wrappers get
   `-webkit-overflow-scrolling: touch`.
4. `main > section + section` gets `margin-top: var(--s8)` ≤760px so
   stacked blocks never feel crowded.

Rules: no color/font/luxury-theme restyling in this block; no `[data-theme]`
regions (dark-mode agent's territory); CSS version bumped
(`?v=20261001a`) so the new rules reach browsers.

## Performance rules (owner's hard constraint)

- JSON is fetched **async after first paint**, never render-blocking.
  Inline data scripts sit at end of `<body>`; `<head>` carries only JSON-LD.
- Loading placeholders paint instantly; no blank page ever waits on a fetch.
- Data files are **aggregated** (largest ~172KB `verdicts.json`), never raw
  row dumps shipped to the browser.
- Long lists: paginate or cap initial render (trending shows top 20 with
  "show more"; brokers tables render per-tab; value screener renders full
  sorted table from a 76KB aggregate — acceptable, pagination only if it grows).
- Auto-refresh (60s, `document.hidden`-gated) is silent: no layout shift,
  no listener duplication (init-once guards), errors keep last good data.

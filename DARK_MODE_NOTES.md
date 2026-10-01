# Dark Mode — implementation notes (2026-10-01)

Site-wide light/dark toggle for the static site. Branch: `feature/dark-mode`.
**NOT pushed, NOT deployed.** Light mode is the default and is byte-for-byte
untouched — every dark rule is scoped under `[data-theme="dark"]`.

## How it works

1. **Inline init snippet** (first thing after `<head>`, before any stylesheet):
   reads `localStorage["sk-theme"]`; falls back to `prefers-color-scheme`;
   sets `document.documentElement[data-theme]`. Runs before CSS paints, so no
   flash of the wrong theme (no FOUC).
2. **`css/theme.css?v=20261001a`** — dark variable remaps for all three CSS
   families + overrides for hardcoded spots (see below). Light mode untouched.
3. **`js/theme-toggle.js?v=20261001a`** (deferred) — injects a sun/moon button
   into the page header, toggles `data-theme`, persists to `sk-theme`, syncs
   `meta[name=theme-color]` (#0e130f dark / #FAF8F2 light), cross-tab sync via
   `storage` events, ARIA `aria-label`/`aria-pressed`.

## Architecture (why variable remap, not an invert filter)

All three CSS families are variable-based and **no page loads more than one
family** (verified by repo walk), so dark mode = remap variables:
- `css/style.css` — 21 pages (homepage, blog/articles)
- `css/nepse-luxury.css` — 426 pages (suite + `stocks/{SYM}/`)
- `css/nepse-design-system.css` — 16 pages, all with `<body class="nd">`
  (`nepse-decode`, `nepse-value`, `nepse-trending`, signal pages, tools)

Caveat: luxury and design-system share variable names (`--paper`, `--ink`,
`--gold`, `--muted`, …) with different values. The design-system block in
`theme.css` is therefore scoped to `[data-theme="dark"] body.nd` so it never
leaks onto luxury pages. `style.css` shares no variable names with the others.

## Toggle placement — one consistent spot (fixed 2026-10-01)

`theme-toggle.js` injects exactly **one** button (`.theme-toggle.fixed`),
`position: fixed` at the **top-right corner** — just below the nav bar
(`top: 76px`) so it never covers header buttons — on every page and every
viewport. Header injection was removed: each page's header DOM differs per
breakpoint, which had left the button top-left on laptop, top-center on
tablet and bottom-right on mobile. Top-right chosen per request, matching
other sites. Safe-area inset on the right; hidden in print.

## Coverage: 471 of 476 HTML pages

5 skipped deliberately:
- `api/index.html` — joke 403 page, already dark
- `nepse-news/article-template.html` — template, not a live page
- `nepse-dashboard/`, `nepse-fundamentals/`, `nepse-alpha/` — meta-refresh
  redirects (no real content to theme)

Known partial coverage:
- Pages with large inline `<style>` blocks that don't use the framework
  variables (e.g. `scholarships/index.html`) get the toggle button but their
  inline styles don't respond to the theme. Fix = migrate them to variables
  later; out of scope for this pass.
- Signal pages (`nepse-signals/*/`) draw equity curves on `<canvas>` with
  hardcoded colors — now theme-aware: they read `data-theme` and switch the
  line/text/grid colors (`#55b183`/`#99917c`/`rgba(245,241,230,.14)` in dark).
- nepse-decode's lightweight-charts candles live inside the already-dark
  `.nd-hero-card` — no change needed.

## Builders patched (future rebuilds keep the wiring)

- `tools/build-symbol-pages.js` — head snippet, theme.css link, toggle script
  (`--symbol=` single rebuild verified: output contains all three, theme
  wiring byte-identical to the mass insertion)
- `tools/build-actions-page.js` — same three (file has ONE head template;
  an earlier patch attempt wrongly assumed two and was discarded unmodified)
- `tools/build-signal-pages.js` — same three + theme-aware canvas colors

## Performance

Per the 2026-10-01 performance bar: the init snippet is ~300 bytes of
synchronous JS (localStorage read + one setAttribute, no network); theme.css
is 8.9 KB; theme-toggle.js is 4.8 KB deferred. No render-blocking scripts
added.

## QA done (static; no live browser available to this worker)

- `node --check` passes on `js/theme-toggle.js` and all three patched builders
- `css/theme.css` braces balanced; all dark rules scoped under
  `[data-theme="dark"]`
- Toggle logic unit-tested with a DOM shim: injection position, aria states,
  click → dark → click → light, localStorage + meta sync, floating fallback
- Verified snippet/link/script order on: homepage, one blog article,
  nepse-decode, nepse-value, nepse-trending, one stock page
- No duplicate insertions anywhere; 5 skipped pages confirmed intentional

**Still needs a human/browser check before deploy:** rendered contrast on a
few representative pages (stock page tables, decode dashboard, one blog
article) — static review covered the known hardcoded spots, but eyeball QA
in a real browser is the honest final gate.

## Commit contents

This commit contains ONLY dark-mode work:
`css/theme.css`, `js/theme-toggle.js`, this file, the three patched builders,
and the 471 HTML pages with the theme wiring. The working tree had other
pre-existing uncommitted changes (data JSONs, unrelated tools, sitemap);
those are NOT in this commit.

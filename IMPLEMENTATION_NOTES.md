# IMPLEMENTATION NOTES — responsive + auto-update pass
Branch: `feature/responsive-autoupdate` · Worktree: `/tmp/resp-au-work`
Owner mandate: make every NEPSE page effectively responsive and auto-updating
**within the free static stack** (client-side live JSON fetches + scheduled
rebuild pipelines). No React/MongoDB/backend — the owner's 2026-10-01 call.

## Auto-update pattern (applied to every data page)

All NEPSE data pages now follow the same refresh contract:

1. **Initial load** paints a loading placeholder instantly (first paint never
   waits on a fetch). Inline data scripts sit at end of `<body>`.
2. **60-second silent refresh**: `setInterval(function(){ if(!document.hidden)
   load(true); }, 60000)` — skips while the tab is hidden (saves battery and
   avoids a burst of stale fetches on return).
3. **`load(silent)` signature**: `silent=false` on first paint (shows the
   error state if the fetch fails); `silent=true` on background refresh —
   a failed background fetch keeps the last good render on screen, never
   flashes an error or blanks content.
4. **`cache: 'no-store'`** on every data fetch so a left-open page actually
   receives the fresh rebuild (previously some pages could serve a cached
   JSON).
5. **Init-once guards** (`state.uiInit` / `state.tabsInit`): dropdown
   population, tab wiring, and sort-handler binding happen exactly once.
   Re-renders only repaint data. (Without this, each refresh stacked
   duplicate event listeners and duplicate `<option>` entries.)

## Per-page changes

| Page | Before | After |
|------|--------|-------|
| `/nepse-brokers/` | fetched once, never refreshed; no error state | 60s silent refresh; `cache:'no-store'`; error banner on failed initial load; as-of line from `meta.generated_at` / data `asof`; CSS version bumped |
| `/nepse-news/` | headlines refreshed (10 min); announcements IIFE had no error state | announcements IIFE wrapped in `loadHeadlines/loadAnnouncements`; announcements get the same error state; as-of per feed |
| `/nepse-trending/` | fetched once | 60s silent refresh; `cache:'no-store'`; `initTabs` guarded (was re-binding listeners every refresh); sort state preserved across refreshes |
| `/nepse-value/` | fetched once; sector dropdown + sort handlers bound inside fetch callback | 60s silent refresh; `cache:'no-store'`; dropdown/handler setup guarded by `state.uiInit` (was duplicating options on every refresh) |
| `/nepse-signals/momentum/` `/trend-relay/` `/reversal/` | fetched once; no as-of stamp | 60s silent refresh; `cache:'no-store'`; visible "Signals generated … NPT · refreshes automatically" line from `generated_at` (NPT-formatted); failed initial load keeps the existing error row, failed refresh stays silent |

Pages already live-updating (untouched): `/nepse-decode/` (60s), stock pages
via `stock-live.js` (60s), chart app via `nepse-lab.js`, `/nepse-screener/`
(60s refresh already present, as-of inline).

## Responsive safety net

Appended to `css/nepse-design-system.css` (additive only — no color/font/
luxury-theme restyling; no `[data-theme]` regions, which belong to the
dark-mode branch):

1. `overflow-x: clip` on `html,body` ≤760px — page-level sideways-scroll
   guard that preserves `position: sticky`.
2. 44px minimum tap targets for tab/pill/sortable-header controls ≤760px.
3. Table cell padding floor `10px 12px` ≤640px; scroll wrappers get momentum
   scrolling on touch.
4. `main > section + section` → `margin-top: var(--s8)` ≤760px (breathing room).

CSS version bumped `?v=20260930b` → `?v=20261001a` on all 12 pages that
reference the design system; the 4 unversioned references (brokers + 3
signals pages) got the version added. Verified: all tables on the touched
pages already live inside horizontal-scroll wrappers.

## Deliberately out of scope

- Blog articles (point-in-time figures by design).
- `/nepse-actions/` verified archive (forward-only official notices).
- Light-mode appearance (restyle nothing visually).
- Any `[data-theme]` regions (dark-mode agent's territory).
- Deploy/push — branch only, parent merges and deploys.

## Verification done on branch

- `node --check` on every modified inline script: all pass.
- Local HTTP 200 on all 7 touched pages; `setInterval` present; JSON endpoints 200.
- JSON payload sizes: largest `verdicts.json` 172KB — aggregated, no raw dumps.
- No render-blocking data fetches: `<head>` carries only JSON-LD; data
  scripts at end of `<body>`; loading placeholders paint instantly.

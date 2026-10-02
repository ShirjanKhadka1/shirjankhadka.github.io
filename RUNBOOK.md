# NEPSE Data Pipeline — Operator Runbook

Practical guide for running, debugging, and recovering the Nepse Decode
market-data pipeline. Keep it near the keyboard.

**Standing rule:** numbers on the site must be CORRECT, FRESH, and IDENTICAL
on every page — or clearly labeled as stale. Wrong numbers must NEVER reach
the screen.

---

## 1. Architecture

```
NEPSE official site (nepalstock.com.np)
        │  intraday poll (live-quotes) / market-close fetch
        ▼
tools/fetch-*.js ──► builders (live.json, trending, value, signals)
        │  validation gates (validateSnapshot: quotes>0, asof sane,
        │  index finite, ±10% moves quarantined)
        ▼
data/manifest.json  (version++, session_date, market_state, data_tag)
        │
        ▼  atomic deploy: single commit + data-<session>-N tag → main
        │
        ▼
GitHub Pages → shirjankhadka.com.np
        │
        ├─► pages read /nepse-chart/data/live.json via js/nepse-data.js
        ├─► /data/health.json (diagnostic snapshot, end of every run)
        ├─► /status/ (human dashboard, noscript-baked)
        └─► nepse-watchdog.yml (external monitor, emails on trouble)
```

Key invariants:
- One writer per data file per run; last-good is always retained on validation failure.
- `health.json` is **diagnostic, never a gate** — it must never fail a workflow.
- All timestamps are Asia/Kathmandu (NPT), labeled as such.
- All number formatting goes through `js/nepse-format.js` (en-IN, lakh/crore).

---

## 2. Normal operation

| Job | Workflow | Schedule (NPT) | Does |
|-----|----------|----------------|------|
| Live quotes | `nepse-live-quotes.yml` | Every 15 min, Sun–Thu 10:30–15:30 | Fetches official live feed, commits `live.json` if changed |
| Market close | `nepse-market-close.yml` | 15:35 NPT, Sun–Thu | Full fetch → build → validate → atomic deploy + `data-<session>-N` tag → `health.json` |
| Floorsheet | `nepse-intraday-floorsheet.yml` | Every 30 min, market hours | Floorsheet poll |
| Content | `nepse-content.yml` | Daily | Blog/content pipeline |
| Watchdog | `nepse-watchdog.yml` | Every 30 min | Fetches live `health.json` + `live.json`, emails on trouble |
| CI | `ci.yml` | Every push/PR + nightly | gitleaks, chaos suite, link check, smoke, axe, Lighthouse, visual |
| Security sweep | `security-sweep.yml` | Weekly | Secret/dependency audit |

A healthy day: market-close run is green, `/status/` shows HEALTHY,
`health.json` `overall: "ok"`, watchdog silent.

Quick health check (copy-paste):

```bash
curl -s https://shirjankhadka.com.np/data/health.json | python3 -c \
  "import json,sys; h=json.load(sys.stdin); print(h['overall'], h['generated_at_npt']); \
   [print(' ', c['status'], c['name']) for c in h['checks']]"
```

---

## 3. Common failures + fixes

### Stale data (site shows yesterday's numbers)
1. Check `/status/` → which job last ran, and its status.
2. Check the market-close run log on GitHub Actions.
3. Common causes: source site unreachable, validation failed (auto-rollback
   kept last-good — this is **correct behavior**, the badge shows STALE),
   deploy push conflict (see "atomic deploy conflict" below).
4. If validation failed, fix the builder — do NOT bypass validation.

### Validation failure (auto-rollback engaged)
- The workflow rolls back to the last good `data-<session>-N` tag automatically
  and emails you. The site keeps serving last-good, marked STALE.
- Find the cause in the run log (`Validate build` step output).
- Fix the root cause, re-run via `workflow_dispatch`. Never hand-edit data
  files to "make validation pass".

### Atomic deploy conflict (push rejected / rebase failed)
- The deploy step rebases onto `origin/main` and retries once. On failure it
  aborts **without force-push** and fails loudly — data is safe, nothing
  half-pushed.
- Fix: check what moved on main, resolve manually:
  ```bash
  git fetch origin main
  git log --oneline origin/main -5
  ```
  Then re-run the market-close workflow (`workflow_dispatch`) — it is
  idempotent and will skip already-published sessions.

### ETag / 304 issues (fetch returns "not modified" but data is old)
- The fetcher sends `If-None-Match`; a 304 means "unchanged since last fetch".
- If the source changed its ETag scheme, the fetcher may 304 forever on stale
  data. Fix: clear the stored ETag (`.cache/etag-*` or equivalent) and re-run.
- The frontend treats 304 as "no notify storm" — pages don't re-render.

### Holiday handling (market closed but pipeline ran)
- `nepse-market-config.js` carries the 2026 NEPSE holiday list.
- On holidays the market-close workflow exits early ("not a trading day") and
  the badge shows CLOSED + holiday label. If a holiday is missing from the
  list, add it to `HOLIDAYS_2026` in `js/nepse-market-config.js` and to the
  chaos suite's holiday test.

### Watchdog false positives
- During market hours the watchdog alerts if `live.json` `asof` > 30 min old.
  If the source feed itself is delayed, the alert is **true** — the site badge
  will show the delay honestly. Don't silence the watchdog; fix the feed.

### Client-side outage ("temporarily unavailable" but feed is healthy)
- 2026-10-02 incident: page showed "Market data is temporarily unavailable"
  for ~15 min during market open while live.json was fresh and valid.
  Root cause never confirmed (no console access). Suspected a client-side
  JS failure in the NepseData snapshot path.
- Immediate fix: reverted recent nepse-data.js + index.html changes.
- Prevention (added 2026-10-02):
  - `window.__nepseErrors` collector on nepse-decode (early script tag).
  - `tools/render-check.js`: headless Chromium verifies data actually paints.
  - Watchdog runs render-check during market hours; alerts on failure.
- If it recurs: check browser console first, then `window.__nepseErrors`.

---

## 4. Rollback procedure

Data publishes are tagged `data-<YYYY-MM-DD>-N` (N increments on re-publish).
To restore a previous good session:

```bash
# 1. List data tags, newest first
git tag --list 'data-*' --sort=-creatordate | head -10

# 2. Inspect what a tag contains (no checkout needed)
git show data-2026-10-01-1:data/manifest.json | head -20

# 3. Restore the data files from the tag onto main
git fetch origin main
git checkout -b rollback/data-2026-10-01-1 origin/main
git checkout data-2026-10-01-1 -- nepse-chart/data data/manifest.json
node tools/build-health.js   # refresh the diagnostic snapshot
git add -A
git commit -m "rollback: restore data files from data-2026-10-01-1 (operator rollback)"
git push origin rollback/data-2026-10-01-1
# → open a PR, wait for CI green, then merge (never push straight to main)

# 4. Verify live
curl -s https://shirjankhadka.com.np/data/health.json | python3 -m json.tool | head -12
```

If the bad publish ALSO broke code (not just data), revert the code commit
instead: `git revert <sha>` on a branch, PR, CI, merge.

---

## 5. Alert meanings

| Alert | Meaning | First action |
|-------|---------|--------------|
| `[NEPSE ALERT] watchdog: …` + "live.json STALE during market hours" | Live feed older than 30 min while market is open | Check live-quotes run log; check source site reachability |
| `[NEPSE ALERT] watchdog: …` + "health.json FAIL: …" | A pipeline health check failed | Read the named check's detail in `/data/health.json`; see §3 |
| `[NEPSE ALERT] watchdog: …` + "health.json stale/missing" | No successful pipeline run in > 2h, or file unreachable | Check market-close/live-quotes runs; check Pages deployment |
| `[NEPSE ALERT] market-close: job failed` | Infra/push error outside validation | Run log → §3 "atomic deploy conflict" |
| `[NEPSE ALERT] market-close: validation failed, auto-rolled back` | Bad data blocked; last-good retained | Fix builder, re-run; do NOT bypass validation |
| `[NEPSE ALERT] live-quotes: refresh failed` | Intraday fetch/push failed | Site serves last-good; check at next market-close |

All alerts go to email (`ALERT_EMAIL_TO`). **Failures are never sent to
Facebook** — that's the standing alert policy.

---

## 6. Never do

- **Never manually create data tags** (`data-*`). Tags are created only by the
  market-close workflow's atomic deploy step. Hand-made tags break the
  rollback chain.
- **Never force-push `main`.** The deploy step aborts instead of force-pushing
  for a reason.
- **Never merge with red CI.** Revise, re-run, then merge.
- **Never bypass `validateSnapshot`** to "fix" stale data. Stale-but-correct
  beats fresh-but-wrong, every time.
- **Never claim "real-time"** on the site. Approved wording only (see the
  LIVE badge contract in `js/nepse-data.js`).
- **Never use `.toFixed()` / `.toLocaleString()` for market numbers outside
  `js/nepse-format.js`.**
- **Never deploy site changes to a `phase*` PR branch** — those branches are
  protected; deploys go to `main` only.
- **Never change `DRY_RUN=false`** in a workflow to "test" — use
  `workflow_dispatch` on a branch.

---

## 7. Useful commands

```bash
# Local chaos suite (no browser needed)
node tools/chaos-test.js

# Regenerate the health snapshot locally
node tools/build-health.js

# Validate a live.json payload by hand
node -e "
  const v = require('./js/nepse-data.js'); // browser build — use chaos harness instead
"

# Check what the watchdog sees
curl -s https://shirjankhadka.com.np/nepse-chart/data/live.json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(d['asof'], len(d['quotes']), 'quotes')"

# Market calendar check
node -e "
  const fs = require('fs'), vm = require('vm');
  const sb = { console }; sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync('js/nepse-market-config.js','utf8'), sb);
  const c = sb.NepseMarketConfig;
  ['2026-10-22','2026-10-23','2026-11-08'].forEach(d =>
    console.log(d, c.isHoliday(d) ? 'HOLIDAY' : (c.isTradingDay(d) ? 'TRADING' : 'WEEKEND')));
"
```

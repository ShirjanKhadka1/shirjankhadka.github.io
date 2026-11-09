#!/usr/bin/env python3
"""Batched intraday publisher for Nepse Decode (PR-flow era).

PROBLEM: per-tick PRs cannot keep up with the ~20-minute required gate
(quality alone is 15-16 min), and the live-quotes workflow's own timeout is
15 min. Per-tick PRs would pile up and land late/out of order.

MODEL (15-minute batched windows, full gate preserved):
- Tick collectors (nepse-live-quotes.yml) write every fresh snapshot to the
  UNPROTECTED branch `intraday-staging` (fast-forward only, never
  force-push). Staging pushes are not gated by main's protection, so
  collection never blocks on CI.
- This publisher runs every 15 min (goal cron `intraday-batched-publisher`).
  Each run takes the LATEST staged state (ticks inside a window collapse to
  the newest value; intraday files are full snapshots, so nothing is lost)
  and moves it to main through ONE PR under the FULL existing gate.
- ONE-PR-IN-FLIGHT: while a publisher PR is in checks, later runs wait. A
  PR whose checks stay pending >= 45 min is closed UNMERGED and the next
  run proceeds with newer state (full snapshots: closing it loses nothing).
  A PR that goes green is merged by the next run that sees it green (or by
  the same run if it greens inside the poll window).
- NEVER REGRESS: a snapshot is published only if it is strictly newer than
  main's live.json (by data_asof). A PR whose content is older than main's
  (e.g. close-capture landed first) is closed unmerged, never merged.

FRESHNESS GUARDS (normal mode; ALL must pass or the run SKIP, exit 0):
- staged market == "OPEN" (closing snapshots belong to close-capture, which
  validates the close; the publisher never publishes a CLOSED snapshot).
- staged data_asof date == today (Asia/Kathmandu) and time in [10:45, 15:00)
  NPT (intraday window; 15:00+ snapshots are the close's job).
- staged data_asof strictly newer than main's live.json data_asof.
- staged data_asof not more than 10 min in the future (clock sanity).
- staged quotes count >= 150 (early-session ramp floor; a smaller board is
  a broken pull, not a publishable snapshot).
- staged bytes differ from main bytes (else there is nothing to publish).

JOB FILES (ride ONLY when live.json qualifies under the guards above):
the same batched PR may also carry the latest staged job snapshots —
VPI (`data/vpi.json`), contributors (`data/contributors.json`), intraday
candles (`nepse-chart/data/intraday-candles/<SYM>.json`, changed symbols
only), and broker splits (`nepse-brokers/data/intraday-provisional.json`).
Each job file has its own guard (see guard_vpi / guard_contributors /
guard_candle / guard_splits); a file failing its guard is EXCLUDED from
the PR, never a run failure. Merge-time re-checks guard the PR's own job contents against current
main: if any included job file no longer qualifies (e.g. close-capture
landed a FINAL board mid-poll), the PR is closed unmerged and the next
run rebuilds. Job files are purged and
live-verified by their version field after a merge, like live.json.

PROOF MODE (--proof): bypasses the freshness guards (a fixture snapshot may
be historical) but otherwise runs the identical path: staging read ->
branch -> PR -> poll all 5 required checks -> REQUIRE green -> CLOSE
UNMERGED + delete branch. Proof mode NEVER merges (code-enforced); a proof
PR is mechanics evidence only, never a publish. Exit 0 iff all 5 required
checks went green before the close; exit 1 otherwise.

MERGE PATH: API squash-merge first. A 404 is reported, NOT retried in a
loop and NOT worked around with a UI merge from here: the PR stays open
and green, and the next publisher run retries the merge. Never merge on
red checks, never bypass, never force-push, never push to main directly.

POST-MERGE: verify authenticated main ref == merge commit and main tree ==
PR head tree, purge the live.json URL from edge cache, then live-verify
the served live.json data_asof == staged data_asof (3 attempts, 60 s apart
for edge propagation).

USAGE (run from a checkout of main; the script owns --worktree):
  PYTHONPATH=/opt/muse/skills/custom-connector-setup/bin python3 -u \\
      tools/publish-intraday-batch.py --worktree ~/workspace/wt-intraday-publish
  ... --proof   (fixture proof run; never merges)

EXIT: 0 = MERGED / OPENED / WAIT / SKIP / PROOF-PASS; 1 = FAIL / PROOF-FAIL.
Every run prints exactly one RESULT line as its last line.
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

REPO = "ShirjanKhadka1/shirjankhadka.github.io"
STAGING_BRANCH = "intraday-staging"
PUBLISH_PREFIX = "deploy/intraday-publish-"
LIVE_PATH = "nepse-chart/data/live.json"
LIVE_URL = "https://shirjankhadka.com.np/nepse-chart/data/live.json"
SITE_BASE = "https://shirjankhadka.com.np/"
# Job payload paths (staged on intraday-staging, published to the same path).
VPI_PATH = "data/vpi.json"
CONTRIBUTORS_PATH = "data/contributors.json"
SPLITS_PATH = "nepse-brokers/data/intraday-provisional.json"
CANDLES_DIR = "nepse-chart/data/intraday-candles/"
# A candles publish carries ONLY paths under CANDLES_DIR (the allowlist
# in collect_job_files): health.json / status/index.html / live.json can
# never enter `included` from that lane.
NPT = timezone(timedelta(hours=5, minutes=45))
# Required checks, matched by substring against check-run names (the panel
# shows them as "<workflow> / <job> (pull_request)"; substrings are stable).
REQUIRED_CHECKS = [
    "quality",
    "Screener figures match the archive",
    "Verdict invariants hold on the shipped batch",
    "axe contrast 0 nodes",
    "Lighthouse budgets + Playwright smoke",
]
STALE_MINUTES = 45
POLL_SECONDS = 25 * 60
POLL_INTERVAL = 60
MIN_QUOTES = 150
PUSHER = os.path.expanduser(
    "~/workspace/custom-connectors/custom.legacy-github/bin/github-push-parallel.py"
)
PURGE_HELPER = os.path.expanduser(
    "~/workspace/custom-connectors/custom.cloudflare/bin/cloudflare-purge-url.py"
)


def log(msg):
    print(f"[intraday-publish] {msg}", flush=True)


def gh(method, path, data=None, ok=(200, 201, 202, 204)):
    req = urllib.request.Request(
        "https://api.github.com" + path,
        method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "NepseDecode"},
    )
    add_surrogate_to_request(req, "custom.github", allowed_hosts=["api.github.com"])
    try:
        with urllib.request.urlopen(req) as r:
            body = read_json_response(r) if r.status != 204 else None
            return r.status, body
    except urllib.error.HTTPError as e:
        raw = e.read().decode()[:400]
        if e.code in ok:
            return e.code, None
        return e.code, raw


def gh_or_die(method, path, data=None):
    status, body = gh(method, path, data)
    if status not in (200, 201, 202, 204):
        raise RuntimeError(f"GitHub {method} {path} -> {status}: {body}")
    return body


def sh(args, cwd=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def npt_now():
    return datetime.now(timezone.utc).astimezone(NPT)


def parse_snapshot(raw):
    """Return (asof_datetime_utc, market, n_quotes) or raise ValueError."""
    d = json.loads(raw.decode())
    asof = datetime.fromisoformat(d["asof"].replace("Z", "+00:00"))
    if asof.tzinfo is None:
        asof = asof.replace(tzinfo=timezone.utc)
    quotes = d.get("quotes") or []
    return asof, d.get("market"), len(quotes)


def freshness_check(staged_raw, main_raw):
    """Return None if publishable, else a SKIP reason string."""
    try:
        s_asof, s_market, s_n = parse_snapshot(staged_raw)
    except Exception as e:
        return f"staged live.json unparsable ({e})"
    try:
        m_asof, _, _ = parse_snapshot(main_raw)
    except Exception:
        m_asof = datetime(1970, 1, 1, tzinfo=timezone.utc)
    now = npt_now()
    s_npt = s_asof.astimezone(NPT)
    if s_market != "OPEN":
        return f"staged market is {s_market!r}, not OPEN (closing snapshots belong to close-capture)"
    if s_npt.date() != now.date():
        return f"staged asof date {s_npt.date()} != today {now.date()}"
    if not ((10, 45) <= (s_npt.hour, s_npt.minute) < (15, 0)):
        return f"staged asof time {s_npt.strftime('%H:%M')} outside intraday window 10:45-15:00 NPT"
    if s_asof <= m_asof:
        return f"staged asof {s_asof.isoformat()} not newer than main {m_asof.isoformat()}"
    if s_asof > datetime.now(timezone.utc) + timedelta(minutes=10):
        return "staged asof more than 10 min in the future (clock sanity)"
    if s_n < MIN_QUOTES:
        return f"staged quotes {s_n} < floor {MIN_QUOTES}"
    return None


# ------------------------------------------------------------ job guards
# Pure functions over (staged_bytes, main_bytes). Every failure EXCLUDES
# the file from the PR; none of them FAILs the run. `today` / `now` /
# `holidays` are injectable so fixture tests can pin the clock and the
# calendar; production passes None and they default to NPT now / the
# on-disk holiday calendar. All timestamps parse both trailing-Z (UTC) and
# numeric offsets (+05:45) via _parse_dt.
_HOLIDAY_TXT = os.path.expanduser("~/workspace/nepse-data-archive/nepse-holidays.txt")


def _parse_dt(s):
    """Parse an ISO timestamp (Z or numeric offset); naive -> UTC."""
    if s is None:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo is not None else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _load_json(raw):
    try:
        return json.loads(raw.decode()), None
    except Exception as e:
        return None, f"unparsable JSON ({e})"


def _as_int(v):
    try:
        return int(v)
    except Exception:
        return None


def _as_float(v):
    try:
        return float(v)
    except Exception:
        return None


def _today_or(today):
    return today if today is not None else npt_now().date()


def _now_or(now):
    return now if now is not None else datetime.now(timezone.utc)


def load_holiday_dates(worktree=None):
    """Set of YYYY-MM-DD holiday strings. Tries the nepse-holidays.txt the
    candle collector uses, then the repo's tools/nepse-holidays.json
    (worktree checkout, else the script's own checkout). Missing sources
    only WARN (mirroring the collector): weekday rules still apply."""
    dates = set()
    try:
        with open(_HOLIDAY_TXT) as f:
            for line in f:
                m = re.match(r"(\d{4}-\d{2}-\d{2})", line)
                if m:
                    dates.add(m.group(1))
    except FileNotFoundError:
        log(f"WARN: holidays file missing at {_HOLIDAY_TXT}; trying repo calendar")
    if not dates:
        candidates = []
        if worktree:
            candidates.append(os.path.join(worktree, "tools/nepse-holidays.json"))
        candidates.append(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "nepse-holidays.json")
        )
        for cand in candidates:
            try:
                with open(cand) as f:
                    cal = json.load(f)
                for h in cal.get("holidays", []):
                    if isinstance(h, dict) and h.get("date_ad") and h.get("type", "closed") == "closed":
                        dates.add(h["date_ad"])
                if dates:
                    break
            except Exception:
                continue
    return dates


def _is_trading_day(d, holidays):
    return d.weekday() < 5 and d.isoformat() not in (holidays or set())


def _most_recent_trading_day_before(today, holidays):
    """Latest trading day strictly before `today` (post-close recovery
    anchor). Walks back at most 31 days; None if none found."""
    d = today - timedelta(days=1)
    for _ in range(31):
        if _is_trading_day(d, holidays):
            return d
        d -= timedelta(days=1)
    return None


def _final_on_main(main):
    """True if main already holds a FINAL board for the session: a staged
    provisional must never overwrite it (close-capture owns the final).
    FINAL is `status == "FINAL"`, or — when there is no status field —
    `intraday == false`; the provisional==false + intraday==false form
    counts too (same marker, both fields present)."""
    if not isinstance(main, dict):
        return False
    if main.get("status") == "FINAL":
        return True
    if "status" not in main and main.get("intraday") is False:
        return True
    if main.get("provisional") is False and main.get("intraday") is False:
        return True
    return False


def _version_guard(staged_dt, main_dt, label):
    """Strictly-newer-where-comparable. None main version -> pass."""
    if staged_dt is None:
        return f"{label}: no parseable version timestamp"
    if main_dt is not None and staged_dt <= main_dt:
        return f"{label}: staged {staged_dt.isoformat()} not newer than main {main_dt.isoformat()}"
    return None


def _future_guard(dt, label):
    if dt is not None and dt > datetime.now(timezone.utc) + timedelta(minutes=10):
        return f"{label}: more than 10 min in the future"
    return None


def guard_vpi(staged_raw, main_raw, today=None):
    """VPI: full snapshot. Version = quotes_asof else built_at."""
    staged, err = _load_json(staged_raw)
    if err:
        return f"vpi: {err}"
    main, _ = _load_json(main_raw) if main_raw else (None, None)
    today = _today_or(today)
    if staged.get("asof") != str(today):
        return f"vpi: asof {staged.get('asof')!r} != today {today}"
    if staged.get("status") != "PROVISIONAL":
        return f"vpi: status {staged.get('status')!r} != PROVISIONAL (intraday publisher carries provisional only)"
    if isinstance(main, dict) and main.get("asof") == str(today) and _final_on_main(main):
        return "vpi: main already FINAL for today; provisional must not overwrite it"
    s_ver = _parse_dt(staged.get("quotes_asof")) or _parse_dt(staged.get("built_at"))
    m_ver = None
    if isinstance(main, dict):
        m_ver = _parse_dt(main.get("quotes_asof")) or _parse_dt(main.get("built_at"))
    v = _version_guard(s_ver, m_ver, "vpi")
    if v:
        return v
    f = _future_guard(s_ver, "vpi")
    if f:
        return f
    data = staged.get("data")
    if not isinstance(data, list) or not data:
        return "vpi: data list empty or missing"
    if staged.get("count") is not None:
        count = _as_int(staged["count"])
        if count is None or count != len(data):
            return f"vpi: count {staged['count']!r} != len(data) {len(data)}"
    if len({r.get("symbol") for r in data if isinstance(r, dict)}) != len(data):
        return "vpi: duplicate symbols in data"
    return None


def _num_field(d, key):
    """Numeric field that may itself be a stringified dict (defensive:
    the contributors payload has occasionally been stored stringified)."""
    v = d.get(key) if isinstance(d, dict) else None
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            return None
    return v if isinstance(v, dict) else None


def guard_contributors(staged_raw, main_raw, today=None):
    """Contributors: exact final-table guards (a)-(e)."""
    staged, err = _load_json(staged_raw)
    if err:
        return f"contributors: {err}"
    main, _ = _load_json(main_raw) if main_raw else (None, None)
    today = _today_or(today)
    if staged.get("schema") != "nd-contributors/v2":
        return f"contributors: schema {staged.get('schema')!r} != nd-contributors/v2"
    if staged.get("status") != "PROVISIONAL" or staged.get("mode") != "live" or staged.get("provisional") is not True:
        return "contributors: not a live provisional board (status PROVISIONAL + mode live + provisional true required)"
    if staged.get("asof") != str(today):
        return f"contributors: asof {staged.get('asof')!r} != today {today}"
    s_q = _parse_dt(staged.get("quotes_asof"))
    if s_q is None:
        return "contributors: quotes_asof unparsable"
    if s_q.astimezone(NPT).date() != today:
        return f"contributors: NPT date of quotes_asof {s_q.astimezone(NPT).date()} != asof {staged.get('asof')!r}"
    if isinstance(main, dict) and main.get("asof") == str(today) and _final_on_main(main):
        return "contributors: main already FINAL for today; provisional must not overwrite it"
    m_q = _parse_dt((main or {}).get("quotes_asof"))
    s_tuple = (str(staged.get("asof")), s_q)
    m_tuple = (str((main or {}).get("asof") or ""), m_q or datetime(1970, 1, 1, tzinfo=timezone.utc))
    if s_tuple <= m_tuple:
        return f"contributors: tuple {s_tuple} not strictly greater than main {m_tuple}"
    f = _future_guard(s_q, "contributors")
    if f:
        return f
    rows = staged.get("rows")
    if not isinstance(rows, list) or not rows:
        return "contributors: rows empty or missing"
    qc = _as_int(staged.get("quotes_count"))
    if qc is None or qc < 250:
        return f"contributors: quotes_count {staged.get('quotes_count')!r} < 250"
    recon = _num_field(staged, "reconciliation")
    cov = _num_field(staged, "coverage")
    residual = _as_float(recon.get("residual")) if recon else None
    cap_pct = _as_float(cov.get("cap_coverage_pct")) if cov else None
    if residual is None or abs(residual) > 2.5:
        return f"contributors: |reconciliation.residual| {residual!r} > 2.5"
    if cap_pct is None or cap_pct < 85:
        return f"contributors: coverage.cap_coverage_pct {cap_pct!r} < 85"
    return None


def guard_candle(symbol, staged_raw, main_raw, today=None, holidays=None, now=None):
    """One intraday-candle file. `holidays` is a set of YYYY-MM-DD strings
    (None -> empty set: weekday rule only; production passes the loaded
    calendar). Monotonic history: same session -> count >= main's count,
    last ts >= main's last ts, overlapping timestamps byte-identical
    (parsed-dict equality); newer session resets; older session rejected."""
    staged, err = _load_json(staged_raw)
    if err:
        return f"candle {symbol}: {err}"
    today = _today_or(today)
    now = _now_or(now)
    holidays = holidays if holidays is not None else set()
    if staged.get("symbol") != symbol:
        return f"candle {symbol}: symbol field {staged.get('symbol')!r} != filename stem"
    session_s = staged.get("session_date")
    try:
        session = datetime.strptime(str(session_s), "%Y-%m-%d").date()
    except Exception:
        return f"candle {symbol}: session_date {session_s!r} unparsable"
    if not _is_trading_day(session, holidays):
        return f"candle {symbol}: session_date {session} is not a trading day"
    candles = staged.get("candles")
    if not isinstance(candles, list) or not candles:
        return f"candle {symbol}: candles empty or missing"
    prev_ts = None
    for c in candles:
        if not isinstance(c, dict):
            return f"candle {symbol}: non-dict candle entry"
        ts = _parse_dt(c.get("ts"))
        if ts is None:
            return f"candle {symbol}: candle without parseable ts"
        if prev_ts is not None and ts <= prev_ts:
            return f"candle {symbol}: timestamps not strictly increasing"
        prev_ts = ts
        try:
            o, h, l, cl = float(c["open"]), float(c["high"]), float(c["low"]), float(c["close"])
        except Exception:
            return f"candle {symbol}: candle without numeric OHLC"
        if not (l <= o <= h and l <= cl <= h):
            return f"candle {symbol}: OHLC sanity violated (low<=open,close<=high)"
    last = prev_ts
    last_npt = last.astimezone(NPT)
    win_start = datetime(session.year, session.month, session.day, 11, 0, tzinfo=NPT)
    win_end = datetime(session.year, session.month, session.day, 16, 0, tzinfo=NPT)
    if not (win_start <= last_npt <= win_end):
        return f"candle {symbol}: last candle {last_npt} outside [session 11:00, session 15:00 + 60 min grace]"
    if session == today:
        if (now - last).total_seconds() > 90 * 60:
            return f"candle {symbol}: intraday last-candle age > 90 min"
    elif session == _most_recent_trading_day_before(today, holidays):
        close_floor = datetime(session.year, session.month, session.day, 14, 30, tzinfo=NPT)
        if last_npt < close_floor:
            return f"candle {symbol}: post-close recovery requires last candle >= 14:30 NPT (frozen tape rejected)"
    else:
        return f"candle {symbol}: session {session} is neither today nor the most recent trading day"
    if main_raw:
        main, merr = _load_json(main_raw)
        if merr is None and isinstance(main, dict):
            m_session_s = main.get("session_date")
            if m_session_s and str(m_session_s) > str(session_s):
                return f"candle {symbol}: main already holds a later session {m_session_s}"
            if m_session_s == str(session_s):
                m_candles = main.get("candles") or []
                if not isinstance(m_candles, list):
                    m_candles = []
                if len(candles) < len(m_candles):
                    return f"candle {symbol}: candle count regresses vs main ({len(candles)} < {len(m_candles)})"
                m_last = None
                for c in m_candles:
                    if isinstance(c, dict):
                        t = _parse_dt(c.get("ts"))
                        if t is not None and (m_last is None or t > m_last):
                            m_last = t
                if m_last is not None and last < m_last:
                    return f"candle {symbol}: last ts regresses vs main"
                old = {c.get("ts"): c for c in m_candles if isinstance(c, dict)}
                for c in candles:
                    if c.get("ts") in old and c != old[c.get("ts")]:
                        return f"candle {symbol}: rewrites history at {c['ts']} (old candle differs)"
    return None


def guard_splits(staged_raw, main_raw, today=None):
    """Broker splits: real-splits shape only. `symbol_only == false` is a
    HARD reject — the Oct-29 symbol-only file staged from the old model
    must never publish. Version = asof, strictly newer than main's
    (common strictly-newer rule, DESIGN 3b)."""
    staged, err = _load_json(staged_raw)
    if err:
        return f"splits: {err}"
    main, _ = _load_json(main_raw) if main_raw else (None, None)
    today = _today_or(today)
    if staged.get("provisional") is not True:
        return "splits: provisional flag missing"
    if staged.get("symbol_only") is not False:
        return f"splits: symbol_only={staged.get('symbol_only')!r} (real splits require false)"
    if staged.get("date") != str(today):
        return f"splits: date {staged.get('date')!r} != today {today}"
    if staged.get("from") != str(today) or staged.get("to") != str(today):
        return f"splits: from/to {staged.get('from')!r}/{staged.get('to')!r} != today {today}"
    brokers = staged.get("brokers")
    if not isinstance(brokers, list) or not brokers:
        return "splits: brokers empty or missing"
    if not isinstance(staged.get("broker_symbols"), dict) or not staged["broker_symbols"]:
        return "splits: broker_symbols empty or missing"
    if not isinstance(staged.get("symbols"), dict) or not staged["symbols"]:
        return "splits: symbols empty or missing"
    if not isinstance(staged.get("accumulation"), list) or not isinstance(staged.get("distribution"), list):
        return "splits: accumulation/distribution missing"
    try:
        buy = sum(float(b["buy_value"]) for b in brokers)
        sell = sum(float(b["sell_value"]) for b in brokers)
    except Exception:
        return "splits: brokers without numeric buy_value/sell_value"
    mean = (buy + sell) / 2
    if mean <= 0 or abs(buy - sell) / mean > 0.005:
        return f"splits: zero-sum violated (buy {buy} sell {sell}, rel > 0.5%)"
    s_asof = _parse_dt(staged.get("asof"))
    m_asof = _parse_dt((main or {}).get("asof")) if isinstance(main, dict) else None
    v = _version_guard(s_asof, m_asof, "splits")
    if v:
        return v
    f = _future_guard(s_asof, "splits")
    if f:
        return f
    return None


def collect_job_files(staged_files, main_files, today=None, holidays=None, now=None):
    """Pure collection step. `staged_files`/`main_files`: dict path -> bytes
    (candles: per-symbol paths). Returns (included_paths, excluded_reasons)
    in deterministic order: VPI, contributors, splits, then candles sorted
    by symbol. Byte-identical files are excluded silently (nothing to
    publish); unknown paths are excluded (never in the allowlist). This
    allowlist is also the candles invariant: only paths under CANDLES_DIR
    can ride from that lane, so health.json / status/index.html /
    live.json can never be published as candle payloads (on the
    multi-writer staging branch a per-commit check is meaningless — the
    branch tip is always another job's commit — so the path allowlist is
    the enforceable form of the invariant)."""
    today = _today_or(today)
    guards = {
        VPI_PATH: lambda s, m: guard_vpi(s, m, today=today),
        CONTRIBUTORS_PATH: lambda s, m: guard_contributors(s, m, today=today),
        SPLITS_PATH: lambda s, m: guard_splits(s, m, today=today),
    }
    included, excluded = [], {}
    ordered = [p for p in (VPI_PATH, CONTRIBUTORS_PATH, SPLITS_PATH) if p in staged_files]
    ordered += sorted(p for p in staged_files if p.startswith(CANDLES_DIR) and p.endswith(".json"))
    for path in ordered:
        raw = staged_files[path]
        if raw == main_files.get(path):
            excluded[path] = "byte-identical to main (nothing to publish)"
            continue
        if path.startswith(CANDLES_DIR):
            symbol = path.rsplit("/", 1)[-1][:-5]
            reason = guard_candle(symbol, raw, main_files.get(path), today=today, holidays=holidays, now=now)
        else:
            reason = guards[path](raw, main_files.get(path))
        if reason is None:
            included.append(path)
        else:
            excluded[path] = reason
    for path in staged_files:
        if path not in ordered:
            excluded[path] = f"no guard registered for {path} (not in publisher allowlist)"
    return included, excluded


def job_version_label(path, raw):
    """Human-readable version for the PR body / live-verify, per payload."""
    d, err = _load_json(raw) if raw else (None, "missing")
    if err or not isinstance(d, dict):
        return "unparsable"
    if path == VPI_PATH:
        return str(d.get("quotes_asof") or d.get("built_at"))
    if path == CONTRIBUTORS_PATH:
        return str(d.get("quotes_asof"))
    if path == SPLITS_PATH:
        return str(d.get("asof"))
    if path.startswith(CANDLES_DIR):
        candles = d.get("candles") or []
        if isinstance(candles, list) and candles and isinstance(candles[-1], dict):
            return str(candles[-1].get("ts"))
        return str(d.get("asof"))
    return str(d.get("asof"))


def get_branch_file(branch, path):
    status, body = gh("GET", f"/repos/{REPO}/contents/{path}?ref={branch}")
    if status != 200:
        return None
    return base64.b64decode(body["content"])


def _gh_read_retry(fn, label):
    """Bounded retry for idempotent Git Data API reads: the egress proxy
    drops connections transiently (RemoteDisconnected), and a single
    dropped blob must not FAIL a whole publisher run. 3 attempts, backoff
    2 s / 4 s. Only GET reads use this; writes (merge, ref updates) never
    retry blindly."""
    last = None
    for attempt in (1, 2, 3):
        try:
            return fn()
        except Exception as e:
            last = e
            log(f"WARN: {label} attempt {attempt} failed ({e}); retrying" if attempt < 3 else f"WARN: {label} failed after 3 attempts ({e})")
            if attempt < 3:
                time.sleep(2 * attempt)
    raise last


def get_branch_tree_map(branch):
    """path -> blob sha for every blob on `branch`, via the Git Data API
    (one recursive tree call). Used for job files: the Contents API
    returns no content for files over ~1 MB, and the real splits payload
    is ~2 MB in 1D shape, so job reads must go through blobs."""
    def _fetch():
        ref = gh_or_die("GET", f"/repos/{REPO}/git/refs/heads/{branch}")
        commit = gh_or_die("GET", f"/repos/{REPO}/git/commits/{ref['object']['sha']}")
        tree = gh_or_die(
            "GET", f"/repos/{REPO}/git/trees/{commit['tree']['sha']}?recursive=1"
        )
        return {e["path"]: e["sha"] for e in tree.get("tree", []) if e["type"] == "blob"}
    return _gh_read_retry(_fetch, f"tree map {branch}")


def get_blob_bytes(blob_sha):
    def _fetch():
        blob = gh_or_die("GET", f"/repos/{REPO}/git/blobs/{blob_sha}")
        return base64.b64decode(blob["content"])
    return _gh_read_retry(_fetch, f"blob {blob_sha[:12]}")


def collect_staged_job_files(today=None, holidays=None, now=None):
    """Read staged + main job payloads and run the guards. Returns
    (included_paths, files_by_path, excluded_reasons). `files_by_path`
    holds the exact staged bytes for included paths only. Candle paths
    come from the staged tree listing (changed symbols only: a candle
    whose blob sha equals main's is byte-identical and never fetched)."""
    staged_map = get_branch_tree_map(STAGING_BRANCH)
    main_map = get_branch_tree_map("main")
    single = [VPI_PATH, CONTRIBUTORS_PATH, SPLITS_PATH]
    staged_candles = sorted(p for p in staged_map if p.startswith(CANDLES_DIR) and p.endswith(".json"))
    wanted = single + staged_candles
    staged_files, main_files = {}, {}
    for path in wanted:
        s_sha, m_sha = staged_map.get(path), main_map.get(path)
        if s_sha is None:
            if path in single:
                log(f"job file not staged: {path}")
            continue
        if s_sha == m_sha:
            # Byte-identical without fetching either blob; the guard
            # step below still records it, via a sentinel both sides share.
            staged_files[path] = main_files[path] = b""
            continue
        staged_files[path] = get_blob_bytes(s_sha)
        if m_sha is not None:
            main_files[path] = get_blob_bytes(m_sha)
    included, excluded = collect_job_files(staged_files, main_files, today=today, holidays=holidays, now=now)
    # Byte-identical sentinels must not leak into the build: re-fetch is
    # unnecessary — identical files are excluded, never included.
    files = {p: staged_files[p] for p in included}
    for path in included:
        log(f"job file INCLUDED: {path} (version {job_version_label(path, files[path])})")
    for path, reason in excluded.items():
        log(f"job file excluded: {path}: {reason}")
    return included, files, excluded


def get_main_tip():
    return gh_or_die("GET", f"/repos/{REPO}/commits/main")["sha"]


def get_commit_tree(sha):
    return gh_or_die("GET", f"/repos/{REPO}/git/commits/{sha}")["tree"]["sha"]


def list_open_publisher_prs():
    prs = gh_or_die("GET", f"/repos/{REPO}/pulls?state=open&per_page=100")
    return [p for p in prs if p["head"]["ref"].startswith(PUBLISH_PREFIX)]


def check_states(head_sha):
    """Map each required check -> 'green' | 'pending' | 'failed' | 'missing'."""
    runs = gh_or_die(
        "GET", f"/repos/{REPO}/commits/{head_sha}/check-runs?per_page=100"
    )["check_runs"]
    out = {}
    for want in REQUIRED_CHECKS:
        matches = [r for r in runs if want in r["name"]]
        if not matches:
            out[want] = "missing"
            continue
        # Latest run wins (highest id).
        r = max(matches, key=lambda x: x["id"])
        if r["status"] != "completed":
            out[want] = "pending"
        elif r["conclusion"] == "success":
            out[want] = "green"
        else:
            out[want] = "failed"
    return out


def pr_age_minutes(pr):
    created = datetime.fromisoformat(pr["created_at"].replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - created).total_seconds() / 60.0


def close_pr(pr):
    gh_or_die("PATCH", f"/repos/{REPO}/pulls/{pr['number']}", {"state": "closed"})
    # Best-effort branch cleanup; a leftover branch is harmless.
    gh("DELETE", f"/repos/{REPO}/git/refs/heads/{pr['head']['ref']}")
    log(f"closed PR #{pr['number']} unmerged")


def update_branch(pr):
    head = pr["head"]["sha"]
    status, body = gh(
        "POST",
        f"/repos/{REPO}/pulls/{pr['number']}/update-branch",
        {"expected_head_sha": head},
    )
    if status == 202:
        log(f"update-branch accepted for PR #{pr['number']}")
        return True
    log(f"update-branch for PR #{pr['number']} -> {status}: {body}")
    return False


def merge_pr(pr):
    status, body = gh(
        "PUT",
        f"/repos/{REPO}/pulls/{pr['number']}/merge",
        {"merge_method": "squash"},
    )
    if status == 200:
        return body["sha"]
    log(f"merge PR #{pr['number']} -> {status}: {body}")
    return None


def ensure_branch(branch, base_sha):
    """The parallel pusher 404s on a nonexistent branch ref, so create it at
    `base_sha` first (tonight's proven pattern). Idempotent for fresh names."""
    status, _ = gh("GET", f"/repos/{REPO}/git/refs/heads/{branch}")
    if status == 200:
        return
    status, body = gh(
        "POST",
        f"/repos/{REPO}/git/refs",
        {"ref": f"refs/heads/{branch}", "sha": base_sha},
    )
    if status != 201:
        raise RuntimeError(f"create branch ref {branch} -> {status}: {body}")


def build_and_push_branch(worktree, branch_prefix, files):
    """Create a local commit (main tree + every file in `files`, an
    ordered dict path -> exact staged bytes, live.json first) and push it
    to a fresh timestamped branch via the parallel pusher (lease-checked
    fast-forward). Returns (branch, local_commit, tree_sha). Retries once
    with a NEW branch name if main moved mid-run (a reused name would trip
    the pusher's tip==base lease check after the first attempt created it)."""
    for attempt in (1, 2):
        sh(["git", "fetch", "origin", "main"], cwd=worktree)
        sh(["git", "reset", "--hard", "HEAD"], cwd=worktree)
        base = sh(["git", "rev-parse", "origin/main"], cwd=worktree)
        branch = branch_prefix + npt_now().strftime("%Y%m%d-%H%M%S")
        sh(["git", "checkout", "-B", "publish-tmp", base], cwd=worktree)
        for path, raw in files.items():
            target = os.path.join(worktree, path)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(raw)
        sh(["git", "add"] + list(files.keys()), cwd=worktree)
        # diff --cached --quiet exits 0 = NO differences, 1 = differences.
        # Commit only when the staged snapshot actually differs from HEAD.
        if subprocess.run(
            ["git", "diff", "--cached", "--quiet"], cwd=worktree
        ).returncode != 0:
            sh(
                ["git", "commit", "-m", "Intraday: live snapshot (batched publish)"],
                cwd=worktree,
            )
        else:
            raise RuntimeError("staged bytes equal main bytes at build time; nothing to publish")
        local = sh(["git", "rev-parse", "HEAD"], cwd=worktree)
        ensure_branch(branch, base)
        env = dict(os.environ, PYTHONPATH="/opt/muse/skills/custom-connector-setup/bin")
        proc = subprocess.run(
            [
                sys.executable,
                PUSHER,
                "--repo",
                REPO,
                "--branch",
                branch,
                "--base-sha",
                base,
                "--local-ref",
                local,
                "--message",
                "Intraday: live snapshot (batched publish)",
            ],
            cwd=worktree,
            env=env,
            capture_output=True,
            text=True,
        )
        tail = (proc.stdout.strip().splitlines() or [""]) [-1]
        log(f"pusher: {tail}")
        # The pusher prints "Deployed <branch> -> <sha>" to STDERR and the
        # bare commit SHA to STDOUT. Trust neither string alone: verify the
        # branch ref actually points at the pushed commit.
        if proc.returncode == 0:
            pushed_sha = (proc.stdout.strip().splitlines() or [""]) [-1].strip()
            status, ref = gh("GET", f"/repos/{REPO}/git/refs/heads/{branch}")
            if status == 200 and ref["object"]["sha"] == pushed_sha:
                tree = sh(["git", "rev-parse", f"{local}^{{tree}}"], cwd=worktree)
                return branch, local, tree
            log(f"pusher ref verification failed: ref={ref}")
        else:
            log(f"pusher attempt {attempt} failed: {proc.stderr.strip()[-300:]}")
    raise RuntimeError("parallel pusher failed twice; aborting (main may be moving fast)")


def open_pr(branch, asof_npt, draft=False, included_files=None):
    body = (
        "Batched intraday publish: latest staged live snapshot "
        f"(asof {asof_npt} NPT, PROVISIONAL) through the full required gate. "
        "Ticks inside the window collapse to the newest value; intraday files "
        "are full snapshots. Closing snapshots are NOT published by this job "
        "(close-capture owns the validated close)."
    )
    if included_files:
        lines = ["", "Included files (live.json + qualifying job files):"]
        for path, raw in included_files.items():
            lines.append(f"- `{path}` (version {job_version_label(path, raw)})")
        body += "\n" + "\n".join(lines)
    if draft:
        body = ("[PROOF RUN — DO NOT MERGE] Mechanics proof only; this PR is "
                "opened as a draft and will be closed unmerged by the proof "
                "run itself. It must never be merged.\n\n" + body)
    pr = gh_or_die(
        "POST",
        f"/repos/{REPO}/pulls",
        {
            "title": ("[PROOF — DO NOT MERGE] " if draft else "")
            + f"Intraday: live snapshot {asof_npt} (batched publish)",
            "head": branch,
            "base": "main",
            "body": body,
            "draft": draft,
        },
    )
    return pr


def list_pr_files(pr_number):
    names, page = [], 1
    while True:
        files = gh_or_die("GET", f"/repos/{REPO}/pulls/{pr_number}/files?per_page=100&page={page}")
        names += [f["filename"] for f in files]
        if len(files) < 100:
            break
        page += 1
    return names


def pr_files_match(names, included):
    """Exact-set check: no extras, no drops (order-insensitive)."""
    return sorted(names) == sorted(included)


def verify_pr_files(pr_number, included=None):
    names = list_pr_files(pr_number)
    want = included if included is not None else [LIVE_PATH]
    if not pr_files_match(names, want):
        raise RuntimeError(f"publisher PR touches unexpected files: {names} (expected {sorted(want)})")


def purge_and_live_verify(staged_raw, included_files=None):
    """Purge every included file's URL (purge failure stays non-gating,
    logged only), then live-verify each: live.json by data_asof equality,
    job files by their version field (VPI quotes_asof, contributors
    quotes_asof, splits asof, candles last candle ts). 3 attempts, 60 s
    apart for edge propagation; non-convergence is FAIL (merge stands)."""
    urls = [LIVE_URL]
    if included_files:
        urls += [SITE_BASE + p for p in included_files if p != LIVE_PATH]
    for url in urls:
        proc = subprocess.run(
            [sys.executable, PURGE_HELPER, url],
            capture_output=True,
            text=True,
        )
        log(f"purge {url} exit {proc.returncode}: {proc.stdout.strip()[-200:]}")
    want_asof, _, _ = parse_snapshot(staged_raw)
    want_versions = {}
    if included_files:
        for path, raw in included_files.items():
            if path != LIVE_PATH:
                want_versions[path] = job_version_label(path, raw)
    for i in (1, 2, 3):
        try:
            with urllib.request.urlopen(
                urllib.request.Request(LIVE_URL, headers={"User-Agent": "NepseDecode"})
            ) as r:
                live_raw = r.read()
            live_asof, _, _ = parse_snapshot(live_raw)
            if live_asof != want_asof:
                log(f"live-verify attempt {i}: live asof {live_asof} != staged {want_asof}")
                time.sleep(60)
                continue
            mismatches = []
            for path, want in want_versions.items():
                try:
                    with urllib.request.urlopen(
                        urllib.request.Request(SITE_BASE + path, headers={"User-Agent": "NepseDecode"})
                    ) as r:
                        served_raw = r.read()
                    if job_version_label(path, served_raw) != want:
                        mismatches.append(f"{path}: served {job_version_label(path, served_raw)} != staged {want}")
                except Exception as e:
                    mismatches.append(f"{path}: fetch error {e}")
            if not mismatches:
                log(f"live-verify PASS (attempt {i}): data_asof == staged asof, {len(want_versions)} job file(s) converged")
                return True
            log(f"live-verify attempt {i} job mismatches: {mismatches}")
        except Exception as e:
            log(f"live-verify attempt {i} error: {e}")
        time.sleep(60)
    return False


def check_pr_job_files(pr, today=None, holidays=None, now=None):
    """Merge-time job re-check: guard the PR's OWN job contents against
    CURRENT main (not fresh staging — staging may have moved on, and the
    criterion is strictly-newer-than-main). Returns (stale_paths,
    reasons, pr_job_files). Raises on API read error. A PR carrying only
    live.json (pre-extension PRs) trivially passes."""
    names = list_pr_files(pr["number"])
    job_paths = [p for p in names if p != LIVE_PATH]
    if not job_paths:
        return [], {}, {}
    pr_map = get_branch_tree_map(pr["head"]["ref"])
    main_map = get_branch_tree_map("main")
    pr_files, main_files = {}, {}
    for path in job_paths:
        sha = pr_map.get(path)
        if sha is None:
            raise RuntimeError(f"PR #{pr['number']} file {path} missing from head tree")
        pr_files[path] = get_blob_bytes(sha)
        m_sha = main_map.get(path)
        if m_sha is not None:
            main_files[path] = get_blob_bytes(m_sha)
    included, excluded = collect_job_files(pr_files, main_files, today=today, holidays=holidays, now=now)
    stale = [p for p in job_paths if p not in included]
    return stale, {p: excluded.get(p, "excluded") for p in stale}, pr_files


def handle_open_pr(pr, staged_raw, main_raw, proof, worktree, holidays=None):
    """Deal with an already-open publisher PR. Returns a RESULT string or
    None if the caller should proceed to open a fresh PR."""
    head = pr["head"]["sha"]
    # Never merge content older than main's.
    pr_live = get_branch_file(head, LIVE_PATH)
    if pr_live is not None:
        try:
            pr_asof, _, _ = parse_snapshot(pr_live)
            m_asof, _, _ = parse_snapshot(main_raw)
            if pr_asof <= m_asof:
                log(f"PR #{pr['number']} content older than main; closing as superseded")
                close_pr(pr)
                return None
        except Exception as e:
            log(f"could not compare PR #{pr['number']} content ({e}); treating as pending")
    if not proof:
        # Early job staleness check: a PR whose job content already fails
        # against current main is closed now and rebuilt fresh below,
        # instead of waiting out its checks and failing at merge time.
        # Read errors only log (transient) — the merge-time check is hard.
        try:
            stale, reasons, _ = check_pr_job_files(pr, holidays=holidays)
            if stale:
                log(f"PR #{pr['number']} job files stale vs main {reasons}; closing")
                close_pr(pr)
                return None
        except Exception as e:
            log(f"job re-check deferred for PR #{pr['number']} ({e})")
    states = check_states(head)
    log(f"PR #{pr['number']} checks: {states}")
    if all(v == "green" for v in states.values()):
        base_sha = pr["base"]["sha"]
        if base_sha != get_main_tip():
            log(f"PR #{pr['number']} green but out-of-date; updating branch")
            if not update_branch(pr):
                return "RESULT: FAIL update-branch rejected for green PR"
            return "RESULT: WAIT updated green PR, re-poll next run"
        if proof:
            log("proof mode: green PR closed unmerged (never merged)")
            close_pr(pr)
            return "RESULT: PROOF-PASS"
        # Re-check freshness at merge time: main may have moved since the
        # content comparison above. Merging older content would REGRESS main.
        pr_live2 = get_branch_file(head, LIVE_PATH)
        cur_main = get_branch_file("main", LIVE_PATH)
        try:
            pr_asof2, _, _ = parse_snapshot(pr_live2)
            m_asof2, _, _ = parse_snapshot(cur_main)
            if pr_asof2 <= m_asof2:
                log("PR content no longer newer than main at merge time; closing")
                close_pr(pr)
                return None
        except Exception as e:
            log(f"merge-time re-check failed ({e}); refusing merge")
            return "RESULT: FAIL merge-time freshness re-check error; PR left open"
        # Merge-time job re-check (REQUIRED): update-branch rebases the PR
        # onto new main but does NOT refresh frozen PR file contents, so a
        # provisional board that was fine at build time could now
        # overwrite a FINAL board close-capture landed mid-poll.
        try:
            stale, reasons, pr_job_files = check_pr_job_files(pr, holidays=holidays)
            if stale:
                log(f"PR #{pr['number']} job files no longer qualify at merge time {reasons}; closing unmerged")
                close_pr(pr)
                return None
        except Exception as e:
            log(f"merge-time job re-check failed ({e}); refusing merge")
            return "RESULT: FAIL merge-time job re-check error; PR left open"
        merged = merge_pr(pr)
        if merged is None:
            return "RESULT: FAIL api merge 404/failed; PR left open green for next run"
        head_tree = get_commit_tree(head)
        if get_main_tip() != merged or get_commit_tree(merged) != head_tree:
            return "RESULT: FAIL post-merge ref/tree mismatch"
        merged_files = {LIVE_PATH: pr_live2}
        merged_files.update(pr_job_files)
        if not purge_and_live_verify(pr_live2, merged_files):
            return "RESULT: FAIL merged but live-verify did not converge"
        gh("DELETE", f"/repos/{REPO}/git/refs/heads/{pr['head']['ref']}")
        return f"RESULT: MERGED {merged}"
    if any(v in ("failed",) for v in states.values()):
        log(f"PR #{pr['number']} has a failed required check; closing")
        close_pr(pr)
        return None
    # Pending (or missing = still starting).
    if pr_age_minutes(pr) >= STALE_MINUTES:
        log(f"PR #{pr['number']} pending >= {STALE_MINUTES} min; closing as stale")
        close_pr(pr)
        return None
    return "RESULT: WAIT publisher PR in checks"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worktree", required=True)
    ap.add_argument("--proof", action="store_true")
    args = ap.parse_args()
    worktree = os.path.expanduser(args.worktree)

    try:
        staged_raw = get_branch_file(STAGING_BRANCH, LIVE_PATH)
        if staged_raw is None:
            print("RESULT: SKIP no staging branch or no staged live.json")
            return 0
        main_raw = get_branch_file("main", LIVE_PATH)
        if main_raw is None:
            print("RESULT: FAIL main live.json unreadable")
            return 1
        if not args.proof:
            reason = freshness_check(staged_raw, main_raw)
            if reason:
                print(f"RESULT: SKIP {reason}")
                return 0
        elif staged_raw == main_raw:
            print("RESULT: FAIL proof needs staged != main (nothing to publish)")
            return 1

        holidays = load_holiday_dates(worktree)

        # One-PR-in-flight: handle any open publisher PR first.
        open_prs = list_open_publisher_prs()
        if args.proof and open_prs:
            # A proof run must prove ITS OWN fresh PR, never inherit or close
            # a real publisher PR that might be in flight.
            print("RESULT: FAIL proof refused: open publisher PR(s) already exist")
            return 1
        if len(open_prs) > 1:
            log(f"WARNING: {len(open_prs)} open publisher PRs; handling newest")
        if open_prs:
            newest = max(open_prs, key=lambda p: p["created_at"])
            res = handle_open_pr(newest, staged_raw, main_raw, args.proof, worktree, holidays=holidays)
            if res is not None:
                print(res)
                return 0 if res.startswith(("RESULT: MERGED", "RESULT: WAIT", "RESULT: PROOF-PASS")) else 1
            # Closed (superseded/failed/stale) -> fall through to fresh PR.
            main_raw = get_branch_file("main", LIVE_PATH) or main_raw

        if args.proof and staged_raw == get_branch_file("main", LIVE_PATH):
            print("RESULT: FAIL staged == main after handling open PRs")
            return 1
        if not args.proof:
            # Main may have moved since the first read; never open a PR for
            # content that is no longer newer than main.
            fresh_main = get_branch_file("main", LIVE_PATH)
            if fresh_main is not None and staged_raw == fresh_main:
                print("RESULT: SKIP staged == main on re-check (main moved first)")
                return 0

        # Job files ride ONLY with a qualifying live.json (gating A, already
        # established above). A failing job guard excludes that file only.
        _, job_files, _ = collect_staged_job_files(holidays=holidays)
        included_files = {LIVE_PATH: staged_raw}
        included_files.update(job_files)
        log(f"fresh PR will carry {len(included_files)} file(s): {sorted(included_files)}")

        # Open a fresh PR with exactly the staged bytes.
        branch, _, tree = build_and_push_branch(worktree, PUBLISH_PREFIX, included_files)
        s_asof, _, _ = parse_snapshot(staged_raw)
        pr = open_pr(branch, s_asof.astimezone(NPT).strftime("%Y-%m-%d %H:%M"),
                     draft=args.proof, included_files=included_files)
        log(f"opened PR #{pr['number']} on {branch}")
        verify_pr_files(pr["number"], list(included_files.keys()))

        # Poll up to POLL_SECONDS; merge (normal) or close (proof) on green.
        head = pr["head"]["sha"]
        updates = 0
        deadline = time.time() + POLL_SECONDS
        while time.time() < deadline:
            states = check_states(head)
            log(f"PR #{pr['number']} checks: {states}")
            if all(v == "green" for v in states.values()):
                cur = gh_or_die("GET", f"/repos/{REPO}/pulls/{pr['number']}")
                if args.proof:
                    # Proof PRs are never merged, so up-to-date-ness is
                    # irrelevant — and update-branch 404s on draft PRs.
                    # Green is the whole proof: close and pass.
                    close_pr(cur)
                    print("RESULT: PROOF-PASS")
                    return 0
                if cur["base"]["sha"] != get_main_tip():
                    if updates < 2 and update_branch(cur):
                        updates += 1
                        head = gh_or_die("GET", f"/repos/{REPO}/pulls/{pr['number']}")["head"]["sha"]
                        time.sleep(POLL_INTERVAL)
                        continue
                    print("RESULT: WAIT green PR out-of-date; update cycles used")
                    return 0
                # Merge-time freshness re-check: main may have moved during
                # the poll (e.g. close-capture landed a newer live.json).
                # Merging older content would REGRESS main — close instead.
                cur_main = get_branch_file("main", LIVE_PATH)
                try:
                    s_asof, _, _ = parse_snapshot(staged_raw)
                    m_asof, _, _ = parse_snapshot(cur_main)
                    if s_asof <= m_asof:
                        close_pr(cur)
                        print("RESULT: SKIP staged no longer newer than main at merge time; PR closed")
                        return 0
                except Exception as e:
                    log(f"merge-time freshness re-check failed ({e}); refusing merge")
                    print("RESULT: FAIL merge-time freshness re-check error; PR left open")
                    return 1
                # Merge-time job re-check (same rule as handle_open_pr).
                try:
                    stale, reasons, _ = check_pr_job_files(cur, holidays=holidays)
                    if stale:
                        log(f"job files no longer qualify at merge time {reasons}; closing PR unmerged")
                        close_pr(cur)
                        print("RESULT: SKIP job file no longer qualifies at merge time; PR closed")
                        return 0
                except Exception as e:
                    log(f"merge-time job re-check failed ({e}); refusing merge")
                    print("RESULT: FAIL merge-time job re-check error; PR left open")
                    return 1
                merged = merge_pr(cur)
                if merged is None:
                    print("RESULT: FAIL api merge failed; PR left open green for next run")
                    return 1
                if get_main_tip() != merged or get_commit_tree(merged) != get_commit_tree(head):
                    print("RESULT: FAIL post-merge ref/tree mismatch")
                    return 1
                if not purge_and_live_verify(staged_raw, included_files):
                    print("RESULT: FAIL merged but live-verify did not converge")
                    return 1
                gh("DELETE", f"/repos/{REPO}/git/refs/heads/{branch}")
                print(f"RESULT: MERGED {merged}")
                return 0
            if any(v == "failed" for v in states.values()):
                if args.proof:
                    print("RESULT: PROOF-FAIL a required check failed")
                    return 1
                close_pr(pr)
                print("RESULT: FAIL fresh PR failed a required check; closed, next window retries")
                return 1
            if args.proof and pr_age_minutes(pr) >= STALE_MINUTES:
                print("RESULT: PROOF-FAIL checks did not go green in time")
                return 1
            time.sleep(POLL_INTERVAL)
        print("RESULT: WAIT checks still pending at poll cap; next run handles it")
        return 0
    except Exception as e:
        print(f"RESULT: FAIL {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""NEPSE Contributors board builder (Nepse Decode teardown Link 8).

Rebuild of Nepalytix's NEPSE Contributors board on OUR data only. Their
feature is AUTH-GATED and schema-declared "Paid feature" (probed fresh
2026-10-23: HTTP 401 unauthenticated; the public OpenAPI schema's entire
definition surface is one sentence: "NEPSE point contribution per symbol
and per sector for the latest live snapshot", "No response body"). The
construction below is the standard capitalisation-weighted index
arithmetic, rebuilt from our archive, and matches Shirjan's spec for the
feature: every stock ranked by index points added/removed, a sector
breakdown with the top contributor and top detractor per sector, and
the board reconciled to the official index move with the
explained-vs-official remainder shown as an explicit RESIDUAL — never
hidden, never plugged away.

MODEL v2 (2026-10-24 fix — full evidence in TEARDOWN-08, FIX section).
The v1 board explained +11.82 of the official +8.23 on 2026-10-16
(residual -3.59). The decomposition of that residual, per factor:
  * Divisor basis (+0.94 pts): v1 divided by a covered-universe
    divisor (scored cap / index prev close). The official divisor is a
    measurable constant — the archived EOD snapshots imply
    TotalCap/Index = Rs 1,720,112,441..1,720,116,942 per point on every
    session 2026-10-07..14 (drift +0.000%/day) — so v2 divides by the
    OFFICIAL divisor: previous session's official total market
    capitalisation / the index's previous close (fallbacks: same-day
    implied divisor; last published implied divisor; covered divisor,
    always disclosed in the payload).
  * Coverage (+2.49 pts): two heavyweight ordinary shares were missing
    from the filings compilation — NRIC (paid-up row blank) and BBC
    (no row) — and fell on the day (NRIC -3.16% = -1.95 pts, BBC
    -0.68% = -0.63 pts at the official divisor). v2's share chain falls
    back to the ownership archive carried in data/verdicts-v2.d
    (identity paid-up, then float-implied total = float shares /
    (1 - promoter %), measured entries only). Filings counts were
    audited against that second compilation: no scored name's count
    moved by more than rounding, so no filings figure was altered.
  * Price vintage (+0.56 pts on 10-13, +2.68 on 10-15, -0.21 on
    10-16): the raw OHLC archive's 2026-10-14 bars are a preliminary
    vintage — 192 of 346 bars differ from the final revised closes in
    the adjusted archive (vs 3-36 on neighbouring days), so returns
    measured off that day ran ~0.5pp hot market-wide. v2 prices rows
    from the adjusted archive (final revised closes; the same series
    also neutralises ex-date mechanical moves the way the official
    divisor does) wherever it covers the symbol, else the raw archive.
  * Float basis was TESTED and REJECTED for the headline board: the
    implied-divisor constancy proves the headline index is total-cap
    based (a separate Float Index exists and is not this board's
    target).
Multi-session validation of v2 (sessions 2026-10-09/12/13/15/16,
official-divisor + extended coverage + adjusted-final prices):
residuals +0.72 / -0.08 / -0.57 / -0.37 / +0.09 (mean |residual| 0.37,
worst 0.72) vs v1's +0.60 / +0.09 / -2.61 / -4.67 / -3.59 (mean 2.31).
The residual gate is set from that evidence: |residual| > 2.5 pts
(~3.5x the worst observed) fails the build.

REAL-TIME MODE (--intraday, added 2026-10-24 on Shirjan's order).
During market hours the same model runs on the live quote tape:
points = shares x (LTP - previous close) / official divisor, with the
divisor and the weights carried from the previous session's official
EOD state (the divisor is a within-day constant) and volume/turnover
taken from the tape's cumulative figures. The payload is flagged
mode 'live' / provisional and the page shows a LIVE badge with the
quotes-as-of stamp; the EOD run overwrites the same path with the
FINAL board, and a provisional payload can never overwrite a final
one. The ledger is written by the final build only.

Shares chain (all repo-local, priority order): (1) paid-up capital in
the quarterly filings compilation (nepse-chart/data/fundamentals.json)
 / Rs 100 par; (2) identity paid-up in data/verdicts-v2.d; (3)
float-implied total from the same ownership archive (measured float
entries only; 2024-07-19 ownership vintage — disclosed on the page).
Volume/turnover come from the same bar series that priced the row.

Reads only ~/workspace/nepse-data-archive (ohlc-db, ohlc-adjusted,
official EOD snapshots) and the worktree's repo data. Zero runtime
dependency on any third-party analytics site.

Usage:
  build-contributors.py            # compute + summary, writes nothing
  build-contributors.py --publish  # build the FINAL board in a fresh
                                   # ephemeral checkout, seed the
                                   # ledger from the data branch, and
                                   # stage payload + ledger via the
                                   # shared data-branch writer
                                   # (component contributors) +
                                   # Publish wait + purge + served
                                   # verification; never pushes to
                                   # protected main (2026-11-04
                                   # migration, Charter v5 item 6:
                                   # the old parallel-pusher path
                                   # 422'd under branch protection)
  build-contributors.py --intraday --live live.json
                                   # provisional board, writes nothing
  build-contributors.py --intraday --live live.json --publish
                                   # stage the provisional board on
                                   # intraday-staging (unchanged by
                                   # the 2026-11-04 migration)
"""
import argparse, bisect, datetime as dt, glob, json, os, subprocess, sys

ARCHIVE = os.path.expanduser('~/workspace/nepse-data-archive')
WT = os.path.expanduser('~/workspace/wt-contributors')
REPO = 'ShirjanKhadka1/shirjankhadka.github.io'
# Data-branch deploy (2026-11-04 migration, Charter v5 item 6): branch
# protection forbids direct pushes to main, so the daily --publish path
# stages payload + ledger with the shared data-branch writer (component
# `contributors`, already declared in data/_manifest.json with both
# RELPATHS) and waits for the Publish workflow, then purges the edge
# cache and verifies the served bytes. Nothing here commits to or
# pushes from any worktree, and there is no --force path anywhere.
HOME = os.path.expanduser('~')
WRITER = os.path.join(HOME, 'workspace', 'tools', 'data-branch-writer.py')
PUBLISH_WAIT = os.path.join(HOME, 'workspace', 'tools', 'publish-wait.py')
PURGE = os.path.join(HOME, 'workspace', 'custom-connectors',
                     'custom.cloudflare', 'bin', 'cloudflare-purge-url.py')
COMPONENT = 'contributors'
DATA_BRANCH = 'data'
LIVE_URLS = ['https://shirjankhadka.com.np/data/contributors.json',
             'https://shirjankhadka.com.np/data/contributors-history.json']
WRITER_ENV = dict(os.environ,
                  PYTHONPATH='/opt/muse/skills/custom-connector-setup/bin')
# Source clone for the daily path's fresh ephemeral checkout (the
# wt-contributors worktree belongs to this clone's object store).
SOURCE_REPO = os.path.join(HOME, 'workspace', 'wave8-build', 'repo')
RELPATHS = ['data/contributors.json', 'data/contributors-history.json']
PAR = 100.0
RESIDUAL_TOLERANCE_PTS = 2.5      # from 5-session v2 evidence (worst 0.72)
MIN_CAP_COVERAGE_PCT = 85.0
MIN_SCORED = 200
NPT = dt.timezone(dt.timedelta(hours=5, minutes=45))
MODEL = 'v2'
MIN_QUOTES_LIVE = 250      # live-tape coverage gate (2026-10-24)


def r2(x):
    return None if x is None else round(x, 2)


def r3(x):
    return None if x is None else round(x, 3)


# ---------------------------------------------------------------- series
def load_series_dir(db, vol_fields):
    out = {}
    for fn in sorted(os.listdir(db)):
        if not fn.endswith('.json'):
            continue
        sym = fn[:-5]
        try:
            d = json.load(open(os.path.join(db, fn)))
        except Exception:
            continue
        bars = {}
        for b in d.get('bars', []):
            c = b.get('close')
            if c is not None and c > 0:
                bars[b['date']] = {
                    'close': c,
                    'volume': b.get(vol_fields[0]),
                    'turnover': b.get(vol_fields[1]),
                }
        if bars:
            dates = sorted(bars)
            out[sym] = (dates, [bars[x] for x in dates])
    return out


def load_adjusted():
    """Adjusted archive: monthly files ohlc-adj-*.json, data =
    {symbol: [bars]}. Later files win on (symbol, date) conflicts."""
    merged = {}
    for p in sorted(glob.glob(os.path.join(
            ARCHIVE, 'ohlc-adjusted', 'ohlc-adj-*.json'))):
        try:
            d = json.load(open(p))
        except Exception:
            continue
        for sym, rows in (d.get('data') or {}).items():
            bars = merged.setdefault(sym, {})
            for b in rows:
                c = b.get('close')
                if c is not None and c > 0:
                    bars[b['date']] = {
                        'close': c,
                        'volume': b.get('volume'),
                        'turnover': b.get('amount'),
                    }
    out = {}
    for sym, bars in merged.items():
        if bars:
            dates = sorted(bars)
            out[sym] = (dates, [bars[x] for x in dates])
    return out


def bar_on_or_before(series, day):
    dates, bars = series
    i = bisect.bisect_right(dates, day) - 1
    return (None, None) if i < 0 else (dates[i], bars[i])


def bar_before(series, day):
    dates, bars = series
    i = bisect.bisect_left(dates, day) - 1
    return (None, None) if i < 0 else (dates[i], bars[i])


# ---------------------------------------------------------------- inputs
def load_index_history():
    ih = json.load(open(os.path.join(WT, 'data/index-history.json')))
    pts = {}
    for r in ih['rows']:
        s = str(r[0])
        day = f'{s[:4]}-{s[4:6]}-{s[6:]}'
        if r[4] is not None and r[4] > 0:
            pts[day] = float(r[4])
    return pts


def load_official(session):
    """Official figures for the session from the archived official EOD
    snapshot, when one exists: the published index change, the previous
    close (the snapshot's 'close' field carries the PREVIOUS session's
    final close — semantics proven in TEARDOWN-08), and the official
    total market capitalisation."""
    p = os.path.join(ARCHIVE, 'eod', f'eod-{session}.json')
    if not os.path.exists(p):
        return {}
    d = json.load(open(p))
    out = {}
    idx = d.get('indices', {}).get('NEPSE Index', {})
    if idx.get('change') is not None:
        out['change'] = float(idx['change'])
    if idx.get('close') is not None:
        out['prev_close'] = float(idx['close'])
    for row in d.get('market_summary', []):
        if row.get('detail', '').startswith('Total Market Capitalization'):
            out['total_cap'] = float(row['value'])
    return out


def load_share_chain():
    """symbol -> (shares, source). Priority: filings paid-up, then the
    ownership archive's identity paid-up, then its float-implied total
    (measured entries only)."""
    chain = {}
    fund = json.load(open(os.path.join(
        WT, 'nepse-chart/data/fundamentals.json')))['companies']
    for sym, rec in fund.items():
        if rec and rec.get('paidup_b'):
            chain[sym] = (rec['paidup_b'] * 1e9 / PAR, 'filings')
    for p in sorted(glob.glob(os.path.join(WT, 'data/verdicts-v2.d',
                                           '*.json'))):
        try:
            d = json.load(open(p))
        except Exception:
            continue
        for sym, v in (d.get('verdicts') or {}).items():
            if sym in chain:
                continue
            ident = (v.get('evidence') or {}).get('identity') or {}
            if ident.get('paidup_b'):
                chain[sym] = (ident['paidup_b'] * 1e9 / PAR,
                              'ownership archive (paid-up)')
                continue
            fs, pp = ident.get('float_shares'), ident.get('promoter_pct')
            if (ident.get('float_status') == 'measured' and fs
                    and pp is not None and pp < 0.999):
                chain[sym] = (fs / (1.0 - pp),
                              'ownership archive (float-implied)')
    return chain


DIVISOR_JUMP_PCT = 10.0      # 2026-11-03: a genuine divisor move
MAX_CAP_COVERAGE_PCT = 125.0  # across sessions is far smaller than
# this; the Nov-2 EOD snapshot's total market capitalisation collapsed
# Rs 4,630,727,163,404 (Oct-30) -> Rs 957,973,947,007 (Nov-2, -79.3%)
# while the index fell only 1.21%, so the Nov-3 live divisor came out
# Rs 360M/pt instead of ~Rs 1,721M/pt and inflated every row's points
# ~4.74x. A candidate divisor jumping more than this vs the last
# plausible session is therefore REJECTED, never published.


def _implied_divisor(session, idx):
    """total_cap(session) / close(session) from the archived EOD
    snapshot, or None when the snapshot carries no capitalisation."""
    o = load_official(session)
    if o.get('total_cap') and session in idx:
        return o['total_cap'] / idx[session]
    return None


def _stable_reference(before_session, idx):
    """Most recent session strictly before before_session whose
    implied divisor agrees within DIVISOR_JUMP_PCT with the next
    earlier implied divisor (or the earliest available when no
    earlier session exists). Returns (session, divisor) or
    (None, None). A collapsed snapshot can never serve as its own
    reference, and a run of collapsed snapshots is skipped back
    past, not averaged in."""
    ordered = sorted(d for d in idx if d < before_session
                     and _implied_divisor(d, idx) is not None)
    for i in range(len(ordered) - 1, -1, -1):
        d = ordered[i]
        if i == 0:
            return (d, _implied_divisor(d, idx))
        prev_d = ordered[i - 1]
        cur = _implied_divisor(d, idx)
        ref = _implied_divisor(prev_d, idx)
        if abs(cur / ref - 1.0) <= DIVISOR_JUMP_PCT / 100.0:
            return (d, cur)
    return (None, None)


def _check_divisor(candidate, cand_session, idx):
    """Plausibility gate for one divisor candidate. Returns
    (candidate, None) when plausible, else (None, source-note) where
    the note names the rejection and the fallback it triggers, so the
    payload itself discloses that a snapshot was distrusted."""
    ref_session, ref = _stable_reference(cand_session, idx)
    if ref is None or ref == 0:
        return (candidate, None)
    jump = 100.0 * (candidate / ref - 1.0)
    if abs(jump) <= DIVISOR_JUMP_PCT:
        return (candidate, None)
    return (None,
            f'REJECTED {cand_session} implied divisor '
            f'Rs {candidate:,.0f}/pt ({jump:+.1f}% vs last plausible '
            f'{ref_session} implied Rs {ref:,.0f}/pt) — falling back '
            f'to last plausible implied divisor ({ref_session} EOD '
            'snapshot)')


def _fallback_divisor(idx, before_session):
    """The last plausible implied divisor strictly before
    before_session, or (None, None) when no session qualifies."""
    return _stable_reference(before_session, idx)


def resolve_divisor(session, prev, idx_prev, official, idx):
    """The official divisor D (Rs of market cap per index point).
    Returns (D, source). The divisor is a within-day constant and, the
    snapshots prove, near-constant across days absent corporate
    actions — so each fallback stays an official-divisor estimate.
    Every candidate is plausibility-checked against the last stable
    implied divisor (2026-11-03 fix): a collapsed snapshot's divisor
    is rejected and the payload says so, instead of inflating the
    whole board."""
    off_prev = load_official(prev)
    if off_prev.get('total_cap'):
        cand = off_prev['total_cap'] / idx_prev
        ok, note = _check_divisor(cand, prev, idx)
        if ok is not None:
            return (ok, 'official total market capitalisation, '
                        'previous session EOD snapshot')
        rejected = note
    else:
        rejected = None
    if official.get('total_cap'):
        close = idx_prev + official['change']
        cand = official['total_cap'] / close
        ok, note = _check_divisor(cand, session, idx)
        if ok is not None:
            return (ok, (rejected + '; ' if rejected else '') +
                    'official total market capitalisation, '
                    'same-day implied (the divisor is a '
                    'within-day constant)')
        rejected = note
    days = sorted(idx)
    i = days.index(session)
    for back in days[max(0, i - 10):i][::-1]:
        cand = _implied_divisor(back, idx)
        if cand is None:
            continue
        ok, note = _check_divisor(cand, back, idx)
        if ok is not None:
            return (ok, (rejected + '; ' if rejected else '') +
                    f'last published implied divisor ({back} EOD '
                    'snapshot)')
        rejected = note
    ref_session, ref = _fallback_divisor(idx, session)
    if ref is not None:
        return (ref, (rejected + '; ' if rejected else '') +
                f'last plausible implied divisor ({ref_session} EOD '
                'snapshot)')
    return (None, 'covered-universe fallback (no official total '
                  'capitalisation in the archive window)')


def resolve_cap_denominator(session, off_close, official, idx):
    """Coverage denominator: the session's official total market
    capitalisation when plausible, else the last plausible snapshot's
    total capitalisation (2026-11-03 fix, same last-plausible
    principle as the divisor fallback above). Returns (denominator,
    source); (None, None) when the session carries no official total
    cap, in which case the caller keeps the weight-coverage fallback.
    The gate threshold is untouched — only the denominator is
    corrected, and the payload discloses the substitution, so a
    collapsed snapshot can no longer inflate cap coverage past the
    gate (Nov-2: 474.3% vs the collapsed Rs 958B snapshot; the
    Oct-30 denominator gives ~98.1%)."""
    session_cap = official.get('total_cap')
    if not session_cap:
        return (None, None)
    rejected = None
    if off_close:
        ok, note = _check_divisor(session_cap / off_close, session, idx)
        if ok is not None:
            return (session_cap, 'official total market '
                        'capitalisation, session EOD snapshot')
        rejected = note
    ref_session, _ref_div = _stable_reference(session, idx)
    if ref_session:
        ref_official = load_official(ref_session)
        if ref_official.get('total_cap'):
            return (ref_official['total_cap'],
                    (rejected + '; ' if rejected else '') +
                    f'last plausible total market capitalisation '
                    f'({ref_session} EOD snapshot)')
    return (session_cap, (rejected + '; ' if rejected else '') +
            'official total market capitalisation, session EOD '
            'snapshot (no plausible fallback found)')


# ---------------------------------------------------------------- compute
def compute(raw, adjusted):
    univ = json.load(open(os.path.join(
        WT, 'nepse-chart/data/universe.json')))
    symbols = univ['symbols']
    names = {r['s']: r.get('n') for r in symbols}
    types = {r['s']: r.get('t') for r in symbols}
    verdicts = json.load(open(os.path.join(
        WT, 'nepse-chart/data/verdicts.json')))['verdicts']
    keystone = json.load(open(os.path.join(WT, 'data/sector-indices.json')))
    sector_of = {}
    for sec, s in keystone['sectors'].items():
        for sym in s['constituents']:
            sector_of[sym] = sec

    def sector_for(sym):
        if sym in sector_of:
            return sector_of[sym]
        v = verdicts.get(sym)
        if v and v.get('sec'):
            return v['sec']
        return 'Unclassified'

    chain = load_share_chain()
    idx = load_index_history()
    idx_days = sorted(idx)
    newest = max(d[-1] for d, _ in raw.values() if d)
    # The session is the archive's newest real session. index-history
    # can carry a phantom forward row past it (2026-10-19, a holiday);
    # such rows never participate because the previous session is taken
    # strictly before the archive session.
    session = newest
    if session not in idx:
        raise SystemExit(f'gate: index-history has no close on the '
                         f'archive session {session}')
    prev = max(d for d in idx_days if d < session)
    idx_prev = idx[prev]
    official = load_official(session)
    if 'change' in official:
        off_change = official['change']
        if 'prev_close' in official:
            if abs(official['prev_close'] - idx_prev) > 1.0:
                raise SystemExit('gate: EOD previous close '
                                 f"{official['prev_close']} disagrees "
                                 f'with index history {idx_prev} by >1pt')
            idx_prev = official['prev_close']
        off_close = round(idx_prev + off_change, 2)
        off_source = ('official EOD snapshot (nepse-data-archive/eod): '
                      'published change on the snapshot\'s previous '
                      'close; close = previous close + change')
    else:
        off_close = idx[session]
        off_change = round(off_close - idx_prev, 2)
        off_source = 'official index history (data/index-history.json)'

    divisor, divisor_source = resolve_divisor(
        session, prev, idx_prev, official, idx)

    cap_denominator, cap_denominator_source = resolve_cap_denominator(
        session, off_close, official, idx)

    scored, no_shares, no_price = [], [], []
    for r in symbols:
        sym = r['s']
        got = chain.get(sym)
        if types.get(sym) != 'Equity' or got is None:
            if types.get(sym) == 'Equity':
                no_shares.append({'symbol': sym, 'type': types.get(sym),
                                  'reason': 'no share count in the '
                                            'filings compilation or the '
                                            'ownership archive'})
            else:
                no_shares.append({'symbol': sym, 'type': types.get(sym),
                                  'reason': f"{types.get(sym)} — not an "
                                            'ordinary share; outside the '
                                            'board\'s share-count basis'})
            continue
        shares, share_source = got
        # price the row: adjusted-final series where it covers the
        # symbol on both sides of the session, else the raw archive.
        priced = None
        for label, book in (('adjusted-final', adjusted),
                            ('raw', raw)):
            series = book.get(sym)
            if not series:
                continue
            last_day, last_bar = bar_on_or_before(series, session)
            if last_day is None or last_day < prev:
                continue
            _, prev_bar = bar_on_or_before(series, prev)
            if prev_bar is None:
                continue
            traded = (last_day == session)
            close_bar = last_bar if traded else prev_bar
            priced = (label, close_bar, prev_bar, traded,
                      last_bar if traded else None)
            break
        if priced is None:
            series = raw.get(sym) or adjusted.get(sym)
            if not series:
                reason = 'no prices in the OHLC archive'
            else:
                last_day, _ = bar_on_or_before(series, session)
                if last_day is None or last_day < prev:
                    reason = ('no price since before the previous '
                              'session (suspended, merged or stale)')
                else:
                    reason = ('no close before this session '
                              '(new listing)')
            no_price.append({'symbol': sym, 'type': types.get(sym),
                             'reason': reason})
            continue
        label, close_bar, prev_bar, traded, sess_bar = priced
        scored.append({
            'symbol': sym, 'name': names.get(sym),
            'sector': sector_for(sym), 'shares': shares,
            'shares_source': share_source, 'price_source': label,
            'close': close_bar['close'], 'prev_close': prev_bar['close'],
            'traded': traded,
            'volume': (sess_bar or {}).get('volume') if traded else 0,
            'turnover': (sess_bar or {}).get('turnover') if traded else 0,
        })

    return assemble_board(scored, session, prev, idx_prev, off_change,
                          off_close, off_source, divisor, divisor_source,
                          official.get('total_cap'), keystone, session,
                          len(symbols),
                          {'no_share_count': no_shares, 'no_price': no_price},
                          cap_denominator, cap_denominator_source)


def assemble_board(scored, session, prev, idx_prev, off_change, off_close,
                   off_source, divisor, divisor_source, official_total_cap,
                   keystone, level_date, universe_count, unscored,
                   cap_denominator=None, cap_denominator_source=None):
    """The model: derived figures for a scored board — per-row points
    and true index weights, the sector roll-up, the reconciliation and
    the top-10 blocks. Shared by the final (EOD) and live (intraday)
    modes: one arithmetic, two price tapes. `scored` rows carry
    symbol/name/sector/shares/shares_source/price_source/close/
    prev_close/traded/volume/turnover. `official_total_cap` is the
    session's official total market capitalisation when an official
    figure for the session itself exists (final mode), else None —
    and is always reported truthfully, even when the coverage
    denominator below substitutes a last-plausible snapshot for it.
    `cap_denominator` (final mode only) is the total capitalisation
    the coverage percentage is actually divided by: the session's
    official figure when plausible, else the last plausible
    snapshot's figure (2026-11-03 fix); None keeps the legacy
    weight-coverage fallback. —
    coverage then falls back to the previous-close basis."""
    cap_prev_total = sum(s['shares'] * s['prev_close'] for s in scored)
    if divisor is None:
        divisor = cap_prev_total / idx_prev
    # Weights are true index weights: share of the OFFICIAL total
    # market capitalisation at the previous close implied by the
    # divisor (TotalCap_prev = D x Index_prev, by definition).
    total_cap_prev = divisor * idx_prev
    for s in scored:
        s['cap_prev'] = s['shares'] * s['prev_close']
        s['cap'] = s['shares'] * s['close']
        s['points'] = s['shares'] * (s['close'] - s['prev_close']) / divisor
        s['weight_pct'] = 100.0 * s['cap_prev'] / total_cap_prev
        s['pct_change'] = (s['close'] / s['prev_close'] - 1.0) * 100.0
    scored.sort(key=lambda s: (-s['points'], s['symbol']))
    for i, s in enumerate(scored):
        s['rank'] = i + 1

    explained = sum(s['points'] for s in scored)
    gross_up = sum(s['points'] for s in scored if s['points'] > 0)
    gross_down = sum(s['points'] for s in scored if s['points'] < 0)
    residual = off_change - explained

    sec_map = {}
    for s in scored:
        g = sec_map.setdefault(s['sector'], {
            'sector': s['sector'], 'points': 0.0, 'symbols': 0,
            'advancers': 0, 'decliners': 0, 'unchanged': 0,
            'cap_prev': 0.0, 'dcap': 0.0, 'volume': 0, 'turnover': 0.0,
            'rows': []})
        g['points'] += s['points']
        g['symbols'] += 1
        g['cap_prev'] += s['cap_prev']
        g['dcap'] += s['shares'] * (s['close'] - s['prev_close'])
        g['volume'] += s['volume'] or 0
        g['turnover'] += s['turnover'] or 0.0
        if s['pct_change'] > 0:
            g['advancers'] += 1
        elif s['pct_change'] < 0:
            g['decliners'] += 1
        else:
            g['unchanged'] += 1
        g['rows'].append(s)
    sectors = []
    for g in sec_map.values():
        rows = g.pop('rows')
        top = max(rows, key=lambda s: (s['points'], s['symbol']))
        bot = min(rows, key=lambda s: (s['points'], s['symbol']))
        ks = keystone['sectors'].get(g['sector'])
        level = None
        if ks and ks.get('dates') and ks.get('values'):
            j = ks['dates'].index(level_date) if level_date in ks['dates'] else -1
            if j >= 0:
                level = ks['values'][j]
        g['index_level'] = level
        g['change_pct'] = (100.0 * g['dcap'] / g['cap_prev']
                           if g['cap_prev'] else None)
        g['weight_pct'] = (100.0 * g['points'] / abs(off_change)
                           if off_change else None)
        g['cap_weight_pct'] = 100.0 * g['cap_prev'] / total_cap_prev
        g['turnover_rs'] = round(g.pop('turnover'), 2)
        g['volume'] = int(g.pop('volume'))
        g.pop('dcap'); g.pop('cap_prev')
        g['top_contributor'] = {'symbol': top['symbol'],
                                'points': r3(top['points'])}
        g['top_detractor'] = {'symbol': bot['symbol'],
                              'points': r3(bot['points'])}
        g['points'] = r3(g['points'])
        g['change_pct'] = r2(g['change_pct'])
        g['weight_pct'] = r2(g['weight_pct'])
        g['cap_weight_pct'] = r2(g['cap_weight_pct'])
        g['index_level'] = r2(g['index_level'])
        sectors.append(g)
    sectors.sort(key=lambda g: (-g['points'], g['sector']))

    cap_today_total = sum(s['cap'] for s in scored)
    src_counts = {}
    for s in scored:
        src_counts[s['shares_source']] = \
            src_counts.get(s['shares_source'], 0) + 1
    coverage = {
        'scored_symbols': len(scored),
        'universe_symbols': universe_count,
        'cap_scored_prev_rs': round(cap_prev_total, 2),
        'cap_scored_rs': round(cap_today_total, 2),
        'official_total_cap_rs': (official_total_cap
                                  if official_total_cap is not None
                                  else round(total_cap_prev, 2)),
        'total_cap_prev_rs': round(total_cap_prev, 2),
        'cap_coverage_pct': (r2(100.0 * cap_today_total /
                                cap_denominator)
                             if cap_denominator else
                             (r2(100.0 * cap_today_total /
                                 official_total_cap)
                              if official_total_cap else
                              r2(100.0 * cap_prev_total / total_cap_prev))),
        'cap_coverage_denominator_rs': (round(cap_denominator, 2)
                                         if cap_denominator else None),
        'cap_coverage_denominator_source': cap_denominator_source,
        'weight_coverage_pct': r2(100.0 * cap_prev_total / total_cap_prev),
        'shares_source_counts': src_counts,
    }
    recon = {
        'official_change': r2(off_change),
        'explained': r2(explained),
        'residual': r2(residual),
        'gap': r2(residual),   # v1 field name, same definition
        'explained_pct': (r2(100.0 * explained / off_change)
                          if off_change else None),
        'gross_up': r2(gross_up),
        'gross_down': r2(gross_down),
        'divisor_rs_per_point': round(divisor, 2),
        'divisor_source': divisor_source,
        'residual_tolerance_pts': RESIDUAL_TOLERANCE_PTS,
        'gap_tolerance_pts': RESIDUAL_TOLERANCE_PTS,
    }

    def row_out(s):
        return {
            'rank': s['rank'], 'symbol': s['symbol'], 'name': s['name'],
            'sector': s['sector'],
            'close': r2(s['close']), 'prev_close': r2(s['prev_close']),
            'pct_change': r2(s['pct_change']), 'points': r3(s['points']),
            'shares': int(round(s['shares'])),
            'shares_source': s['shares_source'],
            'price_source': s['price_source'],
            'market_cap_prev_rs': round(s['cap_prev'], 2),
            'weight_pct': round(s['weight_pct'], 4),
            'volume': (int(s['volume']) if s['volume'] is not None
                       else None),
            'turnover_rs': (round(s['turnover'], 2)
                            if s['turnover'] is not None else None),
            'traded': s['traded'],
        }

    rows = [row_out(s) for s in scored]
    gainers = [s for s in scored if s['points'] > 0][:10]
    losers = [s for s in scored if s['points'] < 0][-10:][::-1]

    def top_block(lst):
        return {
            'rows': [row_out(s) for s in lst],
            'total_points': r3(sum(s['points'] for s in lst)),
            'total_weight_pct': r2(sum(s['weight_pct'] for s in lst)),
            'total_volume': int(sum(s['volume'] or 0 for s in lst)),
            'total_turnover_rs': round(
                sum(s['turnover'] or 0.0 for s in lst), 2),
        }

    return {
        'session': session, 'prev_session': prev,
        'index': {'prev_close': r2(idx_prev), 'close': off_close,
                  'change': r2(off_change),
                  'pct_change': (r2(100.0 * off_change / idx_prev)
                                 if idx_prev else None),
                  'source': off_source},
        'divisor': {'rs_per_point': round(divisor, 2),
                    'source': divisor_source},
        'reconciliation': recon, 'coverage': coverage,
        'sectors': sectors,
        'residual_row': {
            'label': 'Residual — outside this board',
            'points': r3(residual),
            'weight_pct': (r2(100.0 * residual / abs(off_change))
                           if off_change else None),
            'note': 'the net move of everything the official index '
                    'counts that this board cannot score (unscored and '
                    'newly listed names), plus any official divisor '
                    'adjustment — printed, never netted away',
        },
        'top_gainers': top_block(gainers),
        'top_losers': top_block(losers),
        'rows': rows,
        'unscored': unscored,
    }


def resolve_divisor_live(prev, idx_prev):
    """The official divisor carried into the live session: the
    previous session's official total market capitalisation divided
    by its close. The divisor is a within-day constant, so the value
    that priced yesterday's final board prices today's live board.
    Returns (D, source); (None, ...) when no official-anchored state
    exists — the live build then refuses to publish."""
    off_prev = load_official(prev)
    idx = load_index_history()
    rejected = None
    if off_prev.get('total_cap'):
        cand = off_prev['total_cap'] / idx_prev
        ok, note = _check_divisor(cand, prev, idx)
        if ok is not None:
            return (ok, 'official total market capitalisation, '
                        'previous session EOD snapshot — carried '
                        'into the live session')
        rejected = note
    cur = os.path.join(WT, RELPATHS[0])
    if os.path.exists(cur):
        try:
            p = json.load(open(cur))
        except Exception:
            p = None
        if p and p.get('asof') == prev and \
                (p.get('divisor') or {}).get('rs_per_point'):
            cand = float(p['divisor']['rs_per_point'])
            ok, note = _check_divisor(cand, prev, idx)
            if ok is not None:
                return (ok, (rejected + '; ' if rejected else '') +
                        'the divisor published with the previous '
                        "session's final board")
            rejected = note
    for back in sorted((d for d in idx if d <= prev), reverse=True)[:10]:
        cand = _implied_divisor(back, idx)
        if cand is None:
            continue
        ok, note = _check_divisor(cand, back, idx)
        if ok is not None:
            return (ok, (rejected + '; ' if rejected else '') +
                    f'last published implied divisor ({back} EOD '
                    'snapshot)')
        rejected = note
    ref_session, ref = _fallback_divisor(idx, prev)
    if ref is not None:
        return (ref, (rejected + '; ' if rejected else '') +
                f'last plausible implied divisor ({ref_session} EOD '
                'snapshot)')
    return (None, 'no official divisor state available')


def compute_intraday(live, raw, adjusted, prev_override=None):
    """The live board: the v2 model priced on a live quote tape.
    points = shares x (LTP - previous close) / official divisor,
    weights and the divisor carried from the previous session's
    official EOD state; volume/turnover are the tape's cumulative
    session figures. The previous close is the final-revised
    (adjusted) archive close — the same bar the final board will use
    as its previous close tonight."""
    quotes_list = live.get('quotes')
    if not isinstance(quotes_list, list):
        raise SystemExit('gate: live payload carries no quotes array')
    if len(quotes_list) < MIN_QUOTES_LIVE:
        raise SystemExit(f'gate: live tape carries {len(quotes_list)} '
                         f'quotes (< {MIN_QUOTES_LIVE}) — refusing to '
                         'publish a thin board')
    quotes = {}
    for q in quotes_list:
        if isinstance(q, dict) and q.get('symbol'):
            quotes[q['symbol']] = q
    session = live.get('session_date')
    quotes_asof = live.get('asof')
    if not session and quotes_asof:
        session = dt.datetime.fromisoformat(
            quotes_asof.replace('Z', '+00:00')).astimezone(NPT) \
            .strftime('%Y-%m-%d')
    if not session:
        raise SystemExit('gate: live payload carries no session date')
    if quotes_asof:
        qdate = dt.datetime.fromisoformat(
            quotes_asof.replace('Z', '+00:00')).astimezone(NPT) \
            .strftime('%Y-%m-%d')
        if qdate != session:
            raise SystemExit(f'gate: quotes_asof date {qdate} != '
                             f'session date {session}')
    feed_idx = live.get('index') or {}
    if feed_idx.get('value') is None or feed_idx.get('change') is None:
        raise SystemExit('gate: live payload carries no index block '
                         '— the official move is load-bearing for '
                         'the residual')

    univ = json.load(open(os.path.join(
        WT, 'nepse-chart/data/universe.json')))
    symbols = univ['symbols']
    names = {r['s']: r.get('n') for r in symbols}
    types = {r['s']: r.get('t') for r in symbols}
    verdicts = json.load(open(os.path.join(
        WT, 'nepse-chart/data/verdicts.json')))['verdicts']
    keystone = json.load(open(os.path.join(WT, 'data/sector-indices.json')))
    sector_of = {}
    for sec, s in keystone['sectors'].items():
        for sym in s['constituents']:
            sector_of[sym] = sec

    def sector_for(sym):
        if sym in sector_of:
            return sector_of[sym]
        v = verdicts.get(sym)
        if v and v.get('sec'):
            return v['sec']
        return 'Unclassified'

    chain = load_share_chain()
    idx = load_index_history()
    newest = max(d[-1] for d, _ in raw.values() if d)
    prev = prev_override or newest
    if session <= prev:
        raise SystemExit(f'gate: live session {session} is not after '
                         f'the last closed session {prev} — stale '
                         'tape, not publishing')
    off_prev = load_official(prev)
    if off_prev.get('prev_close') is not None and \
            off_prev.get('change') is not None:
        idx_prev = round(off_prev['prev_close'] +
                         off_prev['change'], 2)
    elif prev in idx:
        idx_prev = idx[prev]
    else:
        raise SystemExit(f'gate: no official close for the previous '
                         f'session {prev}')
    if feed_idx.get('previous_close') is not None and \
            abs(float(feed_idx['previous_close']) - idx_prev) > 1.0:
        raise SystemExit('gate: feed previous close '
                         f"{feed_idx['previous_close']} disagrees "
                         f'with the archived official close {idx_prev} '
                         'by >1pt')
    divisor, divisor_source = resolve_divisor_live(prev, idx_prev)
    if divisor is None:
        raise SystemExit('gate: divisor state missing — no official '
                         'total capitalisation for the previous '
                         'session and no published divisor to carry')
    off_change = float(feed_idx['change'])
    off_close = float(feed_idx['value'])
    off_source = ('live quote feed (NEPSE official API via the Nepse '
                  'Decode quote layer): the live index value and its '
                  'published change; the previous close from the '
                  'archived official EOD snapshot')

    scored, no_shares, no_price = [], [], []
    for r in symbols:
        sym = r['s']
        got = chain.get(sym)
        if types.get(sym) != 'Equity' or got is None:
            if types.get(sym) == 'Equity':
                no_shares.append({'symbol': sym, 'type': types.get(sym),
                                  'reason': 'no share count in the '
                                            'filings compilation or the '
                                            'ownership archive'})
            else:
                no_shares.append({'symbol': sym, 'type': types.get(sym),
                                  'reason': f"{types.get(sym)} — not an "
                                            'ordinary share; outside the '
                                            'board\'s share-count basis'})
            continue
        shares, share_source = got
        # previous close: the freshest bar on or before the previous
        # session across the two archives — the adjusted-final series
        # wins ties (it is the basis the final board uses).
        cands = []
        for label, book in (('adjusted-final', adjusted),
                            ('raw', raw)):
            series = book.get(sym)
            if not series:
                continue
            p_day, p_bar = bar_on_or_before(series, prev)
            if p_bar is not None:
                cands.append((p_day,
                              1 if label == 'adjusted-final' else 0,
                              label, p_bar))
        if not cands:
            series = raw.get(sym) or adjusted.get(sym)
            if not series:
                reason = 'no prices in the OHLC archive'
            else:
                last_day, _ = bar_on_or_before(series, prev)
                if last_day is None:
                    reason = ('no close before this session '
                              '(new listing)')
                else:
                    reason = ('no price since before the previous '
                              'session (suspended, merged or stale)')
            no_price.append({'symbol': sym, 'type': types.get(sym),
                             'reason': reason})
            continue
        cands.sort(key=lambda c: (c[0], c[1]))
        _, _, label, prev_bar = cands[-1]
        prev_close = prev_bar['close']
        q = quotes.get(sym)
        if q is not None and isinstance(q.get('ltp'), (int, float)) \
                and not isinstance(q.get('ltp'), bool) and q['ltp'] > 0:
            close = float(q['ltp'])
            traded = True
            volume = q.get('volume')
            turnover = q.get('turnover')
            psource = 'live LTP'
        else:
            close = prev_close
            traded = False
            volume = 0
            turnover = 0
            psource = label
        scored.append({
            'symbol': sym, 'name': names.get(sym),
            'sector': sector_for(sym), 'shares': shares,
            'shares_source': share_source, 'price_source': psource,
            'close': close, 'prev_close': prev_close,
            'traded': traded, 'volume': volume, 'turnover': turnover,
        })

    board = assemble_board(
        scored, session, prev, idx_prev, off_change, off_close,
        off_source, divisor, divisor_source, None, keystone, prev,
        len(symbols),
        {'no_share_count': no_shares, 'no_price': no_price})
    board['quotes_count'] = len(quotes_list)
    return board


def gates(board):
    errs = []
    rows = board['rows']
    if len(rows) < MIN_SCORED:
        errs.append(f'scored symbols {len(rows)} < {MIN_SCORED}')
    recon = board['reconciliation']
    d = recon['divisor_rs_per_point']
    idx_prev = board['index']['prev_close']
    for r in rows:
        expect = r['shares'] * (r['close'] - r['prev_close']) / d
        if abs(expect - r['points']) > 0.002:
            errs.append(f"{r['symbol']}: points identity broken "
                        f'({r["points"]} vs {expect:.3f})')
            break
        wexp = 100.0 * r['market_cap_prev_rs'] / (d * idx_prev)
        if abs(wexp - r['weight_pct']) > 0.01:
            errs.append(f"{r['symbol']}: weight identity broken "
                        f'({r["weight_pct"]} vs {wexp:.4f})')
            break
    sec_sum = sum(s['points'] for s in board['sectors'])
    if abs(sec_sum - recon['explained']) > 0.02:
        errs.append(f'sector points sum {sec_sum} != explained '
                    f"{recon['explained']}")
    if abs(sec_sum + board['residual_row']['points'] -
           recon['official_change']) > 0.02:
        errs.append('sectors + residual do not sum to the official '
                    'change')
    for key, lst in (('top_gainers', board['top_gainers']),
                     ('top_losers', board['top_losers'])):
        tot = sum(x['points'] for x in lst['rows'])
        if abs(tot - lst['total_points']) > 0.01:
            errs.append(f'{key} total does not match its rows')
    if [r['rank'] for r in rows] != list(range(1, len(rows) + 1)):
        errs.append('ranks are not 1..N in published order')
    cov = board['coverage']
    if (cov['cap_coverage_pct'] is not None and
            cov['cap_coverage_pct'] < MIN_CAP_COVERAGE_PCT):
        errs.append(f"cap coverage {cov['cap_coverage_pct']}% < "
                    f'{MIN_CAP_COVERAGE_PCT}% — share-count data degraded')
    if (cov['cap_coverage_pct'] is not None and
            cov['cap_coverage_pct'] > MAX_CAP_COVERAGE_PCT):
        errs.append(f"cap coverage {cov['cap_coverage_pct']}% > "
                    f'{MAX_CAP_COVERAGE_PCT}% — official total market '
                    'capitalisation understated (collapsed snapshot) '
                    'or share-count data inflated; investigate '
                    'before publishing')
    if abs(recon['residual']) > RESIDUAL_TOLERANCE_PTS:
        errs.append(f"reconciliation residual {recon['residual']} pts "
                    f'beyond the +/-{RESIDUAL_TOLERANCE_PTS} tolerance '
                    '— investigate before publishing')
    if errs:
        raise SystemExit('gate failures:\n' + '\n'.join(' - ' + e
                                                         for e in errs))


def methodology_block():
    return {
        'construction': 'A capitalisation-weighted index moves '
                        'when market caps move. Each scored '
                        'stock\'s point contribution = shares x '
                        '(close - previous close) / divisor, with '
                        'the OFFICIAL divisor — the official total '
                        'market capitalisation divided by the '
                        'index level, a near-constant Rs ~1.72 '
                        'billion per point that the archived EOD '
                        'snapshots pin down session by session. '
                        'Sector contributions are the sum of their '
                        'stocks\' points; sector contributions '
                        'plus the printed residual sum exactly to '
                        'the official move.',
        'shares': 'Share counts, in priority order: paid-up '
                  'capital from the latest published quarterly '
                  'filings compilation / Rs 100 par; the ownership '
                  'archive\'s identity paid-up (same compilation '
                  'family, carried per stock in the verdicts '
                  'data); and, for the few ordinary shares both '
                  'miss (NRIC and BBC among them), the total '
                  'implied by that archive\'s measured float — '
                  'float shares / (1 - promoter %), ownership as '
                  'of 2024-07-19. Counts refresh at quarterly '
                  'compilations, so a bonus or right issue '
                  'allotted mid-quarter enters this board\'s '
                  'weights at the next compilation.',
        'prices': 'Final revised closes: the adjusted OHLC '
                  'archive where it covers a symbol (it also '
                  'neutralises the mechanical ex-date price drop '
                  'the way the official divisor does), else the '
                  'raw OHLC archive. The raw archive\'s '
                  '2026-10-14 bars are a preliminary vintage — '
                  'over half differ from the final closes — which '
                  'is what pricing this board off raw closes '
                  'alone got wrong in v1. Volume and turnover are '
                  'the session\'s, from the same bar that priced '
                  'the row.',
        'residual': 'The residual is the net move of everything '
                    'the official index counts that this board '
                    'cannot score — ordinary shares with no '
                    'share count in either source, newly listed '
                    'names not yet in any compilation (BENH, '
                    'listed 2026-10-15, is the current example) '
                    '— plus any official divisor adjustment for '
                    'listings and corporate actions. Debentures '
                    'and mutual funds are not constituents of '
                    'the NEPSE equity index and are excluded '
                    'from this board entirely. The residual is '
                    'printed in the sector table so the table '
                    'sums to the official move; it is measured, '
                    'never plugged.',
        'tolerance': f"If the residual ever exceeds "
                     f"+/-{RESIDUAL_TOLERANCE_PTS} points, or "
                     f"scored cap coverage of the official total "
                     f"market capitalisation falls under "
                     f"{MIN_CAP_COVERAGE_PCT}%, the daily build "
                     f"fails instead of publishing. The residual "
                     f"tolerance is set from the v2 model's "
                     f"five-session validation (worst observed "
                     f"|residual| 0.72 pts, Oct 2026).",
    }


def build_payload():
    raw = load_series_dir(os.path.join(ARCHIVE, 'ohlc-db'),
                          ('volume', 'turnover'))
    adjusted = load_adjusted()
    board = compute(raw, adjusted)
    now = dt.datetime.now(NPT).replace(microsecond=0).isoformat()
    payload = {
        'schema': 'nd-contributors/v2',
        'model': MODEL,
        'asof': board['session'],
        'prev_session': board['prev_session'],
        'built_at': now,
        'status': 'FINAL',
        'mode': 'final',
        'provisional': False,
        'intraday': False,
        'source': 'Nepse Decode OHLC archive (final revised closes '
                  'from the adjusted archive where it covers a symbol, '
                  'else raw closes) + share counts from the published '
                  'quarterly filings compilation, with the ownership '
                  'archive as the fallback source; official index '
                  'figures and the official divisor from the archived '
                  'NEPSE EOD snapshots',
        'index': board['index'],
        'divisor': board['divisor'],
        'reconciliation': board['reconciliation'],
        'coverage': board['coverage'],
        'sectors': board['sectors'],
        'residual_row': board['residual_row'],
        'top_gainers': board['top_gainers'],
        'top_losers': board['top_losers'],
        'rows': board['rows'],
        'unscored': board['unscored'],
        'methodology': methodology_block(),
    }
    gates(payload_board_view(payload))
    return payload


def payload_board_view(payload):
    return {'rows': payload['rows'], 'sectors': payload['sectors'],
            'reconciliation': payload['reconciliation'],
            'coverage': payload['coverage'],
            'residual_row': payload['residual_row'],
            'top_gainers': payload['top_gainers'],
            'top_losers': payload['top_losers'],
            'index': payload['index']}


def ledger_entry(payload):
    return {
        'asof': payload['asof'], 'built_at': payload['built_at'],
        'model': payload.get('model', 'v1'),
        'official_change': payload['index']['change'],
        'explained': payload['reconciliation']['explained'],
        'gap': payload['reconciliation']['gap'],
        'residual': payload['reconciliation']['residual'],
        'scored_symbols': payload['coverage']['scored_symbols'],
        'top_contributors': [{'symbol': r['symbol'],
                              'points': r['points']}
                             for r in payload['rows'][:5]],
        'top_detractors': [{'symbol': r['symbol'],
                            'points': r['points']}
                           for r in payload['rows'][-5:]][::-1],
        'sector_points': {s['sector']: s['points']
                          for s in payload['sectors']},
    }


LEDGER_NOTE = (
    'Append-only daily snapshots of the NEPSE contributors board: '
    'the official index change, the points this board explains, the '
    'published residual, and the session\'s top contributors and '
    'detractors. Entries are never edited; a same-day rebuild '
    'replaces only that day\'s entry. 2026-10-24: the model changed '
    '(v2 — official divisor, extended share-count coverage, '
    'final-revised price basis; see TEARDOWN-08 FIX section). The '
    '2026-10-16 entry was republished under v2 in the same-day '
    'rebuild: explained +11.82 -> +8.14, residual -3.59 -> +0.09. '
    'Entries from the first live session under v2 carry model: "v2".')


def build_local():
    payload = build_payload()
    out_p = os.path.join(WT, RELPATHS[0])
    led_p = os.path.join(WT, RELPATHS[1])
    ledger = []
    if os.path.exists(led_p):
        ledger = json.load(open(led_p)).get('entries', [])
    entry = ledger_entry(payload)
    kept = []
    for e in ledger:
        if e['asof'] == entry['asof']:
            old = {k: v for k, v in e.items() if k != 'built_at'}
            new = {k: v for k, v in entry.items() if k != 'built_at'}
            kept.append(e if old == new else entry)
        else:
            kept.append(e)
    if not any(e['asof'] == entry['asof'] for e in kept):
        kept.append(entry)
    kept.sort(key=lambda e: e['asof'])
    payload['history_recent'] = [
        {'asof': e['asof'], 'official_change': e['official_change'],
         'explained': e['explained'], 'gap': e['gap']}
        for e in kept[-10:]][::-1]
    existing = json.load(open(out_p)) if os.path.exists(out_p) else None
    if existing and existing.get('asof') == payload['asof']:
        same = ({k: v for k, v in existing.items() if k != 'built_at'} ==
                {k: v for k, v in payload.items() if k != 'built_at'})
        if same:
            print(f'unchanged: board for {payload["asof"]} already written')
            return payload, False
    with open(out_p, 'w') as f:
        json.dump(payload, f, indent=1)
    with open(led_p, 'w') as f:
        json.dump({'schema': 'nd-contributors-history/v1',
                   'note': LEDGER_NOTE,
                   'entries': kept}, f, indent=1)
    return payload, True


# ------------------------------------------------------- daily publish
# 2026-11-04 migration (Charter v5 item 6): the daily --publish path
# below replaces deploy()/commit_and_push() (DELETED — direct pushes
# to protected main 422, and no --force path remains anywhere in this
# file). The daily run:
#   1. builds in a FRESH ephemeral checkout of origin/main (never the
#      persistent wt-contributors worktree, never a dirty-preserving
#      sync), removed on exit even on failure;
#   2. seeds the component's own two files from the DATA branch into
#      that checkout BEFORE build_local() reads the ledger — the
#      append-only ledger on main LAGS the data branch (main: 3
#      entries through 2026-10-28; data: 5 entries through 2026-11-02
#      at migration time), so building on main's copies would DROP
#      entries. A failed data-branch fetch fails LOUD, never falls
#      back to stale main copies;
#   3. stages payload + ledger via the shared data-branch writer,
#      waits for Publish, purges the edge cache, verifies served
#      bytes. Any failure raises SystemExit, so the cron wrapper
#      retries once and then fails loud — a failed publish never
#      reports silent success.
#
# Deliberately NOT staged here: data/health.json and
# status/index.html, which the old deploy() baked with
# tools/build-health.js. Those are shared multi-writer outputs with
# NO manifest component of their own, so this lane must not claim
# them; other baking lanes still refresh them on their runs. A
# single owner for health/status freshness is a remaining gap (see
# the migration report), not something this lane silently owns.
# The intraday path is untouched: it stages only the payload on
# intraday-staging and never touches the ledger or health.
import base64 as _base64
import tempfile as _tempfile
import time as _time


def _git_out(args, cwd, timeout=300):
    r = subprocess.run(['git', '-c', 'http.version=HTTP/1.1'] + args,
                       cwd=cwd, capture_output=True, text=True,
                       timeout=timeout)
    if r.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed rc={r.returncode}: "
                         + (r.stdout + r.stderr)[-600:])
    return r.stdout.strip()


def prepare_ephemeral_worktree():
    """Fresh ephemeral checkout of origin/main. Returns the dir.
    Fails LOUD on any fetch/reset/verify failure — a publish must
    never start from a stale base."""
    import shutil
    # NOT /tmp: /tmp is a small tmpfs (512M) and a full site checkout
    # does not fit in it reliably (2026-11-04 verify failure). The
    # checkout lives under the workspace and is removed on exit by
    # the caller's finally block (remove_ephemeral_worktree).
    base = os.path.join(HOME, 'workspace', '.ephemeral-checkouts')
    os.makedirs(base, exist_ok=True)
    tmp = _tempfile.mkdtemp(prefix='contributors-', dir=base)
    try:
        _git_out(['fetch', 'origin', 'main'], SOURCE_REPO)
        tip = _git_out(['rev-parse', 'origin/main'], SOURCE_REPO)
        _git_out(['worktree', 'add', '--detach', tmp, 'origin/main'],
                 SOURCE_REPO)
        head = _git_out(['rev-parse', 'HEAD'], tmp)
        if head != tip:
            raise SystemExit(f'ephemeral checkout HEAD {head} != '
                             f'origin/main {tip}')
        print(f'ephemeral checkout {tmp} at origin/main {tip[:8]}')
        return tmp
    except BaseException:
        # SystemExit is BaseException, not Exception — a plain
        # `except Exception` would leak the scratch dir on the
        # loud-failure path, which is exactly when cleanup matters.
        shutil.rmtree(tmp, ignore_errors=True)
        subprocess.run(['git', '-c', 'http.version=HTTP/1.1',
                        'worktree', 'prune'],
                       cwd=SOURCE_REPO, capture_output=True, text=True)
        raise


def remove_ephemeral_worktree(tmp):
    # No --force anywhere: the scratch dir is simply deleted and the
    # worktree metadata pruned (prune only drops entries whose dir
    # no longer exists, so a half-deleted dir is left listed, never
    # force-removed — the next run's mkdtemp never reuses the path).
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    subprocess.run(['git', '-c', 'http.version=HTTP/1.1',
                    'worktree', 'prune'],
                   cwd=SOURCE_REPO, capture_output=True, text=True)


def seed_component_from_data_branch():
    """Overlay this component's two files from the DATA branch into
    WT, validating JSON + shape. LOUD failure, never a fallback to
    main's copies (which lag and would drop ledger entries)."""
    for rp in RELPATHS:
        s, b = _gh_api('GET', f'/repos/{REPO}/contents/{rp}'
                       f'?ref={DATA_BRANCH}')
        if s != 200 or not isinstance(b, dict) or 'content' not in b:
            raise SystemExit(
                f'seed: data-branch fetch failed for {rp} '
                f'(HTTP {s}); refusing to build on stale main copies')
        try:
            parsed = json.loads(_base64.b64decode(b['content']))
        except Exception as e:
            raise SystemExit(f'seed: data-branch {rp} is not valid '
                             f'JSON ({e}); refusing to build on it')
        if rp.endswith('contributors.json'):
            if parsed.get('schema') != 'nd-contributors/v2' or \
                    not isinstance(parsed.get('asof'), str):
                raise SystemExit(
                    f'seed: data-branch {rp} fails shape check '
                    f'(schema/asof); refusing to build on it')
        else:
            if not isinstance(parsed.get('entries'), list):
                raise SystemExit(
                    f'seed: data-branch {rp} has no entries list; '
                    f'refusing to build on it')
        dest = os.path.join(WT, rp)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'w') as f:
            json.dump(parsed, f, indent=1)
        print(f"seeded {rp} from data branch "
              f"(board/ledger asof "
              f"{parsed.get('asof') or parsed['entries'][-1]['asof']})")


def deploy_data_branch(payload):
    """Stage payload + ledger via the data-branch writer, wait for
    Publish, purge, verify served bytes. Returns the Publish tag."""
    import re as _re
    asof = payload['asof']
    if not _re.fullmatch(r'\d{4}-\d{2}-\d{2}', asof):
        raise SystemExit(f'deploy: bad payload asof {asof!r}')
    args = [sys.executable, WRITER, '--component', COMPONENT,
            '--asof', asof,
            '--message', f'NEPSE contributors board {asof}']
    for rp in RELPATHS:
        args += ['--file', f'{rp}:{os.path.join(WT, rp)}']
    r = subprocess.run(args, capture_output=True, text=True,
                       timeout=600, env=WRITER_ENV)
    print('deploy: data-branch-writer stdout:\n' + r.stdout)
    if r.stderr:
        print('deploy: data-branch-writer stderr:\n' + r.stderr)
    if r.returncode != 0:
        raise SystemExit(f'writer failed rc={r.returncode}')
    proof = None
    for line in reversed(r.stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith('{'):
            try:
                proof = json.loads(line)
                break
            except ValueError:
                continue
    if proof is None:
        raise SystemExit('deploy: no proof JSON from data-branch-writer')
    status = proof.get('status')
    if status not in ('WRITTEN', 'NO-CHANGES'):
        raise SystemExit(f'deploy: writer status={status!r}; refusing '
                         f'to publish')
    tag = None
    if status == 'NO-CHANGES':
        print('deploy: board already staged (NO-CHANGES); skipping '
              'Publish wait')
    else:
        snap = proof.get('commit')
        if not snap:
            raise SystemExit('deploy: writer proof has no commit SHA')
        print(f'deploy: staged data commit {snap}; waiting for Publish')
        pw = subprocess.run(
            [sys.executable, PUBLISH_WAIT, '--snapshot', snap,
             '--timeout', '900', '--interval', '30'],
            capture_output=True, text=True, timeout=1200, env=WRITER_ENV)
        print('deploy: publish-wait stdout:\n' + pw.stdout)
        if pw.stderr:
            print('deploy: publish-wait stderr:\n' + pw.stderr)
        if pw.returncode != 0:
            raise SystemExit(f'publish-wait failed rc={pw.returncode}')
        published = [ln for ln in pw.stdout.splitlines()
                     if ln.startswith('PUBLISHED ')]
        if not published:
            raise SystemExit('deploy: no PUBLISHED line from publish-wait')
        tag = published[-1].split()[-1]
        print(f'deploy: {published[-1]}')
    pg = subprocess.run([sys.executable, PURGE] + LIVE_URLS,
                        capture_output=True, text=True, timeout=300,
                        env=WRITER_ENV)
    print(f'deploy: purge rc={pg.returncode} out={pg.stdout.strip()} '
          f'err={pg.stderr.strip()}')
    _time.sleep(30)
    for attempt in (1, 2, 3):
        try:
            cur = subprocess.run(
                ['curl', '-s', '--max-time', '30', '-A', 'Mozilla/5.0',
                 '-H', 'Cache-Control: no-cache',
                 '-H', 'Pragma: no-cache', LIVE_URLS[0]],
                capture_output=True, text=True, timeout=60)
            live_board = json.loads(cur.stdout)
            cur2 = subprocess.run(
                ['curl', '-s', '--max-time', '30', '-A', 'Mozilla/5.0',
                 '-H', 'Cache-Control: no-cache',
                 '-H', 'Pragma: no-cache', LIVE_URLS[1]],
                capture_output=True, text=True, timeout=60)
            live_ledger = json.loads(cur2.stdout)
            live_asof = live_board.get('asof')
            live_entries = [e['asof'] for e in
                            live_ledger.get('entries', [])]
            print(f'deploy: served check {attempt}: board asof='
                  f'{live_asof} status={live_board.get("status")} '
                  f'ledger last={live_entries[-1] if live_entries else None} '
                  f'(want {asof})')
            if live_asof == asof and \
                    live_board.get('status') == 'FINAL' and \
                    asof in live_entries:
                print(f'deploy: LIVE VERIFIED board {asof} '
                      f'(Publish tag {tag})')
                return tag
        except Exception as e:
            print(f'deploy: served check {attempt} failed: {e}')
        if attempt < 3:
            _time.sleep(45)
    raise SystemExit('deploy: served verification failed after 3 attempts')


# ------------------------------------------------------- intraday staging
# 2026-10-30 migration: the intraday --publish path writes the payload
# file ONLY to branch intraday-staging via the GitHub API (blob ->
# tree -> commit -> fast-forward ref update), never to main, never
# with force. (The old deploy_intraday()/commit_and_push() direct-push
# path was DELETED in the 2026-11-04 daily migration; the daily path
# now stages via the data-branch writer instead.) No git, no
# worktree sync, no parallel pusher on this path — so a staging write
# cannot race a cron tick's worktree and cannot 422 on branch
# protection (staging is unprotected; the ref PATCH is still
# lease-checked by re-fetching the tip on every attempt).
STAGING_BRANCH = 'intraday-staging'
STAGING_PAYLOAD_PATH = RELPATHS[0]  # 'data/contributors.json'
STAGING_MAX_ATTEMPTS = 5
STALLED_DIR = os.path.expanduser(
    '~/workspace/fixprog-autonomy/contributors/stalled')


def _gh_api(method, path, body=None):
    """One authenticated GitHub API call. Returns (status, payload).
    Auth via the dynamic_credentials surrogate (custom.github); the
    keyword-only allowed_hosts argument is REQUIRED."""
    sys.path.insert(0, '/opt/muse/skills/custom-connector-setup/bin')
    from dynamic_credentials import add_surrogate_to_request, \
        read_json_response
    import urllib.request, urllib.error
    data = None
    headers = {'Accept': 'application/vnd.github+json',
               'User-Agent': 'nepse-decode-contributors-intraday'}
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(
        f'https://api.github.com{path}', data=data, method=method,
        headers=headers)
    add_surrogate_to_request(req, 'custom.github',
                             allowed_hosts=['api.github.com'])
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, read_json_response(resp)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:1000]
    except Exception as e:
        return 0, str(e)[:500]


def _staging_ref():
    s, b = _gh_api('GET', f'/repos/{REPO}/git/ref/heads/'
                   f'{STAGING_BRANCH}')
    if s != 200 or not isinstance(b, dict):
        return None
    return (b.get('object') or {}).get('sha')


def _staging_file():
    """Current staged payload: (blob_sha, parsed_json_or_None).
    (None, None) when the path is absent from the staging branch."""
    import base64
    s, b = _gh_api('GET', f'/repos/{REPO}/contents/'
                   f'{STAGING_PAYLOAD_PATH}?ref={STAGING_BRANCH}')
    if s != 200 or not isinstance(b, dict) or 'content' not in b:
        return None, None
    try:
        parsed = json.loads(base64.b64decode(b['content']))
    except Exception:
        parsed = None
    return b.get('sha'), parsed


def _record_stalled(payload_bytes, reason):
    """Stalled record + exact-bytes archive, then a clear log line.
    The next tick retries with fresher data; a newer provisional
    board supersedes a stalled one (same full-snapshot reasoning as
    the other collectors), so a stalled record never blocks fresh
    data — it exists for post-close recovery visibility. The
    post-close contributors-daily job is the recovery path."""
    import hashlib
    os.makedirs(STALLED_DIR, exist_ok=True)
    stamp = dt.datetime.now(NPT).strftime('%Y%m%d-%H%M%S')
    arch = os.path.join(STALLED_DIR,
                        f"contributors-intraday-{stamp}.json")
    with open(arch, 'wb') as f:
        f.write(payload_bytes)
    rec = {
        'status': 'STALLED',
        'created_at': dt.datetime.now(NPT).replace(
            microsecond=0).isoformat(),
        'archive_path': arch,
        'session': None,
        'content_sha256': hashlib.sha256(payload_bytes).hexdigest(),
        'reason': reason,
        'branch': STAGING_BRANCH,
        'path': STAGING_PAYLOAD_PATH,
    }
    try:
        rec['session'] = json.loads(payload_bytes).get('asof')
    except Exception:
        pass
    with open(os.path.join(STALLED_DIR, 'stalled.json'), 'w') as f:
        json.dump(rec, f, indent=1)
    print(f"STALLED (silent): intraday staging write failed "
          f"({reason}); exact bytes archived at {arch}; record "
          f"{STALLED_DIR}/stalled.json; next tick retries with "
          f"fresher data, post-close contributors-daily recovers")


def deploy_intraday_staging(payload):
    """Stage the provisional board on intraday-staging (API only).
    Payload file ONLY — never nepse-chart/data/live.json, never any
    other job's file: the new tree is the staging tip's tree with
    exactly one path replaced. Staging-side guards (in addition to
    build_local_intraday's worktree guards): a staged FINAL board
    for the session is never overwritten by a provisional, and a
    staged provisional with equal-or-newer quotes_asof is never
    replaced. Returns the new staging commit SHA, or None for
    no-change / stalled-silent (both exit 0 — never a loud per-tick
    failure)."""
    content = json.dumps(payload, indent=1)
    payload_bytes = content.encode()
    staged_sha, staged = _staging_file()
    if staged is not None:
        if staged.get('asof') == payload['asof'] and \
                staged.get('status') == 'FINAL':
            print(f"RESULT: no change (final board for "
                  f"{payload['asof']} already staged — provisional "
                  f"never overwrites final)")
            return None
        if staged.get('provisional') and \
                staged.get('asof') == payload['asof'] and \
                (staged.get('quotes_asof') or '') >= \
                (payload.get('quotes_asof') or ''):
            print('RESULT: no change (quotes as-of '
                  f"{staged.get('quotes_asof')} already staged)")
            return None
    msg = (f"NEPSE contributors LIVE {payload['asof']} "
           f"(quotes {payload['quotes_asof']})")
    last_err = 'staging branch unreachable'
    for attempt in range(1, STAGING_MAX_ATTEMPTS + 1):
        tip = _staging_ref()
        if not tip:
            last_err = 'staging ref fetch failed (branch missing?)'
            break
        s, commit = _gh_api('GET', f'/repos/{REPO}/git/commits/{tip}')
        if s != 200 or not isinstance(commit, dict):
            last_err = f'tip commit fetch failed ({s})'
            continue
        base_tree = (commit.get('tree') or {}).get('sha')
        if not base_tree:
            last_err = 'tip commit carries no tree'
            continue
        s, blob = _gh_api('POST', f'/repos/{REPO}/git/blobs',
                          {'content': content, 'encoding': 'utf-8'})
        if s != 201 or not isinstance(blob, dict) or not blob.get('sha'):
            last_err = f'blob create failed ({s})'
            continue
        blob_sha = blob['sha']
        s, tree = _gh_api('POST', f'/repos/{REPO}/git/trees',
                          {'base_tree': base_tree,
                           'tree': [{'path': STAGING_PAYLOAD_PATH,
                                     'mode': '100644', 'type': 'blob',
                                     'sha': blob_sha}]})
        if s != 201 or not isinstance(tree, dict) or not tree.get('sha'):
            last_err = f'tree create failed ({s})'
            continue
        s, new_commit = _gh_api(
            'POST', f'/repos/{REPO}/git/commits',
            {'message': msg, 'tree': tree['sha'], 'parents': [tip]})
        if s != 201 or not isinstance(new_commit, dict) \
                or not new_commit.get('sha'):
            last_err = f'commit create failed ({s})'
            continue
        new_sha = new_commit['sha']
        s, ref = _gh_api('PATCH',
                         f'/repos/{REPO}/git/refs/heads/{STAGING_BRANCH}',
                         {'sha': new_sha, 'force': False})
        if s == 200:
            # Verify: ref moved to our commit AND the path carries
            # our exact blob. A tip move between fetch and PATCH
            # 422s (non-fast-forward) and retries from the new tip.
            if _staging_ref() != new_sha:
                last_err = 'ref verify mismatch after PATCH'
                continue
            cur_sha, _ = _staging_file()
            if cur_sha != blob_sha:
                last_err = 'blob verify mismatch after PATCH'
                continue
            print(f'verified: intraday-staging {new_sha} '
                  f'(blob {blob_sha})')
            return new_sha
        last_err = (f'ref PATCH failed ({s}): '
                    f'{ref if isinstance(ref, str) else ""}'[:300])
        # Tip moved mid-attempt: re-fetch + rebuild + retry.
    _record_stalled(payload_bytes, last_err)
    return None


def build_payload_intraday(live, prev_override=None):
    raw = load_series_dir(os.path.join(ARCHIVE, 'ohlc-db'),
                          ('volume', 'turnover'))
    adjusted = load_adjusted()
    board = compute_intraday(live, raw, adjusted, prev_override)
    now = dt.datetime.now(NPT).replace(microsecond=0).isoformat()
    meth = methodology_block()
    meth['live'] = ('Between 11:00 and 15:00 on trading days this '
                    'board is rebuilt every five minutes from the '
                    'live quote feed: last-traded prices stand in '
                    'for closes, the divisor and the weights are '
                    "carried from the previous session's official "
                    'EOD state (the divisor is a within-day '
                    'constant), and volume and turnover are '
                    'cumulative for the session so far. It is marked '
                    'LIVE and provisional; after the close the final '
                    'board — priced on final revised closes — '
                    'replaces it on this same page and is the board '
                    'that enters the ledger.')
    payload = {
        'schema': 'nd-contributors/v2', 'model': MODEL,
        'mode': 'live', 'intraday': True, 'provisional': True,
        'status': 'PROVISIONAL',
        'asof': board['session'], 'prev_session': board['prev_session'],
        'quotes_asof': live.get('asof'),
        'quotes_count': board.get('quotes_count'),
        'built_at': now,
        'source': 'Live NEPSE quotes (official API via the Nepse '
                  'Decode quote layer): last-traded prices and '
                  'cumulative volume/turnover for the session so '
                  'far; previous closes from the final-revised '
                  'archive (adjusted where it covers a symbol, else '
                  'raw); share counts and the official divisor '
                  "carried from the previous session's official EOD "
                  'state — the same model v2 arithmetic as the final '
                  'board',
        'index': board['index'], 'divisor': board['divisor'],
        'reconciliation': board['reconciliation'],
        'coverage': board['coverage'], 'sectors': board['sectors'],
        'residual_row': board['residual_row'],
        'top_gainers': board['top_gainers'],
        'top_losers': board['top_losers'], 'rows': board['rows'],
        'unscored': board['unscored'], 'methodology': meth,
    }
    try:
        gates(payload_board_view(payload))
    except SystemExit:
        # 2026-11-03: a per-tick gate failure used to print only the
        # gate line, so diagnosis needed a rerun. Print the summary
        # the dry-run path prints, then still fail (no publish).
        rec = payload['reconciliation']
        cov = payload['coverage']
        print(f"live session {payload['asof']} (prev "
              f"{payload['prev_session']}) — official "
              f"{payload['index']['change']:+.2f}, explained "
              f"{rec['explained']:+.2f}, residual "
              f"{rec['residual']:+.2f}")
        print(f"divisor Rs {rec['divisor_rs_per_point']:,.0f} "
              f"({rec['divisor_source']})")
        print(f"quotes {payload['quotes_count']}; scored "
              f"{cov['scored_symbols']} of {cov['universe_symbols']}; "
              f"coverage {cov['cap_coverage_pct']}%")
        raise
    return payload


def build_local_intraday(live, prev_override=None):
    """Provisional publish path. Never overwrites a FINAL board for
    the same session, and never republishes a tape that is not newer
    than the one already live. The ledger is untouched; the recent-
    finals list is carried over from the current payload."""
    payload = build_payload_intraday(live, prev_override)
    out_p = os.path.join(WT, RELPATHS[0])
    existing = None
    if os.path.exists(out_p):
        try:
            existing = json.load(open(out_p))
        except Exception:
            existing = None
    if existing and existing.get('asof') == payload['asof'] and \
            existing.get('status') == 'FINAL':
        print(f"RESULT: no change (final board for {payload['asof']} "
              'already published — provisional never overwrites '
              'final)')
        return payload, False
    if existing and existing.get('provisional') and \
            existing.get('asof') == payload['asof'] and \
            (existing.get('quotes_asof') or '') >= \
            (payload.get('quotes_asof') or ''):
        print('RESULT: no change (quotes as-of '
              f"{existing.get('quotes_asof')} already published)")
        return payload, False
    if existing and existing.get('history_recent'):
        payload['history_recent'] = existing['history_recent']
    with open(out_p, 'w') as f:
        json.dump(payload, f, indent=1)
    return payload, True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--publish', action='store_true')
    ap.add_argument('--intraday', action='store_true',
                    help='provisional LIVE board from a live.json '
                         'snapshot (requires --live)')
    ap.add_argument('--live', help='path to a live.json snapshot '
                                   '(the full payload, not just its '
                                   'quotes array)')
    ap.add_argument('--prev-session',
                    help='replay/testing only: treat this date as '
                         'the last closed session')
    args = ap.parse_args()
    if args.intraday:
        if not args.live:
            raise SystemExit('--intraday requires --live PATH')
        live = json.load(open(args.live))
        if args.publish:
            # 2026-10-30: intraday stages to intraday-staging via
            # the API (deploy_intraday_staging) — NO worktree sync,
            # NO git, NO push to main (branch protection 422s it).
            # build_local_intraday still applies its guards (never
            # overwrite FINAL, never republish stale quotes) and
            # writes the local worktree copy; the staging deploy
            # re-checks both guards against the staged file.
            # (The daily/final --publish branch below was migrated
            # 2026-11-04 to the data-branch writer; it shares no
            # code with this intraday branch.)
            payload, changed = build_local_intraday(
                live, args.prev_session)
            if not changed:
                return
            sha = deploy_intraday_staging(payload)
            if sha:
                print(f"staged LIVE {payload['asof']} (quotes "
                      f"{payload['quotes_asof']}) on "
                      f"{STAGING_BRANCH} as {sha}")
            else:
                print(f"RESULT: SILENT (intraday staging skipped "
                      f"or stalled — see log; next tick retries)")
            return
        payload = build_payload_intraday(live, args.prev_session)
        rec = payload['reconciliation']
        cov = payload['coverage']
        print(f"live session {payload['asof']} (prev "
              f"{payload['prev_session']}) — official "
              f"{payload['index']['change']:+.2f}, explained "
              f"{rec['explained']:+.2f}, residual "
              f"{rec['residual']:+.2f}")
        print(f"divisor Rs {rec['divisor_rs_per_point']:,.0f} "
              f"({rec['divisor_source']})")
        print(f"quotes {payload['quotes_count']}; scored "
              f"{cov['scored_symbols']} of {cov['universe_symbols']}; "
              f"coverage {cov['cap_coverage_pct']}%")
        print('top +:', [(r['symbol'], r['points'])
                         for r in payload['rows'][:5]])
        print('top -:', [(r['symbol'], r['points'])
                         for r in payload['rows'][-5:]])
        return
    if not args.publish:
        payload = build_payload()
        rec = payload['reconciliation']
        cov = payload['coverage']
        print(f"session {payload['asof']} (prev {payload['prev_session']})"
              f" — official {payload['index']['change']:+.2f}, "
              f"explained {rec['explained']:+.2f}, "
              f"residual {rec['residual']:+.2f}")
        print(f"divisor Rs {rec['divisor_rs_per_point']:,.0f} "
              f"({rec['divisor_source']})")
        print(f"scored {cov['scored_symbols']} of "
              f"{cov['universe_symbols']} symbols; cap coverage "
              f"{cov['cap_coverage_pct']}%; share sources "
              f"{cov['shares_source_counts']}")
        print('top +:', [(r['symbol'], r['points'])
                         for r in payload['rows'][:5]])
        print('top -:', [(r['symbol'], r['points'])
                         for r in payload['rows'][-5:]])
        return
    # 2026-11-04 migration: fresh ephemeral checkout + data-branch
    # ledger seed + data-branch writer. The ephemeral checkout is
    # removed on exit even on failure; a no-change build stages
    # nothing (the data branch already holds these exact bytes).
    global WT
    _saved_wt = WT
    ephemeral = prepare_ephemeral_worktree()
    try:
        WT = ephemeral
        seed_component_from_data_branch()
        payload, changed = build_local()
        if not changed:
            print(f"RESULT: no change (session {payload['asof']} "
                  f'already staged)')
            return
        tag = deploy_data_branch(payload)
        print(f"published {payload['asof']} via data-branch writer "
              f"(Publish tag {tag})")
    finally:
        WT = _saved_wt
        remove_ephemeral_worktree(ephemeral)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Nepse Decode — simulator strategy benchmarks (page: /nepse-simulator/).

Runs the page's THREE strategies (buyhold, sma-cross, rsi-swing) over all
symbols with full history across standard trailing windows from the OWNED
OHLC archive (~/workspace/nepse-data-archive/ohlc-db, NOT the community
scraper), with the page's EXACT cost/tax/sizing rules (see js/nepse-
simulator.js runSimulation/costModel — this port replicates them line
for line, including the ATR smoothing quirk and the warm = from+50 rule),
and writes data/sim-benchmarks.json:

  per strategy x window x symbol: return, max drawdown, trade count,
  win rate, profit factor, exit-reason counts, buy-and-hold spread,
  plus per-strategy aggregates and per-sector aggregates.

Re-categorization: the file is REGENERATED on every run (never appended).
Windows end at each symbol's latest session, so as new sessions land the
windows roll forward and previously-pending positions re-resolve:
  resolved = trades closed by stop / target / signal;
  pending  = positions still open at the window end (reason 'end',
             marked to market at the last close).

Gates (any failure aborts before writing):
  G1 window dates within the symbol's history (>= 60 sessions);
  G2 every numeric finite;
  G3 no symbol counted twice per (strategy, window);
  G4 aggregates recompute from rows (independent second pass), never copied.

Usage (stdlib only):
  build-sim-benchmarks.py            # dry run: compute, print, write nothing
  build-sim-benchmarks.py --out FILE # write payload to FILE (no git, no push)
  build-sim-benchmarks.py --publish  # stage via the shared data-branch
                                     # writer (component sim-benchmarks) +
                                     # Publish wait + edge purge + served
                                     # verification; never pushes to
                                     # protected main (2026-11-04 migration,
                                     # Charter v5 item 6: the old parallel-
                                     # pusher path 422'd on 2026-11-03 under
                                     # branch protection).
"""
import argparse
import datetime as dt
import json
import math
import os
import statistics
import subprocess
import sys

HOME = os.path.expanduser('~')
ARCH_DIR = os.path.join(HOME, 'workspace', 'nepse-data-archive', 'ohlc-db')
WT = os.path.join(HOME, 'workspace', 'wt-simbench')
# Data-branch deploy (2026-11-04 migration, Charter v5 item 6): branch
# protection forbids direct pushes to main, so --publish stages the
# payload with the shared data-branch writer (component `sim-benchmarks`,
# already declared in data/_manifest.json with path
# data/sim-benchmarks.json) and waits for the Publish workflow, then
# purges the edge cache and verifies the served bytes. Nothing here
# commits to or pushes from any worktree.
WRITER = os.path.join(HOME, 'workspace', 'tools', 'data-branch-writer.py')
PUBLISH_WAIT = os.path.join(HOME, 'workspace', 'tools', 'publish-wait.py')
PURGE = os.path.join(HOME, 'workspace', 'custom-connectors',
                     'custom.cloudflare', 'bin', 'cloudflare-purge-url.py')
RELPATH = 'data/sim-benchmarks.json'
LIVE_URL = 'https://shirjankhadka.com.np/data/sim-benchmarks.json'
COMPONENT = 'sim-benchmarks'
WRITER_ENV = dict(os.environ,
                  PYTHONPATH='/opt/muse/skills/custom-connector-setup/bin')

START_CASH = 100000.0
RISK_PCT = 1.0
STOP_MULT = 2.0
TARGET_MULT = 4.0
CGT_SHORT = 5.0
CGT_LONG = 3.75
WINDOWS = {'1Y': 252, '3Y': 756, '5Y': 1260, 'MAX': None}
STRATEGIES = ['buyhold', 'sma-cross', 'rsi-swing']
REASONS = {'stop': 'Stop loss', 'target': 'Take profit',
           'signal': 'Strategy exit', 'end': 'End of period'}

# ---------------------------------------------------------------- indicators
# Verbatim ports of js/nepse-simulator.js smaArr / rsiArr / atrArr.


def sma_arr(vals, n):
    out = [None] * len(vals)
    s = 0.0
    for i, v in enumerate(vals):
        s += v
        if i >= n:
            s -= vals[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def rsi_arr(closes, n):
    out = [None] * len(closes)
    if len(closes) < n + 1:
        return out
    g = l = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        if d > 0:
            g += d
        else:
            l -= d
    g /= n
    l /= n
    out[n] = 100.0 if l == 0 else 100 - 100 / (1 + g / l)
    for i in range(n + 1, len(closes)):
        dd = closes[i] - closes[i - 1]
        gg = dd if dd > 0 else 0.0
        ll = -dd if dd < 0 else 0.0
        g = (g * (n - 1) + gg) / n
        l = (l * (n - 1) + ll) / n
        out[i] = 100.0 if l == 0 else 100 - 100 / (1 + g / l)
    return out


def atr_arr(rows, n):
    # rows: [ymd, open, high, low, close, volume, turnover]
    out = [None] * len(rows)
    trs = []
    for i in range(1, len(rows)):
        h, lo, pc = rows[i][2], rows[i][3], rows[i - 1][4]
        trs.append(max(h - lo, abs(h - pc), abs(lo - pc)))
    a = 0.0
    for i, tr in enumerate(trs):
        # JS quirk, kept verbatim: running sum of tr/min(n, i+1), not a
        # plain mean, for i < n; Wilder smoothing only from i >= n.
        a = a + tr / min(n, i + 1) if i < n else (a * (n - 1) + tr) / n
        if i >= n - 1:
            out[i + 1] = a
    return out


# ---------------------------------------------------------------- cost model
class CostModel:
    def __init__(self, costs=True, cgt_short=CGT_SHORT, cgt_long=CGT_LONG):
        self.on = costs
        self.cgt_short = cgt_short
        self.cgt_long = cgt_long

    def commission(self, value):
        if not self.on:
            return 0.0
        if value <= 50000:
            return max(10.0, value * 0.0036)
        if value <= 500000:
            return value * 0.0033
        if value <= 2000000:
            return value * 0.00306
        if value <= 10000000:
            return value * 0.0027
        return value * 0.00243

    def buy_cost(self, value):
        return self.commission(value) + value * 0.00015 + 5.0 if self.on else 0.0

    def sell_cost(self, value):
        return self.commission(value) + value * 0.00015 + 25.0 if self.on else 0.0

    @staticmethod
    def days_between(a, b):
        def ms(s):
            s = str(s)
            return dt.datetime(int(s[0:4]), int(s[4:6]), int(s[6:8]),
                               tzinfo=dt.timezone.utc).timestamp()
        return max(0, round((ms(b) - ms(a)) / 86400))

    def cgt_rate(self, days):
        return self.cgt_long if days > 365 else self.cgt_short


# ---------------------------------------------------------------- engine
# Verbatim port of runSimulation(); indicators are computed over the FULL
# row list (as the page does) and passed in so one symbol's indicators
# serve all its windows.


def simulate(rows, inds, strategy, from_idx, to_idx):
    """rows: full history; inds: dict with s20/s50/rsi/atr over full rows."""
    n = len(rows)
    frm = max(0, from_idx)
    to = n - 1 if to_idx is None else min(n - 1, to_idx)
    if to - frm + 1 < 60:
        return {'error': 'range has fewer than 60 sessions'}
    closes = [r[4] for r in rows]
    s20, s50, rsi, atr = inds['s20'], inds['s50'], inds['rsi'], inds['atr']
    cm = CostModel()
    cash = START_CASH
    pos = None
    open_trade = None
    trades = []
    curve = []

    def net_pos_value(p, price, ymd):
        sell_val = p['qty'] * price
        s_cost = cm.sell_cost(sell_val)
        basis = p['qty'] * p['entry'] + (p.get('buy_cost') or 0)
        taxable = max(0.0, (sell_val - s_cost) - basis)
        cgt = taxable * cm.cgt_rate(cm.days_between(p['entry_ymd'], ymd)) / 100.0 if cm.on else 0.0
        return sell_val - s_cost - cgt

    def equity_at(i):
        return cash + (net_pos_value(pos, closes[i], rows[i][0]) if pos else 0.0)

    def settle_exit(t, exit_idx, price, reason):
        qty = t['qty']
        buy_val = qty * t['entry']
        sell_val = qty * price
        b_cost = t.get('buy_cost') or 0
        s_cost = cm.sell_cost(sell_val)
        basis = buy_val + b_cost
        taxable = max(0.0, (sell_val - s_cost) - basis)
        days = cm.days_between(t['entry_ymd'], rows[exit_idx][0])
        rate = cm.cgt_rate(days)
        cgt = taxable * rate / 100.0 if cm.on else 0.0
        t.update(exit_idx=exit_idx, exit_ymd=rows[exit_idx][0], exit=price,
                 reason=reason, pnl=sell_val - buy_val,
                 buy_cost=b_cost, sell_cost=s_cost,
                 commission=cm.commission(buy_val) + cm.commission(sell_val),
                 other_fees=(b_cost + s_cost) - (cm.commission(buy_val) + cm.commission(sell_val)),
                 cgt=cgt, cgt_rate=rate, holding_days=days,
                 net_pnl=(sell_val - s_cost - cgt) - basis,
                 net_proceeds=sell_val - s_cost - cgt)
        return t

    def exit_pos(i, price, reason):
        nonlocal cash, pos, open_trade
        t = settle_exit(open_trade, i, price, reason)
        cash += t['net_proceeds']
        trades.append(t)
        pos = None
        open_trade = None

    def try_enter(i):
        nonlocal cash, pos, open_trade
        entry, a = closes[i], atr[i]
        if a is None or a <= 0 or entry <= 0:
            return
        stop = entry - STOP_MULT * a
        target = entry + TARGET_MULT * a
        risk_amt = (RISK_PCT / 100.0) * equity_at(i)
        dist = entry - stop
        qty = int(risk_amt // dist) if dist > 0 else 0
        while qty >= 1 and qty * entry + cm.buy_cost(qty * entry) > cash:
            qty -= 1
        if qty < 1:
            return
        b_cost = cm.buy_cost(qty * entry)
        cash -= qty * entry + b_cost
        pos = {'qty': qty, 'entry': entry, 'stop': stop, 'target': target,
               'entry_idx': i, 'entry_ymd': rows[i][0], 'buy_cost': b_cost}
        open_trade = {'entry_idx': i, 'entry_ymd': rows[i][0], 'entry': entry,
                      'qty': qty, 'stop': stop, 'target': target,
                      'buy_cost': b_cost, 'exit_idx': None}

    warm = frm + 50  # SMA50 needs 50 in-range bars before signals are valid

    def enter_signal(i):
        if i < warm:
            return False
        if strategy == 'sma-cross':
            return (s20[i - 1] is not None and s50[i - 1] is not None
                    and s20[i - 1] <= s50[i - 1] and s20[i] > s50[i])
        if strategy == 'rsi-swing':
            return rsi[i] is not None and rsi[i] < 30
        return False

    def exit_signal(i):
        if strategy == 'sma-cross':
            return (s20[i - 1] is not None and s50[i - 1] is not None
                    and s20[i - 1] >= s50[i - 1] and s20[i] < s50[i])
        if strategy == 'rsi-swing':
            return rsi[i] is not None and rsi[i] > 70
        return False

    bh_qty = int(START_CASH // closes[frm])
    while bh_qty >= 1 and bh_qty * closes[frm] + cm.buy_cost(bh_qty * closes[frm]) > START_CASH:
        bh_qty -= 1
    bh_entry = closes[frm]
    bh_buy_cost = cm.buy_cost(bh_qty * bh_entry) if bh_qty >= 1 else 0.0
    bh_cash = START_CASH - bh_qty * bh_entry - bh_buy_cost

    def bh_net_at(b):
        if bh_qty < 1:
            return bh_cash
        return bh_cash + net_pos_value(
            {'qty': bh_qty, 'entry': bh_entry, 'entry_ymd': rows[frm][0],
             'buy_cost': bh_buy_cost}, closes[b], rows[b][0])

    if strategy == 'buyhold':
        if bh_qty >= 1:
            trades.append(settle_exit(
                {'entry_idx': frm, 'entry_ymd': rows[frm][0], 'entry': bh_entry,
                 'qty': bh_qty, 'stop': None, 'target': None,
                 'buy_cost': bh_buy_cost, 'exit_idx': None},
                to, closes[to], 'end'))
        for b in range(frm, to + 1):
            eq = bh_net_at(b)
            curve.append({'i': b, 'ymd': rows[b][0], 'equity': eq, 'bh': eq})
    else:
        for i in range(frm, to + 1):
            if pos and i > pos['entry_idx']:
                lo, hi = rows[i][3], rows[i][2]
                if lo <= pos['stop']:
                    exit_pos(i, pos['stop'], 'stop')
                elif hi >= pos['target']:
                    exit_pos(i, pos['target'], 'target')
            if pos and exit_signal(i):
                exit_pos(i, closes[i], 'signal')
            if not pos and enter_signal(i):
                try_enter(i)
            curve.append({'i': i, 'ymd': rows[i][0], 'equity': equity_at(i),
                          'bh': bh_net_at(i)})
        if pos:
            exit_pos(to, closes[to], 'end')

    final_eq = curve[-1]['equity'] if curve else START_CASH
    bh_final = curve[-1]['bh'] if curve else START_CASH
    wins = [t for t in trades if t['pnl'] > 0]
    peak, mdd = -math.inf, 0.0
    for p in curve:
        peak = max(peak, p['equity'])
        if peak > 0:
            mdd = max(mdd, (peak - p['equity']) / peak * 100.0)
    bh_peak, bh_mdd = -math.inf, 0.0
    for p in curve:
        bh_peak = max(bh_peak, p['bh'])
        if bh_peak > 0:
            bh_mdd = max(bh_mdd, (bh_peak - p['bh']) / bh_peak * 100.0)
    gross_pos = sum(t['net_pnl'] for t in trades if t['net_pnl'] > 0)
    gross_neg = sum(t['net_pnl'] for t in trades if t['net_pnl'] < 0)
    pf = (gross_pos / abs(gross_neg)) if gross_neg < 0 else None
    exit_counts = {k: 0 for k in REASONS}
    for t in trades:
        exit_counts[t['reason']] = exit_counts.get(t['reason'], 0) + 1
    return {
        'error': None, 'strategy': strategy,
        'from_ymd': rows[frm][0], 'to_ymd': rows[to][0],
        'final_equity': final_eq,
        'return_pct': (final_eq - START_CASH) / START_CASH * 100.0,
        'n_trades': len(trades), 'wins': len(wins),
        'win_rate_pct': len(wins) / len(trades) * 100.0 if trades else 0.0,
        'max_drawdown_pct': mdd, 'bh_drawdown_pct': bh_mdd,
        'bh_final': bh_final,
        'bh_return_pct': (bh_final - START_CASH) / START_CASH * 100.0,
        'bh_trades': 1 if bh_qty >= 1 else 0,
        'profit_factor': pf,
        'exit_counts': exit_counts,
        'n_resolved': sum(exit_counts[k] for k in ('stop', 'target', 'signal')),
        'n_pending': exit_counts['end'],
        'net_pnl': sum(t['net_pnl'] for t in trades),
    }


# ---------------------------------------------------------------- loading

def ymd_num(date_str):
    return int(date_str[0:4] + date_str[5:7] + date_str[8:10])


def load_archive_rows(path):
    """Owned archive file -> page-shaped rows, same filter as the page UI."""
    with open(path) as f:
        arch = json.load(f)
    rows = []
    for b in arch.get('bars', []):
        try:
            d = ymd_num(b['date'])
            o, h, lo = float(b['open']), float(b['high']), float(b['low'])
            c = float(b['close'] if b.get('close') is not None else b['ltp'])
            v = float(b.get('volume') or 0)
            t = float(b.get('turnover') or 0)
        except (KeyError, TypeError, ValueError):
            continue
        rows.append([d, o, h, lo, c, v, t])
    rows.sort(key=lambda r: r[0])
    # Page filter: close, high and low all positive.
    return [r for r in rows if r[4] > 0 and r[2] > 0 and r[3] > 0]


def fmt_ymd(ymd):
    s = str(ymd)
    return s[0:4] + '-' + s[4:6] + '-' + s[6:8] if len(s) == 8 else s


# ---------------------------------------------------------------- build

def build_payload(archive_dir, verdicts_path, only_symbols=None):
    sectors = {}
    if verdicts_path and os.path.exists(verdicts_path):
        with open(verdicts_path) as f:
            v = json.load(f)
        sectors = {sym: e.get('sec') for sym, e in (v.get('verdicts') or {}).items()}
    files = sorted(f for f in os.listdir(archive_dir) if f.endswith('.json'))
    rows_out = []
    seen = set()
    skipped = []
    for fn in files:
        sym = fn[:-5]
        if only_symbols and sym not in only_symbols:
            continue
        try:
            rows = load_archive_rows(os.path.join(archive_dir, fn))
        except (OSError, ValueError) as e:
            skipped.append((sym, 'unreadable: ' + str(e)))
            continue
        if len(rows) < 60:
            skipped.append((sym, 'only %d sessions' % len(rows)))
            continue
        closes = [r[4] for r in rows]
        inds = {'s20': sma_arr(closes, 20), 's50': sma_arr(closes, 50),
                'rsi': rsi_arr(closes, 14), 'atr': atr_arr(rows, 14)}
        last = len(rows) - 1
        for strat in STRATEGIES:
            for wname, wlen in WINDOWS.items():
                frm = 0 if wlen is None else max(0, last - wlen + 1)
                if last - frm + 1 < 60:  # G1
                    continue
                key = (strat, wname, sym)
                assert key not in seen, 'duplicate row ' + str(key)  # G3
                seen.add(key)
                res = simulate(rows, inds, strat, frm, last)
                assert res['error'] is None
                for val in (res['return_pct'], res['max_drawdown_pct'],
                            res['bh_return_pct'], res['final_equity']):
                    assert math.isfinite(val), 'non-finite in ' + str(key)  # G2
                rows_out.append({
                    'symbol': sym, 'sector': sectors.get(sym),
                    'strategy': strat, 'window': wname,
                    'from': fmt_ymd(res['from_ymd']), 'to': fmt_ymd(res['to_ymd']),
                    'nSessions': last - frm + 1,
                    'returnPct': res['return_pct'],
                    'finalEquity': res['final_equity'],
                    'maxDrawdownPct': res['max_drawdown_pct'],
                    'bhReturnPct': res['bh_return_pct'],
                    'bhSpreadPct': res['return_pct'] - res['bh_return_pct'],
                    'nTrades': res['n_trades'], 'wins': res['wins'],
                    'winRatePct': res['win_rate_pct'],
                    'profitFactor': res['profit_factor'],
                    'exitCounts': res['exit_counts'],
                    'nResolved': res['n_resolved'], 'nPending': res['n_pending'],
                })
    rows_out.sort(key=lambda r: (r['strategy'], r['window'], r['symbol']))

    def aggregate(subset):
        n = len(subset)
        rets = [r['returnPct'] for r in subset]
        spreads = [r['bhSpreadPct'] for r in subset]
        nt = sum(r['nTrades'] for r in subset)
        nw = sum(r['wins'] for r in subset)
        return {
            'nSymbols': n,
            'meanReturnPct': statistics.fmean(rets) if rets else 0.0,
            'medianReturnPct': statistics.median(rets) if rets else 0.0,
            'meanBhSpreadPct': statistics.fmean(spreads) if spreads else 0.0,
            'winRatePct': nw / nt * 100.0 if nt else 0.0,
            'nTrades': nt,
            'nResolved': sum(r['nResolved'] for r in subset),
            'nPending': sum(r['nPending'] for r in subset),
        }

    aggregates = []
    for strat in STRATEGIES:
        for wname in WINDOWS:
            sub = [r for r in rows_out if r['strategy'] == strat and r['window'] == wname]
            if sub:
                a = aggregate(sub)
                a.update(strategy=strat, window=wname)
                aggregates.append(a)
    sector_aggs = []
    for strat in STRATEGIES:
        for wname in WINDOWS:
            by_sec = {}
            for r in rows_out:
                if r['strategy'] == strat and r['window'] == wname and r['sector']:
                    by_sec.setdefault(r['sector'], []).append(r)
            for sec, sub in sorted(by_sec.items()):
                a = aggregate(sub)
                best = max(sub, key=lambda r: r['returnPct'])
                sector_aggs.append({
                    'strategy': strat, 'window': wname, 'sector': sec,
                    'nSymbols': a['nSymbols'], 'meanReturnPct': a['meanReturnPct'],
                    'bestSymbol': best['symbol'], 'bestReturnPct': best['returnPct'],
                })
    # G4: independent recomputation of one aggregate from rows.
    if aggregates:
        a0 = aggregates[0]
        sub = [r for r in rows_out if r['strategy'] == a0['strategy']
               and r['window'] == a0['window']]
        check = aggregate(sub)
        for k, v in check.items():
            assert abs(a0[k] - v) < 1e-9, 'aggregate mismatch on ' + k
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=45)))
    payload = {
        'generated': now.strftime('%Y-%m-%d %H:%M NPT'),
        'source': 'owned OHLC archive (nepse-data-archive/ohlc-db), '
                  'page engine rules (js/nepse-simulator.js)',
        'defaults': {'startCash': START_CASH, 'riskPct': RISK_PCT,
                     'stopMult': STOP_MULT, 'targetMult': TARGET_MULT,
                     'cgtShort': CGT_SHORT, 'cgtLong': CGT_LONG},
        'windows': list(WINDOWS),
        'strategies': STRATEGIES,
        'rows': rows_out,
        'aggregates': aggregates,
        'sectors': sector_aggs,
        'skipped': [{'symbol': s, 'reason': r} for s, r in skipped],
    }
    return payload


# ---------------------------------------------------------------- publish

def prepare_worktree():
    # 2026-10-29 hardening: shared helper — same create-if-missing +
    # fetch + reset as before, plus lock-aware fetch retry and
    # post-reset HEAD verification (the old unchecked fetch/reset
    # silently continued on failure). Call placements unchanged.
    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from worktree_sync import prepare_worktree as _shared_prepare_worktree
    return _shared_prepare_worktree(WT, repo=os.path.join(HOME, 'workspace', 'wave8-build', 'repo'))


def publish(payload):
    """Data-branch deploy (2026-11-04 migration).

    Stages data/sim-benchmarks.json under the existing `sim-benchmarks`
    manifest component, waits for Publish (unless the writer reports
    NO-CHANGES, in which case there is nothing new to publish), purges
    the served URL, and verifies the served bytes carry this payload's
    `generated` stamp and row count. Any failure raises SystemExit, so
    the cron wrapper retries once and then fails loud — a failed
    publish never reports silent success.

    Deliberately NOT staged here: nothing else. This lane's only output
    is data/sim-benchmarks.json; it writes no shared multi-writer file
    (health.json, status/index.html, jobs.json, manifests), so no
    shared-output handling is needed.

    NO-CHANGES + skip-Publish rationale: a no-change run means the data
    branch already holds these exact bytes, so the previously published
    snapshot already serves them; dispatching Publish again would only
    risk a tag collision on the old snapshot. The purge + served check
    below still proves the bytes are live; if they are not (staged but
    never published, then a no-change rerun), the served check fails
    loud instead of reporting silent success.
    """
    import re as _re
    import tempfile as _tempfile
    import time as _time
    asof = payload['generated'].split()[0]
    if not _re.fullmatch(r'\d{4}-\d{2}-\d{2}', asof):
        raise SystemExit('publish: bad generated stamp %r'
                         % payload['generated'])
    tmp = _tempfile.NamedTemporaryFile(prefix='sim-benchmarks-',
                                       suffix='.json', delete=False)
    try:
        with open(tmp.name, 'w') as f:
            json.dump(payload, f, indent=1)
        msg = 'Simulator benchmarks %s' % asof
        r = subprocess.run(
            [sys.executable, WRITER, '--component', COMPONENT,
             '--asof', asof, '--message', msg,
             '--file', '%s:%s' % (RELPATH, tmp.name)],
            capture_output=True, text=True, timeout=600, env=WRITER_ENV)
        print('deploy: data-branch-writer stdout:\n' + r.stdout)
        if r.stderr:
            print('deploy: data-branch-writer stderr:\n' + r.stderr)
        if r.returncode != 0:
            raise SystemExit('writer failed rc=%d' % r.returncode)
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
            raise SystemExit('deploy: writer status=%r; refusing to publish'
                             % (status,))
        if status == 'NO-CHANGES':
            print('deploy: board already staged (NO-CHANGES); '
                  'skipping Publish wait')
        else:
            snap = proof.get('commit')
            if not snap:
                raise SystemExit('deploy: writer proof has no commit SHA')
            print('deploy: staged data commit %s; waiting for Publish' % snap)
            pw = subprocess.run(
                [sys.executable, PUBLISH_WAIT, '--snapshot', snap,
                 '--timeout', '900', '--interval', '30'],
                capture_output=True, text=True, timeout=1200, env=WRITER_ENV)
            print('deploy: publish-wait stdout:\n' + pw.stdout)
            if pw.stderr:
                print('deploy: publish-wait stderr:\n' + pw.stderr)
            if pw.returncode != 0:
                raise SystemExit('publish-wait failed rc=%d' % pw.returncode)
            published = [l for l in pw.stdout.splitlines()
                         if l.startswith('PUBLISHED ')]
            if not published:
                raise SystemExit('deploy: no PUBLISHED line from publish-wait')
            print('deploy: %s' % published[-1])
        pg = subprocess.run([sys.executable, PURGE, LIVE_URL],
                            capture_output=True, text=True, timeout=300,
                            env=WRITER_ENV)
        print('deploy: purge rc=%d out=%s err=%s'
              % (pg.returncode, pg.stdout.strip(), pg.stderr.strip()))
        _time.sleep(30)
        want_generated = payload['generated']
        want_rows = len(payload['rows'])
        for attempt in (1, 2, 3):
            try:
                cur = subprocess.run(
                    ['curl', '-s', '--max-time', '30', '-A', 'Mozilla/5.0',
                     '-H', 'Cache-Control: no-cache',
                     '-H', 'Pragma: no-cache', LIVE_URL],
                    capture_output=True, text=True, timeout=60)
                if cur.returncode != 0:
                    raise RuntimeError('curl rc=%d err=%s'
                                       % (cur.returncode,
                                          cur.stderr.strip()[:200]))
                live = json.loads(cur.stdout)
                live_generated = live.get('generated')
                live_rows = len(live.get('rows', []))
                print('deploy: served check %d: generated=%s rows=%d '
                      '(want %s/%d)'
                      % (attempt, live_generated, live_rows,
                         want_generated, want_rows))
                if (live_generated == want_generated
                        and live_rows == want_rows):
                    print('deploy: LIVE VERIFIED generated=%s rows=%d'
                          % (want_generated, want_rows))
                    return
            except Exception as e:
                print('deploy: served check %d failed: %s' % (attempt, e))
            if attempt < 3:
                _time.sleep(45)
        raise SystemExit('deploy: served verification failed after 3 attempts')
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=None, help='write payload here (no git)')
    ap.add_argument('--publish', action='store_true')
    ap.add_argument('--archive-dir', default=ARCH_DIR)
    ap.add_argument('--verdicts', default=None,
                    help='verdicts.json for sector mapping (default: '
                         'repo nepse-chart/data/verdicts.json next to tools/)')
    ap.add_argument('--symbols', default=None,
                    help='comma list; restrict to these symbols (QA only)')
    a = ap.parse_args()
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cands = [os.path.join(repo_root, 'nepse-chart', 'data', 'verdicts.json'),
             os.path.join(WT, 'nepse-chart', 'data', 'verdicts.json')]
    verdicts = a.verdicts or next((c for c in cands if os.path.exists(c)), None)
    if a.publish:
        # Sync first so sector verdicts come from fresh origin/main.
        # Input-only: the deploy no longer commits to or pushes from
        # this worktree (data-branch writer path above).
        prepare_worktree()
        if not a.verdicts:
            wt_v = os.path.join(WT, 'nepse-chart', 'data', 'verdicts.json')
            if os.path.exists(wt_v):
                verdicts = wt_v
    only = set(a.symbols.split(',')) if a.symbols else None
    payload = build_payload(a.archive_dir, verdicts, only)
    n = len(payload['rows'])
    print('symbols with rows: %d rows, skipped %d'
          % (len({r['symbol'] for r in payload['rows']}), len(payload['skipped'])))
    for agg in payload['aggregates']:
        print('  %(strategy)s %(window)s n=%(nSymbols)d mean=%(meanReturnPct).2f%% '
              'median=%(medianReturnPct).2f%% win=%(winRatePct).1f%% '
              'trades=%(nTrades)d resolved=%(nResolved)d pending=%(nPending)d'
              % agg)
    if a.publish:
        publish(payload)
        return
    if a.out:
        with open(a.out, 'w') as f:
            json.dump(payload, f, indent=1)
        print('wrote ' + a.out)
    else:
        print('dry run — nothing written (use --out or --publish)')


if __name__ == '__main__':
    main()

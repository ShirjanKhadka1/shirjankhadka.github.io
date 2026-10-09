#!/usr/bin/env python3
"""Nepse Decode: Live signal forward tracker.

Forward-tests the three signal systems in real time against REAL market data.
Every active Entry alert becomes a paper trade at the signal close; each run
walks the trade forward through the owned OHLC archive and closes it when:

  - the session LOW touches the stop loss        -> LOSS  (exit at stop)
  - the session LOW touches the ratcheted trail  -> exit at trail (win/loss on sign)
  - the session HIGH touches Target 1            -> WIN   (exit at target 1)
  - 20 trading sessions pass with no exit        -> TIME EXIT (exit at close)

Exit precedence within one session is conservative: stop first, then trail,
then target. P&L is net of 0.5% round-trip charges (broker + SEBON + DP),
matching the signal pages' stated cost assumption.

Nothing here is invented: entry comes from the signal alert, every exit price
and date comes from a real OHLC bar in ~/workspace/nepse-data-archive/ohlc-db.
If the archive has no forward bars yet, the trade simply stays open — the
closed-trade table starts thin and fills as real sessions elapse.

Data file: nepse-chart/data/signals/live-track-record.json
Each system's signal JSON also receives a `live_track_record` section
(stats + open positions + recent closed) for the website.

Usage:
    python3 tools/track-live-signals.py              # update ledger + inject
    python3 tools/track-live-signals.py --deploy    # update + deploy to GitHub
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIGNALS_DIR = os.path.join(REPO, 'nepse-chart', 'data', 'signals')
TRACK_FILE = os.path.join(SIGNALS_DIR, 'live-track-record.json')
OHLC_DIR = '/home/hatch/workspace/nepse-data-archive/ohlc-db'

SYSTEMS = ['momentum', 'trend-relay', 'reversal']
MAX_HOLD_SESSIONS = 20   # time exit after 20 trading sessions
ROUND_TRIP_COST_PCT = 0.5  # broker + SEBON + DP, matches signal pages
PAPER_NOTIONAL_RS = 1_000_000  # Rs 10L per paper trade (matches backtest sizing)


def log(msg):
    print(f"[live-tracker] {msg}", flush=True)


def get_npt_now():
    npt = timezone(timedelta(hours=5, minutes=45))
    return datetime.now(npt)


def load_track_record():
    if os.path.exists(TRACK_FILE):
        with open(TRACK_FILE) as f:
            return json.load(f)
    return {
        "updated_at": None,
        "tracking_started": None,
        "method": ("Paper trades from live Entry alerts. Exits on real forward OHLC: "
                   "stop loss / ratcheted trailing stop / target 1 / 20-session time exit. "
                   "P&L net of 0.5% round-trip charges. Conservative same-bar precedence: "
                   "stop, then trail, then target."),
        "systems": {s: {"open": [], "closed": [], "stats": {}} for s in SYSTEMS},
    }


_bars_cache = {}


def load_bars(symbol):
    """OHLC bars for a symbol, ascending by date. Cached per run."""
    if symbol in _bars_cache:
        return _bars_cache[symbol]
    path = os.path.join(OHLC_DIR, f"{symbol}.json")
    if not os.path.exists(path):
        _bars_cache[symbol] = None
        return None
    with open(path) as f:
        d = json.load(f)
    bars = sorted(d.get('bars', []), key=lambda b: b['date'])
    _bars_cache[symbol] = bars
    return bars


def net_pct(gross_pct):
    return round(gross_pct - ROUND_TRIP_COST_PCT, 2)


def walk_trade(trade, bars):
    """Walk one open paper trade forward through real OHLC bars.

    Returns (outcome_dict | None, updated_open_trade). outcome_dict has
    exit_date/exit_price/exit_reason/outcome/pnl_pct/pnl_rs/hold_sessions.
    """
    entry = trade['entry_price']
    stop = trade['stop_loss']
    target = trade['target_1']
    risk = entry - stop if entry and stop else 0
    trail = trade.get('trail_stop', stop) or stop
    sessions = trade.get('sessions_held', 0)

    fwd = [b for b in bars if b['date'] > trade['entry_date']]
    current_close = trade.get('current_price', entry)
    outcome = None

    for bar in fwd:
        sessions += 1
        lo, hi, cl = bar['low'], bar['high'], bar['close']
        current_close = cl
        # Ratchet the trailing stop: keep `risk` distance below the close,
        # but only ever upward, and only once price is above entry.
        if risk > 0 and cl > entry:
            trail = max(trail, round(cl - risk, 2))

        exit_price, reason = None, None
        if stop > 0 and lo <= stop:
            exit_price, reason = stop, "Stop loss hit"
        elif trail > stop and lo <= trail:
            exit_price, reason = trail, "Trailing stop hit"
        elif target > 0 and hi >= target:
            exit_price, reason = target, "Target 1 hit"
        elif sessions >= MAX_HOLD_SESSIONS:
            exit_price, reason = cl, f"Time exit ({MAX_HOLD_SESSIONS} sessions)"

        if exit_price is not None:
            gross = (exit_price - entry) / entry * 100 if entry > 0 else 0
            pnl = net_pct(gross)
            outcome = {
                "outcome": "win" if pnl > 0 else "loss",
                "exit_date": bar['date'],
                "exit_price": exit_price,
                "exit_reason": reason,
                "pnl_pct": pnl,
                "pnl_rs": round(pnl / 100 * entry * trade.get('qty', 0), 2),
                "hold_sessions": sessions,
            }
            break

    unreal = round((current_close - entry) / entry * 100, 2) if entry > 0 else 0
    open_trade = {
        **trade,
        "trail_stop": trail,
        "sessions_held": sessions,
        "current_price": current_close,
        "unrealized_pct": unreal,
        "data_through": fwd[-1]['date'] if fwd else trade['entry_date'],
    }
    return outcome, open_trade


def capture_new_signals(track):
    """Capture active Entry alerts as paper trades (dedupe on symbol+entry_date)."""
    now = get_npt_now()
    if not track.get('tracking_started'):
        track['tracking_started'] = now.strftime('%Y-%m-%d')
    for system in SYSTEMS:
        path = os.path.join(SIGNALS_DIR, f'{system}.json')
        if not os.path.exists(path):
            continue
        with open(path) as f:
            data = json.load(f)
        sys_track = track['systems'].setdefault(system, {"open": [], "closed": [], "stats": {}})
        seen = {(t['symbol'], t['entry_date']) for t in sys_track['open']}
        seen.update((t['symbol'], t['entry_date']) for t in sys_track['closed'])
        for alert in data.get('alerts', []):
            if alert.get('alert') != 'Entry' or alert.get('status') != 'active':
                continue
            symbol, entry_date = alert.get('symbol'), alert.get('date')
            if not symbol or not entry_date or (symbol, entry_date) in seen:
                continue
            entry = alert.get('entry')
            qty = round(PAPER_NOTIONAL_RS / entry) if entry and entry > 0 else 0
            # NOTE (honesty): the alert's trail_stop is the CURRENT ratcheted value
            # as of the signal build (data_asof), i.e. it already reflects price
            # action AFTER entry. Using it would be lookahead bias. The paper
            # trade starts its trail at the stop loss and ratchets it itself,
            # bar by bar, in walk_trade().
            stop = alert.get('stop_loss')
            sys_track['open'].append({
                "symbol": symbol,
                "system": system,
                "rule": alert.get('rule'),
                "entry_date": entry_date,
                "entry_price": entry,
                "qty": qty,
                "stop_loss": stop,
                "trail_stop": stop,
                "target_1": alert.get('target_1'),
                "target_2": alert.get('target_2'),
                "status": "open",
                "sessions_held": 0,
                "current_price": entry,
                "unrealized_pct": 0.0,
                "data_through": entry_date,
                "captured_at": now.isoformat(),
            })
            log(f"{system}: captured {symbol} @ Rs {entry} ({entry_date})")


def update_open_positions(track):
    """Advance every open trade through real forward OHLC; close on exits."""
    for system in SYSTEMS:
        sys_track = track['systems'].get(system, {})
        still_open = []
        for trade in sys_track.get('open', []):
            bars = load_bars(trade['symbol'])
            if not bars:
                log(f"{system}: {trade['symbol']} — no OHLC archive, kept open")
                still_open.append(trade)
                continue
            outcome, updated = walk_trade(trade, bars)
            if outcome:
                closed = {**updated, "status": "closed", **outcome,
                          "closed_at": get_npt_now().isoformat()}
                sys_track['closed'].insert(0, closed)
                log(f"{system}: {trade['symbol']} CLOSED {outcome['outcome']} "
                    f"({outcome['pnl_pct']:+.2f}% net, {outcome['exit_reason']}, "
                    f"exit {outcome['exit_date']} @ {outcome['exit_price']})")
            else:
                still_open.append(updated)
        sys_track['open'] = still_open


def calculate_stats(track):
    for system in SYSTEMS:
        sys_track = track['systems'].get(system, {})
        closed = sys_track.get('closed', [])
        opens = sys_track.get('open', [])
        wins = [t for t in closed if t['outcome'] == 'win']
        losses = [t for t in closed if t['outcome'] == 'loss']
        n = len(closed)
        win_rate = round(len(wins) / n * 100, 2) if n else 0.0
        fail_rate = round(len(losses) / n * 100, 2) if n else 0.0
        avg_win = round(sum(t['pnl_pct'] for t in wins) / len(wins), 2) if wins else 0.0
        avg_loss = round(sum(t['pnl_pct'] for t in losses) / len(losses), 2) if losses else 0.0
        gross_p = sum(t['pnl_pct'] for t in wins)
        gross_l = abs(sum(t['pnl_pct'] for t in losses))
        pf = round(gross_p / gross_l, 2) if gross_l > 0 else 0.0
        best = max(closed, key=lambda t: t['pnl_pct']) if closed else None
        worst = min(closed, key=lambda t: t['pnl_pct']) if closed else None
        data_through = max(
            [t.get('data_through', '') for t in opens] +
            [t.get('exit_date', '') for t in closed] + [''], key=lambda x: x or '')
        sys_track['stats'] = {
            "tracking_started": track.get('tracking_started'),
            "data_through": data_through or None,
            "open_positions": len(opens),
            "closed_trades": n,
            "total_signals": n + len(opens),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": win_rate,
            "failure_rate_pct": fail_rate,
            "avg_win_pct": avg_win,
            "avg_loss_pct": avg_loss,
            "profit_factor": pf,
            "round_trip_cost_pct": ROUND_TRIP_COST_PCT,
            "best_trade": ({k: best[k] for k in
                            ('symbol', 'pnl_pct', 'entry_date', 'exit_date', 'exit_reason')}
                           if best else None),
            "worst_trade": ({k: worst[k] for k in
                             ('symbol', 'pnl_pct', 'entry_date', 'exit_date', 'exit_reason')}
                            if worst else None),
            "last_updated": get_npt_now().isoformat(),
        }
        log(f"{system}: {n} closed ({len(wins)}W/{len(losses)}L), {len(opens)} open, "
            f"win {win_rate}%, fail {fail_rate}%, PF {pf}")


def inject_into_signal_jsons(track):
    for system in SYSTEMS:
        path = os.path.join(SIGNALS_DIR, f'{system}.json')
        if not os.path.exists(path):
            continue
        with open(path) as f:
            data = json.load(f)
        sys_track = track['systems'].get(system, {})
        data['live_track_record'] = {
            "tracking_started": track.get('tracking_started'),
            "method": track.get('method'),
            "stats": sys_track.get('stats', {}),
            "open_positions": sys_track.get('open', []),
            "recent_closed": sys_track.get('closed', [])[:30],
            "note": ("Forward-tested paper trades from this system's live alerts. "
                     "Entries at the signal close; exits on real forward OHLC "
                     "(target 1 / stop loss / trailing stop / 20-session time exit). "
                     "P&L is net of 0.5% round-trip charges. Updated daily after close."),
        }
        with open(path, 'w') as f:
            json.dump(data, f, separators=(',', ':'))
    log("live_track_record injected into the three signal JSONs")


def deploy():
    log("Deploying live track record...")
    subprocess.run(['git', 'fetch', 'origin', 'main', '-q'], cwd=REPO,
                   capture_output=True, timeout=60)
    wt_dir = f"/home/hatch/workspace/tmp/wt-live-track-{int(time.time())}"
    result = subprocess.run(
        ['git', 'worktree', 'add', '--detach', wt_dir, 'origin/main'],
        cwd=REPO, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"worktree failed: {result.stderr[:300]}")
    try:
        files = ['nepse-chart/data/signals/live-track-record.json']
        for s in SYSTEMS:
            files.append(f'nepse-chart/data/signals/{s}.json')
        for relpath in files:
            src = os.path.join(REPO, relpath)
            dst = os.path.join(wt_dir, relpath)
            if os.path.exists(src):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
        subprocess.run(['git', 'add'] + files, cwd=wt_dir, capture_output=True, timeout=30)
        result = subprocess.run(
            ['git', 'commit', '-m', 'Update live signal track record (auto)'],
            cwd=wt_dir, capture_output=True, text=True, timeout=30)
        if 'nothing to commit' in result.stdout:
            log("No changes to deploy")
            return
        local_ref = subprocess.run(
            ['git', 'rev-parse', 'HEAD'], cwd=wt_dir,
            capture_output=True, text=True, timeout=10).stdout.strip()
        result = subprocess.run(
            [sys.executable, '/home/hatch/workspace/skills/github/bin/github-push.py',
             '--repo', 'ShirjanKhadka1/shirjankhadka.github.io',
             '--local-ref', local_ref, '--branch', 'main', '--repo-dir', wt_dir,
             '--message', 'Update live signal track record (auto)'],
            capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"Push failed: {result.stderr[-500:]}")
        log("Deployed successfully")
    finally:
        subprocess.run(['git', 'worktree', 'remove', wt_dir, '--force'],
                       cwd=REPO, capture_output=True, timeout=30)


def main():
    ap = argparse.ArgumentParser(description='Forward-track live signal performance on real OHLC')
    ap.add_argument('--deploy', action='store_true', help='Deploy after update')
    args = ap.parse_args()

    track = load_track_record()
    capture_new_signals(track)
    update_open_positions(track)
    calculate_stats(track)
    track['updated_at'] = get_npt_now().isoformat()

    with open(TRACK_FILE, 'w') as f:
        json.dump(track, f, indent=2)
    log(f"Saved {TRACK_FILE}")

    inject_into_signal_jsons(track)

    if args.deploy:
        deploy()
    log("Done")


if __name__ == '__main__':
    sys.exit(main())

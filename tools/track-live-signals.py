#!/usr/bin/env python3
"""Nepse Decode: Live signal performance tracker.

Forward-tests the signal systems in real time. When a system generates a BUY
alert, this tracker records it as a paper trade at the signal price. Each day
it checks:
  - Did the price hit target_1? → WIN (record profit)
  - Did the price hit stop_loss? → LOSS (record loss)
  - Held more than MAX_HOLD_DAYS? → TIME EXIT (close at current price)

The live win rate feeds back into the system:
  - Each system's JSON gets a `live_track_record` section
  - The website displays live success rate alongside backtest stats
  - Over time, systems with better live performance earn more prominence

This is the feedback loop that makes the system "more powerful" — it learns
from real forward-tested signals, not just historical backtests.

Data file: nepse-chart/data/signals/live-track-record.json
    {
        "updated_at": "2026-10-08T...",
        "systems": {
            "momentum": {
                "open": [...],      # currently tracked signals
                "closed": [...],     # completed paper trades, newest first
                "stats": {
                    "total_signals": 25,
                    "wins": 14, "losses": 8, "time_exits": 3,
                    "win_rate_pct": 56.0,
                    "avg_win_pct": 8.2, "avg_loss_pct": -4.1,
                    "profit_factor": 1.8,
                    "best": {...}, "worst": {...}
                }
            },
            ...
        }
    }

Usage:
    python3 tools/track-live-signals.py              # update tracking
    python3 tools/track-live-signals.py --deploy    # update + deploy
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
LIVE_JSON = os.path.join(REPO, 'nepse-chart', 'data', 'live.json')

SYSTEMS = ['momentum', 'trend-relay', 'reversal']
MAX_HOLD_DAYS = 20  # auto-close after 20 trading days if no target/stop hit


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
        "systems": {s: {"open": [], "closed": [], "stats": {}} for s in SYSTEMS}
    }


def get_current_prices():
    """Get latest closing prices from live.json."""
    if not os.path.exists(LIVE_JSON):
        log(f"WARNING: {LIVE_JSON} not found")
        return {}, None
    with open(LIVE_JSON) as f:
        data = json.load(f)
    quotes = data.get('quotes', {})
    session = data.get('session_date', data.get('asof'))
    prices = {}
    if isinstance(quotes, dict):
        for sym, q in quotes.items():
            if isinstance(q, dict):
                prices[sym] = q.get('close', q.get('ltp', q.get('price', 0)))
            elif isinstance(q, (int, float)):
                prices[sym] = q
    elif isinstance(quotes, list):
        for q in quotes:
            if isinstance(q, dict) and 'symbol' in q:
                sym = q['symbol']
                prices[sym] = q.get('close', q.get('ltp', q.get('price', 0)))
    return prices, session


def capture_new_signals(track, prices, session_date):
    """Capture new Entry alerts as paper trades."""
    for system in SYSTEMS:
        path = os.path.join(SIGNALS_DIR, f'{system}.json')
        if not os.path.exists(path):
            continue
        with open(path) as f:
            data = json.load(f)

        alerts = data.get('alerts', [])
        sys_track = track['systems'].setdefault(system, {"open": [], "closed": [], "stats": {}})

        # Get symbols already tracked (open or recently closed)
        tracked_symbols = {t['symbol'] for t in sys_track['open']}
        tracked_symbols.update(t['symbol'] for t in sys_track['closed'][:10])

        for alert in alerts:
            if alert.get('alert') != 'Entry':
                continue
            if alert.get('status') != 'active':
                continue
            symbol = alert.get('symbol')
            if not symbol or symbol in tracked_symbols:
                continue

            # New signal - start tracking
            paper_trade = {
                "symbol": symbol,
                "system": system,
                "entry_date": alert.get('date'),
                "entry_price": alert.get('entry'),
                "stop_loss": alert.get('stop_loss'),
                "target_1": alert.get('target_1'),
                "target_2": alert.get('target_2'),
                "rule": alert.get('rule'),
                "status": "open",
                "hold_days": 0,
                "current_price": alert.get('current', alert.get('entry')),
                "unrealized_pct": 0,
                "captured_at": get_npt_now().isoformat(),
            }
            sys_track['open'].append(paper_trade)
            log(f"{system}: tracking new signal {symbol} @ Rs {alert.get('entry')}")


def update_open_positions(track, prices, session_date):
    """Check open positions for target hits, stop hits, or time exits."""
    for system in SYSTEMS:
        sys_track = track['systems'].get(system, {})
        still_open = []
        for trade in sys_track.get('open', []):
            symbol = trade['symbol']
            current = prices.get(symbol, trade.get('current_price', trade['entry_price']))
            entry = trade['entry_price']
            stop = trade.get('stop_loss', 0)
            target = trade.get('target_1', float('inf'))

            trade['current_price'] = current
            trade['hold_days'] = trade.get('hold_days', 0) + 1
            if entry > 0:
                trade['unrealized_pct'] = round((current - entry) / entry * 100, 2)

            outcome = None
            exit_price = current
            exit_reason = None

            # Check target hit (use target_1 as primary)
            if current >= target and target > 0:
                outcome = "win"
                exit_price = target
                exit_reason = "Target 1 hit"
            # Check stop loss
            elif stop > 0 and current <= stop:
                outcome = "loss"
                exit_price = stop
                exit_reason = "Stop loss hit"
            # Check time exit
            elif trade['hold_days'] >= MAX_HOLD_DAYS:
                outcome = "time_exit"
                exit_reason = f"Time exit ({MAX_HOLD_DAYS} days)"

            if outcome:
                pnl_pct = round((exit_price - entry) / entry * 100, 2) if entry > 0 else 0
                closed_trade = {
                    **trade,
                    "status": "closed",
                    "outcome": outcome,
                    "exit_date": session_date,
                    "exit_price": exit_price,
                    "exit_reason": exit_reason,
                    "pnl_pct": pnl_pct,
                    "closed_at": get_npt_now().isoformat(),
                }
                # Remove tracking-only fields
                closed_trade.pop('current_price', None)
                closed_trade.pop('unrealized_pct', None)
                closed_trade.pop('captured_at', None)

                sys_track['closed'].insert(0, closed_trade)  # newest first
                log(f"{system}: {symbol} CLOSED as {outcome} "
                    f"({pnl_pct:+.2f}%, {exit_reason})")
            else:
                still_open.append(trade)

        sys_track['open'] = still_open


def calculate_stats(track):
    """Calculate live performance stats for each system."""
    for system in SYSTEMS:
        sys_track = track['systems'].get(system, {})
        closed = sys_track.get('closed', [])
        open_trades = sys_track.get('open', [])

        wins = [t for t in closed if t['outcome'] == 'win']
        losses = [t for t in closed if t['outcome'] == 'loss']
        time_exits = [t for t in closed if t['outcome'] == 'time_exit']

        # Time exits with profit count as wins, with loss as losses
        profitable_exits = [t for t in time_exits if t.get('pnl_pct', 0) > 0]
        losing_exits = [t for t in time_exits if t.get('pnl_pct', 0) <= 0]

        total_wins = len(wins) + len(profitable_exits)
        total_losses = len(losses) + len(losing_exits)
        total_closed = len(closed)

        win_rate = (total_wins / total_closed * 100) if total_closed > 0 else 0

        all_wins = wins + profitable_exits
        all_losses = losses + losing_exits
        avg_win = sum(t['pnl_pct'] for t in all_wins) / len(all_wins) if all_wins else 0
        avg_loss = sum(t['pnl_pct'] for t in all_losses) / len(all_losses) if all_losses else 0

        gross_profit = sum(t['pnl_pct'] for t in all_wins)
        gross_loss = abs(sum(t['pnl_pct'] for t in all_losses))
        profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0

        best = max(closed, key=lambda t: t.get('pnl_pct', -999)) if closed else None
        worst = min(closed, key=lambda t: t.get('pnl_pct', 999)) if closed else None

        sys_track['stats'] = {
            "total_signals": total_closed + len(open_trades),
            "closed_trades": total_closed,
            "open_positions": len(open_trades),
            "wins": total_wins,
            "losses": total_losses,
            "win_rate_pct": round(win_rate, 2),
            "avg_win_pct": round(avg_win, 2),
            "avg_loss_pct": round(avg_loss, 2),
            "profit_factor": profit_factor,
            "best_trade": {
                "symbol": best['symbol'], "pnl_pct": best['pnl_pct'],
                "entry_date": best['entry_date'], "exit_date": best.get('exit_date')
            } if best else None,
            "worst_trade": {
                "symbol": worst['symbol'], "pnl_pct": worst['pnl_pct'],
                "entry_date": worst['entry_date'], "exit_date": worst.get('exit_date')
            } if worst else None,
            "last_updated": get_npt_now().isoformat(),
        }

        log(f"{system}: {total_closed} closed, {len(open_trades)} open, "
            f"win rate {win_rate:.1f}%, PF {profit_factor}")


def inject_into_signal_jsons(track):
    """Inject live track record into each system's JSON for the website."""
    for system in SYSTEMS:
        path = os.path.join(SIGNALS_DIR, f'{system}.json')
        if not os.path.exists(path):
            continue
        with open(path) as f:
            data = json.load(f)

        sys_track = track['systems'].get(system, {})
        data['live_track_record'] = {
            "stats": sys_track.get('stats', {}),
            "open_positions": sys_track.get('open', []),
            "recent_closed": sys_track.get('closed', [])[:20],
            "note": "Forward-tested paper trades from live signals. "
                    "Win = hit target, Loss = hit stop, Time exit = closed after "
                    f"{MAX_HOLD_DAYS} days. Updated daily.",
        }

        with open(path, 'w') as f:
            json.dump(data, f, separators=(',', ':'))

    log("Live track records injected into signal JSONs")


def deploy():
    """Deploy track record + updated signal JSONs."""
    log("Deploying...")
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
    ap = argparse.ArgumentParser(description='Track live signal performance')
    ap.add_argument('--deploy', action='store_true', help='Deploy after update')
    args = ap.parse_args()

    track = load_track_record()
    prices, session_date = get_current_prices()

    if not session_date:
        log("ERROR: Could not determine session date from live.json")
        sys.exit(1)

    log(f"Session: {session_date}, {len(prices)} symbols with prices")

    # Step 1: Capture new signals
    capture_new_signals(track, prices, session_date)

    # Step 2: Update open positions
    update_open_positions(track, prices, session_date)

    # Step 3: Calculate stats
    calculate_stats(track)

    track['updated_at'] = get_npt_now().isoformat()

    # Save
    with open(TRACK_FILE, 'w') as f:
        json.dump(track, f, indent=2)
    log(f"Saved to {TRACK_FILE}")

    # Step 4: Inject into signal JSONs
    inject_into_signal_jsons(track)

    if args.deploy:
        deploy()

    log("Done")


if __name__ == '__main__':
    sys.exit(main())

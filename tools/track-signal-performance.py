#!/usr/bin/env python3
"""Nepse Decode: Signal performance history tracker.

Records the success rate (win rate) and key performance metrics for each
signal system after every rebuild, building a historical record over time.

This runs automatically after tools/build-signals.js rebuilds the signal JSONs.
It reads the current stats from each system's JSON and appends a timestamped
snapshot to the performance history file.

Output: nepse-chart/data/signals/performance-history.json
    {
        "updated_at": "2026-10-08T21:30:00+05:45",
        "systems": {
            "momentum": [
                {"date": "2026-10-08", "win_rate_pct": 33.33, "total_trades": 771,
                 "profit_factor": 2.07, "annual_return_pct": 111.25,
                 "max_drawdown_pct": 15.69, "avg_win_pct": 29.31, "avg_loss_pct": 7.08},
                ...
            ],
            "trend-relay": [...],
            "reversal": [...]
        }
    }

Only appends a new record if the stats changed since the last record
(avoids duplicate entries from rebuilds with no new data).

Usage:
    python3 tools/track-signal-performance.py
    python3 tools/track-signal-performance.py --deploy  (also deploys to GitHub)
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
HISTORY_FILE = os.path.join(SIGNALS_DIR, 'performance-history.json')

SYSTEMS = ['momentum', 'trend-relay', 'reversal']

# Metrics to track over time
TRACKED_METRICS = [
    'win_rate_pct',
    'total_trades',
    'profit_factor',
    'annual_return_pct',
    'total_return_pct',
    'max_drawdown_pct',
    'avg_win_pct',
    'avg_loss_pct',
    'avg_holding_days',
    'sharpe',
    'sortino',
]


def log(msg):
    print(f"[signal-tracker] {msg}", flush=True)


def get_npt_now():
    """Current time in Nepal (UTC+5:45)."""
    npt = timezone(timedelta(hours=5, minutes=45))
    return datetime.now(npt)


def load_history():
    """Load existing performance history, or create empty structure."""
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE) as f:
            return json.load(f)
    return {"updated_at": None, "systems": {s: [] for s in SYSTEMS}}


def get_current_stats(system):
    """Read current stats from a signal system's JSON."""
    path = os.path.join(SIGNALS_DIR, f'{system}.json')
    if not os.path.exists(path):
        log(f"WARNING: {path} not found, skipping {system}")
        return None

    with open(path) as f:
        data = json.load(f)

    stats = data.get('stats', {})
    if not stats:
        log(f"WARNING: No stats in {system}.json, skipping")
        return None

    record = {"date": get_npt_now().strftime('%Y-%m-%d')}
    for metric in TRACKED_METRICS:
        record[metric] = stats.get(metric)

    # Also capture trade counts for context
    trade_counts = data.get('trade_counts', {})
    record['closed_total'] = trade_counts.get('closed_total')
    record['active_positions'] = trade_counts.get('active')

    return record


def stats_changed(last_record, new_record):
    """Check if stats meaningfully changed since last record."""
    if not last_record:
        return True
    # Compare key metrics - if win rate or total trades changed, it's new
    for key in ['win_rate_pct', 'total_trades', 'profit_factor']:
        if last_record.get(key) != new_record.get(key):
            return True
    return False


def update_history():
    """Update performance history with current stats."""
    history = load_history()
    now = get_npt_now()
    updated_systems = []

    for system in SYSTEMS:
        stats = get_current_stats(system)
        if not stats:
            continue

        records = history['systems'].setdefault(system, [])
        last = records[-1] if records else None

        # Only append if stats changed or it's a new date
        if stats_changed(last, stats) or (last and last.get('date') != stats['date']):
            records.append(stats)
            updated_systems.append(system)
            log(f"{system}: recorded {stats['date']} "
                f"(win {stats.get('win_rate_pct')}%, "
                f"trades {stats.get('total_trades')}, "
                f"PF {stats.get('profit_factor')})")
        else:
            log(f"{system}: no change since last record, skipping")

    history['updated_at'] = now.isoformat()

    # Write back
    with open(HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2)

    log(f"History updated: {HISTORY_FILE}")
    return updated_systems


def deploy():
    """Deploy the history file to GitHub Pages."""
    log("Deploying performance history...")

    result = subprocess.run(['git', 'fetch', 'origin', 'main', '-q'],
                            cwd=REPO, capture_output=True, timeout=60)

    wt_dir = f"/home/hatch/workspace/tmp/wt-perf-hist-{int(time.time())}"
    result = subprocess.run(
        ['git', 'worktree', 'add', '--detach', wt_dir, 'origin/main'],
        cwd=REPO, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"worktree add failed: {result.stderr[:300]}")

    try:
        src = HISTORY_FILE
        dst = os.path.join(wt_dir, 'nepse-chart', 'data', 'signals', 'performance-history.json')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)

        subprocess.run(['git', 'add', 'nepse-chart/data/signals/performance-history.json'],
                       cwd=wt_dir, capture_output=True, timeout=30)
        result = subprocess.run(
            ['git', 'commit', '-m', 'Update signal performance history (auto)'],
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
             '--message', 'Update signal performance history (auto)'],
            capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"Push failed: {result.stderr[-500:]}")
        log("Deployed successfully")
    finally:
        subprocess.run(['git', 'worktree', 'remove', wt_dir, '--force'],
                       cwd=REPO, capture_output=True, timeout=30)


def main():
    ap = argparse.ArgumentParser(description='Track signal system performance over time')
    ap.add_argument('--deploy', action='store_true', help='Deploy history file to GitHub Pages')
    args = ap.parse_args()

    updated = update_history()

    if args.deploy and updated:
        deploy()
    elif args.deploy:
        log("No new records, skipping deploy")

    log("Done")


if __name__ == '__main__':
    sys.exit(main())

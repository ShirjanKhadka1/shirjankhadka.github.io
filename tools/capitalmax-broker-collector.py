#!/usr/bin/env python3
"""Nepse Decode: Capital Max broker data collector.

Pulls daily broker turnover data from Capital Max (the permanent daily source
for broker/floorsheet data per user's 2026-10-08 order) and updates our archive.

This script handles the DATA PROCESSING side. The actual browser automation
(fetching from Capital Max) is done by the calling cron worker via browser task,
which passes the extracted JSON via --data-file.

Usage:
    python3 tools/capitalmax-broker-collector.py --data-file /path/to/brokers.json [--date YYYY-MM-DD]
    python3 tools/capitalmax-broker-collector.py --data-file /path/to/brokers.json --deploy

Data file format (from Capital Max Top Brokers page):
    {
        "date": "2026-10-08",
        "market_turnover": 3930560952.76,
        "brokers": [
            {"rank": 1, "code": 58, "name": "Naasa Securities Co. Ltd.",
             "buy_value": 349355147.78, "sell_value": 403223414.04,
             "total": 752578561.82, "matching": 84450631.40},
            ...
        ]
    }

Pipeline:
    1. Validate the data (91 brokers, nonzero values, date = last trading day)
    2. Archive to ~/workspace/nepse-data-archive/capitalmax/YYYY-MM-DD/
    3. Insert into tools/broker/data/floorsheet.db (daily_summary)
    4. Rebuild all period JSONs via export_broker_data.py
    5. Re-bake the HTML snapshot via bake-broker-snapshot.py
    6. Optionally deploy to GitHub Pages (--deploy)

Exit codes:
    0: success
    1: validation failed (do not deploy)
    2: no data / market holiday
"""
import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import date, datetime, timedelta

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(REPO, 'tools', 'broker', 'data', 'floorsheet.db')
ARCHIVE_BASE = '/home/hatch/workspace/nepse-data-archive/capitalmax'
HOLIDAYS_FILE = '/home/hatch/workspace/nepse-data-archive/nepse-holidays.txt'

EXPECTED_BROKERS = 91  # NEPSE has 91 licensed brokers


def log(msg):
    print(f"[capitalmax-collector] {msg}", flush=True)


def is_trading_day(d):
    """Check if a date is a NEPSE trading day (Mon-Fri, not a holiday)."""
    if d.weekday() >= 5:  # Sat-Sun
        return False
    if os.path.exists(HOLIDAYS_FILE):
        with open(HOLIDAYS_FILE) as f:
            holidays = set(line.strip() for line in f if line.strip())
        if d.isoformat() in holidays:
            return False
    return True


def get_last_trading_day():
    """Get the most recent trading day."""
    d = date.today()
    # If it's before market close, use yesterday
    # Market closes at 15:00 NPT
    now = datetime.now()
    if d.weekday() < 5 and now.hour < 15:
        d -= timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d.isoformat()


def validate_data(data, expected_date):
    """Validate the Capital Max data. Returns (ok, errors)."""
    errors = []

    # Check date
    data_date = data.get('date')
    if data_date != expected_date:
        errors.append(f"Date mismatch: got {data_date}, expected {expected_date}")

    # Check broker count
    brokers = data.get('brokers', [])
    if len(brokers) < EXPECTED_BROKERS - 5:  # Allow small variance
        errors.append(f"Too few brokers: got {len(brokers)}, expected ~{EXPECTED_BROKERS}")

    # Check for nonzero values
    total_buy = sum(b.get('buy_value', 0) for b in brokers)
    total_sell = sum(b.get('sell_value', 0) for b in brokers)
    if total_buy == 0:
        errors.append("All buy values are zero - data looks empty")
    if total_sell == 0:
        errors.append("All sell values are zero - data looks empty")

    # Check market turnover is reasonable (NEPSE daily turnover is typically Rs 1B - 20B)
    turnover = data.get('market_turnover', 0)
    if turnover < 1e8:  # Less than 10 crore is suspicious
        errors.append(f"Market turnover suspiciously low: Rs {turnover:,.0f}")

    # Check buy/sell balance (should be roughly equal at market level)
    if total_buy > 0 and total_sell > 0:
        ratio = total_buy / total_sell
        if ratio < 0.8 or ratio > 1.25:
            errors.append(f"Buy/sell imbalance: buy={total_buy:,.0f}, sell={total_sell:,.0f}, ratio={ratio:.2f}")

    return len(errors) == 0, errors


def archive_data(data, date_str):
    """Archive the raw Capital Max data."""
    arch_dir = os.path.join(ARCHIVE_BASE, date_str)
    os.makedirs(arch_dir, exist_ok=True)
    arch_path = os.path.join(arch_dir, 'top-brokers.json')
    with open(arch_path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    log(f"Archived to {arch_path}")
    return arch_path


def update_db(data, date_str):
    """Insert broker aggregates into floorsheet.db."""
    con = sqlite3.connect(DB)
    cur = con.cursor()

    # Check if date already exists
    cur.execute("SELECT COUNT(*) FROM daily_summary WHERE date = ?", (date_str,))
    existing = cur.fetchone()[0]
    if existing > 0:
        log(f"Date {date_str} already has {existing} rows in DB, skipping insert")
        con.close()
        return False

    rows = []
    for b in data['brokers']:
        broker_code = str(b['code'])
        rows.append((
            date_str,
            broker_code,
            '',  # empty symbol = broker-level aggregate (no symbol breakdown from Capital Max)
            0,   # buy_qty (not available from Capital Max aggregate view)
            b['buy_value'],
            0,   # sell_qty (not available)
            b['sell_value']
        ))

    cur.executemany(
        "INSERT INTO daily_summary (date, broker, symbol, buy_qty, buy_value, sell_qty, sell_value)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows
    )
    con.commit()

    # Verify
    cur.execute("SELECT COUNT(DISTINCT date), MAX(date) FROM daily_summary")
    ndays, maxdate = cur.fetchone()
    log(f"DB updated: {len(rows)} rows for {date_str}, now {ndays} trading days through {maxdate}")

    con.close()
    return True


def rebuild_periods():
    """Rebuild all period JSON files from the DB."""
    log("Rebuilding period files...")
    result = subprocess.run(
        [sys.executable, os.path.join(REPO, 'tools', 'broker', 'export_broker_data.py'), '--periods'],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=300
    )
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    if result.returncode != 0:
        raise RuntimeError(f"export_broker_data.py failed with code {result.returncode}")
    log("Period files rebuilt")


def rebake_snapshot():
    """Re-bake the HTML snapshot with latest data."""
    log("Re-baking HTML snapshot...")
    result = subprocess.run(
        [sys.executable, os.path.join(REPO, 'tools', 'bake-broker-snapshot.py')],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=60
    )
    print(result.stdout)
    if result.returncode != 0:
        raise RuntimeError(f"bake-broker-snapshot.py failed with code {result.returncode}")


def build_health():
    """Rebuild health.json (CI requirement for manual deploys)."""
    log("Rebuilding health.json...")
    result = subprocess.run(
        ['node', os.path.join(REPO, 'tools', 'build-health.js')],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=60
    )
    if result.returncode != 0:
        log(f"WARNING: build-health.js failed: {result.stderr[:200]}")
    else:
        log("health.json rebuilt")


def deploy():
    """Deploy broker data files to GitHub Pages via clean worktree."""
    import tempfile
    import time

    log("Deploying to GitHub Pages...")

    # Get current origin/main
    result = subprocess.run(
        ['git', 'fetch', 'origin', 'main', '-q'],
        cwd=REPO, capture_output=True, timeout=60
    )
    result = subprocess.run(
        ['git', 'rev-parse', 'origin/main'],
        cwd=REPO, capture_output=True, text=True, timeout=30
    )
    base = result.stdout.strip()
    log(f"Base: {base[:8]}")

    # Create clean worktree
    wt_dir = f"/home/hatch/workspace/tmp/wt-cm-deploy-{int(time.time())}"
    result = subprocess.run(
        ['git', 'worktree', 'add', '--detach', wt_dir, 'origin/main'],
        cwd=REPO, capture_output=True, text=True, timeout=120
    )
    if result.returncode != 0:
        raise RuntimeError(f"worktree add failed: {result.stderr[:300]}")

    try:
        # Copy changed files
        for relpath in [
            'nepse-brokers/data/meta.json',
            'nepse-brokers/index.html',
            'data/health.json',
            'status/index.html',
        ]:
            src = os.path.join(REPO, relpath)
            dst = os.path.join(wt_dir, relpath)
            if os.path.exists(src):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)

        # Copy all period files
        periods_src = os.path.join(REPO, 'nepse-brokers', 'data', 'periods')
        periods_dst = os.path.join(wt_dir, 'nepse-brokers', 'data', 'periods')
        os.makedirs(periods_dst, exist_ok=True)
        for fname in os.listdir(periods_src):
            if fname.endswith('.json'):
                shutil.copy2(os.path.join(periods_src, fname), os.path.join(periods_dst, fname))

        # Commit
        date_str = date.today().isoformat()
        subprocess.run(['git', 'add', 'nepse-brokers/data/', 'nepse-brokers/index.html',
                        'data/health.json', 'status/index.html'],
                       cwd=wt_dir, capture_output=True, timeout=30)
        result = subprocess.run(
            ['git', 'commit', '-m', f'Capital Max broker data {date_str} (automated daily refresh)'],
            cwd=wt_dir, capture_output=True, text=True, timeout=30
        )
        if 'nothing to commit' in result.stdout or 'nothing to commit' in result.stderr:
            log("No changes to deploy")
            return

        local_ref = subprocess.run(['git', 'rev-parse', 'HEAD'],
                                    cwd=wt_dir, capture_output=True, text=True, timeout=10).stdout.strip()
        log(f"Local ref: {local_ref[:8]}")

        # Push via API
        result = subprocess.run(
            [sys.executable, '/home/hatch/workspace/skills/github/bin/github-push.py',
             '--repo', 'ShirjanKhadka1/shirjankhadka.github.io',
             '--local-ref', local_ref,
             '--branch', 'main',
             '--repo-dir', wt_dir,
             '--message', f'Capital Max broker data {date_str} (automated daily refresh)'],
            capture_output=True, text=True, timeout=300
        )
        print(result.stdout[-500:] if len(result.stdout) > 500 else result.stdout)
        if result.returncode != 0:
            raise RuntimeError(f"github-push.py failed: {result.stderr[-500:]}")

        log("Deployed successfully")
    finally:
        subprocess.run(['git', 'worktree', 'remove', wt_dir, '--force'],
                       cwd=REPO, capture_output=True, timeout=30)


def main():
    ap = argparse.ArgumentParser(description='Capital Max broker data collector')
    ap.add_argument('--data-file', required=True, help='Path to Capital Max JSON data file')
    ap.add_argument('--date', help='Trading date (default: last trading day)')
    ap.add_argument('--deploy', action='store_true', help='Deploy to GitHub Pages after rebuild')
    ap.add_argument('--skip-validation', action='store_true', help='Skip validation (not recommended)')
    args = ap.parse_args()

    # Load data
    with open(args.data_file) as f:
        data = json.load(f)

    expected_date = args.date or get_last_trading_day()
    data_date = data.get('date', expected_date)

    log(f"Processing Capital Max data for {data_date}")

    # Validate
    if not args.skip_validation:
        ok, errors = validate_data(data, expected_date)
        if not ok:
            log("VALIDATION FAILED:")
            for e in errors:
                log(f"  - {e}")
            log("NOT deploying. Fix the data or investigate.")
            sys.exit(1)
        log("Validation passed")

    # Archive
    archive_data(data, data_date)

    # Update DB
    db_updated = update_db(data, data_date)

    # Rebuild periods
    rebuild_periods()

    # Re-bake snapshot
    rebake_snapshot()

    # Rebuild health
    build_health()

    # Deploy if requested and DB was updated (or force)
    if args.deploy:
        if db_updated:
            deploy()
        else:
            log("DB already had this date, skipping deploy (data unchanged)")
    else:
        log("Skipping deploy (use --deploy to push to GitHub Pages)")

    log("Done")


if __name__ == '__main__':
    sys.exit(main())

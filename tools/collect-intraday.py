#!/usr/bin/env python3
"""NEPSE intraday data collector — 15-min tier.
Replaces the placeholder tools/update-ohlc-intraday.py.

- Checks market hours via market-hours.py (exits silently if closed)
- Runs nepse-scraper.py to fetch current market data
- Archives to ~/workspace/nepse-data-archive/intraday/
- Updates live.json for the site

Usage: python3 tools/collect-intraday.py
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone, timedelta

NPT = timezone(timedelta(hours=5, minutes=45))
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCH_DIR = '/home/hatch/workspace/nepse-data-archive/intraday'

def npt_now():
    return datetime.now(NPT)

def main():
    # 0. Ensure archive directory exists (2026-10-07 fix: create upfront so we
    #    can see the collector is running even if scraper fails)
    os.makedirs(ARCH_DIR, exist_ok=True)

    # 1. Market hours gate (lives in ~/workspace/tools/, not the repo)
    mh = subprocess.run(
        [sys.executable, '/home/hatch/workspace/tools/market-hours.py', '--quiet'],
        capture_output=True
    )
    if mh.returncode != 0:
        # Outside market hours — silent exit
        return 0

    # 2. Jitter (0-60s) to avoid thundering herd
    import random, time
    time.sleep(random.uniform(0, 60))

    # 3. Run scraper (lives in ~/workspace/tools/, not the repo)
    try:
        result = subprocess.run(
            [sys.executable, '/home/hatch/workspace/tools/nepse-scraper.py'],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            print(f"Scraper failed: {result.stderr[:500]}", file=sys.stderr)
            return 1
        data = json.loads(result.stdout)
    except Exception as e:
        print(f"Scraper error: {e}", file=sys.stderr)
        return 1

    # 3b. Full-symbol quotes via the proven JS fetcher (collect-full-quotes.py).
    # Loud failure: exit 1 so the runner retries once.
    quotes = None
    quotes_asof = npt_now().isoformat()
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.json', delete=False) as tf:
            quotes_path = tf.name
        fq = subprocess.run(
            [sys.executable,
             os.path.join(REPO, 'tools', 'collect-full-quotes.py'),
             '--out', quotes_path],
            capture_output=True, text=True, timeout=240
        )
        if fq.returncode != 0:
            print(f"Full-quotes failed: {(fq.stderr or fq.stdout)[:500]}",
                  file=sys.stderr)
            return 1
        with open(quotes_path) as f:
            quotes = json.load(f)
        try:
            os.unlink(quotes_path)
        except OSError:
            pass
        if not isinstance(quotes, list) or len(quotes) < 300:
            print(f"Full-quotes invalid: expected >=300 quotes, got "
                  f"{len(quotes) if isinstance(quotes, list) else type(quotes)}",
                  file=sys.stderr)
            return 1
        quotes_asof = npt_now().isoformat()
    except Exception as e:
        print(f"Full-quotes error: {e}", file=sys.stderr)
        return 1

    # 4. Archive with timestamp
    os.makedirs(ARCH_DIR, exist_ok=True)
    ts = npt_now().strftime('%Y-%m-%dT%H-%M')
    archive_path = os.path.join(ARCH_DIR, f'intraday-{ts}.json')
    data['_archived_at_npt'] = npt_now().isoformat()
    with open(archive_path, 'w') as f:
        json.dump(data, f, indent=2)

    # 5. Update live.json for site
    # (Keep the existing live.json structure, update with fresh data)
    live_path = os.path.join(REPO, 'nepse-chart', 'data', 'live.json')
    try:
        with open(live_path) as f:
            live = json.load(f)
    except:
        live = {}

    # Update with scraper data (no attribution, just numbers)
    nepse_idx = data.get('indices', {}).get('NEPSE Index', {})
    live['intraday'] = {
        'nepse_index': nepse_idx.get('currentValue'),
        'change': nepse_idx.get('change'),
        'per_change': nepse_idx.get('perChange'),
        'asof': data.get('fetched_at'),
        'market_status': data.get('market_status', {}).get('isOpen'),
    }
    live['data_asof'] = npt_now().isoformat()
    live['quotes'] = quotes
    live['quotes_asof'] = quotes_asof

    with open(live_path, 'w') as f:
        json.dump(live, f, indent=2)

    # Deploy intraday update to live site (2026-10-09 fix: deploy via the
    # DEDICATED clean worktree ~/workspace/wt-intraday, detached at
    # origin/main. NEVER deploy from this feature-branch tree — the
    # staleness guards abort such deploys on purpose. Steps: fetch + reset
    # --hard origin/main, apply ONLY the intraday key + data_asof onto
    # main's live.json (compact separators, minimal diff), health-bake with
    # node, commit live.json + data/health.json + status/index.html, push
    # with explicit --local-ref and --repo-dir.
    WT = '/home/hatch/workspace/wt-intraday'
    try:
        subprocess.run(['git', 'fetch', 'origin', 'main'],
                       cwd=WT, capture_output=True, timeout=60)
        subprocess.run(['git', 'reset', '--hard', 'origin/main'],
                       cwd=WT, capture_output=True, timeout=60)
        wt_live = os.path.join(WT, 'nepse-chart', 'data', 'live.json')
        with open(wt_live) as f:
            live = json.load(f)
        live['intraday'] = {
            'nepse_index': nepse_idx.get('currentValue'),
            'change': nepse_idx.get('change'),
            'per_change': nepse_idx.get('perChange'),
            'asof': data.get('fetched_at'),
            'market_status': data.get('market_status', {}).get('isOpen'),
        }
        live['data_asof'] = npt_now().isoformat()
        live['quotes'] = quotes
        live['quotes_asof'] = quotes_asof
        with open(wt_live, 'w') as f:
            json.dump(live, f, separators=(',', ':'))
        # Health bake — NODE, not python3 (there is no python build-health)
        hb = subprocess.run(['node', 'tools/build-health.js'],
                            cwd=WT, capture_output=True, text=True, timeout=120)
        if hb.returncode != 0:
            print(f"Health bake failed: {hb.stderr[:300]}", file=sys.stderr)
        subprocess.run(['git', 'add', 'nepse-chart/data/live.json',
                        'data/health.json', 'status/index.html'],
                       cwd=WT, capture_output=True, timeout=30)
        # Only commit if there are changes
        status = subprocess.run(['git', 'diff', '--cached', '--quiet'],
                                cwd=WT, capture_output=True)
        if status.returncode != 0:  # There are changes
            subprocess.run(['git', 'commit', '-m', f'Intraday live.json {ts}'],
                           cwd=WT, capture_output=True, timeout=30)
            # Push via API (no direct git push — use the deploy script)
            sha = subprocess.run(['git', 'rev-parse', 'HEAD'],
                                 cwd=WT, capture_output=True, text=True,
                                 timeout=10)
            if sha.returncode == 0:
                deploy = subprocess.run([
                    sys.executable,
                    '/home/hatch/workspace/skills/github/bin/github-push.py',
                    '--repo', 'ShirjanKhadka1/shirjankhadka.github.io',
                    '--branch', 'main',
                    '--local-ref', sha.stdout.strip(),
                    '--repo-dir', WT,
                    '--message', f'Intraday live.json {ts}',
                ], capture_output=True, text=True, timeout=180)
                if deploy.returncode != 0:
                    print(f"Deploy failed: {deploy.stderr[:300]}",
                          file=sys.stderr)
    except Exception as e:
        print(f"Deploy error: {e}", file=sys.stderr)

    print(f"quotes: {len(quotes)} symbols")
    print(f"Intraday collected: {ts} (NEPSE {nepse_idx.get('currentValue')})")
    return 0

if __name__ == '__main__':
    sys.exit(main())

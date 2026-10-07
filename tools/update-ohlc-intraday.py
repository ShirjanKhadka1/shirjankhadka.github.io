#!/usr/bin/env python3
"""Nepse Decode: Intraday OHLC updater.

Polls for fresh market data every 15 minutes during NEPSE trading hours
(11:00-15:00 NPT, Mon-Fri). Updates our proprietary OHLC archive.

Pattern from Chukul research (2026-10-07):
- Bulk fetch once per cycle (not per-symbol)
- UPSERT into our archive (never serve upstream directly)
- Jitter to avoid bot detection patterns

This is the intraday tier. The EOD tier (ohlc-archive-updater at 16:00)
handles the post-close snapshot.

Run: python3 tools/update-ohlc-intraday.py
Scheduled: every 15 min, Mon-Fri 11:00-15:00 NPT (intraday-ohlc-poll cron)
"""
import json
import os
import sys
import time
import random
from datetime import datetime, timezone, timedelta

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCH_DIR = '/home/hatch/workspace/nepse-data-archive'

# NPT timezone
NPT = timezone(timedelta(hours=5, minutes=45))

def is_market_hours():
    """Check if currently within NEPSE trading hours."""
    now = datetime.now(NPT)
    # Mon-Fri (0=Monday)
    if now.weekday() >= 5:
        return False
    # 11:00-15:00 NPT
    market_open = now.replace(hour=11, minute=0, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=0, second=0, microsecond=0)
    return market_open <= now <= market_close

def main():
    print("== Intraday OHLC update ==")
    
    # Jitter: random 0-60s delay (Chukul pattern)
    jitter = random.uniform(0, 60)
    print(f"Jitter: {jitter:.1f}s")
    time.sleep(jitter)
    
    if not is_market_hours():
        now = datetime.now(NPT)
        print(f"Outside market hours ({now.strftime('%Y-%m-%d %H:%M')} NPT). Skipping.")
        sys.exit(0)
    
    # TODO: Implement bulk OHLC fetch from our data source
    # For now, this is a placeholder that validates the schedule works.
    # The actual data source integration goes here.
    
    print("Market hours confirmed. Intraday update logic goes here.")
    print("Note: Implement bulk fetch -> UPSERT to archive.")
    
    # Placeholder: touch a heartbeat file
    heartbeat = os.path.join(ARCH_DIR, 'intraday-heartbeat.json')
    os.makedirs(ARCH_DIR, exist_ok=True)
    with open(heartbeat, 'w') as f:
        json.dump({
            'last_check': datetime.now(NPT).isoformat(),
            'market_hours': True,
            'status': 'placeholder - implement bulk fetch'
        }, f)
    
    print("Done.")

if __name__ == '__main__':
    main()

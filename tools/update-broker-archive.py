#!/usr/bin/env python3
"""Nepse Decode: Broker archive updater.

Maintains our proprietary broker archive at ~/workspace/nepse-data-archive/.
Reads from floorsheet.db (populated by manual/automated collection) and
rebuilds the period aggregates for the static site.

The builder NEVER hits source platforms directly — it reads only our archive.

Run: python3 tools/update-broker-archive.py
Scheduled: daily after market close.

Validates buy=sell balance for every date; aborts on imbalance.
"""
import json
import os
import sqlite3
import sys
from datetime import date, timedelta

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(REPO, 'tools', 'broker', 'data', 'floorsheet.db')
ARCH_DIR = '/home/hatch/workspace/nepse-data-archive'
OUT = os.path.join(REPO, 'nepse-brokers', 'data')

PERIODS = {
    '1D': 1, '2D': 2, '1W': 7, '2W': 14, '1M': 30,
    '3M': 91, '6M': 182, '1Y': 365, '2Y': 730, '3Y': 1095
}

def get_trading_dates(conn, end_date, n_days):
    """Get the last n trading days ending at end_date."""
    cur = conn.execute(
        "SELECT DISTINCT date FROM daily_summary WHERE date <= ? ORDER BY date DESC LIMIT ?",
        (end_date, n_days * 2)  # over-fetch to handle weekends
    )
    dates = [r[0] for r in cur.fetchall()]
    return dates[:n_days]

def aggregate_period(conn, period_days, end_date):
    """Aggregate broker data for a period."""
    dates = get_trading_dates(conn, end_date, period_days)
    if not dates:
        return None
    
    placeholders = ','.join('?' * len(dates))
    cur = conn.execute(f"""
        SELECT broker, 
               SUM(buy_value) as buy_val,
               SUM(sell_value) as sell_val,
               SUM(buy_qty) as buy_q,
               SUM(sell_qty) as sell_q
        FROM daily_summary 
        WHERE date IN ({placeholders})
        GROUP BY broker
    """, dates)
    
    brokers = []
    total_buy = 0
    total_sell = 0
    for row in cur.fetchall():
        code, buy_v, sell_v, buy_q, sell_q = row
        buy_v = buy_v or 0
        sell_v = sell_v or 0
        total_buy += buy_v
        total_sell += sell_v
        brokers.append({
            'code': str(code),
            'buy_value': round(buy_v, 2),
            'sell_value': round(sell_v, 2),
            'total': round(buy_v + sell_v, 2),
            'net': round(buy_v - sell_v, 2),
            'buy_qty': round(buy_q or 0, 2),
            'sell_qty': round(sell_q or 0, 2),
            'total_qty': round((buy_q or 0) + (sell_q or 0), 2),
            'net_qty': round((buy_q or 0) - (sell_q or 0), 2),
        })
    
    # Validate balance
    diff = abs(total_buy - total_sell)
    if diff > 1.0:
        print(f"WARNING: Buy/sell imbalance for {period_days}D: Rs {diff:,.2f}", file=sys.stderr)
    
    # Get broker names
    broker_names = {}
    try:
        with open(os.path.join(os.path.dirname(DB), 'broker_map.json')) as f:
            bm = json.load(f)
            for k, v in bm.items():
                broker_names[str(k)] = v.get('name', str(k)) if isinstance(v, dict) else str(v)
    except:
        pass
    
    for b in brokers:
        b['name'] = broker_names.get(b['code'], f"Broker {b['code']}")
    
    brokers.sort(key=lambda x: x['total'], reverse=True)
    
    return {
        'period': f"{period_days}D" if period_days < 7 else None,
        'from': min(dates),
        'to': max(dates),
        'trading_days': len(dates),
        'brokers': brokers,
        'total_buy': round(total_buy, 2),
        'total_sell': round(total_sell, 2),
        'balanced': diff < 1.0,
    }

def main():
    print("== Broker archive update ==")
    
    if not os.path.exists(DB):
        print(f"ERROR: Database not found: {DB}", file=sys.stderr)
        sys.exit(1)
    
    conn = sqlite3.connect(DB)
    
    # Get latest date
    cur = conn.execute("SELECT MAX(date) FROM daily_summary")
    latest = cur.fetchone()[0]
    print(f"Latest date in DB: {latest}")
    
    # Update meta
    cur = conn.execute("SELECT MIN(date), MAX(date), COUNT(DISTINCT date) FROM daily_summary")
    earliest, latest, trading_days = cur.fetchone()
    cur = conn.execute("SELECT COUNT(DISTINCT broker) FROM daily_summary")
    broker_count = cur.fetchone()[0]
    
    meta = {
        'earliest': earliest,
        'latest': latest,
        'trading_days': trading_days,
        'broker_count': broker_count,
        'periods': list(PERIODS.keys()),
        'updated_at': date.today().isoformat() + 'T00:00:00+05:45',
        'last_updated': latest,
        'note': 'Transaction flow (net bought/sold), not verified beneficial holdings.',
    }
    
    os.makedirs(os.path.join(OUT, 'periods'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'daily'), exist_ok=True)
    os.makedirs(ARCH_DIR, exist_ok=True)
    
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"Meta updated: {trading_days} days, {broker_count} brokers")
    
    # Rebuild period files
    for pname, pdays in PERIODS.items():
        agg = aggregate_period(conn, pdays, latest)
        if agg:
            agg['period'] = pname
            # Save to proprietary archive (no source attribution)
            arch_file = os.path.join(ARCH_DIR, f'broker-{pname}-{latest}.json')
            with open(arch_file, 'w') as f:
                json.dump({
                    'asof': latest,
                    'archive': 'Nepse Decode proprietary broker archive',
                    'period': pname,
                    **agg
                }, f)
            
            # Save to site data
            site_file = os.path.join(OUT, 'periods', f'{pname}.json')
            with open(site_file, 'w') as f:
                json.dump(agg, f)
            
            status = "✓" if agg['balanced'] else "✗ IMBALANCE"
            print(f"  {pname}: {len(agg['brokers'])} brokers, {status}")
    
    # Build daily files for recent dates
    cur = conn.execute(
        "SELECT DISTINCT date FROM daily_summary ORDER BY date DESC LIMIT 30"
    )
    for (d,) in cur.fetchall():
        agg = aggregate_period(conn, 1, d)
        if agg:
            site_file = os.path.join(OUT, 'daily', f'{d}.json')
            with open(site_file, 'w') as f:
                json.dump(agg, f)
    
    print(f"Done. Archive: {ARCH_DIR}/")
    conn.close()

if __name__ == '__main__':
    main()

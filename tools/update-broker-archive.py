#!/usr/bin/env python3
"""Nepse Decode: Broker archive updater.

Maintains our proprietary broker archive at ~/workspace/nepse-data-archive/.
Reads from floorsheet.db (populated by manual collection) and rebuilds
the period aggregates for the static site.

Builds ALL data needed by the 5 broker views:
- brokers: broker-level aggregates (Top Brokers, Broker Trade Pattern)
- symbols: per-symbol buyers/sellers (Stock Trade Pattern, Stockwise Holdings)
- broker_symbols: per-broker top symbols (Broker Trade Pattern detail)
- accumulation/distribution: top net flows (Accumulation/Distribution)

The builder NEVER hits source platforms directly — it reads only our archive.

Run: python3 tools/update-broker-archive.py
Scheduled: daily after market close (broker-daily-refresh cron).

Validates buy=sell balance for every period; warns on imbalance.
"""
import json
import os
import sqlite3
import sys
from datetime import date

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(REPO, 'tools', 'broker', 'data', 'floorsheet.db')
ARCH_DIR = '/home/hatch/workspace/nepse-data-archive'
OUT = os.path.join(REPO, 'nepse-brokers', 'data')

PERIODS = {
    '1D': 1, '2D': 2, '1W': 7, '2W': 14, '1M': 30,
    '3M': 91, '6M': 182, '1Y': 365, '2Y': 730, '3Y': 1095
}

def r2(x):
    return round(x or 0, 2)

def get_trading_dates(conn, end_date, n_days):
    """Get the last n trading days ending at end_date."""
    cur = conn.execute(
        "SELECT DISTINCT date FROM daily_summary WHERE date <= ? ORDER BY date DESC LIMIT ?",
        (end_date, n_days * 2)
    )
    dates = [r[0] for r in cur.fetchall()]
    return dates[:n_days]

def get_broker_names():
    """Load broker code -> name mapping."""
    broker_names = {}
    for path in [
        os.path.join(os.path.dirname(DB), 'broker_map.json'),
        os.path.join(REPO, 'nepse-brokers', 'data', 'brokers.json'),
    ]:
        try:
            with open(path) as f:
                data = json.load(f)
                # Handle different formats
                if isinstance(data, dict):
                    for k, v in data.items():
                        if isinstance(v, dict):
                            broker_names[str(k)] = v.get('name', str(k))
                        else:
                            broker_names[str(k)] = str(v)
                elif isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and 'code' in item:
                            broker_names[str(item['code'])] = item.get('name', str(item['code']))
            if broker_names:
                break
        except:
            continue
    return broker_names

def aggregate_period(conn, dates, broker_names):
    """Build complete period data: brokers, symbols, flows."""
    if not dates:
        return None
    
    placeholders = ','.join('?' * len(dates))
    
    # Broker-level aggregates (includes __TOTAL__ aggregate rows)
    cur = conn.execute(f"""
        SELECT broker, 
               SUM(buy_value), SUM(sell_value),
               SUM(buy_qty), SUM(sell_qty)
        FROM daily_summary 
        WHERE date IN ({placeholders})
        GROUP BY broker
    """, dates)
    
    brokers = []
    total_buy = 0
    total_sell = 0
    for code, bv, sv, bq, sq in cur.fetchall():
        bv, sv, bq, sq = bv or 0, sv or 0, bq or 0, sq or 0
        total_buy += bv
        total_sell += sv
        brokers.append({
            'code': str(code),
            'name': broker_names.get(str(code), f"Broker {code}"),
            'buy_value': r2(bv),
            'sell_value': r2(sv),
            'total': r2(bv + sv),
            'net': r2(bv - sv),
            'buy_qty': r2(bq),
            'sell_qty': r2(sq),
            'total_qty': r2(bq + sq),
            'net_qty': r2(bq - sq),
        })
    brokers.sort(key=lambda x: x['total'], reverse=True)
    
    # Symbol-level data (excludes __TOTAL__ aggregate rows)
    cur = conn.execute(f"""
        SELECT broker, symbol,
               SUM(buy_qty), SUM(buy_value), SUM(sell_qty), SUM(sell_value)
        FROM daily_summary 
        WHERE date IN ({placeholders}) AND symbol != '__TOTAL__'
        GROUP BY broker, symbol
    """, dates)
    
    symbols = {}
    broker_symbols = {}
    flows = []
    
    for broker, sym, bq, bv, sq, sv in cur.fetchall():
        bq, bv, sq, sv = bq or 0, bv or 0, sq or 0, sv or 0
        code = str(broker)
        
        # Per-broker symbol breakdown (for Broker Trade Pattern)
        bs = broker_symbols.setdefault(code, {})
        e = bs.get(sym)
        if e is None:
            e = bs[sym] = {"buy_qty": 0, "buy_value": 0, "sell_qty": 0, "sell_value": 0}
        e["buy_qty"] += bq; e["buy_value"] += bv
        e["sell_qty"] += sq; e["sell_value"] += sv
        
        # Per-symbol buyers/sellers (for Stock Trade Pattern, Holdings)
        sd = symbols.get(sym)
        if sd is None:
            sd = symbols[sym] = {"qty": 0, "value": 0, "buyers": {}, "sellers": {}}
        sd["qty"] += bq + sq; sd["value"] += bv + sv
        if bv > 0:
            be = sd["buyers"].get(code)
            if be is None:
                be = sd["buyers"][code] = [0, 0]
            be[0] += bq; be[1] += bv
        if sv > 0:
            se = sd["sellers"].get(code)
            if se is None:
                se = sd["sellers"][code] = [0, 0]
            se[0] += sq; se[1] += sv
        
        # Flows for accumulation/distribution
        net_qty = bq - sq
        net_val = bv - sv
        if net_qty != 0 or net_val != 0:
            flows.append({
                "symbol": sym, "broker": code,
                "broker_name": broker_names.get(code, f"Broker {code}"),
                "net_qty": r2(net_qty), "net_value": r2(net_val),
                "buy_qty": r2(bq), "buy_value": r2(bv),
                "sell_qty": r2(sq), "sell_value": r2(sv),
            })
    
    # Build symbol output with top buyers/sellers and netflow
    netflow = {}
    for f in flows:
        nf = netflow.setdefault(f["symbol"], {})
        nf[f["broker"]] = [f["net_qty"], f["net_value"], f["buy_qty"], 
                          f["buy_value"], f["sell_qty"], f["sell_value"]]
    for sym in netflow:
        netflow[sym] = dict(sorted(netflow[sym].items(), key=lambda x: -abs(x[1][1])))
    
    sym_out = {}
    for sym, sd in symbols.items():
        buyers = dict(sorted(sd["buyers"].items(), key=lambda x: -x[1][1])[:25])
        sellers = dict(sorted(sd["sellers"].items(), key=lambda x: -x[1][1])[:25])
        sym_out[sym] = {
            "qty": r2(sd["qty"]), 
            "value": r2(sd["value"]),
            "avg_rate": r2(sd["value"] / sd["qty"]) if sd["qty"] else 0,
            "buyers": {k: [r2(v[0]), r2(v[1])] for k, v in buyers.items()},
            "sellers": {k: [r2(v[0]), r2(v[1])] for k, v in sellers.items()},
            "netflow": netflow.get(sym, {}),
        }
    
    # Top broker symbols (for detail view)
    broker_sym_out = {}
    for code, syms in broker_symbols.items():
        lst = sorted(syms.items(), key=lambda x: -(x[1]["buy_value"] + x[1]["sell_value"]))[:25]
        broker_sym_out[code] = [
            {"symbol": s, "buy_qty": r2(v["buy_qty"]), "buy_value": r2(v["buy_value"]),
             "sell_qty": r2(v["sell_qty"]), "sell_value": r2(v["sell_value"]),
             "net_value": r2(v["buy_value"] - v["sell_value"])}
            for s, v in lst
        ]
    
    # Accumulation (top net bought) and Distribution (top net sold)
    flows_sorted = sorted(flows, key=lambda x: -x["net_value"])
    accumulation = flows_sorted[:200]
    distribution = sorted(flows, key=lambda x: x["net_value"])[:200]
    
    diff = abs(total_buy - total_sell)
    
    return {
        'from': min(dates),
        'to': max(dates),
        'trading_days': len(dates),
        'brokers': brokers,
        'broker_symbols': broker_sym_out,
        'symbols': sym_out,
        'accumulation': accumulation,
        'distribution': distribution,
        'total_buy': r2(total_buy),
        'total_sell': r2(total_sell),
        'balanced': diff < 1.0,
        'symbol_count': len(sym_out),
    }

def main():
    print("== Broker archive update ==")
    
    if not os.path.exists(DB):
        print(f"ERROR: Database not found: {DB}", file=sys.stderr)
        sys.exit(1)
    
    conn = sqlite3.connect(DB)
    broker_names = get_broker_names()
    print(f"Loaded {len(broker_names)} broker names")
    
    cur = conn.execute("SELECT MAX(date) FROM daily_summary")
    latest = cur.fetchone()[0]
    print(f"Latest date in DB: {latest}")
    
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
    print(f"Meta: {trading_days} days, {broker_count} brokers")
    
    for pname, pdays in PERIODS.items():
        dates = get_trading_dates(conn, latest, pdays)
        agg = aggregate_period(conn, dates, broker_names)
        if agg:
            agg['period'] = pname
            
            arch_file = os.path.join(ARCH_DIR, f'broker-{pname}-{latest}.json')
            with open(arch_file, 'w') as f:
                json.dump({
                    'asof': latest,
                    'archive': 'Nepse Decode proprietary broker archive',
                    'period': pname,
                    **agg
                }, f)
            
            site_file = os.path.join(OUT, 'periods', f'{pname}.json')
            with open(site_file, 'w') as f:
                json.dump(agg, f)
            
            status = "✓" if agg['balanced'] else "✗ IMBALANCE"
            print(f"  {pname}: {len(agg['brokers'])} brokers, {agg['symbol_count']} symbols, {status}")
    
    cur = conn.execute(
        "SELECT DISTINCT date FROM daily_summary ORDER BY date DESC LIMIT 30"
    )
    for (d,) in cur.fetchall():
        agg = aggregate_period(conn, [d], broker_names)
        if agg:
            site_file = os.path.join(OUT, 'daily', f'{d}.json')
            with open(site_file, 'w') as f:
                json.dump(agg, f)
    
    print(f"Done. Archive: {ARCH_DIR}/")
    conn.close()

if __name__ == '__main__':
    main()

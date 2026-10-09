#!/usr/bin/env python3
"""One-off repair (2026-10-09, broker-pattern-keeper):
1. Normalize 2026-10-07 rows: broker NAME+"(Broker N)" -> numeric code, symbol '*' -> ''.
2. Backfill 2026-10-08 per-stock detail from verified periods/1D.json broker_symbols.
DB inserts are batched (500/batch). Safe to re-run (PK + INSERT OR IGNORE).
"""
import sqlite3, json, re, sys

DB = sys.argv[1] if len(sys.argv) > 1 else \
    '/home/hatch/workspace/wave8-build/repo/tools/broker/data/floorsheet.db'
JSON1D = '/home/hatch/workspace/wt-brokerpattern/nepse-brokers/data/periods/1D.json'
BATCH = 500

con = sqlite3.connect(DB)
cur = con.cursor()

# STEP 1: normalize Oct 7
rows = cur.execute(
    "SELECT broker, buy_value, sell_value FROM daily_summary WHERE date='2026-10-07'"
).fetchall()
upd = []
for (b, bv, sv) in rows:
    m = re.search(r'\(Broker (\d+)\)', b)
    if m:
        code = m.group(1)
    elif re.fullmatch(r'\d+', b):
        code = b  # already normalized (idempotent re-run)
    else:
        raise SystemExit('unparseable broker: %r' % b)
    upd.append((code, bv, sv))
cur.execute("DELETE FROM daily_summary WHERE date='2026-10-07'")
cur.executemany(
    "INSERT INTO daily_summary (date,broker,symbol,buy_qty,buy_value,sell_qty,sell_value)"
    " VALUES ('2026-10-07',?,'',0,?,0,?)", upd)
print('Oct7 normalized rows: %d' % len(upd), flush=True)

# STEP 2: backfill Oct 8 detail
d = json.load(open(JSON1D))
ins = []
for code, lst in d['broker_symbols'].items():
    assert re.fullmatch(r'\d+', code), 'non-numeric code in 1D.json: %r' % code
    for r in lst:
        ins.append(('2026-10-08', code, r['symbol'],
                    r.get('buy_qty', 0), r.get('buy_value', 0),
                    r.get('sell_qty', 0), r.get('sell_value', 0)))
for i in range(0, len(ins), BATCH):
    cur.executemany(
        "INSERT OR IGNORE INTO daily_summary"
        " (date,broker,symbol,buy_qty,buy_value,sell_qty,sell_value)"
        " VALUES (?,?,?,?,?,?,?)", ins[i:i + BATCH])
print('Oct8 detail rows staged: %d' % len(ins), flush=True)

con.commit()
print('Oct7 rows now: %s' % (cur.execute(
    "SELECT COUNT(*), COUNT(DISTINCT broker) FROM daily_summary"
    " WHERE date='2026-10-07'").fetchone(),))
print('Oct8 detail rows: %d' % cur.execute(
    "SELECT COUNT(*) FROM daily_summary WHERE date='2026-10-08' AND symbol!=''").fetchone()[0])
print('Oct8 agg rows: %d' % cur.execute(
    "SELECT COUNT(*) FROM daily_summary WHERE date='2026-10-08' AND symbol=''").fetchone()[0])
print('non-numeric broker codes in DB: %d' % cur.execute(
    "SELECT COUNT(DISTINCT broker) FROM daily_summary WHERE broker GLOB '*[^0-9]*'").fetchone()[0])
con.close()
print('DB repair done: %s' % DB)

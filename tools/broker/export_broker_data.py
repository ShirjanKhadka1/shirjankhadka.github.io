#!/usr/bin/env python3
"""Export broker-analytics JSONs from floorsheet.db for the static site.

Reads tools/broker/data/floorsheet.db (daily_summary) and writes:
  nepse-brokers/data/brokers.json            broker code -> name
  nepse-brokers/data/meta.json              backfill coverage + updated_at
  nepse-brokers/data/periods/<P>.json       full aggregates per preset period
  nepse-brokers/data/daily/<YYYY-MM-DD>.json per-day symbol aggregates

Periods: 1D 2D 1W 2W 1M 3M 6M 1Y 2Y 3Y  (trading-day windows ending at the
latest scraped trading day).

Each periods/<P>.json:
  { period, from, to, trading_days,
    brokers: [{code, buy_value, sell_value, total, net}],
    broker_symbols: {code: [{symbol, buy_qty, buy_value, sell_qty, sell_value}] (top 25)},
    symbols: {SYM: {qty, value, avg_rate,
                    buyers: {code: [buy_qty, buy_value]} (top 25 by value),
                    sellers: {code: [sell_qty, sell_value]} (top 25 by value),
                    netflow: {code: [net_qty, net_value]} (ALL brokers, sorted by net value desc)}},
    accumulation: [{symbol, broker, net_qty, net_value}] (top 200 net bought,
                    only flows with traded value >= MIN_FLOW_VALUE),
    distribution: [{symbol, broker, net_qty, net_value}] (top 200 net sold,
                    same floor) }

Rows whose symbol is an aggregate marker ("", "*", "__TOTAL__") count toward
broker totals only and are never emitted as symbol flows or
accumulation/distribution entries. Brokers stored as "Name (Broker N)" are
normalized to the numeric code.

Honesty: this is transaction FLOW (net bought/sold), not verified beneficial
holdings. UI labels must say "net bought (accumulation)" / "net sold
(distribution)".
"""
import argparse
import json
import os
import re
import sqlite3
from datetime import date, timedelta

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DB = os.path.join(os.path.dirname(__file__), "data", "floorsheet.db")
OUT = os.path.join(REPO, "nepse-brokers", "data")

PERIODS = {"1D": 1, "2D": 2, "1W": 7, "2W": 14, "1M": 30, "3M": 91,
           "6M": 182, "1Y": 365, "2Y": 730, "3Y": 1095}

BROKER_MAP = {}  # filled from brokers.json source if present

# Sanity bounds for accumulation/distribution classification (accdist keeper,
# 2026-10-09). A broker+symbol flow is only classified as accumulating /
# distributing when the broker actually traded a meaningful amount in that
# symbol over the period — this keeps trivial-volume noise out of the tables.
MIN_FLOW_VALUE = 500_000  # Rs 5 lakh total traded value (buy+sell)

# Symbols that mark a row as a broker-day aggregate (no per-symbol breakdown),
# never a real tradeable symbol. Such rows count toward broker totals only.
AGGREGATE_SYMBOLS = {"", "*", "__TOTAL__"}

# Some archive days stored the broker as "Name (Broker N)" instead of the
# numeric code (e.g. 2026-10-07). Normalize to the code so broker totals merge.
_BROKER_CODE_RE = re.compile(r"\(Broker\s*(\d+)\)\s*$")


def norm_broker(code):
    code = str(code or "").strip()
    m = _BROKER_CODE_RE.search(code)
    return m.group(1) if m else code


def r2(x):
    return round(x * 100) / 100


def healthy_symbols(symbols):
    """True if the symbols map carries real per-stock data (not degenerate).

    A rebuild from aggregate-only DB rows yields {'': {...}} (or empty) —
    publishing that would blank the Stock Trade Pattern / Holdings /
    Accumulation pages. Never silently publish it.
    """
    if not symbols:
        return False
    real = [k for k in symbols.keys() if k and k != "__TOTAL__"]
    return len(real) >= 10


def guard_period_symbols(path, data):
    """Check-and-balance gate for period files (stock-pattern keeper).

    If the rebuilt symbol-level data is degenerate (no detailed per-stock rows
    in the DB for this window) but the existing file on disk has healthy
    detailed symbols, keep the existing symbols / broker_symbols /
    accumulation / distribution and refresh only the broker aggregates.
    Logs LOUDLY in both cases. Returns the (possibly patched) data dict.
    """
    if healthy_symbols(data.get("symbols")):
        return data
    pname = os.path.basename(path)
    prev = None
    if os.path.exists(path):
        try:
            with open(path) as f:
                prev = json.load(f)
        except Exception as e:
            print(f"*** LOUD *** {pname}: rebuilt symbols are DEGENERATE and the "
                  f"existing file could not be read ({e}) — publishing as-is. "
                  f"Stock-pattern pages will show no data. Investigate immediately!")
            return data
    if prev and healthy_symbols(prev.get("symbols")):
        asof = prev.get("symbols_asof", prev.get("to"))
        print(f"*** LOUD *** {pname}: rebuilt symbols are DEGENERATE (no detailed "
              f"per-stock rows for {data.get('to')}); keeping previous healthy detailed "
              f"symbols from {asof} instead of publishing blank data. "
              f"Investigate the detailed broker collection!")
        data["symbols"] = prev["symbols"]
        data["broker_symbols"] = prev.get("broker_symbols", {})
        data["accumulation"] = prev.get("accumulation", [])
        data["distribution"] = prev.get("distribution", [])
        data["symbols_asof"] = asof
    else:
        print(f"*** LOUD *** {pname}: rebuilt symbols are DEGENERATE and no healthy "
              f"previous file exists — publishing as-is. Stock-pattern pages will "
              f"show no data. Investigate immediately!")
    return data


def trading_days(con, end_iso, n):
    rows = con.execute(
        "SELECT DISTINCT date FROM daily_summary WHERE date <= ? ORDER BY date DESC LIMIT ?",
        (end_iso, n)).fetchall()
    return sorted(r[0] for r in rows)


def aggregate(con, dates):
    """Return (broker_totals, broker_symbols, symbol_data, flows)."""
    if not dates:
        return {}, {}, {}, []
    q = ",".join("?" for _ in dates)
    rows = con.execute(
        f"""SELECT broker, symbol,
                   SUM(buy_qty), SUM(buy_value), SUM(sell_qty), SUM(sell_value)
            FROM daily_summary WHERE date IN ({q})
            GROUP BY broker, symbol""", dates).fetchall()

    brokers = {}
    bsym = {}
    symbols = {}
    flows = []
    for broker, sym, bq, bv, sq, sv in rows:
        bq, bv, sq, sv = bq or 0, bv or 0, sq or 0, sv or 0
        broker = norm_broker(broker)
        # Aggregate-marker rows are broker-day totals with no per-symbol
        # breakdown. They count toward broker totals only and must never
        # become symbol flows / accumulation entries.
        is_agg = (sym or "").strip() in AGGREGATE_SYMBOLS
        bt = brokers.get(broker)
        if bt is None:
            bt = brokers[broker] = {"buy_value": 0, "sell_value": 0, "buy_qty": 0, "sell_qty": 0}
        bt["buy_value"] += bv; bt["sell_value"] += sv
        bt["buy_qty"] += bq; bt["sell_qty"] += sq
        if is_agg:
            continue  # aggregate rows stop here: no symbol flow, no acc/dist

        bs = bsym.setdefault(broker, {})
        e = bs.get(sym)
        if e is None:
            e = bs[sym] = {"buy_qty": 0, "buy_value": 0, "sell_qty": 0, "sell_value": 0}
        e["buy_qty"] += bq; e["buy_value"] += bv; e["sell_qty"] += sq; e["sell_value"] += sv

        sd = symbols.get(sym)
        if sd is None:
            sd = symbols[sym] = {"qty": 0, "value": 0, "buyers": {}, "sellers": {}}
        sd["qty"] += bq + sq; sd["value"] += bv + sv
        # buyers/sellers keyed by broker code: [traded_qty, traded_value]
        if bv > 0:
            be = sd["buyers"].get(broker)
            if be is None:
                be = sd["buyers"][broker] = [0, 0]
            be[0] += bq; be[1] += bv
        if sv > 0:
            se = sd["sellers"].get(broker)
            if se is None:
                se = sd["sellers"][broker] = [0, 0]
            se[0] += sq; se[1] += sv

        net_qty = bq - sq
        net_val = bv - sv
        if net_qty != 0 or net_val != 0:
            flows.append({"symbol": sym, "broker": broker,
                          "net_qty": r2(net_qty), "net_value": r2(net_val),
                          "buy_qty": r2(bq), "buy_value": r2(bv),
                          "sell_qty": r2(sq), "sell_value": r2(sv)})
    return brokers, bsym, symbols, flows


def export_period(con, period, days, end_iso):
    dates = trading_days(con, end_iso, days)
    if not dates:
        return None
    brokers, bsym, symbols, flows = aggregate(con, dates)

    broker_list = []
    for code, t in brokers.items():
        total = t["buy_value"] + t["sell_value"]
        total_qty = t["buy_qty"] + t["sell_qty"]
        broker_list.append({"code": code,
                            "buy_qty": r2(t["buy_qty"]), "buy_value": r2(t["buy_value"]),
                            "sell_qty": r2(t["sell_qty"]), "sell_value": r2(t["sell_value"]),
                            "total_qty": r2(total_qty), "total": r2(total),
                            "net_qty": r2(t["buy_qty"] - t["sell_qty"]),
                            "net": r2(t["buy_value"] - t["sell_value"])})
    broker_list.sort(key=lambda x: -x["total"])

    broker_symbols = {}
    for code, syms in bsym.items():
        lst = [{"symbol": s, "buy_qty": r2(v["buy_qty"]), "buy_value": r2(v["buy_value"]),
                "sell_qty": r2(v["sell_qty"]), "sell_value": r2(v["sell_value"])}
               for s, v in syms.items()]
        lst.sort(key=lambda x: -(x["buy_value"] + x["sell_value"]))
        broker_symbols[code] = lst[:25]

    sym_out = {}
    netflow = {}
    for f in flows:
        nf = netflow.setdefault(f["symbol"], {})
        nf[f["broker"]] = [r2(f["net_qty"]), r2(f["net_value"]), r2(f["buy_qty"]), r2(f["buy_value"]), r2(f["sell_qty"]), r2(f["sell_value"])]
    for sym in netflow:
        netflow[sym] = dict(sorted(netflow[sym].items(), key=lambda x: -x[1][1]))
    for sym, sd in symbols.items():
        buyers = dict(sorted(sd["buyers"].items(), key=lambda x: -x[1][1])[:25])
        sellers = dict(sorted(sd["sellers"].items(), key=lambda x: -x[1][1])[:25])
        sym_out[sym] = {"qty": r2(sd["qty"]), "value": r2(sd["value"]),
                        "avg_rate": r2(sd["value"] / sd["qty"]) if sd["qty"] else 0,
                        "buyers": {k: [r2(v[0]), r2(v[1])] for k, v in buyers.items()},
                        "sellers": {k: [r2(v[0]), r2(v[1])] for k, v in sellers.items()},
                        "netflow": netflow.get(sym, {})}

    # Trivial-volume floor: a flow only qualifies as accumulation/distribution
    # when the broker traded at least MIN_FLOW_VALUE in that symbol.
    real_flows = [f for f in flows
                  if (f["buy_value"] + f["sell_value"]) >= MIN_FLOW_VALUE]
    flows_sorted = sorted(real_flows, key=lambda x: -x["net_value"])
    accumulation = [f for f in flows_sorted if f["net_value"] > 0][:200]
    distribution = [f for f in sorted(real_flows, key=lambda x: x["net_value"])
                    if f["net_value"] < 0][:200]

    return {"period": period, "from": dates[0], "to": dates[-1],
            "trading_days": len(dates),
            "brokers": broker_list, "broker_symbols": broker_symbols,
            "symbols": sym_out,
            "accumulation": accumulation, "distribution": distribution}


def export_daily(con, day_iso):
    dates = [day_iso]
    brokers, bsym, symbols, flows = aggregate(con, dates)
    sym_out = {}
    netflow = {}
    for f in flows:
        nf = netflow.setdefault(f["symbol"], {})
        nf[f["broker"]] = [r2(f["net_qty"]), r2(f["net_value"]), r2(f["buy_qty"]), r2(f["buy_value"]), r2(f["sell_qty"]), r2(f["sell_value"])]
    for sym in netflow:
        netflow[sym] = dict(sorted(netflow[sym].items(), key=lambda x: -x[1][1]))
    for sym, sd in symbols.items():
        buyers = dict(sorted(sd["buyers"].items(), key=lambda x: -x[1][1])[:25])
        sellers = dict(sorted(sd["sellers"].items(), key=lambda x: -x[1][1])[:25])
        sym_out[sym] = {"qty": r2(sd["qty"]), "value": r2(sd["value"]),
                        "avg_rate": r2(sd["value"] / sd["qty"]) if sd["qty"] else 0,
                        "buyers": {k: [r2(v[0]), r2(v[1])] for k, v in buyers.items()},
                        "sellers": {k: [r2(v[0]), r2(v[1])] for k, v in sellers.items()},
                        "netflow": netflow.get(sym, {})}
    return {"date": day_iso, "trading_days": 1, "symbols": sym_out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--periods", action="store_true", help="export preset periods")
    ap.add_argument("--daily", action="store_true", help="export per-day files")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--broker-map", default="/tmp/broker_map.json")
    args = ap.parse_args()
    do_periods = args.periods or args.all
    do_daily = args.daily or args.all

    os.makedirs(os.path.join(OUT, "periods"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "daily"), exist_ok=True)

    # broker map
    if os.path.exists(args.broker_map):
        with open(args.broker_map) as f:
            bmap = json.load(f)
        with open(os.path.join(OUT, "brokers.json"), "w") as f:
            json.dump(bmap, f, ensure_ascii=False)
        print(f"brokers.json: {len(bmap)} entries")

    con = sqlite3.connect(DB)
    latest = con.execute("SELECT MAX(date) FROM daily_summary").fetchone()[0]
    earliest = con.execute("SELECT MIN(date) FROM daily_summary").fetchone()[0]
    ndays = con.execute("SELECT COUNT(DISTINCT date) FROM daily_summary").fetchone()[0]
    print(f"db coverage: {earliest} .. {latest} ({ndays} trading days)")
    if not latest:
        print("empty db; nothing to export")
        return

    if do_periods:
        for p, days in PERIODS.items():
            data = export_period(con, p, days, latest)
            if data is None:
                continue
            path = os.path.join(OUT, "periods", f"{p}.json")
            # Check-and-balance: never silently publish a degenerate symbols map
            # (stock-pattern keeper) — keeps yesterday's good data on failure.
            data = guard_period_symbols(path, data)
            # Atomic write: a killed run must never leave a truncated JSON.
            tmp = path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(data, f, separators=(",", ":"))
            os.replace(tmp, path)
            print(f"periods/{p}.json: {data['trading_days']}d, "
                  f"{len(data['brokers'])} brokers, {len(data['symbols'])} symbols, "
                  f"{os.path.getsize(path)//1024}KB")

    if do_daily:
        days = [r[0] for r in con.execute(
            "SELECT DISTINCT date FROM daily_summary ORDER BY date").fetchall()]
        for d in days:
            data = export_daily(con, d)
            path = os.path.join(OUT, "daily", f"{d}.json")
            with open(path, "w") as f:
                json.dump(data, f, separators=(",", ":"))
        print(f"daily/: {len(days)} files")

    meta = {"earliest": earliest, "latest": latest, "trading_days": ndays,
            "periods": list(PERIODS.keys()),
            "updated_at": date.today().isoformat() + "T00:00:00+05:45",
            "source": "NEPSE official floorsheet (intraday) + Merolagani public floorsheets (backfill)",
            "tier": "tier-1 (unverified method) / tier-2",
            "terms": "Merolagani republication permission not confirmed (R3) — factual flow data only",
            "note": "Transaction flow (net bought/sold), not verified beneficial holdings."}
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print("meta.json written")
    con.close()


if __name__ == "__main__":
    main()

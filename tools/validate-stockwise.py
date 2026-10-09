#!/usr/bin/env python3
"""Stockwise Holdings check-and-balance validator.

Owns the integrity gate for the Stockwise Holdings dataset (the `symbols`
section of nepse-brokers/data/periods/*.json that feeds /nepse-brokers/
"Stockwise Holdings" view and /nepse-brokers/holdings/).

Run BEFORE any deploy. Exit 0 = balanced, safe to publish.
Exit 1 = FAIL LOUD: the caller must abort the deploy and keep yesterday's
good data live. Never silently publish bad data.

Checks:
  1. `to` date is a trading weekday and not older than the previously
     committed file's `to` (previous file read from git HEAD by default).
  2. Symbol row counts sane vs previous day (within +/-15%, min 250 symbols).
  3. No negative quantities or values in any netflow row.
  4. Internal consistency per row: net_qty == buy_qty - sell_qty (rounding),
     net_value == buy_value - sell_value (rounding).
  5. Reconciliation across brokers per stock: total bought == total sold
     (within 1%); sum of net_qty ~ 0 (within 1% of volume).
  6. Absurdity guard: average rates within [1, 500000] Rs/share; no single
     row quantity > 1e9.
  7. Market-level balance: total buy_value ~= total sell_value (within 5%).

Usage:
    python3 tools/validate-stockwise.py [PATH] [--prev REF]

PATH defaults to nepse-brokers/data/periods/1D.json in the repo containing
this script. --prev overrides the git ref used for the previous-day file
(default: HEAD).
"""
import json
import os
import subprocess
import sys
from datetime import date, timedelta

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PATH = os.path.join(REPO, "nepse-brokers", "data", "periods", "1D.json")

MIN_SYMBOLS = 250
COUNT_DRIFT = 0.15        # +/-15% vs previous day
PER_STOCK_QTY_TOL = 0.01  # 1%: bought vs sold per stock
PER_STOCK_MIN_ABS_QTY = 500  # ignore sub-500-share gaps (illiquid-name noise)
MARKET_VALUE_TOL = 0.05   # 5%: buy_value vs sell_value market-wide
MAX_AVG_RATE = 500000     # Rs per share absurdity ceiling
MIN_AVG_RATE = 1
MAX_ROW_QTY = 1e9


def load_json(path):
    with open(path) as f:
        return json.load(f)


def prev_file(rel_path, ref):
    """Return the previously committed file contents, or None."""
    try:
        out = subprocess.run(
            ["git", "show", f"{ref}:{rel_path}"],
            cwd=REPO, capture_output=True, text=True, timeout=30,
        )
        if out.returncode == 0:
            return json.loads(out.stdout)
    except Exception:
        pass
    return None


def validate(path, prev_ref="HEAD"):
    errors = []
    data = load_json(path)
    rel = os.path.relpath(path, REPO)
    prev = prev_file(rel, prev_ref)

    symbols = data.get("symbols") or {}
    to_date = data.get("to") or ""

    # 1. Date sanity: weekday, and not older than previous file's `to`.
    try:
        d = date.fromisoformat(to_date)
        if d.weekday() >= 5:
            errors.append(f"DATA-01: `to` date {to_date} falls on a weekend")
    except ValueError:
        errors.append(f"DATA-01: `to` date {to_date!r} is not ISO YYYY-MM-DD")
        d = None
    prev_to = (prev or {}).get("to") or ""
    if d and prev_to:
        try:
            if d < date.fromisoformat(prev_to):
                errors.append(
                    f"DATA-02: `to` {to_date} older than previous file's "
                    f"`to` {prev_to} (would regress the live table)"
                )
        except ValueError:
            pass

    # 2. Row counts sane vs previous day.
    n_sym = len(symbols)
    if n_sym < MIN_SYMBOLS:
        errors.append(
            f"COUNT-01: only {n_sym} symbols in {rel} (min {MIN_SYMBOLS})"
        )
    prev_syms = (prev or {}).get("symbols") or {}
    if prev_syms:
        pn = len(prev_syms)
        drift = abs(n_sym - pn) / pn
        if drift > COUNT_DRIFT:
            errors.append(
                f"COUNT-02: symbol count {n_sym} drifted {drift:.1%} vs "
                f"previous {pn} (limit {COUNT_DRIFT:.0%})"
            )

    # 3-6. Per-row and per-stock checks.
    tot_buy_q = tot_sell_q = 0
    tot_buy_v = tot_sell_v = 0
    bad_stocks = []
    for sym, s in symbols.items():
        nf = (s or {}).get("netflow") or {}
        if not nf:
            continue
        sb_q = ss_q = sb_v = ss_v = 0
        for code, row in nf.items():
            try:
                nq, nv, bq, bv, sq, sv = (
                    float(row[0] or 0), float(row[1] or 0), float(row[2] or 0),
                    float(row[3] or 0), float(row[4] or 0), float(row[5] or 0),
                )
            except (TypeError, IndexError, ValueError):
                errors.append(f"ROW-01: {sym}/{code} row malformed: {row!r}")
                continue
            # 3. No negatives.
            if bq < 0 or sq < 0 or bv < 0 or sv < 0:
                errors.append(
                    f"ROW-02: {sym}/{code} negative quantity/value "
                    f"(bq={bq}, sq={sq}, bv={bv}, sv={sv})"
                )
            # 4. Internal consistency.
            if abs((bq - sq) - nq) > 1.0:
                errors.append(
                    f"ROW-03: {sym}/{code} net_qty {nq} != "
                    f"buy_qty {bq} - sell_qty {sq}"
                )
            if abs((bv - sv) - nv) > 1.0:
                errors.append(
                    f"ROW-04: {sym}/{code} net_value {nv} != "
                    f"buy_value {bv} - sell_value {sv}"
                )
            # 6. Absurdity.
            if bq > MAX_ROW_QTY or sq > MAX_ROW_QTY:
                errors.append(
                    f"ROW-05: {sym}/{code} absurd quantity (bq={bq}, sq={sq})"
                )
            for q, v, side in ((bq, bv, "buy"), (sq, sv, "sell")):
                if q > 0:
                    rate = v / q
                    if not (MIN_AVG_RATE <= rate <= MAX_AVG_RATE):
                        errors.append(
                            f"ROW-06: {sym}/{code} {side} avg rate Rs {rate:,.2f}"
                            f" outside [{MIN_AVG_RATE},{MAX_AVG_RATE}]"
                        )
            sb_q += bq; ss_q += sq; sb_v += bv; ss_v += sv
        # 5. Reconcile across brokers per stock.
        vol = max(sb_q, ss_q)
        if vol > 0:
            gap = abs(sb_q - ss_q) / vol
            abs_gap = abs(sb_q - ss_q)
            if gap > PER_STOCK_QTY_TOL and abs_gap > PER_STOCK_MIN_ABS_QTY:
                bad_stocks.append(f"{sym} buy/sell qty gap {gap:.1%} ({abs_gap:,.0f} shares)")
        tot_buy_q += sb_q; tot_sell_q += ss_q
        tot_buy_v += sb_v; tot_sell_v += ss_v
    if bad_stocks:
        errors.append(
            f"BAL-01: {len(bad_stocks)} stocks fail buy==sell reconciliation "
            f"(> {PER_STOCK_QTY_TOL:.0%}): " + "; ".join(bad_stocks[:10])
        )

    # 7. Market-level value balance.
    mvol = max(tot_buy_v, tot_sell_v)
    if mvol == 0:
        errors.append("BAL-02: zero total traded value - data looks empty")
    elif abs(tot_buy_v - tot_sell_v) / mvol > MARKET_VALUE_TOL:
        errors.append(
            f"BAL-02: market buy/sell value imbalance "
            f"(buy={tot_buy_v:,.0f}, sell={tot_sell_v:,.0f})"
        )

    return errors, {
        "symbols": n_sym,
        "total_buy_value": tot_buy_v,
        "total_sell_value": tot_sell_v,
        "to": to_date,
    }


def main():
    path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else DEFAULT_PATH
    prev_ref = "HEAD"
    for i, a in enumerate(sys.argv):
        if a == "--prev" and i + 1 < len(sys.argv):
            prev_ref = sys.argv[i + 1]
    if not os.path.exists(path):
        print(f"STOCKWISE VALIDATION: file not found: {path}")
        return 2
    errors, stats = validate(path, prev_ref)
    print(f"STOCKWISE VALIDATION: {path}")
    print(f"  session to={stats['to']} symbols={stats['symbols']} "
          f"buy_value=Rs {stats['total_buy_value']:,.0f} "
          f"sell_value=Rs {stats['total_sell_value']:,.0f}")
    if errors:
        print(f"  FAILED with {len(errors)} error(s):")
        for e in errors:
            print(f"    - {e}")
        print("  >>> DO NOT DEPLOY. Keep yesterday's data live. <<<")
        return 1
    print("  PASSED - balanced, safe to publish")
    return 0


if __name__ == "__main__":
    sys.exit(main())

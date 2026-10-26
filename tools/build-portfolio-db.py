#!/usr/bin/env python3
"""Build the portfolio benchmark database (data/portfolio-benchmark.json).

What it is: the market/session database the /nepse-portfolio/ page scores
against — per-session NEPSE closes plus per-sector equal-weight levels, so
the page can show a portfolio-vs-NEPSE benchmark strip and categorize
each holding's forward outcome against the benchmark over the same window.

What it is NOT: it never sees, stores, or scores user holdings. Holdings,
sells, and portfolio snapshots stay in the user's browser under the
existing 'nl_portfolios_v1' localStorage key. The categorization of a
holding against this database runs in the browser, from real closes.

Sources (all owned, nothing scraped here):
  - data/index-history.json  (NEPSE closes, [YYYYMMDD, O, H, L, C, V])
  - data/sector-indices.json (the Links 2-6 keystone: equal-weight sector
    levels, parallel dates[]/values[] per sector)
  - nepse-holidays.txt       (gazette holidays, for stub-row exclusion)

Honesty rules (hard):
  - Never invent a row: every session comes from a source row, and no
    session is dated after the newest source row.
  - Holiday stubs are EXCLUDED, never carried: index-history carries
    carried-forward rows on market holidays (e.g. [20261019, 2634.17, ...]
    on Maha Nawami, when no trading happened). Any row dated on a listed
    holiday is dropped and recorded in _meta.dropped_holiday_rows.
  - Missing sector levels stay missing: a session with no keystone level
    for a sector simply has no entry for that sector (lookups return
    null on the page), never an interpolated value.
  - Window: the last 5 years of sessions only (snapshots start now, so
    deeper history is dead weight for this page).

Categorization rule (implemented by the page, documented here so the
database and the page cannot drift apart):
  - Portfolio window: first snapshot session D0 -> latest session D1.
    Both dates must exist in this database, else the strip shows "—".
  - Portfolio return = snapshot_value(D1) / snapshot_value(D0) - 1.
  - NEPSE return    = nepse[D1] / nepse[D0] - 1.
  - Beat iff portfolio return > NEPSE return; win iff return > 0.
  - Per holding, since-first-snapshot vs NEPSE: holding price at D0 is
    the close of the last published history bar (nepse-chart/data/
    history/{SYM}.json) on or before D0; if no such bar exists, "—".
    Holding window return = price(D1) / price(D0) - 1, compared to the
    same-window NEPSE return. Since-cost return (retPct) is separate
    and is always shown alongside, never conflated with the window one.
  - No prediction scoring anywhere: every figure is a realized,
    observed outcome from real closes.

Usage:
  python3 tools/build-portfolio-db.py [--root DIR] [--holidays PATH]
      [--out PATH] [--years N]
  Defaults resolve against the repo root (parent of tools/).
"""
import argparse
import datetime as dt
import json
import math
import os
import sys

SCHEMA = "nd-portfolio-benchmark/v1"


def fail(msg):
    raise SystemExit("build-portfolio-db: FAIL " + msg)


def parse_yyyymmdd(v):
    s = str(v)
    try:
        return dt.date(int(s[0:4]), int(s[4:6]), int(s[6:8]))
    except (ValueError, IndexError):
        return None


def load_holidays(path):
    hols = {}
    if not os.path.exists(path):
        fail(f"holidays file missing: {path}")
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(":", 1)
            d = parts[0].strip()
            try:
                dt.date.fromisoformat(d)
            except ValueError:
                continue
            hols[d] = parts[1].strip() if len(parts) > 1 else ""
    return hols


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=None)
    ap.add_argument("--holidays",
                    default=os.path.expanduser("~/workspace/nepse-data-archive/nepse-holidays.txt"))
    ap.add_argument("--out", default=None)
    ap.add_argument("--years", type=int, default=5)
    a = ap.parse_args()

    root = a.root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ih_path = os.path.join(root, "data/index-history.json")
    ks_path = os.path.join(root, "data/sector-indices.json")
    out_path = a.out or os.path.join(root, "data/portfolio-benchmark.json")
    if not os.path.exists(ih_path):
        fail(f"index-history missing: {ih_path}")
    if not os.path.exists(ks_path):
        fail(f"keystone missing: {ks_path}")

    hols = load_holidays(a.holidays)
    with open(ih_path) as f:
        ih = json.load(f)
    rows = ih.get("rows")
    if not isinstance(rows, list) or not rows:
        fail("index-history has no rows")

    # NEPSE closes, holiday stubs excluded, strictly increasing dates.
    nepse = {}
    dropped = []
    prev_date = None
    for r in rows:
        if not isinstance(r, list) or len(r) < 5:
            continue
        d = parse_yyyymmdd(r[0])
        close = r[4]
        if d is None or not isinstance(close, (int, float)) or not math.isfinite(close) or close <= 0:
            continue
        iso = d.isoformat()
        if iso in hols:
            dropped.append({"date": iso, "holiday": hols[iso], "close": close})
            continue
        if prev_date is not None and d <= prev_date:
            continue
        prev_date = d
        nepse[iso] = round(float(close), 2)
    if not nepse:
        fail("no usable NEPSE sessions after holiday exclusion")
    newest = max(nepse)
    newest_d = dt.date.fromisoformat(newest)
    try:
        cutoff = newest_d.replace(year=newest_d.year - a.years)
    except ValueError:  # Feb 29
        cutoff = newest_d.replace(year=newest_d.year - a.years, day=28)
    sessions = sorted(d for d in nepse if d >= cutoff.isoformat())
    if len(sessions) < 100:
        fail(f"too few sessions in window: {len(sessions)}")

    with open(ks_path) as f:
        ks = json.load(f)
    ks_sectors = ks.get("sectors") or {}
    if not ks_sectors:
        fail("keystone has no sectors")
    sectors = {}
    for name, s in ks_sectors.items():
        dates = s.get("dates") or []
        values = s.get("values") or []
        m = {}
        for dd, vv in zip(dates, values):
            if dd in nepse and isinstance(vv, (int, float)) and math.isfinite(vv):
                m[dd] = round(float(vv), 2)
        # Keep only window sessions, in session order.
        sectors[name] = {d: m[d] for d in sessions if d in m}

    db = {
        "schema": SCHEMA,
        "generated": dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=45))).isoformat(timespec="seconds"),
        "asof": sessions[-1],
        "sessions": sessions,
        "nepse": {d: nepse[d] for d in sessions},
        "sectors": sectors,
        "_meta": {
            "sources": [
                "data/index-history.json (NEPSE closes)",
                "data/sector-indices.json (equal-weight sector levels, keystone)",
                "nepse-holidays.txt (stub exclusion)",
            ],
            "index_rows_read": len(rows),
            "dropped_holiday_rows": dropped,
            "sector_counts": {k: len(v) for k, v in sectors.items()},
            "window_years": a.years,
            "note": ("Holiday-dated index rows are excluded, never carried. "
                     "Sector levels are keystone values at the session date; "
                     "a missing level stays missing, never interpolated."),
        },
    }
    with open(out_path, "w") as f:
        json.dump(db, f, indent=1, sort_keys=False)
        f.write("\n")
    print(f"sessions: {len(sessions)} ({sessions[0]}..{sessions[-1]})")
    print(f"sectors: {len(sectors)} ({', '.join(sorted(sectors))})")
    print(f"dropped holiday rows: {len(dropped)} "
          f"({', '.join(d['date'] for d in dropped) if dropped else 'none'})")
    print(f"asof: {sessions[-1]} nepse: {nepse[sessions[-1]]}")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

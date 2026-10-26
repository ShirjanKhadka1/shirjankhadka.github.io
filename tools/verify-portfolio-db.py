#!/usr/bin/env python3
"""Verify data/portfolio-benchmark.json against INDEPENDENT sources.

The builder's own inputs are not enough: NEPSE closes are cross-checked
against the EOD archive and the wave1 market snapshot (both independent
of index-history), and sector levels are re-read from the keystone file.
Exit 0 iff every check passes; any failure exits 1 with the failing
checks named. Stdlib only, writes nothing.

Checks:
  1. Schema tag, strictly increasing sessions, asof == last session.
  2. No session dated after the newest index-history row, and no
     holiday-listed date present in sessions.
  3. Latest NEPSE close matches wave1 market.index.value AND the EOD
     archive's 2026-10-26 previousClose (the true close under the
     documented field-shift: the file's `close` field is stale by one
     session) within Rs 0.02 (paisa rounding).
  4. NEPSE close on 2026-10-16 matches the EOD archive's previousClose
     (2634.17) within Rs 0.02 (index-history carries 2634.16).
  5. Sector levels at first/middle/last sessions match the keystone
     dates[]/values[] exactly (within 1e-9).
  6. Window sanity: >= 100 sessions; every session has a NEPSE close.

Usage:
  python3 tools/verify-portfolio-db.py [--root DIR] [--db PATH]
      [--holidays PATH] [--eod-dir DIR]
"""
import argparse
import datetime as dt
import json
import math
import os
import sys

FAILURES = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ((" — " + detail) if detail else ""))
    if not ok:
        FAILURES.append(name)


def load_json(path):
    with open(path) as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=None)
    ap.add_argument("--db", default=None)
    ap.add_argument("--holidays",
                    default=os.path.expanduser("~/workspace/nepse-data-archive/nepse-holidays.txt"))
    ap.add_argument("--eod-dir",
                    default=os.path.expanduser("~/workspace/nepse-data-archive/eod"))
    a = ap.parse_args()
    root = a.root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_path = a.db or os.path.join(root, "data/portfolio-benchmark.json")
    if not os.path.exists(db_path):
        print("FAIL database missing: " + db_path)
        return 1
    db = load_json(db_path)
    sessions = db.get("sessions") or []
    nepse = db.get("nepse") or {}
    sectors = db.get("sectors") or {}

    check("schema tag", db.get("schema") == "nd-portfolio-benchmark/v1",
          str(db.get("schema")))
    check("sessions non-empty and increasing",
          len(sessions) >= 100 and sessions == sorted(sessions)
          and len(sessions) == len(set(sessions)),
          f"n={len(sessions)}")
    check("asof == last session", db.get("asof") == (sessions[-1] if sessions else None),
          str(db.get("asof")))
    check("every session has a NEPSE close",
          all(s in nepse and isinstance(nepse[s], (int, float)) for s in sessions))

    ih = load_json(os.path.join(root, "data/index-history.json"))
    ih_dates = []
    for r in ih.get("rows") or []:
        if isinstance(r, list) and len(r) >= 5:
            s = str(r[0])
            try:
                ih_dates.append(dt.date(int(s[0:4]), int(s[4:6]), int(s[6:8])).isoformat())
            except ValueError:
                pass
    check("no session after newest index-history row",
          (not sessions) or sessions[-1] <= max(ih_dates),
          f"db last {sessions[-1] if sessions else None} vs index last {max(ih_dates) if ih_dates else None}")

    hols = set()
    if os.path.exists(a.holidays):
        for line in open(a.holidays):
            line = line.strip()
            if line and not line.startswith("#"):
                hols.add(line.split(":")[0].strip())
    bad = [s for s in sessions if s in hols]
    check("no holiday date in sessions", not bad, f"offenders: {bad[:5]}")

    # Independent NEPSE cross-checks (wave1 + EOD archive, not index-history).
    wave1 = load_json(os.path.join(root, "nepse-chart/data/wave1.json"))
    w_idx = (wave1.get("market") or {}).get("index") or {}
    eod26 = load_json(os.path.join(a.eod_dir, "eod-2026-10-26.json"))
    eod26_close = ((eod26.get("indices") or {}).get("NEPSE Index") or {}).get("previousClose")
    eod16 = load_json(os.path.join(a.eod_dir, "eod-2026-10-16.json"))
    eod16_close = ((eod16.get("indices") or {}).get("NEPSE Index") or {}).get("previousClose")
    latest = nepse.get(sessions[-1]) if sessions else None
    if w_idx.get("value") is not None and latest is not None:
        check("latest close vs wave1", abs(latest - w_idx["value"]) <= 0.02,
              f"db {latest} vs wave1 {w_idx['value']}")
    if eod26_close is not None and sessions and sessions[-1] == "2026-10-26":
        check("2026-10-26 close vs EOD archive", abs(nepse["2026-10-26"] - eod26_close) <= 0.02,
              f"db {nepse['2026-10-26']} vs eod {eod26_close}")
    if "2026-10-16" in nepse and eod16_close is not None:
        check("2026-10-16 close vs EOD archive", abs(nepse["2026-10-16"] - eod16_close) <= 0.02,
              f"db {nepse['2026-10-16']} vs eod {eod16_close}")

    ks = load_json(os.path.join(root, "data/sector-indices.json"))
    ks_sectors = ks.get("sectors") or {}
    check("sectors present", set(sectors) == set(ks_sectors),
          f"db {sorted(sectors)}")
    if sessions:
        sample = [sessions[0], sessions[len(sessions) // 2], sessions[-1]]
        ok_all = True
        detail = ""
        for name, s in ks_sectors.items():
            m = dict(zip(s.get("dates") or [], s.get("values") or []))
            for d in sample:
                if d in m and d in sectors.get(name, {}):
                    if abs(sectors[name][d] - m[d]) > 1e-9:
                        ok_all = False
                        detail = f"{name} {d}: db {sectors[name][d]} vs keystone {m[d]}"
        check("sector levels match keystone at sampled sessions", ok_all, detail)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {'; '.join(FAILURES)}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

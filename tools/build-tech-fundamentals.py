#!/usr/bin/env python3
"""Build nepse-chart/data/tech-fundamentals.json from our own data bank.

Merges per-symbol fields from the manually-verified float archive
(tools/verdict-engine-v2/manual/float-archive.json) into a slim file
the /nepse-technical/ fundamentals panel reads:

  sector, shares_outstanding, book_value (BVPS), pbv (P/B ratio)

Sector source of truth is the MASTER (data/reference/instruments.json,
Charter 4B) — the float archive's sector vocabulary (Commercial Banks,
Hydro Power, Tradings, Others) is retired and never used. Shares/BV/PBV
still come from the float archive, as before.
Run after the float archive is rebuilt; deploy the output file.
"""
import json
import os
import sys
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))
from master_instruments import sector_of as master_sector
ARCHIVE = os.path.join(REPO, "tools", "verdict-engine-v2", "manual", "float-archive.json")
OUT = os.path.join(REPO, "nepse-chart", "data", "tech-fundamentals.json")


def main():
    with open(ARCHIVE, encoding="utf-8") as f:
        archive = json.load(f)
    stocks = archive.get("stocks", {})

    companies = {}
    filled = {"sector": 0, "shares": 0, "bv": 0, "pbv": 0}
    for sym, rec in stocks.items():
        if not isinstance(rec, dict):
            continue
        entry = {}
        # 4B: sector ONLY from the master (None = UNCONFIRMED -> no sector
        # field; the panel renders '—'). Archive sector is ignored.
        sector = master_sector(sym)
        if sector:
            entry["sector"] = sector
            filled["sector"] += 1
        shares = rec.get("paidup_shares")
        if shares and float(shares) > 0:
            entry["shares_outstanding"] = int(float(shares))
            filled["shares"] += 1
        bvps = rec.get("bvps")
        if bvps is not None and str(bvps).strip() not in ("", "null", "None"):
            try:
                entry["book_value"] = round(float(bvps), 2)
                filled["bv"] += 1
            except (ValueError, TypeError):
                pass
        pb = rec.get("pb_ratio")
        if pb is not None and str(pb).strip() not in ("", "null", "None"):
            try:
                entry["pbv"] = round(float(pb), 2)
                filled["pbv"] += 1
            except (ValueError, TypeError):
                pass
        if entry:
            companies[sym] = entry

    out = {
        "asof": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "Nepse Decode own archive (float-archive.json, manually verified)",
        "symbols": len(companies),
        "coverage": filled,
        "companies": companies,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}: {len(companies)} symbols, coverage={filled}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

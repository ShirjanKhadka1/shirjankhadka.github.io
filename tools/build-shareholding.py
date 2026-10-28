#!/usr/bin/env python3
"""Build nepse-chart/data/shareholding.json for the stock-page shareholding
section (agency-agents gap 2).

Inputs (both already in this repo, both ours):
  - tools/verdict-engine-v2/manual/float-archive.json : own archive,
    manually transcribed public facts; carries paidup_shares (listed
    total) for 267 symbols and promoter/public percentages.
  - nepse-chart/data/universe.json : the 432 symbols the pages cover,
    with the pipeline's instrument-type tags.

Source rule applied here (2026-10-28, documented in the output file):
  - NEPSE official was probed first: /api/nots/company/list and
    /api/nots/security/{id} carry NO promoter/public/listed-share
    fields, so no official split source exists in bulk.
  - Listed totals come from the own archive. They cross-check exactly
    against an independent republisher (ShareHub, Oct 2026) on every
    sampled symbol (exact totals; post-bonus totals where ShareHub is
    pre-bonus: NABIL, SBL, GBIME).
  - Promoter/public splits are published under a tier rule (2026-10-28):
    Tier A filing-verified (a primary document: the company's own annual
    report or a NEPSE/SEBON filing) and Tier B matched (a republisher
    value matched against an independent site, rendered as matched,
    never as filing-verified). Every other archive split is WITHHELD
    (status "held"). The first filing-verified case is SHL (69/31,
    Soaltee Hotel 51st Annual Report FY2081/82), which publishes
    DESPITE archive disagreement (archive 85 = one broker snapshot):
    the audited primary document outranks an unsourced transcription.
    The 7 archive-agreement splits below remain published.
    Every other archive split is WITHHELD (status "held"): the
    cross-check sample disagrees on 9 of 16 symbols (NABIL 58.4 vs 60,
    SHL 85 vs 69, NFS 52 vs 60, NLICL 55 vs 65, LICN 65 vs 70,
    HBL 70 vs 62.99, GBIME 51.2 vs 51, KBL 51.1 vs 51,
    CZBIL 51.1 vs 51), so archive splits as a field are NOT verified
    and must not be published as fact. Withheld splits render as
    honestly unavailable on the page, never estimated.
  - Promoter-share instruments (universe type "Promoter share") carry
    a definitional 100% promoter / 0% public split: the entire issue
    is promoter holding. No listed total is claimed for them (none on
    file in the archive).
  - Debentures and mutual funds get no split: units, not shares.
  - Equity-tagged symbols with no archive record get nothing: honest
    unavailable (the 15 genuine no-record equities; the former
    debenture/fund-pattern tag noise was corrected in the universe
    builder 2026-10-28, gap-2 item 3).

Output: nepse-chart/data/shareholding.json, loaded by
tools/build-symbol-pages.js in main(). Re-run this script whenever the
archive or the verified-split list changes; the daily universe refresh
regenerates pages from the checked-in file.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE = os.path.join(REPO, "tools", "verdict-engine-v2", "manual", "float-archive.json")
UNIVERSE = os.path.join(REPO, "nepse-chart", "data", "universe.json")
OUT = os.path.join(REPO, "nepse-chart", "data", "shareholding.json")

# Filing-verified splits (Tier A): promoter% proven by a PRIMARY document
# (company's own annual report or a NEPSE/SEBON filing), checked BEFORE
# VERIFIED_SPLITS because the archive may dissent (SHL: archive 85 vs
# filing 69) and the primary document outranks an unsourced
# transcription. Counts use the same rounding/remainder/sum assertions
# as verified splits. Output carries verified_via "filing" + a
# provenance note rendered verbatim on the page.
FILING_VERIFIED = {
    "SHL": {
        "promoter_pct": 69.0,
        "source": ("Soaltee Hotel Ltd 51st Annual Report FY2081/82, "
                   "Notes to the Consolidated Financial Statements, "
                   "'Details of Shareholding' (as at 32 Ashad 2082 / "
                   "16 July 2025): Major Corporate Shareholders 69% / "
                   "General Shareholders 31%, for both FY2081/82 and "
                   "FY2080/81"),
        "archive_dissent": 85.0,
        "dissent_explanation": ("Archive 85 matches a single broker "
                   "snapshot (Himalayan Capital Pulse, Baisakh 2081, "
                   "footnoted 'as per Nepalstock.com Updated On March 6, "
                   "2024'); no capital event explains a 69 -> 85 move "
                   "between the July 2025 audited report and Mar 2026."),
        "provenance": ("Shareholding 69% promoter / 31% public per "
                   "Soaltee Hotel Ltd's own annual reports (51st report, "
                   "FY2081/82, \"Details of Shareholding\": Major "
                   "Corporate Shareholders 69% / General Shareholders "
                   "31%, for both FY2081/82 and FY2080/81), matching "
                   "ShareHub's 69/31 counts. Counts are computed from "
                   "the listed total of 117,515,254 shares."),
    },
}

# Archive promoter% asserted equal to the independent republisher's value
# (ShareHub, Oct 2026, exact share counts). Fail loud if the archive moves.
VERIFIED_SPLITS = {
    "CLI": 70.0,
    "GMLI": 70.0,
    "NBL": 51.0,
    "NLIC": 51.0,
    "NMB": 51.0,
    "RNLI": 70.0,
    "SBL": 51.0,
}

# Cross-check sample evidence (archive vs ShareHub, Oct 2026). Kept in the
# output file so the verification state travels with the data.
CROSSCHECK = [
    # symbol, archive promoter%, republisher promoter%, verdict
    ("CLI", 70.0, 70, "agree"),
    ("GMLI", 70.0, 70, "agree"),
    ("NBL", 51.0, 51, "agree"),
    ("NLIC", 51.0, 51, "agree"),
    ("NMB", 51.0, 51, "agree"),
    ("RNLI", 70.0, 70, "agree"),
    ("SBL", 51.0, 51, "agree"),
    ("GBIME", 51.2, 51, "conflict"),
    ("KBL", 51.1, 51, "conflict"),
    ("CZBIL", 51.1, 51, "conflict"),
    ("LICN", 65.0, 70, "conflict"),
    ("NABIL", 58.4, 60, "conflict"),
    ("NFS", 52.0, 60, "conflict"),
    ("NLICL", 55.0, 65, "conflict"),
    ("SHL", 85.0, 69, "conflict"),
    ("HBL", 70.0, 62.99, "conflict"),
]


def main():
    with open(ARCHIVE, encoding="utf-8") as f:
        archive = json.load(f)
    stocks = archive.get("stocks", {})
    with open(UNIVERSE, encoding="utf-8") as f:
        universe = json.load(f)
    symbols = universe["symbols"]

    out_symbols = {}
    counts = {
        "pages": 0,
        "listed_total": 0,
        "split_verified": 0,
        "split_promoter_instrument": 0,
        "split_held": 0,
        "na_debenture": 0,
        "na_mutual_fund": 0,
        "unavailable": 0,
    }

    for u in symbols:
        sym = u["s"]
        utype = u.get("t") or ""
        rec = stocks.get(sym) or {}
        entry = {"type": utype}
        paidup = rec.get("paidup_shares")
        if paidup and float(paidup) > 0:
            listed = int(float(paidup))
            entry["listed"] = listed
            counts["listed_total"] += 1
        if sym in FILING_VERIFIED:
            fv = FILING_VERIFIED[sym]
            prom_pct = fv["promoter_pct"]
            pub_pct = round(100.0 - prom_pct, 2)
            prom_sh = int(round(listed * prom_pct / 100.0))
            pub_sh = listed - prom_sh
            assert abs(prom_sh + pub_sh - listed) <= 0, f"{sym}: split shares != listed"
            assert abs(prom_sh - listed * prom_pct / 100.0) <= 1, f"{sym}: rounding drift"
            entry.update({
                "promoter_pct": prom_pct,
                "public_pct": pub_pct,
                "promoter_shares": prom_sh,
                "public_shares": pub_sh,
                "split_status": "verified",
                "verified_via": "filing",
                "provenance": fv["provenance"],
            })
            counts["split_verified"] += 1
        elif sym in VERIFIED_SPLITS:
            ap = rec.get("promoter_pct")
            assert ap is not None, f"{sym}: verified split but no archive pct"
            assert abs(float(ap) - VERIFIED_SPLITS[sym]) < 0.05, (
                f"{sym}: archive promoter% moved: {ap} != {VERIFIED_SPLITS[sym]}"
            )
            prom_pct = VERIFIED_SPLITS[sym]
            pub_pct = round(100.0 - prom_pct, 2)
            prom_sh = int(round(listed * prom_pct / 100.0))
            pub_sh = listed - prom_sh
            assert abs(prom_sh + pub_sh - listed) <= 0, f"{sym}: split shares != listed"
            assert abs(prom_sh - listed * prom_pct / 100.0) <= 1, f"{sym}: rounding drift"
            entry.update({
                "promoter_pct": prom_pct,
                "public_pct": pub_pct,
                "promoter_shares": prom_sh,
                "public_shares": pub_sh,
                "split_status": "verified",
            })
            counts["split_verified"] += 1
        elif utype == "Promoter share":
            entry.update({
                "promoter_pct": 100.0,
                "public_pct": 0.0,
                "promoter_shares": None,
                "public_shares": None,
                "split_status": "promoter_instrument",
            })
            counts["split_promoter_instrument"] += 1
        elif "listed" in entry:
            # Archive membership beats the universe type tag: the archive
            # builder skips true funds/debentures, so a typed fund or
            # debenture WITH an archive shares record is a mistagged
            # equity (e.g. RURU, a hydro typed "Mutual fund"). It gets
            # its listed total with the split held, never an NA label.
            entry["split_status"] = "held"
            counts["split_held"] += 1
        elif utype == "Debenture":
            entry["split_status"] = "na_debenture"
            counts["na_debenture"] += 1
        elif utype == "Mutual fund":
            entry["split_status"] = "na_mutual_fund"
            counts["na_mutual_fund"] += 1
        else:
            entry["split_status"] = "unavailable"
            counts["unavailable"] += 1
        out_symbols[sym] = entry
        counts["pages"] += 1

    assert counts["pages"] == len(symbols) == 432, counts
    total_status = (counts["split_verified"] + counts["split_promoter_instrument"]
                    + counts["split_held"] + counts["na_debenture"]
                    + counts["na_mutual_fund"] + counts["unavailable"])
    assert total_status == 432, (total_status, counts)
    # Every archive-backed page must carry a listed total.
    for sym, e in out_symbols.items():
        if e["split_status"] in ("verified", "held"):
            assert "listed" in e, sym

    out = {
        "asof": "2026-10-28",
        "source": ("Nepse Decode own archive "
                   "(tools/verdict-engine-v2/manual/float-archive.json, "
                   "manually transcribed public facts) for listed totals; "
                   "promoter/public splits published only where independently "
                   "cross-checked (see verification)."),
        "method": ("NEPSE official API probed first (company/list, "
                   "security/{id}): no promoter/public/listed-share fields. "
                   "Listed totals from own archive, cross-checked exact "
                   "against an independent republisher on sampled symbols. "
                   "Splits published under a tier rule: Tier A "
                   "filing-verified (primary document) and Tier B matched "
                   "(independent-site match, rendered as matched); all "
                   "other splits withheld. First filing-verified case: "
                   "SHL 69/31 (Soaltee Hotel 51st Annual Report "
                   "FY2081/82)."),
        "counts": counts,
        "symbols": out_symbols,
        "verification": {
            "crosscheck_sample": [
                {"symbol": s, "archive_promoter_pct": a,
                 "republisher_promoter_pct": r, "verdict": v}
                for (s, a, r, v) in CROSSCHECK
            ],
            "note": ("Archive splits agree with the independent republisher "
                     "on 7 of 16 sampled symbols and conflict on 9; the "
                     "field as a whole is therefore NOT verified. Published "
                     "splits: the 7 agreements, plus SHL 69/31 as the first "
                     "filing-verified case (Tier A: Soaltee Hotel 51st "
                     "Annual Report FY2081/82, despite archive dissent 85). "
                     "NABIL (flagship) is held: archive 58.4 vs republisher "
                     "60, with a third source (Wikipedia, FY 2023/24) also "
                     "at 60."),
        },
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {OUT}: {json.dumps(counts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

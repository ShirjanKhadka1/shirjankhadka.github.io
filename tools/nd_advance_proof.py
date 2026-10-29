"""Executed proof for the advance-program helpers (nd_asof.py, nd_rating.py).

Runs offline, no network, no live source. Part 1 reads a REAL published
history file from this repo (nepse-chart/data/history/NABIL.json) and
asserts the point-in-time guards against its own session list — nothing
is hardcoded except calendar facts (2026-10-23 Kojagrat Purnima was a
market holiday; 2026-10-25 was a Sunday). Part 2 scores FIXTURE ledger
rows (labelled FIXTURE in the code; invented numbers used ONLY to prove
the arithmetic, never shipped as data).

Exit 0 with every line PASS, else exit 1. Usage:
  python3 tools/nd-advance-proof.py
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nd_asof import (  # noqa: E402
    as_of, as_of_window, first_close_after, parse_ymd, settle_window)
from nd_rating import Rating, direction, parse_rating, summarize_by_rating  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print("%s %s %s" % ("PASS" if cond else "FAIL", name, detail))
    if not cond:
        FAILURES.append(name)


def approx(a, b, tol=1e-9):
    return a is not None and b is not None and abs(a - b) <= tol


def main():
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    hist_path = os.path.join(repo, "nepse-chart", "data", "history", "NABIL.json")
    hist = json.load(open(hist_path))
    bars = [(parse_ymd(r[0]), float(r[4])) for r in hist["data"]]
    bars.sort(key=lambda b: b[0])
    sessions = [b[0] for b in bars]
    print("loaded %s: %d bars, %s..%s (updated %s)"
          % (hist["symbol"], len(bars), sessions[0], sessions[-1], hist["updated"]))

    # --- Part 1: point-in-time guards on REAL published data ---
    from datetime import date
    s, reason = as_of(date(2026, 10, 29), sessions)
    check("asof-today-clamps-to-last-session", s == date(2026, 10, 28), str(s))
    s, _ = as_of(date(2026, 10, 25), sessions)  # a Sunday
    check("asof-sunday-clamps-to-weekday", s < date(2026, 10, 25) and s.weekday() < 5, str(s))
    s, _ = as_of(date(2026, 10, 23), sessions)  # Kojagrat Purnima holiday
    check("asof-holiday-clamps-back", s < date(2026, 10, 23), str(s))
    s, reason = as_of(date(2000, 1, 1), sessions)
    check("asof-before-archive-withholds-with-reason", s is None and bool(reason), reason)
    bar, reason = first_close_after(date(2026, 10, 27), bars)
    check("first-close-after-decision-date", bar is not None and bar[0] == date(2026, 10, 28), str(bar[0] if bar else reason))
    bar, reason = first_close_after(date(2026, 10, 28), bars)
    check("first-close-after-last-bar-pending", bar is None and "pending" in reason, reason)
    entry = [b for b in bars if b[0] == date(2026, 10, 28)][0]
    out, status, reason = settle_window(entry, bars, 5)
    check("untraded-window-stays-pending", out is None and status == "pending", reason)
    old_entry = bars[-10]
    out, status, reason = settle_window(old_entry, bars, 5)
    check("traded-window-settles-on-5th-session", status == "settled" and out[0] == sessions[-5],
          "%s -> %s" % (old_entry[0], out[0] if out else reason))
    window, note = as_of_window(date(2026, 10, 20), date(2026, 10, 28), sessions)
    check("window-covers-requested-range", bool(window) and window[-1] == date(2026, 10, 28)
          and all(date(2026, 10, 20) <= d <= date(2026, 10, 28) for d in window),
          "%d sessions, note=%r" % (len(window), note))
    window, note = as_of_window(date(2026, 11, 2), date(2026, 11, 6), sessions)
    check("future-window-withholds-with-reason", window == [] and "withheld" in note, note)

    # --- Part 2: rating + summary on FIXTURE rows (invented, proof only) ---
    check("parse-canonical", parse_rating(" buy ") == Rating.BUY and parse_rating("SELL") == Rating.SELL)
    check("parse-nonsense-is-review", parse_rating("nonsense") == Rating.REVIEW
          and parse_rating("") == Rating.REVIEW and parse_rating(None) == Rating.REVIEW)
    check("parse-never-upgrades", parse_rating("Strong Buy") == Rating.REVIEW)
    check("directions", direction(Rating.BUY) == 1 and direction(Rating.OVERWEIGHT) == 1
          and direction(Rating.SELL) == -1 and direction(Rating.UNDERWEIGHT) == -1
          and direction(Rating.HOLD) == 0 and direction(Rating.REVIEW) == 0)
    fixture = [  # FIXTURE ONLY — invented alphas, used to prove the arithmetic.
        {"rating": "BUY", "alpha_net": 2.0, "net_of_charges": True},
        {"rating": "BUY", "alpha_net": -1.0, "net_of_charges": True},
        {"rating": "OVERWEIGHT", "alpha_net": 0.5, "net_of_charges": True},
        {"rating": "SELL", "alpha_net": -1.5, "net_of_charges": True},
        {"rating": "SELL", "alpha_net": 1.0, "net_of_charges": True},
        {"rating": "UNDERWEIGHT", "alpha_net": -0.5, "net_of_charges": True},
        {"rating": "HOLD", "alpha_net": 3.0, "net_of_charges": True},
        {"rating": "nonsense", "alpha_net": 9.0, "net_of_charges": True},
        {"rating": "BUY", "alpha_net": 5.0, "net_of_charges": False},
        {"rating": "BUY", "alpha_net": None, "net_of_charges": True},
        {"rating": "BUY", "alpha_net": 1.0, "net_of_charges": True, "pending": True},
    ]
    res = summarize_by_rating(fixture)
    t = res["tiers"]
    check("summary-buy-tier", t["BUY"] == {"n": 2, "hits": 1, "hit_rate": 0.5, "mean_alpha": 0.5}, str(t.get("BUY")))
    check("summary-overweight-tier", t["OVERWEIGHT"]["n"] == 1 and t["OVERWEIGHT"]["hits"] == 1
          and approx(t["OVERWEIGHT"]["mean_alpha"], 0.5), str(t.get("OVERWEIGHT")))
    check("summary-sell-tier", t["SELL"]["n"] == 2 and t["SELL"]["hits"] == 1
          and approx(t["SELL"]["mean_alpha"], -0.25), str(t.get("SELL")))
    check("summary-underweight-tier", t["UNDERWEIGHT"]["n"] == 1 and t["UNDERWEIGHT"]["hits"] == 1
          and approx(t["UNDERWEIGHT"]["mean_alpha"], -0.5), str(t.get("UNDERWEIGHT")))
    d = res["directional"]
    check("summary-directional-total", d["n"] == 6 and d["hits"] == 4 and approx(d["hit_rate"], 4.0 / 6.0), str(d))
    u = res["unscored"]
    check("summary-unscored-buckets", u == {"hold": 1, "review": 1, "pending": 1,
                                            "unverified_costs": 1, "missing_alpha": 1}, str(u))

    print("----")
    if FAILURES:
        print("RESULT: FAIL (%d failures: %s)" % (len(FAILURES), ", ".join(FAILURES)))
        return 1
    print("RESULT: PASS (all checks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

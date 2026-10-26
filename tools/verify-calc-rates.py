#!/usr/bin/env python3
"""Verify the NEPSE calculators' rates schedule and math identity.

Dry run only: checks, never writes. Exit 0 iff every check passes.

What it checks:
  (1) The rates table in nepse-calculators/index.html states the canonical
      schedule (commission slabs, SEBON fee, DP charge, CGT rates and the
      365-day threshold, the Gazette citation, the superseded rates).
  (2) The engine in js/nd-calcs.js carries the same numbers as literals
      (slabs, Rs 10 minimum, SEBON 0.015%, DP Rs 25, CGT 5% / 3.75%).
      NOTE: the JS holds the holding threshold as a boolean (longHold),
      not a literal 365 — the threshold wording is checked in the HTML
      holding-period buttons instead.
  (3) Math identity: eight known cases (defaults + one custom per
      calculator, taken from rendered page output) recomputed here in
      Python and compared within Rs 0.01 (money) / 0.01pp (percent) /
      exact (counts). The tolerance covers float-path differences only;
      any larger gap is a real drift.

LIMITATION, stated plainly: this catches drift between the page, the
engine, and the canonical schedule below. It does NOT detect a new
Gazette notice — when rates change, a human must update CANONICAL here
first, then the page and engine, and this script proves they agree.

Usage:
  python3 tools/verify-calc-rates.py [--html PATH] [--js PATH]
  Defaults resolve against the repo root (parent of tools/).
"""
import argparse
import math
import os
import re
import sys

CANONICAL = {
    "slabs": [(50000, 0.0036), (500000, 0.0033), (2000000, 0.0031),
              (10000000, 0.0027), (float("inf"), 0.0024)],
    "min_commission": 10,
    "sebon": 0.00015,
    "dp": 25,
    "cgt_short": 0.05,
    "cgt_long": 0.0375,
    "gazette": "vol. 76, Additional 40, Part 5",
    "gazette_date": "31 Bhadra 2083",
    "old_rates": "10% / 7.5%",
    "dividend_tax": "flat 5%",
}

# Expected outputs, captured from rendered page output (before rebuild).
# Money in rupees, percents in points, counts exact.
EXPECTED = {
    "share_default": {"cost": 50212.50, "proceeds": 59768.00, "gain": 9555.50,
                      "cgt": 477.78, "net": 9077.73, "ret": 18.08, "cost_ps": 502.13},
    "share_custom": {"cost": 301060.00, "proceeds": 336310.63, "gain": 35250.63,
                     "cgt": 1321.90, "net": 33928.73, "ret": 11.27, "cost_ps": 1204.24},
    "wacc_default": {"shares": 150, "cost": 82859.38, "avg": 552.40},
    "wacc_custom": {"shares": 300, "cost": 250912.50, "avg": 836.38},
    "sip_default": {"invested": 1200000.00, "fv": 2323390.76, "gain": 1123390.76, "rows": 10},
    "sip_custom": {"invested": 300000.00, "fv": 390411.91, "gain": 90411.91, "rows": 5},
    "adj_default": {"bonus": 833.33, "right": 550.00},
    "adj_custom": {"bonus": 1818.18, "right": 1366.67},
}

FAILURES = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ((" — " + detail) if detail else ""))
    if not ok:
        FAILURES.append(name)


def close(a, b, tol=0.01):
    return abs(a - b) <= tol


# --- engine mirror (same formulas as js/nd-calcs.js) ---
def commission(amount):
    for cap, rate in CANONICAL["slabs"]:
        if amount <= cap:
            return max(CANONICAL["min_commission"], amount * rate)
    return amount * CANONICAL["slabs"][-1][1]


def side(amount):
    c = commission(amount)
    s = amount * CANONICAL["sebon"]
    return {"amount": amount, "commission": c, "sebon": s,
            "dp": CANONICAL["dp"], "charges": c + s + CANONICAL["dp"]}


def share(q, bp, sp, long_hold):
    buy, sell = side(q * bp), side(q * sp)
    cost = buy["amount"] + buy["charges"]
    proc = sell["amount"] - sell["charges"]
    gain = proc - cost
    rate = CANONICAL["cgt_long"] if long_hold else CANONICAL["cgt_short"]
    cgt = gain * rate if gain > 0 else 0.0
    net = gain - cgt
    return {"cost": cost, "proceeds": proc, "gain": gain, "cgt": cgt,
            "net": net, "ret": (net / cost * 100) if cost > 0 else 0.0,
            "cost_ps": (cost / q) if q else 0.0}


def wacc(lots):
    tq = 0.0
    tc = 0.0
    for q, p in lots:
        if q > 0 and p > 0:
            s = side(q * p)
            tq += q
            tc += s["amount"] + s["charges"]
    return {"shares": int(tq), "cost": tc, "avg": (tc / tq) if tq else 0.0}


def sip(m, yrs, ret_pct):
    r = ret_pct / 100.0 / 12.0
    invested = m * 12 * yrs
    fv = 0.0
    for _ in range(yrs):
        for _ in range(12):
            fv = (fv + m) * (1 + r)
    return {"invested": float(invested), "fv": fv, "gain": fv - invested,
            "rows": yrs}


def adj(price, bonus_pct, right_pct, face):
    b, r = bonus_pct / 100.0, right_pct / 100.0
    return {"bonus": (price / (1 + b)) if b > 0 else None,
            "right": ((price + face * r) / (1 + r)) if r > 0 else None}


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    ap.add_argument("--html", default=os.path.join(root, "nepse-calculators", "index.html"))
    ap.add_argument("--js", default=os.path.join(root, "js", "nd-calcs.js"))
    args = ap.parse_args()

    html = open(args.html, encoding="utf-8").read()
    js = open(args.js, encoding="utf-8").read()

    # (1) HTML rates table
    for needle in ["0.36% (min Rs 10)", "0.33%", "0.31%", "0.27%", "0.24%",
                   "0.015%", "Rs 25 per scrip", "5% of the net gain",
                   "3.75% of the net gain", "365 days or less",
                   "more than 365 days", CANONICAL["gazette"],
                   CANONICAL["gazette_date"], CANONICAL["old_rates"],
                   CANONICAL["dividend_tax"]]:
        check("html contains %r" % needle, needle in html)
    for slab_label in ["up to Rs 50,000", "Rs 50,001 to 5 lakh",
                       "Rs 5 lakh to 20 lakh", "Rs 20 lakh to 1 crore",
                       "above Rs 1 crore"]:
        check("html slab label %r" % slab_label, slab_label in html)

    # (2) JS literals
    m = re.search(r"var slabs = \[(.*?)\];", js)
    check("js slabs line present", bool(m))
    if m:
        pairs = re.findall(r"\[(50000|500000|2000000|10000000|Infinity),\s*(0\.00\d+)\]", m.group(1))
        want = [("50000", "0.0036"), ("500000", "0.0033"), ("2000000", "0.0031"),
                ("10000000", "0.0027"), ("Infinity", "0.0024")]
        check("js slabs equal canonical", pairs == want, "found %s" % (pairs,))
    check("js min commission Math.max(10", "Math.max(10," in js)
    check("js SEBON 0.00015", "0.00015" in js)
    check("js DP 25", "dp: 25" in js)
    check("js CGT 0.05 / 0.0375", "0.05" in js and "0.0375" in js)
    check("js Gazette comment", "31 Bhadra 2083" in js)

    # (3) Math identity
    cases = [
        ("share_default", share(100, 500, 600, False), ["cost", "proceeds", "gain", "cgt", "net", "ret", "cost_ps"]),
        ("share_custom", share(250, 1200, 1350, True), ["cost", "proceeds", "gain", "cgt", "net", "ret", "cost_ps"]),
        ("wacc_default", wacc([(100, 500), (50, 650)]), ["cost", "avg"]),
        ("wacc_custom", wacc([(200, 800), (100, 900)]), ["cost", "avg"]),
        ("sip_default", sip(10000, 10, 12), ["invested", "fv", "gain"]),
        ("sip_custom", sip(5000, 5, 10), ["invested", "fv", "gain"]),
        ("adj_default", adj(1000, 20, 100, 100), ["bonus", "right"]),
        ("adj_custom", adj(2000, 10, 50, 100), ["bonus", "right"]),
    ]
    for name, got, fields in cases:
        exp = EXPECTED[name]
        for f in fields:
            check("identity %s.%s (got %.4f, want %.2f)" % (name, f, got[f], exp[f]),
                  close(got[f], exp[f]))
    for name, got, field in [("wacc_default", wacc([(100, 500), (50, 650)]), "shares"),
                             ("wacc_custom", wacc([(200, 800), (100, 900)]), "shares"),
                             ("sip_default", sip(10000, 10, 12), "rows"),
                             ("sip_custom", sip(5000, 5, 10), "rows")]:
        check("identity %s.%s exact (%s)" % (name, field, got[field]),
              got[field] == EXPECTED[name][field])

    print()
    if FAILURES:
        print("FAILED: %d check(s): %s" % (len(FAILURES), "; ".join(FAILURES)))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

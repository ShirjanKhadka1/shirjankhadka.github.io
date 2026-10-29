#!/usr/bin/env python3
"""ROUND 2 / R2 verify: invariant fixes S1/S2/S3 on the verdict batch.

Checks the CURRENT verdicts.json (repo root) plus, when --before/--control
are given, the full-universe before/after attribution:
  * I1 (via gate log): every S1-gated row moved Buy/Strong Buy -> Hold and no
    Buy/Strong Buy row carries an S1 gate. Direct confirmed-vs-forming proof
    lives in the unit tests (tools/round2-test-r2.js, confirmed fixtures)
    and the independent staged-pass rerun (audit-staging/staged-verdict-pass.js),
    because the shipped file carries no confirmed/forming flag on `setup`.
    This script lists remaining bearish-setup Buys as INFO (forming only).
  * I2: 0 Buy/Strong Buy with sector in {Debentures, Mutual Funds,
    Promoter Shares} OR universe type in {Debenture, Mutual fund,
    Promoter share} — daily, weekly and monthly verdicts.
  * I3: 0 Buy/Strong Buy with last-session volume not > 0 — daily, w, m.
  * Attribution: control->new label changes are EXACTLY the gated set
    (Buy/Strong Buy -> Hold only); scores never change control->new;
    tr nulls control->new are EXACTLY the union-non-equity set;
    baseline->new changes are all either gated or already present in the
    control rebuild (data drift), never anything else.
  * R1 non-regression: screener-performance aggregate identical control->new.

Usage (from repo root):
  python3 tools/round2-verify-r2.py --before <baseline-verdicts.json>
      --before-universe <baseline-universe.json> --control <control-verdicts.json>
      --control-perf <control-screener-performance.json>
Exit 0 = PASS, 1 = FAIL.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NON_EQ_SECTORS = {"Debentures", "Mutual Funds", "Promoter Shares"}
NON_EQ_TYPES = {"Debenture", "Mutual fund", "Promoter share"}
BEARISH = {"Double Top", "Head & Shoulders", "Rising Wedge", "Descending Triangle"}
BUY = {"Buy", "Strong Buy"}
FAILS = []
INFOS = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ((" -- " + str(detail)) if detail else ""))
    if not ok:
        FAILS.append(name)


def load(p):
    return json.loads(Path(p).read_text())


def tf_labels(entry):
    """Yield (timeframe, label) for daily + w + m verdicts of one entry."""
    yield ("d", entry.get("v"))
    for tf in ("w", "m"):
        sub = entry.get(tf)
        if isinstance(sub, dict) and sub.get("v") is not None:
            yield (tf, sub["v"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", default=None)
    ap.add_argument("--before-universe", default=None)
    ap.add_argument("--control", default=None)
    ap.add_argument("--control-perf", default=None)
    args = ap.parse_args()

    cur_doc = load(ROOT / "nepse-chart/data/verdicts.json")
    cur = cur_doc["verdicts"]

    def entry_gates(e):
        out = {}
        if isinstance(e, dict):
            if e.get("g"):
                out["d"] = e["g"]
            for tf in ("w", "m"):
                sub = e.get(tf)
                if isinstance(sub, dict) and sub.get("g"):
                    out[tf] = sub["g"]
        return out

    gates = {s: entry_gates(e) for s, e in cur.items()}
    uni = load(ROOT / "nepse-chart/data/universe.json")
    type_of = {r["s"]: r["t"] for r in uni.get("symbols", [])}

    # --- I2 / I3 on current file, all timeframes ---
    bad_eq, bad_vol = [], []
    for sym, e in cur.items():
        sec, vol = e.get("sec"), e.get("vol")
        for tf, lab in tf_labels(e):
            if lab in BUY and (sec in NON_EQ_SECTORS or type_of.get(sym) in NON_EQ_TYPES):
                bad_eq.append((sym, tf, lab, sec, type_of.get(sym)))
            if lab in BUY and not (isinstance(vol, (int, float)) and vol > 0):
                bad_vol.append((sym, tf, lab, vol))
    check("I2 current: 0 non-equity Buy/Strong Buy (d/w/m, sector+type union)", not bad_eq, bad_eq[:10])
    check("I3 current: 0 zero-volume Buy/Strong Buy (d/w/m)", not bad_vol, bad_vol[:10])

    # --- Gate-log consistency: gated rows are Hold; Buys carry no gate ---
    gate_bad = []
    for sym, g in gates.items():
        e = cur.get(sym, {})
        for tf, reasons in (g or {}).items():
            lab = dict(tf_labels(e)).get(tf)
            if reasons and lab != "Hold":
                gate_bad.append((sym, tf, lab, reasons))
    check("Gate log: every gated timeframe reads Hold", not gate_bad, gate_bad[:10])
    buy_gated = [(s, tf) for s, e in cur.items() for tf, lab in tf_labels(e)
                 if lab in BUY and (gates.get(s, {}) or {}).get(tf)]
    check("Gate log: no Buy/Strong Buy carries a gate", not buy_gated, buy_gated[:10])

    # --- INFO: remaining bearish-setup Buys (forming only, by engine rule) ---
    forming = [(s, e["v"], e.get("setup")) for s, e in cur.items()
               if e.get("v") in BUY and e.get("setup") in BEARISH]
    print("INFO remaining bearish-setup daily Buys (forming-pattern display cases, not S1 violations): %d %s"
          % (len(forming), forming[:20]))
    s1_gated = sorted(s for s, g in gates.items() if (g or {}).get("d") and any(r.startswith("S1") for r in g["d"]))
    print("INFO S1-gated daily symbols: %d %s" % (len(s1_gated), s1_gated))

    if args.before and args.control:
        base = load(args.before)["verdicts"]
        ctrl = load(args.control)["verdicts"]
        base_uni = load(args.before_universe) if args.before_universe else uni
        base_type = {r["s"]: r["t"] for r in base_uni.get("symbols", [])}

        def lab(doc, sym, tf):
            e = doc.get(sym, {})
            if tf == "d":
                return e.get("v")
            sub = e.get(tf)
            return sub.get("v") if isinstance(sub, dict) else None

        # control -> new: changes must be exactly the gated set, Buy -> Hold
        cg_changes, cg_unexplained, cg_score_moves = [], [], []
        for sym in set(ctrl) | set(cur):
            for tf in ("d", "w", "m"):
                a, b = lab(ctrl, sym, tf), lab(cur, sym, tf)
                if a == b:
                    continue
                cg_changes.append((sym, tf, a, b))
                reasons = (gates.get(sym, {}) or {}).get(tf, [])
                if not (a in BUY and b == "Hold" and reasons):
                    cg_unexplained.append((sym, tf, a, b, reasons))
                # score must not move control -> new
                sa = ctrl.get(sym, {}).get("s") if tf == "d" else None
                sb = cur.get(sym, {}).get("s") if tf == "d" else None
                if tf == "d" and sa != sb:
                    cg_score_moves.append((sym, sa, sb))
        gated_set = {(s, tf) for s, g in gates.items() for tf, rs in (g or {}).items() if rs}
        changed_set = {(s, tf) for s, tf, _, _ in cg_changes}
        check("Attribution control->new: every change is gated Buy->Hold", not cg_unexplained, cg_unexplained[:10])
        check("Attribution control->new: every gated row changed (no silent gates)", gated_set <= changed_set,
              sorted(gated_set - changed_set)[:10])
        check("Scores unchanged control->new (gates keep score)", not cg_score_moves, cg_score_moves[:10])
        print("INFO control->new label changes: %d" % len(cg_changes))

        # tr nulls control -> new are exactly the union-non-equity set
        tr_lost, tr_lost_bad = [], []
        for sym in ctrl:
            if ctrl[sym].get("tr") and not cur.get(sym, {}).get("tr"):
                tr_lost.append(sym)
                sec = ctrl[sym].get("sec")
                if not (sec in NON_EQ_SECTORS or type_of.get(sym) in NON_EQ_TYPES):
                    tr_lost_bad.append(sym)
        check("tr nulls control->new are union-non-equity only", not tr_lost_bad, tr_lost_bad[:10])
        print("INFO tr nulled control->new: %d" % len(tr_lost))

        # baseline -> new: every change is gated OR already in control (drift)
        drift = {(s, tf) for s in set(base) | set(ctrl) for tf in ("d", "w", "m")
                 if lab(base, s, tf) != lab(ctrl, s, tf)}
        bn_other = []
        for sym in set(base) | set(cur):
            for tf in ("d", "w", "m"):
                if lab(base, sym, tf) != lab(cur, sym, tf) and (sym, tf) not in changed_set and (sym, tf) not in drift:
                    bn_other.append((sym, tf, lab(base, sym, tf), lab(cur, sym, tf)))
        check("Attribution baseline->new: no change outside gates+drift", not bn_other, bn_other[:10])
        print("INFO baseline->new: gated %d, drift(control) %d, total changed %d"
              % (len(changed_set), len(drift),
                 len({(s, tf) for s in set(base) | set(cur) for tf in ("d", "w", "m")
                      if lab(base, s, tf) != lab(cur, s, tf)})))

        if args.control_perf:
            cp = load(args.control_perf)["eval"]
            np = load(ROOT / "nepse-chart/data/screener-performance.json")["eval"]
            same = (cp["securities"], cp["decided_calls"], cp["wins_est"], cp["hit_rate_pct"]) == \
                   (np["securities"], np["decided_calls"], np["wins_est"], np["hit_rate_pct"])
            check("R1 non-regression: screener-performance aggregate unchanged", same, (cp, np))

    print("== R2 VERIFY: %s (%d failures) ==" % ("PASS" if not FAILS else "FAIL", len(FAILS)))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())

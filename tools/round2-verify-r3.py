#!/usr/bin/env python3
"""ROUND 2 / R3 verify: screener-calls ledger repair, independently re-scored.

Independent re-implementation (Python, written from the ledger rules, not
by importing the JS): date normalisation, corporate-action adjustment
(+/-10% overnight gap, prior bars reverse-adjusted, call levels scaled by
ratios dated after the call date), walk with stop-before-target on daily
high/low bars, 20-session expiry, 0.5% charges NOT in returns (builder
rule: exit_return is sl/tp vs entry, charges apply at portfolio level).

Checks the PUBLISHED nepse-chart/data/screener-calls.json:
  * (a) every call re-walked independently matches the published outcome
        (status / exit / exit_date / sessions held-or-elapsed / returns);
  * (b) ZERO calls skipped as unknown_series (call date absent from the
        series truncated to the ledger asof) and ZERO missing series;
  * (c) published summary reconciles exactly against the published calls
        (open / tp / sl / expired / decided / win_rate / by_setup /
        by_persistence);
  * (d) ledger asof NOT advanced (must equal --before asof when given);
  * (e) no call created, dropped, or un-closed (--before comparison);
  * (f) staged cross-check (--staged): the audit's original 65 calls,
        walked with series truncated to 20261027, must reproduce the
        staged outcomes (2 sl / 0 tp / 63 open) — any disagreement is
        reported, not papered over;
  * (g) the repo regression test (tools/round2-test-r3.js) passes.

Usage (from the repo root):
  python3 tools/round2-verify-r3.py [--before PATH] [--staged PATH]
Exit 0 only if every applicable check passes.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "nepse-chart" / "data"


def js_round4(x):
    """JS Math.round(x*10000)/10000 (half toward +inf, not banker's)."""
    return math.floor(x * 10000 + 0.5) / 10000


def ymd_num(d):
    return int(str(d).replace("-", ""))


def fmt_date(ymd):
    s = str(ymd)
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def ca_adjust(call, series):
    """Mirror tools/screener-tracking.js adjustForCorporateActions."""
    adj = [list(r) for r in series]
    all_adj = []
    for i in range(1, len(adj)):
        prev_c, op = adj[i - 1][4], adj[i][1]
        if not (prev_c > 0 and op > 0):
            continue
        ratio = op / prev_c
        if ratio < 0.9 or ratio > 1.1:
            for j in range(i):
                for k in (1, 2, 3, 4):
                    adj[j][k] *= ratio
            all_adj.append({"date": adj[i][0], "ratio": js_round4(ratio)})
    call_date = ymd_num(call["date"])
    scale = 1.0
    applied = []
    for a in all_adj:
        if a["date"] > call_date:
            scale *= a["ratio"]
            applied.append(a)
    adj_call = dict(call)
    adj_call["entry"] = call["entry"] * scale
    adj_call["sl"] = call["sl"] * scale
    adj_call["tp"] = call["tp"] * scale
    return adj, adj_call, applied


def walk(call, series):
    """Mirror tools/screener-tracking.js walkCall. Returns dict."""
    dates = [r[0] for r in series]
    target = ymd_num(call["date"])
    # bisect_left
    lo, hi = 0, len(dates)
    while lo < hi:
        mid = (lo + hi) // 2
        if dates[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    ei = lo
    if ei >= len(dates) or dates[ei] != target:
        return {"status": "open", "unknown_series": True}
    n = len(series)
    for j in range(ei + 1, min(ei + 20, n - 1) + 1):
        low, high = series[j][3], series[j][2]
        if low is not None and low <= call["sl"]:
            r = js_round4(call["sl"] / call["entry"] - 1)
            return {"status": "closed", "exit": "sl",
                    "exit_date": fmt_date(series[j][0]),
                    "sessions_held": j - ei, "exit_return": r,
                    "last_return": r}
        if high is not None and high >= call["tp"]:
            r = js_round4(call["tp"] / call["entry"] - 1)
            return {"status": "closed", "exit": "tp",
                    "exit_date": fmt_date(series[j][0]),
                    "sessions_held": j - ei, "exit_return": r,
                    "last_return": r}
    if n - 1 >= ei + 20:
        c = series[ei + 20][4]
        r = js_round4(c / call["entry"] - 1)
        return {"status": "closed", "exit": "expired",
                "exit_date": fmt_date(series[ei + 20][0]),
                "sessions_held": 20, "exit_return": r, "last_return": r}
    last_close = series[n - 1][4]
    lr = js_round4(last_close / call["entry"] - 1) if last_close and call["entry"] else None
    return {"status": "open", "sessions_elapsed": (n - 1) - ei,
            "last_return": lr}


def load_series(sym):
    p = DATA / "history" / (sym.replace("/", "-") + ".json")
    if not p.exists():
        return None
    return json.loads(p.read_text())["data"]


def main():
    args = sys.argv[1:]
    before_path = staged_path = None
    for i, a in enumerate(args):
        if a == "--before":
            before_path = Path(args[i + 1])
        if a == "--staged":
            staged_path = Path(args[i + 1])
    failures = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" ({detail})" if detail and not cond else ""))
        if not cond:
            failures.append(name)

    doc = json.loads((DATA / "screener-calls.json").read_text())
    asof_num = ymd_num(doc["asof"])
    calls = doc["calls"]
    print(f"R3 verify: {len(calls)} calls @ asof {doc['asof']}")

    # (a)+(b) independent re-walk of every published call.
    unknown, missing, mismatches = [], [], []
    for c in calls:
        series = load_series(c["sym"])
        if series is None:
            missing.append(c["sym"])
            continue
        srs = [r for r in series if r[0] <= asof_num]
        adj_series, adj_call, _ = ca_adjust(c, srs)
        upd = walk(adj_call, adj_series)
        if upd.get("unknown_series"):
            unknown.append(f"{c['sym']} {c['date']}")
            continue
        if upd["status"] == "closed":
            ok = (c["status"] == "closed" and c["exit"] == upd["exit"]
                  and c["exit_date"] == upd["exit_date"]
                  and c["sessions_held"] == upd["sessions_held"]
                  and c["exit_return"] == upd["exit_return"])
            if not ok:
                mismatches.append(f"{c['sym']} published={c['status']}/{c['exit']}/{c['exit_date']}/{c['sessions_held']}/{c['exit_return']} independent={upd}")
        else:
            ok = (c["status"] == "open"
                  and c["sessions_elapsed"] == upd["sessions_elapsed"]
                  and c["last_return"] == upd["last_return"]
                  and c["updated_asof"] == doc["asof"])
            if not ok:
                mismatches.append(f"{c['sym']} published open elapsed={c['sessions_elapsed']} ret={c['last_return']} asof={c['updated_asof']} independent elapsed={upd['sessions_elapsed']} ret={upd['last_return']}")
    check("R3-a every published call matches the independent re-walk", not mismatches, "; ".join(mismatches[:5]))
    check("R3-b ZERO unknown_series skips", not unknown, ", ".join(unknown[:10]))
    check("R3-b ZERO missing history series", not missing, ", ".join(missing[:10]))

    # (c) summary reconciliation from the published calls.
    by_setup, by_pers = {}, {"flash": {"decided": 0, "wins": 0, "n": 0},
                             "mid": {"decided": 0, "wins": 0, "n": 0},
                             "persistent": {"decided": 0, "wins": 0, "n": 0}}
    op = tp = sl = ex = 0
    for c in calls:
        st = c["streak"] or 1
        b = by_pers["flash" if st <= 1 else "mid" if st == 2 else "persistent"]
        b["n"] += 1
        if c["status"] == "open":
            op += 1
            continue
        if c["exit"] == "tp":
            tp += 1; b["decided"] += 1; b["wins"] += 1
        elif c["exit"] == "sl":
            sl += 1; b["decided"] += 1
        elif c["exit"] == "expired":
            ex += 1
        if c["exit"] in ("tp", "sl"):
            k = c["setup"] or "(no setup)"
            by_setup.setdefault(k, {"decided": 0, "wins": 0})
            by_setup[k]["decided"] += 1
            if c["exit"] == "tp":
                by_setup[k]["wins"] += 1
    decided = tp + sl
    exp_setup = [{"setup": k, "decided": by_setup[k]["decided"],
                  "wins": by_setup[k]["wins"],
                  "win_rate": round(by_setup[k]["wins"] / by_setup[k]["decided"], 3)
                  if by_setup[k]["decided"] else None}
                 for k in sorted(by_setup)]
    s = doc["summary"]
    check("R3-c summary open/tp/sl/expired/decided/win_rate reconcile",
          (s["open"], s["closed_tp"], s["closed_sl"], s["closed_expired"],
           s["decided"], s["win_rate"]) ==
          (op, tp, sl, ex, decided,
           round(tp / decided, 3) if decided else None),
          f"published={s['open']}/{s['closed_tp']}/{s['closed_sl']}/{s['closed_expired']}/{s['decided']}/{s['win_rate']} recomputed={op}/{tp}/{sl}/{ex}/{decided}")
    check("R3-c summary by_setup reconciles", s["by_setup"] == exp_setup)
    check("R3-c summary by_persistence reconciles", s["by_persistence"] == by_pers)
    print(f"R3 counts: open={op} tp={tp} sl={sl} expired={ex} decided={decided} win_rate={s['win_rate']}")

    # (d)+(e) before-comparison: asof unmoved, set preserved, closes final.
    if before_path:
        before = json.loads(Path(before_path).read_text())
        check("R3-d asof NOT advanced by the rescore",
              doc["asof"] == before["asof"], f"{before['asof']} -> {doc['asof']}")
        bkeys = {(c["sym"], c["date"]) for c in before["calls"]}
        akeys = {(c["sym"], c["date"]) for c in calls}
        check("R3-e no call created or dropped", bkeys == akeys,
              f"added={sorted(akeys - bkeys)[:5]} dropped={sorted(bkeys - akeys)[:5]}")
        bclosed = {(c["sym"], c["date"]): c for c in before["calls"] if c["status"] == "closed"}
        ok = all(any(c["sym"] == k[0] and c["date"] == k[1] and c["status"] == "closed"
                     and c["exit"] == v["exit"] for c in calls) for k, v in bclosed.items())
        check("R3-e previously-closed calls unchanged", ok)
        newly = [c for c in calls if c["status"] == "closed"
                 and (c["sym"], c["date"]) not in bclosed]
        check("R3-e closed_today equals newly-closed count",
              s["closed_today"] == len(newly), f"{s['closed_today']} vs {len(newly)}")
        print("R3 newly closed: " + ", ".join(
            f"{c['sym']} {c['exit']} {c['exit_date']}" for c in newly))

    # (f) staged cross-check: original 65 through 20261027 must match audit.
    if staged_path:
        staged = json.loads(Path(staged_path).read_text())
        agree, disagree = 0, []
        for c in staged["calls"]:
            series = load_series(c["sym"])
            srs = [r for r in series if r[0] <= 20261027]
            adj_series, adj_call, _ = ca_adjust(c, srs)
            upd = walk(adj_call, adj_series)
            st = c["staged"]
            got = (upd["status"], upd.get("exit"))
            want = (st["status"], st["exit"] if st["status"] == "closed" else None)
            if got == want:
                agree += 1
            else:
                disagree.append(f"{c['sym']} staged={want} independent={got}")
        check("R3-f staged cross-check: original 65 reproduce audit outcomes",
              not disagree and agree == len(staged["calls"]),
              "; ".join(disagree[:5]) or f"agree {agree}/{len(staged['calls'])}")
        print(f"R3 staged cross-check: {agree}/{len(staged['calls'])} agree; "
              f"audit totals were {staged['totals']}")

    # (g) repo regression test must pass.
    r = subprocess.run(["node", "tools/round2-test-r3.js"],
                       cwd=str(ROOT), capture_output=True, text=True)
    print("R3 regression test output tail: " + (r.stdout.strip().splitlines() or [""])[-1])
    check("R3-g regression test tools/round2-test-r3.js passes", r.returncode == 0,
          r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-300:])

    if failures:
        print(f"R3 VERIFY: {len(failures)} FAILURES")
        sys.exit(1)
    print("R3 VERIFY: ALL PASS")


if __name__ == "__main__":
    main()

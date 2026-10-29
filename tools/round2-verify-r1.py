#!/usr/bin/env python3
"""ROUND 2 / R1 verify: public claims integrity on the screener page.

Independently recomputes the screener's published performance figures from
the archive (verdicts.json + universe.json + index-history.json) with a
separate Python code path — NOT the Node builder module — and compares
them against:
  (a) nepse-chart/data/screener-performance.json (the builder's output), and
  (b) nepse-screener/index.html (the published page, all three copy spots).

Also asserts: the frozen 31.0%/11.4% regime copy is gone, Buy/Strong Buy
are labelled ranked setup scores with a research-only disclaimer, nothing
is presented as an AI prediction, and the live-call ledger publishes no
win rate while it has zero decided calls.

Usage: python3 tools/round2-verify-r1.py   (run from the repo root)
Exit 0 = PASS, 1 = FAIL (CI fails the build on any failure).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NON_EQ_SECTORS = {"Debentures", "Mutual Funds", "Promoter Shares"}
FAILS = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ((" -- " + str(detail)) if detail else ""))
    if not ok:
        FAILS.append(name)


def fmt_date(ymd):
    s = str(ymd)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def main():
    verdicts_doc = json.loads((ROOT / "nepse-chart/data/verdicts.json").read_text())
    verdicts = verdicts_doc["verdicts"]
    universe = json.loads((ROOT / "nepse-chart/data/universe.json").read_text())
    index_rows = json.loads((ROOT / "data/index-history.json").read_text())["rows"]
    html = (ROOT / "nepse-screener/index.html").read_text()
    perf = json.loads((ROOT / "nepse-chart/data/screener-performance.json").read_text())

    # --- 1. Independent recomputation: equity-only, sector+type union ---
    type_of = {r["s"]: r["t"] for r in universe["symbols"]}
    secs = decided = 0
    wins_est = 0.0
    for sym, e in verdicts.items():
        tr = (e or {}).get("tr")
        if not tr:
            continue
        if type_of.get(sym) != "Equity" or e.get("sec") in NON_EQ_SECTORS:
            continue
        secs += 1
        decided += tr["n"]
        wins_est += tr["n"] * tr["w"]
    hit = wins_est / decided
    exp = hit * 4 - (1 - hit) * 2
    hit_pct = round(hit * 100, 1)
    exp_atr = round(exp, 2)
    print(f"recomputed: {secs} securities, {decided} decided, ~{round(wins_est)} wins, "
          f"hit {hit_pct}%, expectancy {exp_atr} ATR/call")

    # --- 2. Window dates + index return on the market calendar ---
    asof = universe["asof"]
    flat = asof.replace("-", "")
    anchor = next((i for i, r in enumerate(index_rows) if str(r[0]) == flat), len(index_rows) - 1)
    first_sig, last_sig = index_rows[anchor - 249], index_rows[anchor - 20]
    prev_close_row = index_rows[anchor - 250]
    w_start, w_end = fmt_date(first_sig[0]), fmt_date(last_sig[0])
    idx_ret = round((last_sig[4] / prev_close_row[4] - 1) * 100, 1)
    print(f"window: signal sessions {w_start} to {w_end}; "
          f"index {fmt_date(prev_close_row[0])} close -> {w_end} close = {idx_ret}%")

    # --- 3. Compare against the builder's JSON ---
    ev = perf["eval"]
    check("json hit_rate_pct", ev["hit_rate_pct"] == hit_pct, f"json={ev['hit_rate_pct']} recomputed={hit_pct}")
    check("json expectancy_atr", ev["expectancy_atr"] == exp_atr, f"json={ev['expectancy_atr']} recomputed={exp_atr}")
    check("json decided_calls", ev["decided_calls"] == decided, f"json={ev['decided_calls']} recomputed={decided}")
    check("json securities", ev["securities"] == secs, f"json={ev['securities']} recomputed={secs}")
    check("json window_start", ev["window_start"] == w_start, f"json={ev['window_start']} recomputed={w_start}")
    check("json window_end", ev["window_end"] == w_end, f"json={ev['window_end']} recomputed={w_end}")
    check("json index_return_pct", ev["index_return_pct"] == idx_ret, f"json={ev['index_return_pct']} recomputed={idx_ret}")
    check("json asof == universe asof", perf["asof"] == asof, f"json={perf['asof']} universe={asof}")

    # --- 4. Compare against the published page (all three copy spots) ---
    sentence = (
        f"Track record, recomputed from the page's own archive on every build "
        f"(eval window: signal sessions {w_start} to {w_end}; batch as of {asof}): "
        f"equity-only Buy and Strong Buy calls hit {hit_pct:.1f}% - about {round(wins_est):,} "
        f"of {decided:,} decided calls across {secs} securities - for an expectancy of "
        f"{exp_atr:.2f} ATR per call (a win pays +4 ATR, a loss -2 ATR, so breakeven is 33.3%). "
        f"The NEPSE index returned {'+' if idx_ret >= 0 else ''}{idx_ret:.1f}% over the same window "
        f"({fmt_date(prev_close_row[0])} close to {w_end} close)."
    )
    n_sentence = html.count(sentence)
    check("page canonical sentence in 3 spots", n_sentence == 3, f"found={n_sentence}")
    check("page methodology markers present",
          "<!-- sc-perf:start -->" in html and "<!-- sc-perf:end -->" in html)
    check("page FAQ markers present",
          "<!-- sc-perf-faq:start -->" in html and "<!-- sc-perf-faq:end -->" in html)

    # --- 5. Frozen copy is gone (specific patterns, not bare percentages:
    # per-row target/stop percentages in the snapshot may coincidentally read
    # 31.0%/11.4% and are legitimate row data, not performance claims) ---
    for pat in ("31.0% across", "hit 31.0%", "both regimes are published",
                "versus 11.4%", "they hit 11.4%", "NEPSE +31.0%", "NEPSE -6.2%", "NEPSE −6.2%"):
        check(f"frozen pattern absent: {pat!r}", pat not in html)

    # --- 6. JSON-LD still parses and carries the fresh figure ---
    ld_blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    check("JSON-LD blocks found", len(ld_blocks) >= 3, f"found={len(ld_blocks)}")
    faq_ok = False
    for b in ld_blocks:
        try:
            doc = json.loads(b)
        except json.JSONDecodeError as exc:
            check("JSON-LD parses", False, str(exc))
            continue
        if doc.get("@type") == "FAQPage":
            for q in doc.get("mainEntity", []):
                if q.get("name") == "What is the Hit rate column?":
                    faq_ok = sentence in q["acceptedAnswer"]["text"]
    check("JSON-LD Hit-rate answer carries fresh figure", faq_ok)

    # --- 7. Ranked setup score + research-only framing; no AI prediction ---
    n_rss = html.lower().count("ranked setup score")
    check("ranked setup score labelling present", n_rss >= 5, f"found={n_rss}")
    check("research-only framing present",
          "research and education only" in html and "research only" in html)
    ai_hits = [m.start() for m in re.finditer("AI prediction", html)]
    check("AI prediction appears only as a negation", len(ai_hits) == 1
          and "Nothing here is an AI prediction" in html, f"found={len(ai_hits)}")

    # --- 8. Live-call ledger publishes no win rate while undecided ---
    calls = json.loads((ROOT / "nepse-chart/data/screener-calls.json").read_text())
    summ = calls.get("summary", {})
    if summ.get("decided", 0) == 0:
        check("ledger with 0 decided calls publishes no win rate", summ.get("win_rate") is None)
    else:
        check("ledger win rate present once calls decide", summ.get("win_rate") is not None)
    check("ledger JSON note carries no recommendation",
          "not a recommendation" in calls.get("note", ""))
    check("page live-calls note is research-only",
          "ranked setup scores tracked forward for research only" in html)

    # --- 9. Archive consistency: per-symbol replay count matches track record ---
    tr_doc = json.loads((ROOT / "nepse-chart/data/track-record.json").read_text())
    n_tr = sum(1 for e in verdicts.values() if (e or {}).get("tr"))
    check("verdicts tr count == track-record eval securities",
          n_tr == tr_doc["eval"]["securities"], f"verdicts={n_tr} track-record={tr_doc['eval']['securities']}")

    print()
    if FAILS:
        print(f"R1 VERIFY: FAIL ({len(FAILS)} failing check(s))")
        return 1
    print("R1 VERIFY: PASS — published figures match the independent recomputation")
    return 0


if __name__ == "__main__":
    sys.exit(main())

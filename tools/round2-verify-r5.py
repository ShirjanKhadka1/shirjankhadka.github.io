#!/usr/bin/env python3
"""ROUND 2 / R5 verify: small-sample discipline on every forward ledger display.

Checks, per display:
  - n present (decided/closed trades only; open trades separate, never counted)
  - win rate present WITH a Wilson 95% interval
  - profit factor present (signal ledgers: net of 0.5% charges, from pnl_rs;
    screener ledger: return-based, from exit_return — see notes)
  - too-few-trades badge present iff n < 30 (absent-or-not-required iff n >= 30)
  - displayed counts match the ledger data exactly (no figure adjusted to fit)

Signal pages render client-side, so this script verifies (a) the builder
carries the discipline code, (b) the regenerated pages contain that code and
a baked noscript snapshot whose numbers match the ledger JSONs exactly, and
(c) the screener renderer + signals-index renderer carry the same discipline.
A live DOM render (chromium --dump-dom) is the complementary proof that the
client code actually produces the badge/interval at runtime; see RELEASE-NOTES.

Usage: python3 tools/round2-verify-r5.py   (run from the repo root)
Exit 0 = PASS, 1 = FAIL (first failure listed, all checks still attempted).
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAILURES = []


def check(cond, label, detail=""):
    print(("PASS  " if cond else "FAIL  ") + label + ((" — " + detail) if detail else ""))
    if not cond:
        FAILURES.append(label + " " + detail)


def wilson(w, n):
    if not n:
        return None
    z = 1.96
    p = w / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h) * 100, min(1.0, c + h) * 100)


def ci_text(w, n):
    w2 = wilson(w, n)
    return None if w2 is None else "95%% CI %.1f–%.1f%%" % w2


# ---------------------------------------------------------------- signals
print("== signal forward ledgers (builder + regenerated pages) ==")
builder = (ROOT / "tools" / "build-signal-pages.js").read_text()
for token in ["function wilson(w,n)", "function setBadge(n)", "Too few trades",
              "Decided trades (n)", "95% CI", "Too few trades (n &lt; 30)",
              "n = decided trades only", "id=\"track-badge\"",
              "noscriptTrack(data)", "baker:forward-record:start"]:
    check(token in builder, "builder contains %r" % token)

for slug in ["momentum", "trend-relay", "reversal"]:
    data = json.loads((ROOT / "nepse-chart" / "data" / "signals" / (slug + ".json")).read_text())
    lr = data["live_track_record"]
    st = lr["stats"]
    closed = lr["recent_closed"]
    opens = lr["open_positions"]
    # recount from the ledger rows themselves (outcome field + pnl sign agree)
    wins = sum(1 for t in closed if t.get("outcome") == "win")
    wins_sign = sum(1 for t in closed if t["pnl_pct"] >= 0)
    losses = len(closed) - wins
    gw = sum(t["pnl_rs"] for t in closed if t["pnl_rs"] > 0)
    gl = -sum(t["pnl_rs"] for t in closed if t["pnl_rs"] < 0)
    pf_rows = gw / gl if gl else None
    check(wins == wins_sign, "%s: outcome wins == pnl-sign wins" % slug, "%d vs %d" % (wins, wins_sign))
    check(st["closed_trades"] == len(closed) == wins + losses,
          "%s: stats closed == ledger rows == wins+losses" % slug,
          "stats=%s rows=%d W=%d L=%d" % (st["closed_trades"], len(closed), wins, losses))
    check(st["wins"] == wins and st["losses"] == losses,
          "%s: stats wins/losses match recount" % slug,
          "stats %s/%s recount %d/%d" % (st["wins"], st["losses"], wins, losses))
    check(st["open_positions"] == len(opens),
          "%s: stats open == ledger open rows" % slug,
          "stats=%s rows=%d" % (st["open_positions"], len(opens)))
    check(pf_rows is not None and abs(pf_rows - st["profit_factor"]) < 0.02,
          "%s: stats PF matches gross-wins/gross-losses from rows" % slug,
          "stats=%.2f rows=%.4f" % (st["profit_factor"], pf_rows or -1))
    check(abs(st["win_rate_pct"] - wins / len(closed) * 100) < 0.02 if closed else True,
          "%s: stats win rate matches wins/n" % slug,
          "stats=%s recount=%.2f" % (st["win_rate_pct"], wins / len(closed) * 100 if closed else 0))
    n = st["closed_trades"]
    ci = ci_text(wins, n)
    print("  %s: n=%d W=%d L=%d win=%.2f%% %s PF=%.2f open=%d badge=%s"
          % (slug, n, wins, losses, st["win_rate_pct"], ci, st["profit_factor"],
             st["open_positions"], "REQUIRED" if n < 30 else "not required"))

    page = (ROOT / "nepse-signals" / slug / "index.html").read_text()
    check('id="track-badge"' in page, "%s page: badge element present" % slug)
    check("function wilson(w,n)" in page and "function setBadge(n)" in page,
          "%s page: Wilson + badge code present" % slug)
    check("Decided trades (n)" in page, "%s page: decided-trades (n) label present" % slug)
    check("n = decided trades only" in page, "%s page: n definition present" % slug)
    m = re.search(r"<!-- baker:forward-record:start -->(.*?)<!-- baker:forward-record:end -->",
                  page, re.S)
    check(m is not None and len(m.group(1)) > 1000, "%s page: noscript snapshot baked" % slug,
          "len=%d" % (len(m.group(1)) if m else 0))
    if m:
        ns = m.group(1)
        check("Too few trades" in ns, "%s noscript: badge present (n<30)" % slug)
        check("n=%d decided" % n in ns, "%s noscript: badge carries n=%d" % (slug, n))
        wv = re.search(r"Win rate</div><div class=\"sig-card-v\">([^<]+)<br><span[^>]*>([^<]+)</span>", ns)
        check(wv is not None, "%s noscript: win rate + interval card" % slug)
        if wv:
            check(wv.group(2) == ci, "%s noscript: interval matches Wilson" % slug,
                  "baked=%s expected=%s" % (wv.group(2), ci))
        dv = re.search(r"Decided trades \(n\)</div><div class=\"sig-card-v\">(\d+)</div>", ns)
        check(dv is not None and int(dv.group(1)) == n,
              "%s noscript: decided n matches ledger" % slug,
              "baked=%s expected=%d" % (dv.group(1) if dv else None, n))
        pfv = re.search(r"Profit factor</div><div class=\"sig-card-v\">([^<]+)</div>", ns)
        check(pfv is not None and abs(float(pfv.group(1)) - st["profit_factor"]) < 0.02,
              "%s noscript: PF matches ledger" % slug,
              "baked=%s expected=%.2f" % (pfv.group(1) if pfv else None, st["profit_factor"]))
        ov = re.search(r"Open now</div><div class=\"sig-card-v\">(\d+)</div>", ns)
        check(ov is not None and int(ov.group(1)) == st["open_positions"],
              "%s noscript: open shown separately, matches ledger" % slug)
        bodies = re.findall(r"<tbody>(.*?)</tbody>", ns, re.S)
        check(len(bodies) == 2 and bodies[0].count("<tr>") == len(opens)
              and bodies[1].count("<tr>") == len(closed),
              "%s noscript: open/closed table rows match ledger" % slug,
              "open %d/%d closed %d/%d" % (
                  bodies[0].count("<tr>") if bodies else -1, len(opens),
                  bodies[1].count("<tr>") if len(bodies) > 1 else -1, len(closed)))

# ------------------------------------------------------- signals index page
print("== signals index mini-records ==")
idx = (ROOT / "nepse-signals" / "index.html").read_text()
for token in ["function wilson(w,n)", 'data-lr="badge"', "Too few trades (n=",
              "Live decided (n)", "Wilson 95% interval",
              "count decided trades only (n)"]:
    check(token in idx, "signals index contains %r" % token)
check(idx.count('<span class="rpill rp-trail" data-lr="badge"') == 3,
      "signals index: badge element on all 3 cards")

# ---------------------------------------------------------------- screener
print("== screener live call ledger ==")
doc = json.loads((ROOT / "nepse-chart" / "data" / "screener-calls.json").read_text())
s = doc["summary"]
calls = doc["calls"]
closed_calls = [c for c in calls if c["status"] == "closed"]
open_calls = [c for c in calls if c["status"] == "open"]
check(len(calls) == 82, "screener: total calls == 82", "got %d" % len(calls))
check(s["decided"] == len(closed_calls), "screener: summary decided == closed rows",
      "%s vs %d" % (s["decided"], len(closed_calls)))
check(s["open"] == len(open_calls), "screener: summary open == open rows",
      "%s vs %d" % (s["open"], len(open_calls)))
wins = sum(1 for c in closed_calls if c["exit"] == "tp")
check(round((s["win_rate"] or 0) * s["decided"]) == wins if s["decided"] else s["win_rate"] is None,
      "screener: summary win rate matches tp-wins/decided",
      "win_rate=%s decided=%d tp-wins=%d" % (s["win_rate"], s["decided"], wins))
gw = sum(c["exit_return"] for c in closed_calls if c["exit_return"] > 0)
gl = -sum(c["exit_return"] for c in closed_calls if c["exit_return"] < 0)
pf = gw / gl if gl else None
ci = ci_text(wins, s["decided"])
print("  screener: n=%d W=%d L=%d win=%s %s PF=%.2f (return-based) open=%d badge=%s"
      % (s["decided"], wins, len(closed_calls) - wins,
         ("%.1f%%" % (s["win_rate"] * 100)) if s["win_rate"] is not None else "—",
         ci, pf if pf is not None else -1, s["open"],
         "REQUIRED" if s["decided"] < 30 else "not required"))
for setup in s["by_setup"]:
    print("  screener setup %s: decided=%d wins=%d %s"
          % (setup["setup"], setup["decided"], setup["wins"],
             ci_text(setup["wins"], setup["decided"])))
for k, p in s["by_persistence"].items():
    print("  screener persistence %s: decided=%d wins=%d %s"
          % (k, p["decided"], p["wins"], ci_text(p["wins"], p["decided"])))

js = (ROOT / "js" / "nepse-screener.js").read_text()
for token in ["function trackWilson(w, n)", "function trackCI(w, n)", "function trackPF(closed)",
              "Too few trades", "n = decided calls only", "Wilson 95% interval",
              "decided (n=", "profit factor ", "95% CI</th>"]:
    check(token in js, "screener renderer contains %r" % token)
check("decided < 30" in js, "screener renderer: badge gated on n<30")
check("trackPF((d.calls || []).filter" in js,
      "screener renderer: PF computed over ALL closed calls (not top-20 slice)")
check("no Rs paper stake and deducts no charges" in js,
      "screener renderer: PF basis honestly stated (return-based, no charges)")
import hashlib
pin = hashlib.sha1((ROOT / "js" / "nepse-screener.js").read_bytes()).hexdigest()[:8]
sc_page = (ROOT / "nepse-screener" / "index.html").read_text()
check(("js/nepse-screener.js?v=" + pin) in sc_page,
      "screener page: JS pin re-stamped to raw SHA-1-8", "pin=" + pin)

print()
if FAILURES:
    print("R5 VERIFY: FAIL (%d failures)" % len(FAILURES))
    for f in FAILURES:
        print("  - " + f)
    sys.exit(1)
print("R5 VERIFY: PASS")

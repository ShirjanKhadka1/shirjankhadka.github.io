#!/usr/bin/env python3
"""Nepse Decode: Warning Radar forward tracker.

Persistent warning ledger + measurable track record for Verdict Engine v2.

After each daily verdicts-v2 rebuild, this script:
  1. Reads data/verdicts-v2-summary.json (fresh build).
  2. Appends every NEW warning (EXHAUSTION_RISK / DISTRIBUTION_WARNING /
     ELEVATED_RISK) to data/warning-ledger.json with symbol, session,
     verdict, flags, confidence, pump_score, reason and the warning close.
  3. For every open warning, computes forward price action from the own
     OHLC mirror (~/workspace/v2-mirror): +5/+10/+20 session close-to-close
     returns, max drawdown and max gain inside the 20-session window.
  4. Resolves warnings once 20 sessions have elapsed and recomputes the
     aggregate track record into data/verdicts-v2-track-record.json.

Outcome definitions (transparent, documented in the track-record JSON):
  - HIT:           min close-to-close return within 20 sessions <= -10%
                   (the warned trap materialized)
  - FALSE_POSITIVE: 20 sessions elapsed, close >= +5% above warning close,
                   and the stock never drew down 10% (the warning was wrong)
  - NEUTRAL:       20 sessions elapsed, neither of the above
  - OPEN:          fewer than 20 sessions since the warning
  - PROVISIONAL_HIT: still open, but already drew down >= 10%

Idempotent: re-running never duplicates warnings or corrupts outcomes.

Usage:
    python3 tools/track-warning-radar.py [--repo DIR] [--mirror DIR]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta

WARNING_LABELS = ("EXHAUSTION_RISK", "DISTRIBUTION_WARNING", "ELEVATED_RISK")
HIT_DRAWDOWN = -0.10      # <= -10% inside 20 sessions => warning worked
FP_GAIN = 0.05            # >= +5% at session 20 with no -10% drawdown => warning wrong
HORIZON = 20              # engine horizon_sessions


def log(msg):
    print(f"[warning-tracker] {msg}", flush=True)


def npt_now_iso():
    npt = timezone(timedelta(hours=5, minutes=45))
    return datetime.now(npt).isoformat(timespec="seconds")


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def load_mirror_closes(mirror_dir, symbol):
    """Return [(ymd_int, close), ...] sorted ascending, or None."""
    p = os.path.join(mirror_dir, symbol.replace("/", "-") + ".json")
    try:
        with open(p) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    bars = d.get("bars") or d.get("rows") or []
    out = []
    for b in bars:
        if isinstance(b, dict):
            ymd = b.get("ymd")
            c = b.get("close")
        elif isinstance(b, (list, tuple)) and len(b) >= 5:
            ymd, c = b[0], b[4]
        else:
            continue
        try:
            ymd = int(ymd)
            c = float(c)
        except (TypeError, ValueError):
            continue
        if c > 0:
            out.append((ymd, c))
    out.sort()
    return out or None


def forward_stats(closes, warn_ymd, warn_close):
    """closes: sorted [(ymd, close)]. Returns dict of forward stats or None."""
    idx = next((i for i, (y, _) in enumerate(closes) if y == warn_ymd), None)
    if idx is None:
        # warning session not in mirror (e.g. mirror not yet updated)
        later = [(y, c) for y, c in closes if y > warn_ymd]
        if not later:
            return None
        # fall back: treat first later bar as the reference
        idx = closes.index(later[0]) - 1
        if idx < 0:
            return None
    fwd = closes[idx + 1: idx + 1 + HORIZON]
    if not fwd:
        return {"sessions_elapsed": 0}
    rets = [c / warn_close - 1.0 for _, c in fwd]
    stats = {
        "sessions_elapsed": len(fwd),
        "ret_5": round(rets[4], 4) if len(rets) >= 5 else None,
        "ret_10": round(rets[9], 4) if len(rets) >= 10 else None,
        "ret_20": round(rets[19], 4) if len(rets) >= 20 else None,
        "max_drawdown_20": round(min(rets), 4),
        "max_gain_20": round(max(rets), 4),
        "last_close": fwd[-1][1],
        "last_session": str(fwd[-1][0]),
    }
    return stats


def resolve_status(stats):
    if stats is None or stats.get("sessions_elapsed", 0) == 0:
        return "open"
    n = stats["sessions_elapsed"]
    if stats["max_drawdown_20"] is not None and stats["max_drawdown_20"] <= HIT_DRAWDOWN:
        return "hit" if n >= HORIZON else "provisional_hit"
    if n >= HORIZON:
        if stats["ret_20"] is not None and stats["ret_20"] >= FP_GAIN:
            return "false_positive"
        return "neutral"
    return "open"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument("--mirror", default=os.environ.get("V2_MIRROR", "/home/hatch/workspace/v2-mirror"))
    args = ap.parse_args()

    repo = args.repo
    summary_path = os.path.join(repo, "data", "verdicts-v2-summary.json")
    ledger_path = os.path.join(repo, "data", "warning-ledger.json")
    record_path = os.path.join(repo, "data", "verdicts-v2-track-record.json")

    summary = load_json(summary_path, None)
    if not summary or "verdicts" not in summary:
        log(f"FATAL: cannot read {summary_path}")
        return 2
    session = summary.get("session_date")
    if not session:
        log("FATAL: summary has no session_date")
        return 2
    warn_ymd = int(session.replace("-", ""))
    log(f"session {session}, {len(summary['verdicts'])} verdicts")

    # full evidence file (reasons + active factor flags live under evidence.*)
    full = load_json(os.path.join(repo, "data", "verdicts-v2.json"), {})
    full_verdicts = (full or {}).get("verdicts", {})

    ledger = load_json(ledger_path, {"updated_at": None, "warnings": []})
    seen = {(w.get("symbol"), w.get("session_date")) for w in ledger["warnings"]}

    # 1. append new warnings
    added = 0
    for sym, v in summary["verdicts"].items():
        if v.get("label") not in WARNING_LABELS:
            continue
        if (sym, session) in seen:
            continue
        fv = full_verdicts.get(sym, {})
        fev = fv.get("evidence", {}) if isinstance(fv, dict) else {}
        active_flags = [f.get("name") for f in (fev.get("flags") or [])
                        if isinstance(f, dict) and f.get("active")
                        and f.get("status") == "scored" and f.get("name")]
        if not active_flags:
            # fall back to the summary's flags (builder now fills these)
            active_flags = v.get("flags") or []
        ledger["warnings"].append({
            "symbol": sym,
            "session_date": session,
            "verdict": v.get("label"),
            "confidence": v.get("confidence"),
            "pump_score": v.get("pump_score"),
            "flags": active_flags,
            "reason": fv.get("reason") if isinstance(fv, dict) else None,
            "close": None,  # filled below from mirror
            "outcomes": {"status": "open"},
        })
        seen.add((sym, session))
        added += 1
    log(f"new warnings appended: {added}")

    # 2. update forward outcomes for open / provisional warnings
    updated = 0
    for w in ledger["warnings"]:
        st = (w.get("outcomes") or {}).get("status")
        if st in ("hit", "false_positive", "neutral"):
            continue
        closes = load_mirror_closes(args.mirror, w["symbol"])
        if not closes:
            w["outcomes"] = {"status": "open", "note": "no mirror data"}
            continue
        w_ymd = int(w["session_date"].replace("-", ""))
        # warning close: mirror close on the warning session (fallback: nearest prior)
        wc = next((c for y, c in reversed(closes) if y <= w_ymd), None)
        if wc is None:
            w["outcomes"] = {"status": "open", "note": "warning session not in mirror"}
            continue
        if w.get("close") is None:
            w["close"] = round(wc, 2)
        stats = forward_stats(closes, w_ymd, wc)
        if stats is None:
            w["outcomes"] = {"status": "open", "note": "mirror not yet past warning session"}
            continue
        stats["status"] = resolve_status(stats)
        w["outcomes"] = stats
        updated += 1
    log(f"warnings with refreshed outcomes: {updated}")

    ledger["updated_at"] = npt_now_iso()
    with open(ledger_path, "w") as f:
        json.dump(ledger, f)

    # 3. aggregate track record
    resolved = [w for w in ledger["warnings"]
                if (w.get("outcomes") or {}).get("status") in ("hit", "false_positive", "neutral")]
    prov = [w for w in ledger["warnings"]
            if (w.get("outcomes") or {}).get("status") == "provisional_hit"]
    hits = sum(1 for w in resolved if w["outcomes"]["status"] == "hit")
    fps = sum(1 for w in resolved if w["outcomes"]["status"] == "false_positive")

    def pct(a, b):
        return round(100.0 * a / b, 1) if b else None

    by_verdict = {}
    for w in ledger["warnings"]:
        vb = by_verdict.setdefault(w["verdict"], {"warnings": 0, "resolved": 0, "hits": 0})
        vb["warnings"] += 1
        st = (w.get("outcomes") or {}).get("status")
        if st in ("hit", "false_positive", "neutral"):
            vb["resolved"] += 1
            if st == "hit":
                vb["hits"] += 1
    for vb in by_verdict.values():
        vb["hit_rate_pct"] = pct(vb["hits"], vb["resolved"])

    by_factor = {}
    for w in ledger["warnings"]:
        st = (w.get("outcomes") or {}).get("status")
        for fl in w.get("flags") or []:
            fb = by_factor.setdefault(fl, {"warnings": 0, "resolved": 0, "hits": 0})
            fb["warnings"] += 1
            if st in ("hit", "false_positive", "neutral"):
                fb["resolved"] += 1
                if st == "hit":
                    fb["hits"] += 1
    for fb in by_factor.values():
        fb["hit_rate_pct"] = pct(fb["hits"], fb["resolved"])

    record = {
        "updated_at": npt_now_iso(),
        "engine": "verdict-v2",
        # Engine provenance: which pump weights produced these metrics.
        # Values mirror tools/verdict-engine-v2/rules.js PUMP_WEIGHTS.
        # "research-baseline" = weights as cited to universe-report/P5
        # (unchanged 2026-10-09; a reweighting experiment was measured and
        # REJECTED the same day — see manual/warning-radar-retuning-2026-10-09.md).
        "engine_weights_version": "research-baseline",
        "pump_weights": {"EXHAUSTION": 0.20, "PARABOLIC": 0.13, "DIST_VOLUME": 0.22,
                         "CLIMAX": 0.10, "WINNER_FADE": 0.25, "LATE_CIRCUIT_FADE": 0.10},
        "definitions": {
            "warning_labels": list(WARNING_LABELS),
            "horizon_sessions": HORIZON,
            "hit": f"min close-to-close return within {HORIZON} sessions <= {HIT_DRAWDOWN:.0%}",
            "false_positive": (f"{HORIZON} sessions elapsed, close >= +{FP_GAIN:.0%} vs warning "
                               f"close, never drew down {HIT_DRAWDOWN:.0%}"),
            "neutral": f"{HORIZON} sessions elapsed, neither hit nor false positive",
            "precision": "hits / resolved warnings (open and provisional excluded)",
            "note": "Forward prices come from the site's own OHLC mirror. "
                    "History is thin while the ledger accumulates; treat early rates as provisional.",
        },
        "overall": {
            "warnings_issued": len(ledger["warnings"]),
            "resolved": len(resolved),
            "open": len(ledger["warnings"]) - len(resolved) - len(prov),
            "provisional_hits": len(prov),
            "hits": hits,
            "false_positives": fps,
            "precision_pct": pct(hits, len(resolved)),
            "false_positive_rate_pct": pct(fps, len(resolved)),
        },
        "by_verdict": by_verdict,
        "by_factor": dict(sorted(by_factor.items(),
                                key=lambda kv: (kv[1]["hit_rate_pct"] is None, kv[1]["hit_rate_pct"] or 0),
                                reverse=True)),
        "recent_warnings": [
            {"symbol": w["symbol"], "session_date": w["session_date"], "verdict": w["verdict"],
             "flags": w.get("flags"), "status": (w.get("outcomes") or {}).get("status"),
             "max_drawdown_20": (w.get("outcomes") or {}).get("max_drawdown_20")}
            for w in ledger["warnings"][-12:]
        ],
    }
    with open(record_path, "w") as f:
        json.dump(record, f, indent=1)

    log(f"ledger: {len(ledger['warnings'])} warnings | "
        f"resolved {len(resolved)} | precision {record['overall']['precision_pct']}%")
    log(f"wrote {ledger_path} and {record_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Nepse Decode — verdict persistence tracker (Warning Radar "since / NEW").

Problem: verdicts rebuild daily, so a reader cannot tell a flag raised in
the latest session from one that has held for weeks. This tool maintains
data/verdicts-v2-history.json — a small state file recording, per symbol,
the current verdict label, the session it began ("since"), how many
consecutive build sessions it has held for, and whether it changed in the
latest build — and annotates data/verdicts-v2-summary.json in place with a
"persistence" object per symbol plus a top-level "persistence_meta" block
(changed / new-flag / cleared counts for the latest build).

Honesty rules (do not weaken):
  - A "since" date is only ever (a) the session of a tracked label change,
    or (b) on the FIRST run (seed), for warning labels only, the start of
    the current warning run in data/warning-ledger.json (episodes written
    per flagged session by track-warning-radar.py; run = episodes walking
    back with gaps of at most 4 calendar days, episodes dated after the
    summary session ignored).
  - "since_sessions" is only set when the count is exact — i.e. the run
    began at a build this tracker observed. Seeded warnings carry a
    since DATE only (null count): the ledger proves the date, not an
    exact session count.
  - Unknown since -> null -> the page shows nothing. Never guess.

Runs as a step of tools/verdicts-v2-daily.py, AFTER build-verdicts-v2.js
and track-warning-radar.py. Idempotent per session: re-running for the
same session only re-annotates the summary from state.

Usage: python3 tools/track-verdict-persistence.py [--repo PATH]
"""
import argparse
import json
import os
import sys
from datetime import date

WARNING_LABELS = ("EXHAUSTION_RISK", "DISTRIBUTION_WARNING", "ELEVATED_RISK")
OPPORTUNITY_LABELS = ("IGNITION", "BOUNCE_SETUP")
FLAGGED = set(WARNING_LABELS) | set(OPPORTUNITY_LABELS)


def log(msg):
    print(f"[verdict-persistence] {msg}", flush=True)


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def d(s):
    y, m, dd = s.split("-")
    return date(int(y), int(m), int(dd))


def seed_warning_since(ledger, symbol, label, session):
    """Start date of the symbol's current warning run, from ledger episodes.

    Episodes are appended once per flagged session, so the latest run of
    episodes with the same verdict, walking back while gaps stay <= 4
    calendar days (covers Fri->Mon weekends), dates the run. Episodes
    dated after the summary session (e.g. the phantom 2026-10-19 holiday
    rebuild) are ignored. Returns an ISO date string or None.
    """
    eps = sorted(
        w["session_date"] for w in ledger.get("warnings", [])
        if w.get("symbol") == symbol and w.get("verdict") == label
        and w.get("session_date") and w["session_date"] <= session
    )
    if not eps:
        return None
    start = eps[-1]
    for prev in reversed(eps[:-1]):
        if (d(start) - d(prev)).days <= 4:
            start = prev
        else:
            break
    return start


def seed_state(summary, ledger):
    session = summary["session_date"]
    symbols = {}
    seeded = 0
    for sym, v in summary["verdicts"].items():
        label = v.get("label") or "NEUTRAL"
        st = {"label": label, "since": None, "since_sessions": None,
              "prev_label": None, "changed_latest": False}
        if label in WARNING_LABELS:
            since = seed_warning_since(ledger, sym, label, session)
            if since:
                st["since"] = since
                seeded += 1
        symbols[sym] = st
    log(f"seeded history at session {session}: {len(symbols)} symbols, "
        f"{seeded} warning since-dates from the ledger")
    return {"version": 1, "last_session": session, "sessions": [session],
            "symbols": symbols}


def advance_state(state, summary, ledger):
    """Fold a new session's verdicts into the state. Exact transitions."""
    session = summary["session_date"]
    prev_symbols = state.get("symbols", {})
    symbols = {}
    changed = new_flags = cleared = 0
    for sym, v in summary["verdicts"].items():
        label = v.get("label") or "NEUTRAL"
        prev = prev_symbols.get(sym)
        if prev is None:
            # First time this symbol is observed: its run starts now.
            st = {"label": label, "since": session, "since_sessions": 1,
                  "prev_label": None, "changed_latest": label in FLAGGED}
        elif prev.get("label") == label:
            st = {"label": label,
                  "since": prev.get("since"),
                  "since_sessions": (prev["since_sessions"] + 1
                                     if prev.get("since_sessions") is not None
                                     else None),
                  "prev_label": None, "changed_latest": False}
            if st["since"] is None and label in WARNING_LABELS:
                # Backfill (e.g. a warning whose only seed-time ledger
                # episodes postdated the summary — the phantom 2026-10-19
                # rebuild): date the run from the ledger once real
                # episodes exist. Count stays null (date only).
                st["since"] = seed_warning_since(ledger, sym, label, session)
        else:
            st = {"label": label, "since": session, "since_sessions": 1,
                  "prev_label": prev.get("label"), "changed_latest": True}
        if st["changed_latest"]:
            changed += 1
            prev_label = st["prev_label"]
            if label in FLAGGED and prev_label not in FLAGGED:
                new_flags += 1
            if prev_label in FLAGGED and label not in FLAGGED:
                cleared += 1
        symbols[sym] = st
    sessions = (state.get("sessions") or []) + [session]
    meta = {"session": session, "prev_session": state.get("last_session"),
            "changed": changed, "new_flags": new_flags, "cleared": cleared}
    return {"version": 1, "last_session": session, "sessions": sessions[-500:],
            "symbols": symbols}, meta


def annotate(summary, state):
    meta = summary.get("persistence_meta") or {
        "session": state.get("last_session"),
        "prev_session": None, "changed": 0, "new_flags": 0, "cleared": 0}
    symbols = state.get("symbols", {})
    for sym, v in summary["verdicts"].items():
        st = symbols.get(sym)
        if st is None:
            v["persistence"] = {"since": None, "since_sessions": None,
                                "changed_latest": False, "prev_label": None}
        else:
            v["persistence"] = {
                "since": st.get("since"),
                "since_sessions": st.get("since_sessions"),
                "changed_latest": bool(st.get("changed_latest")),
                "prev_label": st.get("prev_label"),
            }
    summary["persistence_meta"] = meta
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    args = ap.parse_args()
    repo = args.repo

    summary_path = os.path.join(repo, "data", "verdicts-v2-summary.json")
    history_path = os.path.join(repo, "data", "verdicts-v2-history.json")
    ledger_path = os.path.join(repo, "data", "warning-ledger.json")

    summary = load_json(summary_path, None)
    if not summary or "verdicts" not in summary or not summary.get("session_date"):
        log(f"FATAL: cannot read summary with session_date at {summary_path}")
        return 2
    session = summary["session_date"]
    state = load_json(history_path, None)

    if state is None:
        ledger = load_json(ledger_path, {"warnings": []})
        state = seed_state(summary, ledger)
        meta = {"session": session, "prev_session": None,
                "changed": 0, "new_flags": 0, "cleared": 0}
        summary["persistence_meta"] = meta
        annotate(summary, state)
    elif state.get("last_session") == session:
        log(f"session {session} already tracked — re-annotating only")
        meta = annotate(summary, state)
    else:
        ledger = load_json(ledger_path, {"warnings": []})
        state, meta = advance_state(state, summary, ledger)
        summary["persistence_meta"] = meta
        annotate(summary, state)
        log(f"advanced to session {session}: {meta['changed']} changed, "
            f"{meta['new_flags']} new flags, {meta['cleared']} cleared")

    with open(history_path, "w") as f:
        json.dump(state, f, separators=(",", ":"))
    with open(summary_path, "w") as f:
        json.dump(summary, f, separators=(",", ":"))
    log(f"wrote {history_path} and annotated {summary_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

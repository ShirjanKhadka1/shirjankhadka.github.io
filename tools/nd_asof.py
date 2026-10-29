"""Point-in-time guards for NEPSE archive reads (Nepse Decode internal tooling).

Pattern adapted from TradingAgents (Apache License 2.0, Tauric Research)
``dataflows/date_window.py`` — ``as_of`` / ``as_of_window`` clamping plus
explicit withhold messages. This file is a REWRITE from the pattern
description for the NEPSE archive; no upstream code is copied. Upstream
license: Apache-2.0 (see the attribution block in
docs/teardown-advance-program.md).

Rules this module enforces (all of them are honesty rules, not conveniences):

1. A read is always clamped to a real session. Asking for a date after the
   last published session returns the last published session, never a
   fabricated bar and never a silent empty result.
2. A withhold is always explained. Every function that can come back empty
   returns a human-readable reason alongside the empty value.
3. Entry is the FIRST CLOSE AFTER the decision date. A decision made on day
   D (which may read news published after D's close) may only enter at the
   first traded bar after D — never at D's own close, which the decision
   could not have used. This is the TradingAgents settlement entry rule,
   applied to our ledger convention.
4. A window that has not fully traded stays PENDING. A settlement window
   whose exit bar does not exist yet is not scored, not estimated, and not
   quietly shortened.

All inputs are plain data (dates, bars). No I/O, no network, no live source.
``sessions`` are ``datetime.date`` objects in ascending order; ``bars`` are
``(date, close)`` pairs (or longer rows whose first two items are date and
close) in ascending order. Functions never mutate their inputs.
"""

from __future__ import annotations

from datetime import date


def parse_ymd(ymd):
    """int YYYYMMDD -> datetime.date. Raises ValueError on a bad value."""
    s = "%08d" % int(ymd)
    return date(int(s[0:4]), int(s[4:6]), int(s[6:8]))


def ymd_of(d):
    """datetime.date -> int YYYYMMDD."""
    return d.year * 10000 + d.month * 100 + d.day


def as_of(requested, sessions):
    """Latest published session on or before ``requested``.

    Returns ``(session_or_None, reason)``. ``reason`` is "" on success and a
    withhold message when no session exists on or before ``requested``.
    Weekends, holidays, and not-yet-published sessions all clamp backwards
    through this one function — callers must never invent the missing bar.
    """
    sessions = sorted(sessions)
    picked = None
    for s in sessions:
        if s <= requested:
            picked = s
        else:
            break
    if picked is None:
        return None, "withheld: no published session on or before %s" % requested.isoformat()
    return picked, ""


def as_of_window(start, end, sessions):
    """Sessions in [start, end], clamped to what is actually published.

    Returns ``(window, note)``. ``window`` is the list of sessions in range
    (possibly empty). ``note`` always describes what happened: "" when the
    window is fully covered, otherwise a withhold/clamp message naming the
    missing side. An empty window is never silent.
    """
    sessions = sorted(sessions)
    window = [s for s in sessions if start <= s <= end]
    if window:
        if window[0] > start or window[-1] < end:
            return window, (
                "clamped: requested %s..%s, published sessions cover %s..%s"
                % (start.isoformat(), end.isoformat(),
                   window[0].isoformat(), window[-1].isoformat())
            )
        return window, ""
    if not sessions:
        return [], "withheld: session list is empty"
    if end < sessions[0]:
        return [], "withheld: requested window %s..%s predates the archive (first session %s)" % (
            start.isoformat(), end.isoformat(), sessions[0].isoformat())
    return [], "withheld: no published session in %s..%s (last session %s)" % (
        start.isoformat(), end.isoformat(), sessions[-1].isoformat())


def first_close_after(decision, bars):
    """First traded bar strictly after ``decision`` (the entry bar).

    Returns ``(bar_or_None, reason)``. ``reason`` is "" on success and a
    pending message when no bar after ``decision`` is published yet. The
    decision day's own close is NEVER the entry: a decision made on day D
    may rest on information published after D's close.
    """
    ordered = sorted(bars, key=lambda b: b[0])
    for b in ordered:
        if b[0] > decision:
            return b, ""
    if not ordered:
        return None, "pending: bar list is empty"
    return None, "pending: no published bar after %s (last bar %s)" % (
        decision.isoformat(), ordered[-1][0].isoformat())


def settle_window(entry_bar, bars, holding_days):
    """Exit bar ``holding_days`` sessions after ``entry_bar``.

    Returns ``(exit_bar_or_None, status, reason)``. ``status`` is "settled"
    when the exit bar exists, else "pending" with a reason. A pending window
    is never scored, never estimated, and never shortened to fit the data.
    ``holding_days`` is a session count, not calendar days (holidays and
    weekends do not consume holding days).
    """
    ordered = sorted(bars, key=lambda b: b[0])
    entry_dates = [b[0] for b in ordered]
    if entry_bar[0] not in entry_dates:
        return None, "pending", "pending: entry bar %s is not a published session" % entry_bar[0].isoformat()
    idx = entry_dates.index(entry_bar[0])
    exit_idx = idx + int(holding_days)
    if exit_idx >= len(ordered):
        return None, "pending", (
            "pending: %d-session window from %s needs an exit bar that is not "
            "published yet (last bar %s)"
            % (holding_days, entry_bar[0].isoformat(), ordered[-1][0].isoformat())
        )
    return ordered[exit_idx], "settled", ""

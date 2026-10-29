"""Structured ratings, REVIEW sentinel, and by-rating summaries (internal).

Patterns adapted from TradingAgents (Apache License 2.0, Tauric Research)
``agents/rating.py`` + ``backtest.py:summarize()`` — typed rating enums, an
unparseable-output sentinel, and hit-rate/mean-alpha reporting PER RATING
TIER. This file is a REWRITE from the pattern descriptions; no upstream
code is copied. The rating scale, ledger rules, and cost convention below
are Nepse Decode's own (Rs 10 lakh paper trades, 0.5% charges, Target 1 /
stop / ratcheting trailing stop / 20-session exit). Upstream license:
Apache-2.0 (see the attribution block in docs/teardown-advance-program.md).

Honesty rules enforced here:

1. Unparseable is REVIEW, never Hold. A rating that cannot be parsed is
   quarantined as REVIEW and EXCLUDED from scoring. It is never silently
   mapped to HOLD (which would flatter a system by counting "did nothing"
   as a correct call).
2. No direction, no score. HOLD and REVIEW carry no direction and are
   reported as unscored, never counted for or against a hit rate.
3. Costs must be attested. A row is scored only when its alpha is stated
   net of charges (``net_of_charges=True``). A row without that attestation
   goes to the ``unverified_costs`` bucket — never scored as if net.
4. Pending stays pending. A row whose window has not traded goes to the
   ``pending`` bucket, never estimated.
5. A zero alpha is a miss, not a hit. A directional call that produced
   exactly no gain did not call the direction correctly.

``summarize_by_rating`` takes rows, never prices: it scores alphas that
callers computed elsewhere (under the point-in-time guards in nd_asof.py),
so this module cannot invent a return.
"""

from __future__ import annotations

from enum import Enum


class Rating(Enum):
    BUY = "BUY"
    OVERWEIGHT = "OVERWEIGHT"
    HOLD = "HOLD"
    UNDERWEIGHT = "UNDERWEIGHT"
    SELL = "SELL"
    REVIEW = "REVIEW"


_CANONICAL = {
    "BUY": Rating.BUY,
    "OVERWEIGHT": Rating.OVERWEIGHT,
    "HOLD": Rating.HOLD,
    "UNDERWEIGHT": Rating.UNDERWEIGHT,
    "SELL": Rating.SELL,
}


def parse_rating(text):
    """Parse free text into a Rating. Anything unrecognised -> REVIEW.

    Accepts exactly the five canonical names (case-insensitive, surrounding
    whitespace ignored). No fuzzy matching, no synonym table: a near-miss
    ("Strong Buy", "Buy!") is REVIEW, because silently upgrading prose into
    a scored call is how ledgers get flattered.
    """
    if text is None:
        return Rating.REVIEW
    if isinstance(text, Rating):
        return text
    return _CANONICAL.get(str(text).strip().upper(), Rating.REVIEW)


def direction(rating):
    """+1 for BUY/OVERWEIGHT, -1 for SELL/UNDERWEIGHT, 0 for HOLD/REVIEW."""
    if rating in (Rating.BUY, Rating.OVERWEIGHT):
        return 1
    if rating in (Rating.SELL, Rating.UNDERWEIGHT):
        return -1
    return 0


def summarize_by_rating(rows):
    """Hit rate + mean alpha PER RATING TIER, with unscored buckets separate.

    Each row is a dict with keys:
      rating: str or Rating (parsed via parse_rating),
      alpha_net: float or None (alpha AFTER charges; None = missing),
      net_of_charges: bool (must be True to be scored),
      pending: bool (default False; pending rows are never scored).

    Returns a dict:
      tiers: {tier_name: {n, hits, hit_rate, mean_alpha}} for the five
        directional-or-hold tiers that received at least one scored row
        (HOLD appears only if a HOLD row was scored — it never is, since
        HOLD has no direction; HOLD rows land in unscored["hold"]),
      unscored: {hold, review, pending, unverified_costs, missing_alpha},
      directional: {n, hits, hit_rate} over all scored directional rows.

    A hit means sign(alpha_net) == direction(rating). Alpha exactly 0.0 is
    a miss. Rows are never re-scored, re-weighted, or dropped silently:
    every input row lands in exactly one bucket.
    """
    tiers = {}
    unscored = {"hold": 0, "review": 0, "pending": 0,
                "unverified_costs": 0, "missing_alpha": 0}
    dir_n = 0
    dir_hits = 0

    for row in rows:
        rating = parse_rating(row.get("rating"))
        if row.get("pending"):
            unscored["pending"] += 1
            continue
        if rating == Rating.HOLD:
            unscored["hold"] += 1
            continue
        if rating == Rating.REVIEW:
            unscored["review"] += 1
            continue
        if not row.get("net_of_charges"):
            unscored["unverified_costs"] += 1
            continue
        alpha = row.get("alpha_net")
        if alpha is None:
            unscored["missing_alpha"] += 1
            continue
        tier = tiers.setdefault(rating.value, {"n": 0, "hits": 0, "alpha_sum": 0.0})
        tier["n"] += 1
        tier["alpha_sum"] += float(alpha)
        d = direction(rating)
        hit = (float(alpha) > 0 and d == 1) or (float(alpha) < 0 and d == -1)
        if hit:
            tier["hits"] += 1
            dir_hits += 1
        dir_n += 1

    out_tiers = {}
    for name, t in sorted(tiers.items()):
        out_tiers[name] = {
            "n": t["n"],
            "hits": t["hits"],
            "hit_rate": (t["hits"] / t["n"]) if t["n"] else None,
            "mean_alpha": (t["alpha_sum"] / t["n"]) if t["n"] else None,
        }
    return {
        "tiers": out_tiers,
        "unscored": unscored,
        "directional": {
            "n": dir_n,
            "hits": dir_hits,
            "hit_rate": (dir_hits / dir_n) if dir_n else None,
        },
    }

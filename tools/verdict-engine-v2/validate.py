#!/usr/bin/env python3
"""
Validation framework for the Verdict Engine v2 manual data archive.

Every manually entered field passes through check rules. Errors are
reported per symbol — never silently dropped, never auto-"fixed".

Rules (from Shirjan):
  - 0% promoter is VALID (fully public), never flagged as anomaly.
  - Missing/unknown promoter stays null, never 0.
  - Negative P/E is valid when EPS is negative (sign must be consistent).
  - Derived (not directly displayed) values are flagged, never treated as
    raw measured facts.

Usage: from validate import run_checks; errors = run_checks(archive)
"""
import re
from datetime import date

# Per-field sanity rules: (field, check_fn, error_message)
# check_fn(value, record) -> True if valid

def _pct(v, r):
    return v is None or (isinstance(v, (int, float)) and 0 <= v <= 100)

def _nonneg(v, r):
    return v is None or (isinstance(v, (int, float)) and v >= 0)

def _positive(v, r):
    return v is None or (isinstance(v, (int, float)) and v > 0)

def _isnum(v, r):
    return v is None or isinstance(v, (int, float))

def _date(v, r):
    if v is None:
        return True
    try:
        y, m, d = map(int, str(v).split('-'))
        date(y, m, d)
        return True
    except (ValueError, AttributeError):
        return False

def _promoter_public_sum(v, r):
    p, q = r.get('promoter_pct'), r.get('public_pct')
    if p is None or q is None:
        return True
    return abs((p + q) - 100) <= 0.2

def _float_math(v, r):
    paid, pub, fl = r.get('paidup_shares'), r.get('public_pct'), r.get('float_shares')
    if paid is None or pub is None or fl is None:
        return True
    expected = round(paid * pub / 100)
    return abs(fl - expected) <= max(2, expected * 0.001)

def _market_cap_math(v, r):
    ltp, paid, mc = r.get('ltp'), r.get('paidup_shares'), r.get('market_cap')
    if ltp is None or paid is None or mc is None:
        return True
    expected = ltp * paid
    return abs(mc - expected) <= expected * 0.05  # 5% tolerance

def _pe_math(v, r):
    """P/E must equal LTP/EPS with matching sign. Negative P/E is valid
    when EPS is negative; it is only an error when the sign or the math
    is wrong."""
    ltp, eps, pe = r.get('ltp'), r.get('eps_ttm'), r.get('pe_ttm')
    if ltp is None or eps is None or pe is None:
        return True
    if eps == 0:
        return pe == 0
    expected = ltp / eps
    if (pe < 0) != (expected < 0):
        return False
    return abs(pe - expected) <= max(0.5, abs(pe) * 0.05)

def _pb_math(v, r):
    """P/B must equal LTP/BVPS with matching sign."""
    ltp, bvps, pb = r.get('ltp'), r.get('bvps'), r.get('pb_ratio')
    if ltp is None or bvps is None or pb is None:
        return True
    if bvps == 0:
        return pb == 0
    expected = ltp / bvps
    if (pb < 0) != (expected < 0):
        return False
    return abs(pb - expected) <= max(0.1, abs(pb) * 0.05)

def _week52_range(v, r):
    hi, lo = r.get('high_52w'), r.get('low_52w')
    if hi is None or lo is None:
        return True
    return hi >= lo

def _pct_below_high_math(v, r):
    """% below 52w high must equal (high - LTP)/high * 100."""
    hi, ltp, pct = r.get('high_52w'), r.get('ltp'), r.get('pct_below_52w_high')
    if hi is None or ltp is None or pct is None or hi == 0:
        return True
    expected = (hi - ltp) / hi * 100
    return abs(pct - expected) <= 2.0  # percentage points

def _listing_not_future(v, r):
    ld = r.get('listing_date')
    if not ld or not _date(ld, r):
        return True
    y, m, d = map(int, ld.split('-'))
    return date(y, m, d) <= date.today()

def _snapshot_date(v, r):
    sd = r.get('snapshot_date')
    if sd is None:
        return True
    if not _date(sd, r):
        return False
    y, m, d = map(int, str(sd).split('-'))
    dt = date(y, m, d)
    return date(2020, 1, 1) <= dt <= date.today()

KNOWN_SECTORS = {
    'Commercial Banks', 'Development Banks', 'Microfinance', 'Finance',
    'Life Insurance', 'Non Life Insurance', 'Micro Insurance',
    'Hydro Power', 'Hotels and Tourism', 'Manufacturing and Processing',
    'Tradings', 'Investment', 'Others',
}

def _sector_known(v, r):
    return v is None or v in KNOWN_SECTORS

def _top_holders_pct(v, r):
    holders = r.get('top_holders')
    if not holders:
        return True
    if not isinstance(holders, list):
        return False
    total = 0.0
    for h in holders:
        if not isinstance(h, dict):
            return False
        p = h.get('pct')
        name = h.get('name')
        if not isinstance(name, str) or not name.strip():
            return False
        if not isinstance(p, (int, float)) or not (0 <= p <= 100):
            return False
        total += p
    return total <= 100.5  # top holders are shares of one whole

_FY_RE = re.compile(r'^(\d{4})/(\d{4})$')

def _dividend_hist(v, r):
    hist = r.get('dividend_hist')
    if not hist:
        return True
    if not isinstance(hist, list):
        return False
    for d in hist:
        if not isinstance(d, dict):
            return False
        m = _FY_RE.match(str(d.get('fy', '')))
        if not m:
            return False
        y1, y2 = int(m.group(1)), int(m.group(2))
        if y2 != y1 + 1:
            return False
        for k in ('bonus', 'cash'):
            val = d.get(k)
            if val is None:
                continue
            if not isinstance(val, (int, float)) or val < 0:
                return False
    return True

def _ltp_in_52w_range(v, r):
    hi, lo, ltp = r.get('high_52w'), r.get('low_52w'), r.get('ltp')
    if hi is None or lo is None or ltp is None:
        return True
    return lo * 0.99 <= ltp <= hi * 1.01  # 1% tolerance for live tick

CHECKS = [
    # ownership
    ('promoter_pct', _pct, 'promoter_pct out of 0-100 range'),
    ('public_pct', _pct, 'public_pct out of 0-100 range'),
    ('promoter_pct+public_pct', _promoter_public_sum, 'promoter+public does not sum to 100'),
    ('float_shares', _float_math, 'float_shares != paidup*public_pct/100'),
    ('paidup_shares', _positive, 'paidup_shares not positive'),
    ('ownership_asof', _date, 'ownership_asof not a valid date'),
    ('listing_date', _date, 'listing_date not a valid date'),
    ('listing_date', _listing_not_future, 'listing_date is in the future'),
    # market snapshot
    ('sector', _sector_known, 'sector not a known NEPSE sector'),
    ('snapshot_date', _snapshot_date, 'snapshot_date invalid or out of range'),
    ('ltp', _positive, 'ltp not positive'),
    ('market_cap', _positive, 'market_cap not positive'),
    ('market_cap', _market_cap_math, 'market_cap != ltp*paidup_shares (5% tol)'),
    ('high_52w/low_52w', _week52_range, 'high_52w < low_52w'),
    ('ltp', _ltp_in_52w_range, 'ltp outside 52w low-high range'),
    ('pct_below_52w_high', _pct_below_high_math, 'pct_below_52w_high != (high-ltp)/high*100'),
    ('avg_vol_3m', _nonneg, 'avg_vol_3m negative'),
    ('vwap_120d', _positive, 'vwap_120d not positive'),
    ('beta_3y', _isnum, 'beta_3y not numeric'),
    # ratios
    ('pe_ttm', _pe_math, 'pe_ttm inconsistent with ltp/eps_ttm (sign or math)'),
    ('pb_ratio', _pb_math, 'pb_ratio inconsistent with ltp/bvps (sign or math)'),
    ('bvps', _isnum, 'bvps not numeric'),
    ('eps_ttm', _isnum, 'eps_ttm not numeric'),
    ('peg', _nonneg, 'peg negative'),
    ('roe_ttm', _isnum, 'roe_ttm not numeric'),
    ('roa_ttm', _isnum, 'roa_ttm not numeric'),
    ('dividend_yield', _nonneg, 'dividend_yield negative'),
    # holders & dividends
    ('top_holders', _top_holders_pct, 'top_holders pct invalid (range/name/sum>100)'),
    ('dividend_hist', _dividend_hist, 'dividend_hist entry invalid (fy format or negative pct)'),
]

_CONTEXT_KEYS = (
    'paidup_shares', 'promoter_pct', 'public_pct', 'float_shares',
    'ltp', 'market_cap', 'eps_ttm', 'pe_ttm', 'bvps', 'pb_ratio',
    'high_52w', 'low_52w', 'pct_below_52w_high', 'listing_date',
    'ownership_asof', 'snapshot_date', 'sector', 'top_holders',
    'dividend_hist',
)

def run_checks(archive):
    """archive: {symbol: record}. Returns list of error dicts."""
    errors = []
    for sym in sorted(archive):
        rec = archive[sym]
        for field, fn, msg in CHECKS:
            if fn is None:
                continue
            try:
                ok = fn(rec.get(field), rec)
            except Exception as e:
                ok = False
                msg = f'{msg} (check crashed: {e})'
            if not ok:
                errors.append({
                    'symbol': sym,
                    'field': field,
                    'error': msg,
                    'value': rec.get(field),
                    'record': {k: rec.get(k) for k in _CONTEXT_KEYS},
                })
    return errors

def derived_flags(archive):
    """Records whose values were worker-derived, not directly displayed."""
    out = []
    for sym in sorted(archive):
        rec = archive[sym]
        notes = ' '.join(str(rec.get(k, '')) for k in ('note', 'note_52w'))
        if 'deriv' in notes.lower():
            out.append({'symbol': sym, 'note': notes.strip()})
    return out

def stale_report(archive, max_age_days=730):
    out = []
    today = date.today()
    for sym in sorted(archive):
        asof = archive[sym].get('ownership_asof')
        if not asof or not _date(asof, archive[sym]):
            continue
        y, m, d = map(int, asof.split('-'))
        age = (today - date(y, m, d)).days
        if age > max_age_days:
            out.append({'symbol': sym, 'asof': asof, 'age_days': age})
    return sorted(out, key=lambda x: -x['age_days'])

def coverage_report(archive, fields):
    """How many symbols have non-null values per field."""
    return {f: sum(1 for r in archive.values() if r.get(f) is not None)
            for f in fields}

def missing_report(archive, fields):
    """Symbols missing each field (null or absent)."""
    return {f: sorted(sym for sym, r in archive.items() if r.get(f) is None)
            for f in fields}

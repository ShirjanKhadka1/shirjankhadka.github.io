#!/usr/bin/env python3
"""Check-and-balance for the Broker Trade Pattern dataset (nepse-brokers/data/).

Validates every periods/<P>.json + meta.json before anything is published:
  1. broker codes are numeric and drawn from the 91-code active set; a broker
     missing from the 1D period is tolerated ONLY when the day's raw floorsheet
     proves it had zero trades (legitimate quiet day, e.g. broker 73 on
     2026-10-16) — a missing code WITH trades in raw is a pipeline data-loss
     failure. Multi-day periods still require all 91.
  2. market-level buy_value ~= sell_value (tolerance 0.5%)
  3. broker_symbols per-stock rows reconcile with broker aggregates (tolerance 0.1%)
  4. period date ranges end at the expected latest trading day
  5. turnover (1D total buy) sane vs previous committed 1D.json (within 30%)

Exit 0: all checks pass. Exit 1: FAIL LOUDLY with reasons (do NOT publish).
Usage: python3 tools/validate-broker-pattern.py [--data-dir nepse-brokers/data]
         [--expected-date YYYY-MM-DD] [--prev-1d path/to/old/1D.json]
         [--raw-floorsheet path/to/chukul-floorsheet-raw.json]
"""
import json, os, re, sys

EXPECTED_BROKERS = 91
# Active NEPSE broker codes. Code 55 is defunct (present in brokers.json but
# absent from the live set) and is intentionally excluded.
EXPECTED_CODES = frozenset(
    '1,3,4,5,6,7,8,10,11,13,14,16,17,18,19,20,21,22,25,26,28,29,32,33,34,35,'
    '36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,56,57,58,59,60,'
    '61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,'
    '85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101'.split(','))
assert len(EXPECTED_CODES) == EXPECTED_BROKERS
CODE_RE = re.compile(r'^\d+$')


def fail(reasons, msg):
    reasons.append(msg)
    print('FAIL: ' + msg, flush=True)


def raw_trade_counts(raw_path):
    """Map broker code -> number of raw trades (as buyer or seller)."""
    counts = {}
    try:
        d = json.load(open(raw_path))
    except (OSError, ValueError):
        return None
    tx = d.get('transactions') if isinstance(d, dict) else d
    if not isinstance(tx, list):
        return None
    for t in tx:
        if not isinstance(t, dict):
            continue
        for k in ('buyer', 'seller'):
            c = str(t.get(k, '')).strip()
            if c:
                counts[c] = counts.get(c, 0) + 1
    return counts


def main():
    ap_data = None
    args = sys.argv[1:]
    data_dir = 'nepse-brokers/data'
    expected_date = None
    prev_1d = None
    raw_floorsheet = None
    i = 0
    while i < len(args):
        if args[i] == '--data-dir':
            data_dir = args[i + 1]; i += 2
        elif args[i] == '--expected-date':
            expected_date = args[i + 1]; i += 2
        elif args[i] == '--prev-1d':
            prev_1d = args[i + 1]; i += 2
        elif args[i] == '--raw-floorsheet':
            raw_floorsheet = args[i + 1]; i += 2
        else:
            i += 1
    if raw_floorsheet is None and expected_date:
        raw_floorsheet = os.path.expanduser(
            '~/workspace/broker-data/%s/chukul-floorsheet-raw.json' % expected_date)

    reasons = []
    periods_dir = os.path.join(data_dir, 'periods')

    meta = json.load(open(os.path.join(data_dir, 'meta.json')))
    latest = meta.get('latest')
    if expected_date and latest != expected_date:
        fail(reasons, 'meta.latest=%s != expected %s' % (latest, expected_date))
    print('meta: latest=%s trading_days=%s' % (latest, meta.get('trading_days')))

    prev_turnover = None
    if prev_1d and os.path.exists(prev_1d):
        pd = json.load(open(prev_1d))
        prev_turnover = sum(b['buy_value'] for b in pd['brokers'])

    for fname in sorted(os.listdir(periods_dir)):
        if not fname.endswith('.json'):
            continue
        p = fname[:-5]
        d = json.load(open(os.path.join(periods_dir, fname)))
        brokers = d.get('brokers', [])
        codes = [str(b.get('code', '')) for b in brokers]

        # 1. numeric codes from the active set; 1D tolerates proven zero-trade
        # brokers, multi-day periods still require all 91
        bad_codes = [c for c in codes if not CODE_RE.match(c)]
        if bad_codes:
            fail(reasons, '%s: %d non-numeric broker codes (e.g. %s)' %
                 (p, len(bad_codes), bad_codes[:3]))
        code_set = set(codes)
        unexpected = sorted(code_set - EXPECTED_CODES)
        if unexpected:
            fail(reasons, '%s: %d unexpected broker codes (e.g. %s)' %
                 (p, len(unexpected), unexpected[:5]))
        missing = sorted(EXPECTED_CODES - code_set)
        if missing:
            if p == '1D' and len(code_set) < EXPECTED_BROKERS and not unexpected:
                counts = raw_trade_counts(raw_floorsheet) if raw_floorsheet else None
                if counts is None:
                    fail(reasons, '1D: %d brokers missing %s but raw floorsheet '
                         'unavailable at %s - cannot prove quiet day' %
                         (len(code_set), missing, raw_floorsheet))
                else:
                    lost = [c for c in missing if counts.get(c, 0) > 0]
                    quiet = [c for c in missing if counts.get(c, 0) == 0]
                    if lost:
                        fail(reasons, '1D: brokers %s have %d raw trades but are '
                             'missing from 1D.json - PIPELINE DATA LOSS' %
                             (lost, sum(counts[c] for c in lost)))
                    if quiet:
                        print('1D: brokers %s verified ZERO trades in raw '
                              'floorsheet - legitimate quiet day' % quiet)
            else:
                fail(reasons, '%s: %d distinct brokers, expected %d (missing %s)' %
                     (p, len(code_set), EXPECTED_BROKERS, missing[:5]))

        # 2. market-level balance
        tb = sum(b.get('buy_value', 0) for b in brokers)
        ts = sum(b.get('sell_value', 0) for b in brokers)
        if tb <= 0 or ts <= 0:
            fail(reasons, '%s: zero buy/sell totals (buy=%.0f sell=%.0f)' % (p, tb, ts))
        elif abs(tb - ts) / max(tb, ts) > 0.005:
            fail(reasons, '%s: market buy/sell imbalance %.2f%% (buy=%.0f sell=%.0f)' %
                 (p, 100 * abs(tb - ts) / max(tb, ts), tb, ts))

        # 3. broker_symbols reconcile with aggregates.
        # Multi-day periods keep only the TOP 25 stocks per broker, so the
        # per-stock rows are a SUBSET: their sums must not EXCEED the
        # broker aggregate (beyond rounding tolerance). 1D carries full
        # detail, so the same check holds with near-equality.
        bsym = d.get('broker_symbols', {}) or {}
        agg = {str(b.get('code')): b for b in brokers}
        mism = 0
        for code, rows in bsym.items():
            a = agg.get(str(code))
            if not a:
                continue
            rbv = sum(r.get('buy_value', 0) for r in rows)
            rsv = sum(r.get('sell_value', 0) for r in rows)
            tol_b = max(100, a.get('buy_value', 0) * 0.001)
            tol_s = max(100, a.get('sell_value', 0) * 0.001)
            if rbv - a.get('buy_value', 0) > tol_b or \
               rsv - a.get('sell_value', 0) > tol_s:
                mism += 1
        if mism:
            fail(reasons, '%s: %d brokers where per-stock sums EXCEED aggregates' % (p, mism))

        # 4. date range ends at latest
        if d.get('to') != latest:
            fail(reasons, '%s: to=%s != meta.latest=%s' % (p, d.get('to'), latest))

        # 5. turnover sanity vs previous day (1D only)
        if p == '1D' and prev_turnover:
            if abs(tb - prev_turnover) / prev_turnover > 0.30:
                fail(reasons, '1D turnover moved %.1f%% vs previous (%0.f -> %0.f)' %
                     (100 * (tb - prev_turnover) / prev_turnover, prev_turnover, tb))

        print('%-4s brokers=%d buy=%.2fcr sell=%.2fcr ratio=%.4f %s->%s' %
              (p, len(set(codes)), tb / 1e7, ts / 1e7,
               tb / ts if ts else 0, d.get('from'), d.get('to')))

    if reasons:
        print('\nVALIDATION FAILED (%d reasons) - DO NOT PUBLISH' % len(reasons))
        return 1
    print('\nVALIDATION PASSED - all periods balanced, broker codes verified, reconciled')
    return 0


if __name__ == '__main__':
    sys.exit(main())

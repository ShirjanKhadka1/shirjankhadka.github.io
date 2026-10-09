#!/usr/bin/env python3
"""Check-and-balance for the Broker Trade Pattern dataset (nepse-brokers/data/).

Validates every periods/<P>.json + meta.json before anything is published:
  1. broker codes are numeric, exactly 91 distinct brokers per period
  2. market-level buy_value ~= sell_value (tolerance 0.5%)
  3. broker_symbols per-stock rows reconcile with broker aggregates (tolerance 0.1%)
  4. period date ranges end at the expected latest trading day
  5. turnover (1D total buy) sane vs previous committed 1D.json (within 30%)

Exit 0: all checks pass. Exit 1: FAIL LOUDLY with reasons (do NOT publish).
Usage: python3 tools/validate-broker-pattern.py [--data-dir nepse-brokers/data]
         [--expected-date YYYY-MM-DD] [--prev-1d path/to/old/1D.json]
"""
import json, os, re, sys

EXPECTED_BROKERS = 91
CODE_RE = re.compile(r'^\d+$')


def fail(reasons, msg):
    reasons.append(msg)
    print('FAIL: ' + msg, flush=True)


def main():
    ap_data = None
    args = sys.argv[1:]
    data_dir = 'nepse-brokers/data'
    expected_date = None
    prev_1d = None
    i = 0
    while i < len(args):
        if args[i] == '--data-dir':
            data_dir = args[i + 1]; i += 2
        elif args[i] == '--expected-date':
            expected_date = args[i + 1]; i += 2
        elif args[i] == '--prev-1d':
            prev_1d = args[i + 1]; i += 2
        else:
            i += 1

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

        # 1. numeric codes, exactly 91
        bad_codes = [c for c in codes if not CODE_RE.match(c)]
        if bad_codes:
            fail(reasons, '%s: %d non-numeric broker codes (e.g. %s)' %
                 (p, len(bad_codes), bad_codes[:3]))
        if len(set(codes)) != EXPECTED_BROKERS:
            fail(reasons, '%s: %d distinct brokers, expected %d' %
                 (p, len(set(codes)), EXPECTED_BROKERS))

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
    print('\nVALIDATION PASSED - all periods balanced, 91 numeric brokers, reconciled')
    return 0


if __name__ == '__main__':
    sys.exit(main())

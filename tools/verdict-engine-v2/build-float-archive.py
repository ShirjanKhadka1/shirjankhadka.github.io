#!/usr/bin/env python3
"""
Merge manual float/promoter batches + NEPSE listing dates + extended
fundamental batches into the Verdict Engine v2 data archive.

Output: tools/verdict-engine-v2/manual/float-archive.json
  Per symbol: paidup_shares, promoter_pct, public_pct, ownership_asof,
  listing_date, float_shares (measured), float_status, plus the full
  manually collected fundamental snapshot (sector, ltp, market_cap,
  52w range, ratios, dividend history, top holders), snapshot_date,
  and source_notes.

Rules (from Shirjan):
  - 0% promoter is VALID (fully public), never flagged as anomaly.
  - Missing/unknown promoter stays null, never 0.
  - float_shares = paidup_shares * public_pct / 100
  - Negative P/E is valid when EPS is negative (sign must match).
  - Duplicate symbols across batches: the later batch's snapshot wins;
    the earlier value is logged in the dedup report, never silently lost.
  - Derived (worker-computed, not page-displayed) values stay flagged.
"""
import json, glob, os, re, sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate import (run_checks, stale_report, coverage_report,
                      missing_report, derived_flags)

MANUAL = os.path.dirname(os.path.abspath(__file__)) + '/manual'

FUND_FIELDS = [
    'sector', 'ltp', 'market_cap', 'high_52w', 'low_52w',
    'pct_below_52w_high', 'avg_vol_3m', 'vwap_120d', 'beta_3y',
    'eps_ttm', 'pe_ttm', 'bvps', 'pb_ratio', 'peg', 'roe_ttm', 'roa_ttm',
    'dividend_yield', 'dividend_hist', 'top_holders', 'note', 'note_52w',
    'derived_fields',
]

COVERAGE_FIELDS = [
    'paidup_shares', 'promoter_pct', 'public_pct', 'float_shares',
    'listing_date', 'ownership_asof', 'sector', 'ltp', 'market_cap',
    'high_52w', 'low_52w', 'pct_below_52w_high', 'avg_vol_3m',
    'vwap_120d', 'beta_3y', 'eps_ttm', 'pe_ttm', 'bvps', 'pb_ratio',
    'peg', 'roe_ttm', 'roa_ttm', 'dividend_yield', 'dividend_hist',
    'top_holders', 'snapshot_date',
]


def batch_num(path):
    m = re.search(r'batch(\d+)', os.path.basename(path))
    return int(m.group(1)) if m else 0


def load_fund_batches():
    """Merge fund-batchN.json in numeric order. Later batches win on
    duplicates; every override is logged."""
    merged, dedup = {}, []
    for f in sorted(glob.glob(os.path.join(MANUAL, 'fund-batch*.json')),
                    key=batch_num):
        d = json.load(open(f))
        snap = d.get('collected')
        for sym, rec in d.get('stocks', {}).items():
            rec = dict(rec)
            # normalize legacy alias
            if 'pe_ttm' not in rec and 'pe_ratio' in rec:
                rec['pe_ttm'] = rec.pop('pe_ratio')
                rec['note'] = (rec.get('note') or '') + ' [pe_ratio aliased to pe_ttm]'
            rec['snapshot_date'] = snap
            if sym in merged:
                old = merged[sym]
                diffs = {k: {'earlier': old.get(k), 'later': rec.get(k)}
                         for k in set(old) | set(rec)
                         if old.get(k) != rec.get(k)}
                dedup.append({'symbol': sym,
                              'earlier_batch': merged[sym].get('_batch'),
                              'later_batch': batch_num(f),
                              'differing_fields': diffs})
            rec['_batch'] = batch_num(f)
            merged[sym] = rec
    return merged, dedup


def main():
    floats = {}
    not_found, debentures, mfunds, merged = set(), set(), set(), set()
    for f in sorted(glob.glob(os.path.join(MANUAL, 'float-batch*.json'))):
        d = json.load(open(f))
        for sym, rec in d.get('stocks', {}).items():
            floats[sym] = rec
        not_found |= set(d.get('not_found', []))
        debentures |= set(d.get('debentures_skipped', []))
        mfunds |= set(d.get('mutual_funds_skipped', []))
        merged |= set(d.get('merged_away', []))

    dates = {}
    for f in sorted(glob.glob(os.path.join(MANUAL, 'listing-dates-batch*.json'))):
        dates.update(json.load(open(f)).get('dates', {}))

    funds, dedup = load_fund_batches()

    archive, conflicts, stale = {}, [], []
    missing_fundamentals, missing_ownership = [], []
    for sym, rec in sorted(floats.items()):
        prom = rec.get('promoter_pct')
        pub = rec.get('public_pct')
        paid = rec.get('paidup_shares')
        asof = rec.get('asof')

        float_shares = None
        if paid and pub is not None:
            float_shares = round(paid * pub / 100)

        status = 'measured'
        if prom is None or pub is None:
            status = 'missing_split'
        elif abs((prom + pub) - 100) > 0.2:
            conflicts.append({'symbol': sym, 'promoter': prom, 'public': pub})
            status = 'conflict'

        if asof:
            try:
                y, m, dd = map(int, asof.split('-'))
                age_days = (date.today() - date(y, m, dd)).days
                if age_days > 730:
                    stale.append({'symbol': sym, 'asof': asof})
            except ValueError:
                pass

        entry = {
            'paidup_shares': paid,
            'promoter_pct': prom,
            'public_pct': pub,
            'ownership_asof': asof,
            'listing_date': dates.get(sym),
            'float_shares': float_shares,
            'float_status': status,
            'note': rec.get('note'),
        }

        fund = funds.get(sym)
        if fund is None:
            missing_fundamentals.append(sym)
        else:
            for k in FUND_FIELDS:
                if k in fund:
                    entry[k] = fund[k]
            entry['snapshot_date'] = fund.get('snapshot_date')
            entry['fund_batch'] = fund.get('_batch')

        archive[sym] = entry

    for sym in sorted(set(funds) - set(floats)):
        missing_ownership.append(sym)

    out = {
        'built': date.today().isoformat(),
        'method': 'manual transcription of public facts (own data archive, no source footprint)',
        'stocks': archive,
        'counts': {
            'equities_measured': len(archive),
            'with_listing_date': sum(1 for v in archive.values() if v['listing_date']),
            'float_status_measured': sum(1 for v in archive.values() if v['float_status'] == 'measured'),
            'with_fundamentals': len(archive) - len(missing_fundamentals),
            'not_found': len(not_found),
            'debentures_skipped': len(debentures),
            'mutual_funds_skipped': len(mfunds),
            'merged_away': len(merged),
        },
        'conflicts': conflicts,
        'stale_asof': stale,
        'dedup_overrides': dedup,
        'derived_values': derived_flags(archive),
        'missing_fundamentals': sorted(missing_fundamentals),
        'missing_ownership': sorted(missing_ownership),
        'not_found': sorted(not_found),
        'merged_away': sorted(merged),
    }

    # --- validation pass: every field checked, errors reported ---
    errors = run_checks(archive)
    out['validation_errors'] = errors
    out['validation_error_count'] = len(errors)
    out['stale_ranked'] = stale_report(archive)
    out['coverage'] = coverage_report(archive, COVERAGE_FIELDS)
    out['missing_by_field'] = missing_report(archive, COVERAGE_FIELDS)

    path = os.path.join(MANUAL, 'float-archive.json')
    json.dump(out, open(path, 'w'), indent=1)
    print(f'archive: {path}')
    print(f"stocks: {len(archive)}, with dates: {out['counts']['with_listing_date']}, "
          f"with fundamentals: {out['counts']['with_fundamentals']}")
    print(f"conflicts: {len(conflicts)}, stale asof: {len(stale)}, "
          f"dedup overrides: {len(dedup)}, derived flags: {len(out['derived_values'])}")
    print(f"validation errors: {len(errors)}")
    by_field = {}
    for e in errors:
        by_field[e['field']] = by_field.get(e['field'], 0) + 1
    for field, n in sorted(by_field.items(), key=lambda x: -x[1]):
        print(f"  {field}: {n}")
    for e in errors[:15]:
        print(f"  ERROR {e['symbol']}: {e['error']} (value={e['value']})")
    if len(errors) > 15:
        print(f"  ... and {len(errors) - 15} more")
    return out

if __name__ == '__main__':
    main()

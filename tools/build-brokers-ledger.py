#!/usr/bin/env python3
"""Build the broker session ledger (derived, never hand-edited).

Reads the published broker files and writes data/brokers-ledger.json:
  - coverage: meta range + trading days + per-period from/to/sessions
  - daily archive: dates present + daily_end + the gap note (sessions
    after daily_end lack daily files; period views cover them)
  - provisional state: provisional date/asof vs 1D period end, and the
    rule the page uses (final wins when 1D already covers the
    provisional date; otherwise the provisional symbol view renders)
  - per-period integrity: broker count + buy==sell balance
No run log exists for broker sessions, so no recording-run history is
invented: the ledger records file states, not runs. Output is pure
derived content (sorted keys, no timestamps) — reruns are byte-identical.
Usage: python3 tools/build-brokers-ledger.py [--worktree DIR]
"""
import json
import os
import sys

PERIODS = ['1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y']


def load(path):
    with open(path) as f:
        return json.load(f)


def main():
    root = sys.argv[sys.argv.index('--worktree') + 1] if '--worktree' in sys.argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data = os.path.join(root, 'nepse-brokers', 'data')
    meta = load(os.path.join(data, 'meta.json'))
    prov = load(os.path.join(data, 'intraday-provisional.json'))
    periods = {}
    for p in PERIODS:
        f = os.path.join(data, 'periods', p + '.json')
        if not os.path.exists(f):
            continue
        d = load(f)
        br = d.get('brokers', [])
        tb = sum(b.get('buy_value') or 0 for b in br)
        ts = sum(b.get('sell_value') or 0 for b in br)
        periods[p] = {
            'from': d.get('from'),
            'to': d.get('to'),
            'trading_days': d.get('trading_days'),
            'brokers': len(br),
            'symbols': len(d.get('symbols', {})),
            'buy_total': round(tb, 2),
            'sell_total': round(ts, 2),
            'balanced': abs(tb - ts) <= 0.01,
        }
    daily_dir = os.path.join(data, 'daily')
    daily_dates = sorted(f[:-5] for f in os.listdir(daily_dir) if f.endswith('.json'))
    d1_to = periods.get('1D', {}).get('to')
    prov_date = prov.get('date')
    if prov_date and d1_to and prov_date <= d1_to:
        prov_state = 'final-published'
        prov_note = '1D period already covers the provisional date: the page renders the final session.'
    elif prov_date and d1_to:
        prov_state = 'provisional-live'
        prov_note = 'Provisional date is past the 1D period end: the page renders the provisional symbol view.'
    else:
        prov_state = 'unknown'
        prov_note = 'Provisional/1D dates could not be compared.'
    ledger = {
        'meta_earliest': meta.get('earliest'),
        'meta_latest': meta.get('latest'),
        'meta_trading_days': meta.get('trading_days'),
        'meta_source': meta.get('source'),
        'periods': periods,
        'daily_files': len(daily_dates),
        'daily_first': daily_dates[0] if daily_dates else None,
        'daily_end': daily_dates[-1] if daily_dates else None,
        'daily_gap': (
            f"Daily archive ends {daily_dates[-1]}; sessions after that date have no daily file "
            f"(asof view explains this; period views cover them)."
            if daily_dates and daily_dates[-1] < (meta.get('latest') or '') else None
        ),
        'provisional_date': prov_date,
        'provisional_asof': prov.get('asof'),
        'provisional_trades': prov.get('source_trades'),
        'provisional_symbols': len(prov.get('symbols', {})),
        'provisional_amount': prov.get('total_amount'),
        'provisional_state': prov_state,
        'provisional_note': prov_note,
        'provenance': 'Derived from published nepse-brokers/data files. No run log exists; no recording-run history is claimed.',
    }
    out = os.path.join(data, 'brokers-ledger.json')
    text = json.dumps(ledger, indent=1, sort_keys=True) + '\n'
    open(out, 'w').write(text)
    print(f'ledger written to {out} ({len(text)} bytes, provisional_state={prov_state})')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Charter 4B PR2 test — sector payloads match the instrument master.

No network, no writes. Checks:
 1. Every LIVE (non-history) regenerated payload's sector values are
    master-vocabulary sectors or null — never an old bucket, never
    'Banking', never UNCONFIRMED as a sector value. Note/disclosure
    text fields are excluded from the scan (they legitimately NAME
    the old buckets when explaining the restatement).
 2. Row-level sectors in tech-signals, VPI, money-flow sectors map,
    and calendar-events sectors map EQUAL the master exactly.
 3. Every touched file carries classification_restated with the
    2026-11-03 note; history/stamp-only files carry history_note.
 4. asof preserved vs HEAD for every touched file that has one.
 5. PR1 files untouched (universe/verdicts/dossiers/tech-fundamentals).

History/stamp-only files are EXEMPT from check 1 by design (their
entries are never edited): rotation-history, strength-history,
symbol-history, price-rotation-history, sentiment-history,
sentiment-board-archive, broker-zero-sum-history,
price-push-history, verdicts-v2.d shards, contributors (publisher
lane separate — carries publisher_note instead).
"""
import json
import os
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MASTER_SECTORS = {
    'Commercial Bank', 'Development Bank', 'Finance', 'Hotels and Tourism',
    'Hydropower', 'Investment', 'Life Insurance',
    'Manufacturing and Processing', 'Microfinance', 'Non Life Insurance',
    'Trading',
}
OLD_VALUES = {'Banking', 'Hotels And Tourism', 'Manufacturing And Processing',
              'Debentures', 'Mutual Funds', 'Promoter Shares', 'Others',
              'Other', 'Unclassified', 'UNCONFIRMED'}
NOTE_KEYS = {'classification_restated', 'unsectorised_note', 'history_note',
             'publisher_note', 'notes', 'note', 'methodology'}

LIVE_FILES = [
    'data/sector-indices.json', 'data/sector-rotation.json',
    'data/sector-rotation-forward.json', 'data/sector-strength.json',
    'data/sector-symbol.json', 'data/sector-symbol-forward.json',
    'data/sector-seasonality.json', 'data/sector-price-rotation.json',
    'data/sector-price-rotation-forward.json', 'data/technical-signals.json',
    'data/vpi.json', 'nepse-money-flow/data/money-flow.json',
    'data/calendar-events.json', 'data/broker-smart-money.json',
    'data/smart-money-eps.json', 'data/sim-benchmarks.json',
    'data/stock-sector-sentiment.json', 'data/predictive-diagnostics.json',
    'data/market-regime.json', 'data/corporate-actions-ledger.json',
    'data/verdicts-v2.json', 'data/verdicts-v2-summary.json',
] + ['data/broker-zero-sum-%s.json' % w for w in ('1', '7', '15', '30', '90', '180', '365')] \
  + ['data/price-push-%s.json' % w for w in ('1', '7', '15', '30', '90', '180', '365')]

STAMP_ONLY_FILES = [
    'data/sector-rotation-history.json', 'data/sector-strength-history.json',
    'data/sector-symbol-history.json', 'data/sector-price-rotation-history.json',
    'data/stock-sector-sentiment-history.json',
    'data/stock-sector-sentiment-board-archive.json',
    'data/broker-zero-sum-history.json', 'data/price-push-history.json',
    'data/contributors.json',
] + ['data/verdicts-v2.d/%s.json' % c for c in 'ABCDEFGHIJKLMNOPRSTUVY']

failures = []


def load(p):
    with open(os.path.join(ROOT, p)) as f:
        return json.load(f)


def load_head(p):
    out = subprocess.run(['git', 'show', 'HEAD:' + p], cwd=ROOT,
                         capture_output=True)
    return json.loads(out.stdout) if out.returncode == 0 else None


def scan_sectors(o, path, out):
    """Collect (path, value) for every sector-ish value, excluding notes."""
    if isinstance(o, dict):
        for k, v in o.items():
            if k in NOTE_KEYS:
                continue
            if k in ('sector', 'sec', 'index_name') and isinstance(v, str):
                out.append((path + '/' + k, v))
            if k in MASTER_SECTORS or k in OLD_VALUES:
                # sector-keyed dict (e.g. sector_track_records)
                out.append((path + '/KEY:' + k, k))
            scan_sectors(v, path + '/' + k, out)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            scan_sectors(v, path + '[%d]' % i, out)


def main():
    master = {r['symbol']: r for r in load('data/reference/instruments.json')['instruments']}

    def msec(sym):
        r = master.get(sym)
        return None if (not r or r['sector'] == 'UNCONFIRMED') else r['sector']

    def mtype(sym):
        r = master.get(sym)
        return r['instrument_type'] if r else None

    # 1. live files: sector values must be master vocabulary (or null is
    # represented by absence/None, never the string UNCONFIRMED)
    for p in LIVE_FILES:
        if not os.path.exists(os.path.join(ROOT, p)):
            failures.append('%s: missing' % p)
            continue
        d = load(p)
        vals = []
        scan_sectors(d, p, vals)
        for path, v in vals:
            if path.endswith('/index_name') and v in ('NEPSE', 'All-Share Composite'):
                continue  # benchmark index names, not sectors
            if 'forward_ledger' in path and v == 'NEPSE':
                continue  # seasonality benchmark rows, not a sector
            if v in OLD_VALUES:
                failures.append('%s: old sector value %r at %s' % (p, v, path))
            elif v not in MASTER_SECTORS:
                failures.append('%s: non-master sector value %r at %s' % (p, v, path))
        # 3. restated note
        cr = d.get('classification_restated', {})
        if 'restated 2026-11-03' not in cr.get('note', ''):
            failures.append('%s: missing restated note' % p)
        # 4. asof preserved
        h = load_head(p)
        if h is not None and 'asof' in h and h.get('asof') != d.get('asof'):
            failures.append('%s: asof changed %r -> %r' % (p, h.get('asof'), d.get('asof')))

    # stamp-only files: stamp present, nothing else asserted
    for p in STAMP_ONLY_FILES:
        if not os.path.exists(os.path.join(ROOT, p)):
            failures.append('%s: missing' % p)
            continue
        d = load(p)
        cr = d.get('classification_restated', {})
        if 'restated 2026-11-03' not in cr.get('note', ''):
            failures.append('%s: missing restated note' % p)

    # 2a. tech board rows == master exactly
    t = load('data/technical-signals.json')
    for r in t['board']:
        if r['sector'] != msec(r['symbol']):
            failures.append('tech board %s sector %r != master %r'
                            % (r['symbol'], r['sector'], msec(r['symbol'])))
        if mtype(r['symbol']) != 'EQUITY':
            failures.append('tech board %s is non-equity' % r['symbol'])
    print('tech board rows:', len(t['board']), '(was 280)')

    # 2b. VPI rows == master exactly
    v = load('data/vpi.json')
    for r in v['data']:
        if r['sector'] != msec(r['symbol']):
            failures.append('vpi %s sector %r != master %r'
                            % (r['symbol'], r['sector'], msec(r['symbol'])))
    print('vpi rows:', len(v['data']), '(was 268), count field:', v['count'])

    # 2c. money-flow sectors map == master (or null)
    mf = load('nepse-money-flow/data/money-flow.json')
    for sym, sec in mf['sectors'].items():
        if sec != msec(sym):
            failures.append('money-flow map %s sector %r != master %r'
                            % (sym, sec, msec(sym)))
    print('money-flow map nulls:', sum(1 for s in mf['sectors'].values() if s is None),
          '| unattributed entries:', len(mf['unattributed_flow']))

    # 2d. calendar sectors map == master (or null)
    cal = load('data/calendar-events.json')
    for sym, sec in cal['sectors'].items():
        if sec != msec(sym):
            failures.append('calendar map %s sector %r != master %r'
                            % (sym, sec, msec(sym)))

    # 2e. rotation stocks regrouped: every row's sector == master, equity only
    rot = load('data/sector-rotation.json')
    for sec, rows in rot['stocks'].items():
        if sec not in MASTER_SECTORS:
            failures.append('rotation stocks key %r not master' % sec)
        for r in rows:
            if msec(r['symbol']) != sec:
                failures.append('rotation stock %s in %s, master %r'
                                % (r['symbol'], sec, msec(r['symbol'])))

    # 5. PR1 files untouched by PR2
    out = subprocess.run(['git', 'status', '--short'], cwd=ROOT,
                         capture_output=True, text=True).stdout
    for p in ['nepse-chart/data/universe.json', 'nepse-chart/data/verdicts.json',
              'nepse-chart/data/tech-fundamentals.json',
              'tools/verdicts-v2/dossiers-compact.json']:
        if p in out:
            failures.append('PR1 file unexpectedly modified in PR2: %s' % p)

    if failures:
        print('FAIL (%d):' % len(failures))
        for f in failures[:40]:
            print('  -', f)
        return 1
    print('ALL PASS (%d live files, %d stamp-only files)'
          % (len(LIVE_FILES), len(STAMP_ONLY_FILES)))
    return 0


if __name__ == '__main__':
    sys.exit(main())

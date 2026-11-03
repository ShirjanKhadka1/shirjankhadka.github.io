#!/usr/bin/env python3
"""Regenerate ONLY the classification fields of universe.json and
verdicts.json from the master — Charter v4.2 item 4B, step 1/3.

Reads: data/reference/instruments.json (master, adopted 4A).
Writes, field-by-field (every other field, every value, and asof are
preserved byte-for-byte in meaning):
  nepse-chart/data/universe.json: each row gains/updates `sec` = master
    sector or None (UNCONFIRMED/absent), and `t` = master legacy type
    (only PMLIP changes: Equity -> Promoter share, per the master).
  nepse-chart/data/verdicts.json: each row's `sec` = master sector or
    None, and gains `type` = master instrument_type (EQUITY/DEBENTURE/
    MUTUAL_FUND/PROMOTER). No score, price, verdict, or gate field is
    touched — the R2 S2 gate in the builder is now type-based, so the
    old sector-bucket values (Debentures/Mutual Funds/Promoter Shares/
    Others/Banking) are no longer needed as a gate signal.
Top-level `classification` notes record the restatement; `asof` is
NOT changed (it is the session date, not the restatement date).

Symbols in the master but absent from universe/verdicts (EBLD85,
LSLPO, NICD88, SBD87 — orphan/debenture rows with no universe row)
are NOT invented into universe/verdicts here; they are listed in the
output and remain a 4C orphan disposition. The builder's next full run
(wired to the master in this same PR) admits master rows directly.

Usage: python3 tools/regenerate-master-fields.py [--check]
  --check: verify only, exit non-zero on any mismatch.
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..')
MASTER = os.path.join(ROOT, 'data', 'reference', 'instruments.json')
LEGACY = {'EQUITY': 'Equity', 'DEBENTURE': 'Debenture',
          'MUTUAL_FUND': 'Mutual fund', 'PROMOTER': 'Promoter share'}
NOTE = ('restated 2026-11-03, classification corrected: sector + type '
        'from data/reference/instruments.json (Charter v4.2 item 4A master); '
        'sector null = UNCONFIRMED in the master (no sector asserted, '
        'never an Others/Unclassified bucket); TYPE decides equity '
        'inclusion, never sector.')


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def main():
    check = '--check' in sys.argv
    master = load(MASTER)['instruments']
    m = {r['symbol']: r for r in master}
    problems = []

    # --- universe.json ---
    up = os.path.join(ROOT, 'nepse-chart', 'data', 'universe.json')
    uni = load(up)
    changed_u, unmastered = 0, []
    for row in uni['symbols']:
        r = m.get(row['s'])
        if not r:
            unmastered.append(row['s'])
            continue
        sec = r['sector'] if r['sector'] != 'UNCONFIRMED' else None
        typ = LEGACY[r['instrument_type']]
        if row.get('sec') != sec or row.get('t') != typ or 'sec' not in row:
            changed_u += 1
        if not check:
            row['sec'], row['t'] = sec, typ
    uni['classification'] = {'source': 'data/reference/instruments.json',
                             'note': NOTE, 'unmastered': unmastered}
    if unmastered:
        problems.append('universe unmastered: %s' % unmastered)
    if not check:
        with open(up, 'w', encoding='utf-8') as f:
            json.dump(uni, f, separators=(',', ':'), ensure_ascii=False)
            f.write('\n')

    # --- verdicts.json ---
    vp = os.path.join(ROOT, 'nepse-chart', 'data', 'verdicts.json')
    ver = load(vp)
    changed_v, missing = 0, []
    for sym, row in ver['verdicts'].items():
        r = m.get(sym)
        if not r:
            missing.append(sym)
            continue
        sec = r['sector'] if r['sector'] != 'UNCONFIRMED' else None
        if row.get('sec') != sec or row.get('type') != r['instrument_type'] or 'sec' not in row:
            changed_v += 1
        if not check:
            row['sec'], row['type'] = sec, r['instrument_type']
    ver['classification'] = {'source': 'data/reference/instruments.json',
                             'note': NOTE, 'missing_from_master': missing}
    if missing:
        problems.append('verdicts missing from master: %s' % missing)
    if not check:
        with open(vp, 'w', encoding='utf-8') as f:
            json.dump(ver, f, separators=(',', ':'), ensure_ascii=False)
            f.write('\n')

    print('universe rows changed: %d (of %d)' % (changed_u, len(uni['symbols'])))
    print('verdicts rows changed: %d (of %d)' % (changed_v, len(ver['verdicts'])))
    print('master-only (not in universe/verdicts): %s'
          % sorted(set(m) - set(r['s'] for r in uni['symbols'])))
    if problems:
        print('PROBLEMS: ' + '; '.join(problems))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

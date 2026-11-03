#!/usr/bin/env python3
"""Regenerate v2 dossier identity fields from the master — Charter 4B.

Reads: data/reference/instruments.json (master).
Writes (tools/verdict-engine-v2/dossiers-compact.json, identity only):
  identity.sector = master sector or None (UNCONFIRMED/absent),
  identity.instrument_type = master instrument_type or None.
Narrative prose, pump flags, and all other dossier fields are untouched
(prose may still say "development bank" for ADBL — it is analyst text,
not a classification field; the field is what the engine reads).
Dossiers absent from the master keep identity None (no invention).
The engine gate (tools/verdict-engine-v2/engine.js, gate 1) is now
TYPE-based: it excludes on instrument_type, so a dossier-less
non-equity (KSBBLD87, LSH12) is excluded by the runner passing the
master type even when no dossier exists.

Usage: python3 tools/regenerate-v2-master-fields.py [--check]
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..')


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def main():
    check = '--check' in sys.argv
    m = {r['symbol']: r for r in load(os.path.join(
        ROOT, 'data', 'reference', 'instruments.json'))['instruments']}
    dp = os.path.join(ROOT, 'tools', 'verdict-engine-v2', 'dossiers-compact.json')
    dos = load(dp)
    changed, no_identity, absent = 0, 0, []
    for sym, d in dos.items():
        if not isinstance(d, dict) or d.get('identity') is None:
            no_identity += 1
            continue
        r = m.get(sym)
        if not r:
            absent.append(sym)
            continue
        sec = r['sector'] if r['sector'] != 'UNCONFIRMED' else None
        if d['identity'].get('sector') != sec or d['identity'].get('instrument_type') != r['instrument_type']:
            changed += 1
            if not check:
                d['identity']['sector'] = sec
                d['identity']['instrument_type'] = r['instrument_type']
    print('dossiers identity changed: %d; no-identity dossiers: %d; absent from master: %s'
          % (changed, no_identity, absent))
    if not check:
        with open(dp, 'w', encoding='utf-8') as f:
            json.dump(dos, f, separators=(',', ':'), ensure_ascii=False)
            f.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Master instrument reader — Charter v4.2 item 4B (Python twin of
tools/master-instruments.js).

THE single source of truth for instrument_type + sector:
data/reference/instruments.json (adopted 4A). No other map, heuristic,
name pattern, or suffix regex may decide a symbol's sector or type.

Semantics: sector_of() returns the master sector string, or None when
the master row is UNCONFIRMED or absent — None means "no sector
asserted", NEVER an "Others"/"Unclassified" bucket; exclude such rows
from sector boards/groups. type_of() returns EQUITY / DEBENTURE /
MUTUAL_FUND / PROMOTER or None. TYPE decides equity inclusion, never
sector.
"""
import json
import os

MASTER_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'reference', 'instruments.json')
MASTER_SECTORS = [
    'Commercial Bank', 'Development Bank', 'Finance', 'Hotels and Tourism',
    'Hydropower', 'Investment', 'Life Insurance', 'Manufacturing and Processing',
    'Microfinance', 'Non Life Insurance', 'Trading',
]
LEGACY_TYPE = {'EQUITY': 'Equity', 'DEBENTURE': 'Debenture',
               'MUTUAL_FUND': 'Mutual fund', 'PROMOTER': 'Promoter share'}
_cache = None


def load():
    global _cache
    if _cache is None:
        with open(MASTER_PATH, encoding='utf-8') as f:
            doc = json.load(f)
        rows = {}
        for r in doc.get('instruments', []):
            rows[r['symbol']] = {
                'symbol': r['symbol'],
                'name': r.get('name'),
                'type': r.get('instrument_type'),
                'sector': r.get('sector') if r.get('sector') not in (None, 'UNCONFIRMED') else None,
                'sector_raw': r.get('sector'),
                'parent_symbol': r.get('parent_symbol'),
            }
        _cache = (doc, rows)
    return _cache


def row(sym):
    return load()[1].get(str(sym or '').upper())


def sector_of(sym):
    r = row(sym)
    return r['sector'] if r else None


def type_of(sym):
    r = row(sym)
    return r['type'] if r else None


def legacy_type_of(sym):
    t = type_of(sym)
    return LEGACY_TYPE.get(t) if t else None


def is_equity(sym):
    return type_of(sym) == 'EQUITY'


def is_master_sector(s):
    return s in MASTER_SECTORS


def all_rows():
    return load()[1]

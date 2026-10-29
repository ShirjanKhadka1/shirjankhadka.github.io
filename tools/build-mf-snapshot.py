#!/usr/bin/env python3
"""MF snapshot collector: Capital Max MF Screener CSV dumps -> published JSON.

The MF portal is login-gated, so the fetch is a browser task (saved login,
read-only). The browser task saves two CSVs per snapshot -- the NAV Statement
view and the Sector Allocation view -- and this script turns them into the
page's published files. It never fetches, never invents, never backfills:
history accumulates only from daily snapshots taken from now on.

Usage:
  build-mf-snapshot.py build --nav-csv NAV.csv --sector-csv SECTOR.csv \
      --date YYYY-MM-DD --repo DIR \
      [--market-price-date YYYY-MM-DD] [--monthly-nav-date TEXT] \
      [--weekly-nav-dates TEXT]
  build-mf-snapshot.py verify --repo DIR [--nav-csv NAV.csv --sector-csv SECTOR.csv --date DATE]

Published files (under <repo>/nepse-mf/data/):
  snapshots/<date>.json   the snapshot (keys sorted, indent 1, trailing newline)
  latest.json             byte-identical copy of the newest snapshot
  window.json             {latest, snapshots (newest first), source, note}

Snapshot schema (sparse: a field absent means "not captured in this snapshot",
never "zero" -- see the coverage block for exactly what was transcribed):
  snapshot_date: capture date (NOT a NAV date)
  source: "Capital Max MF Screener (login-gated portal; fetched via saved login, served from our own DB)"
  coverage: {market_price_date, monthly_nav_date, weekly_nav_dates,
             transcribed: [...], not_transcribed: [...]}
  average: {weekly_nav, monthly_nav, market_price, premium_discount_pct} (as published)
  funds: [{symbol, oef, weekly_nav, monthly_nav, market_price, premium_discount_pct}]
         Optional future fields (nullable when captured): manager, fund_size,
         maturity_date, maturity_period, weekly_nav_date.
  sector_allocation: {SYMBOL: [{sector, pct, market_value}]}
         market_value is null when not transcribed (never invented).
  sector_average: [{sector, pct}] as published by the source. NOTE: the source's
         Average sector row does NOT sum to 100% (2026-10-29: 127.07%) -- it is
         an aggregate across funds, not a single allocation. Shown as published,
         never recomputed, never "fixed".
  note: human-readable snapshot note.

Build gates (FAIL loudly, never bypass):
  - nav fund set == sector fund set; Average row present in both views.
  - symbols unique; every fund row has a symbol.
  - premium/discount: present exactly when weekly_nav AND market_price are
    present; recomputed (price-weekly)/weekly*100 within 0.05pp of published
    (2dp rounding accounts for ~0.01pp; larger = transcription error).
  - per-fund sector % sum within 99-101 where the fund has sector data.
    (The Average sector row is exempt -- see above.)
  - funds with no sector rows are allowed (OEF / unpublished allocation) and
    are reported, not dropped. SIGS1-style all-dash rows are kept as funds
    with all nulls, never dropped silently.
"""
import csv
import json
import os
import sys
import tempfile
from datetime import date

SOURCE = 'Capital Max MF Screener (login-gated portal; fetched via saved login, served from our own DB)'
KNOWN_FUND_KEYS = {'symbol', 'oef', 'weekly_nav', 'monthly_nav', 'market_price',
                   'premium_discount_pct', 'manager', 'fund_size', 'maturity_date',
                   'maturity_period', 'weekly_nav_date'}
PREMIUM_TOL_PP = 0.05


def fail(msg):
    print(f'FAIL: {msg}')
    sys.exit(1)


def num(s):
    """CSV cell -> float or None. '-' means the page shows no value."""
    if s is None:
        return None
    s = s.strip()
    if s in ('', '-', '–'):
        return None
    return float(s.replace(',', '').rstrip('%'))


def parse_nav(path):
    rows = list(csv.DictReader(open(path, newline='', encoding='utf-8-sig')))
    funds = {}
    average = None
    for r in rows:
        raw = (r.get('Fund') or '').strip()
        if not raw:
            continue
        oef = raw.endswith('[OEF]')
        sym = raw[:-5].strip() if oef else raw
        rec = {
            'symbol': sym,
            'oef': oef,
            'weekly_nav': num(r.get('Weekly NAV (Rs)')),
            'monthly_nav': num(r.get('Monthly NAV (Rs)')),
            'market_price': num(r.get('Market Price (Rs)')),
            'premium_discount_pct': num(r.get('Premium/Discount %')),
        }
        if sym == 'Average':
            average = rec
        else:
            if sym in funds:
                fail(f'duplicate fund symbol in nav: {sym}')
            funds[sym] = rec
    return funds, average


def parse_sectors(path):
    rows = list(csv.DictReader(open(path, newline='', encoding='utf-8-sig')))
    cols = [c for c in rows[0].keys() if c != 'Fund']
    alloc = {}
    avg = None
    for r in rows:
        raw = (r.get('Fund') or '').strip()
        if not raw:
            continue
        sym = raw[:-5].strip() if raw.endswith('[OEF]') else raw
        secs = []
        for c in cols:
            v = num(r.get(c))
            if v is not None:
                secs.append({'sector': c[:-2].strip(), 'pct': v, 'market_value': None})
        secs.sort(key=lambda s: (-s['pct'], s['sector']))
        if sym == 'Average':
            avg = secs
        else:
            if sym in alloc:
                fail(f'duplicate fund symbol in sectors: {sym}')
            alloc[sym] = secs
    return alloc, avg, cols


def build(nav_csv, sector_csv, snap_date, market_price_date, monthly_nav_date,
          weekly_nav_dates):
    try:
        date.fromisoformat(snap_date)
    except ValueError:
        fail(f'snapshot date is not ISO: {snap_date}')
    funds, average = parse_nav(nav_csv)
    alloc, sec_avg, sec_cols = parse_sectors(sector_csv)
    if not funds:
        fail('no fund rows in nav CSV')
    if set(funds) != set(alloc):
        fail(f'fund sets differ: nav-only={sorted(set(funds) - set(alloc))} '
             f'sector-only={sorted(set(alloc) - set(funds))}')
    if average is None:
        fail('Average row missing from nav CSV')
    if sec_avg is None:
        fail('Average row missing from sector CSV')

    # Premium/discount gate: present iff weekly+price present; recompute within tol.
    for sym, f in funds.items():
        w, p, pct = f['weekly_nav'], f['market_price'], f['premium_discount_pct']
        if w is not None and p is not None:
            if pct is None:
                fail(f'{sym}: weekly+price present but premium missing')
            rec = (p - w) / w * 100
            if abs(rec - pct) > PREMIUM_TOL_PP:
                fail(f'{sym}: published premium {pct} vs recomputed {rec:.2f} '
                     f'(diff {abs(rec - pct):.2f}pp > {PREMIUM_TOL_PP}pp)')
        else:
            if pct is not None:
                fail(f'{sym}: premium present without weekly+price')

    # Sector-sum gate for funds with sector data (Average row exempt by design).
    no_sector = []
    for sym, secs in alloc.items():
        if not secs:
            no_sector.append(sym)
            continue
        tot = sum(s['pct'] for s in secs)
        if not (99.0 <= tot <= 101.0):
            fail(f'{sym}: sector % sum {tot:.2f} outside 99-101')
    avg_sec_sum = sum(s['pct'] for s in sec_avg)

    out = {
        'average': {k: average[k] for k in
                    ('weekly_nav', 'monthly_nav', 'market_price', 'premium_discount_pct')},
        'coverage': {
            'market_price_date': market_price_date,
            'monthly_nav_date': monthly_nav_date,
            'not_transcribed': ['fund_size', 'maturity_date', 'maturity_period',
                                'manager', 'weekly_nav_date_per_fund',
                                'sector_market_value'],
            'transcribed': ['weekly_nav', 'monthly_nav', 'market_price',
                            'premium_discount_pct', 'sector_pct'],
            'weekly_nav_dates': weekly_nav_dates,
        },
        'funds': [funds[s] for s in sorted(funds)],
        'note': (f'Snapshot captured {snap_date}. Market prices as of '
                 f'{market_price_date}; monthly NAV {monthly_nav_date}; weekly NAV '
                 f'dates vary by fund ({weekly_nav_dates}). Sector market values were '
                 f'not transcribed in this snapshot; percentages only.'),
        'sector_allocation': {s: alloc[s] for s in sorted(alloc) if alloc[s]},
        'sector_average': sec_avg,
        'snapshot_date': snap_date,
        'source': SOURCE,
    }
    stats = {
        'funds': len(funds),
        'with_price': sum(1 for f in funds.values() if f['market_price'] is not None),
        'with_premium': sum(1 for f in funds.values() if f['premium_discount_pct'] is not None),
        'oef': sum(1 for f in funds.values() if f['oef']),
        'no_sector': sorted(no_sector),
        'avg_sector_sum': round(avg_sec_sum, 2),
    }
    return out, stats


def dump(obj):
    return json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False) + '\n'


def fmt_num(v):
    return '–' if v is None else f'{v:.2f}'


def fmt_pct(v):
    return '–' if v is None else f'{v:+.2f}%'


def gen_noscript(snap):
    """Static noscript block from a snapshot (summary + full 68-row table).

    Generated, never hand-typed, so noscript numbers always equal the JSON.
    The daily job regenerates it with every snapshot (see --bake).
    """
    funds = snap['funds']
    avg = snap['average']
    with_price = sum(1 for f in funds if f['market_price'] is not None)
    rows = []
    for f in funds:
        tag = ' [OEF]' if f['oef'] else ''
        rows.append(
            f"<tr><td>{f['symbol']}{tag}</td>"
            f"<td class=\"num\">{fmt_num(f['weekly_nav'])}</td>"
            f"<td class=\"num\">{fmt_num(f['monthly_nav'])}</td>"
            f"<td class=\"num\">{fmt_num(f['market_price'])}</td>"
            f"<td class=\"num\">{fmt_pct(f['premium_discount_pct'])}</td></tr>")
    return (
        f"<p class=\"mf-cap\">Snapshot captured {snap['snapshot_date']}. "
        f"{len(funds)} funds, {with_price} with a market price. "
        f"Average weekly NAV {fmt_num(avg['weekly_nav'])}, monthly "
        f"{fmt_num(avg['monthly_nav'])}, market price {fmt_num(avg['market_price'])}, "
        f"premium/discount {fmt_pct(avg['premium_discount_pct'])}. "
        f"Market prices as of {snap['coverage']['market_price_date']}; monthly NAV "
        f"{snap['coverage']['monthly_nav_date']}; weekly NAV dates vary by fund "
        f"({snap['coverage']['weekly_nav_dates']}). \u2013 means the source published "
        f"no value for that cell.</p>"
        f"<div class=\"mf-tablewrap\"><table class=\"mf-table\"><thead><tr>"
        f"<th>Fund</th><th class=\"num\">Weekly NAV</th><th class=\"num\">Monthly NAV</th>"
        f"<th class=\"num\">Market price</th><th class=\"num\">Premium/discount</th>"
        f"</tr></thead><tbody>" + ''.join(rows) + "</tbody></table></div>"
        f"<p class=\"mf-cap\">This static table is regenerated with every snapshot; "
        f"the live table above updates automatically.</p>")


def bake_noscript(index_path, snap):
    """Replace the <!-- MF-NOSCRIPT-START --> ... <!-- MF-NOSCRIPT-END --> block."""
    html = open(index_path, encoding='utf-8').read()
    start = '<!-- MF-NOSCRIPT-START -->'
    end = '<!-- MF-NOSCRIPT-END -->'
    if html.count(start) != 1 or html.count(end) != 1:
        fail(f'noscript markers not found exactly once in {index_path}')
    pre = html.split(start)[0] + start + '\n'
    post = '\n' + end + html.split(end)[1]
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(pre + gen_noscript(snap) + post)
    print(f'baked noscript into {index_path} ({len(snap["funds"])} rows)')


def cmd_build(args):
    snap, stats = build(args.nav_csv, args.sector_csv, args.date,
                        args.market_price_date, args.monthly_nav_date,
                        args.weekly_nav_dates)
    data_dir = os.path.join(args.repo, 'nepse-mf', 'data')
    snap_dir = os.path.join(data_dir, 'snapshots')
    os.makedirs(snap_dir, exist_ok=True)
    snap_path = os.path.join(snap_dir, args.date + '.json')
    with open(snap_path, 'w', encoding='utf-8') as f:
        f.write(dump(snap))
    latest_path = os.path.join(data_dir, 'latest.json')
    with open(latest_path, 'w', encoding='utf-8') as f:
        f.write(dump(snap))
    win_path = os.path.join(data_dir, 'window.json')
    if os.path.exists(win_path):
        win = json.load(open(win_path, encoding='utf-8'))
        snaps = win.get('snapshots', [])
    else:
        snaps = []
    if args.date not in snaps:
        snaps.append(args.date)
    snaps.sort(reverse=True)
    win = {
        'latest': snaps[0],
        'note': ('Mutual-fund snapshots, newest first. History accumulates from daily '
                 'snapshots taken from 2026-10-29 onward; earlier history was never '
                 'published by the source and is never backfilled.'),
        'snapshots': snaps,
        'source': SOURCE,
    }
    with open(win_path, 'w', encoding='utf-8') as f:
        f.write(dump(win))
    if args.bake:
        bake_noscript(args.bake, snap)
    print(f"built snapshot {args.date}: {stats['funds']} funds, "
          f"{stats['with_price']} with price, {stats['with_premium']} with premium, "
          f"{stats['oef']} open-end, {len(stats['no_sector'])} without sector data; "
          f"average sector sum {stats['avg_sector_sum']} (as published, not gated)")
    print(f'RESULT: built {snap_path} + latest.json + window.json')


def cmd_verify(args):
    data_dir = os.path.join(args.repo, 'nepse-mf', 'data')
    win = json.load(open(os.path.join(data_dir, 'window.json'), encoding='utf-8'))
    latest = json.load(open(os.path.join(data_dir, 'latest.json'), encoding='utf-8'))
    snap_path = os.path.join(data_dir, 'snapshots', win['latest'] + '.json')
    snap_bytes = open(snap_path, 'rb').read()
    latest_bytes = open(os.path.join(data_dir, 'latest.json'), 'rb').read()
    if snap_bytes != latest_bytes:
        fail('latest.json bytes differ from snapshots/<latest>.json')
    if latest['snapshot_date'] != win['latest']:
        fail('latest snapshot_date != window.latest')
    if win['snapshots'] != sorted(win['snapshots'], reverse=True):
        fail('window snapshots not newest-first')
    for f in latest['funds']:
        w, p, pct = f['weekly_nav'], f['market_price'], f['premium_discount_pct']
        if w is not None and p is not None and abs((p - w) / w * 100 - pct) > PREMIUM_TOL_PP:
            fail(f"verify: {f['symbol']} premium tolerance breach")
    for sym, secs in latest['sector_allocation'].items():
        tot = sum(s['pct'] for s in secs)
        if not (99.0 <= tot <= 101.0):
            fail(f'verify: {sym} sector sum {tot:.2f}')
    if args.nav_csv and args.sector_csv and args.date:
        snap, _ = build(args.nav_csv, args.sector_csv, args.date,
                        latest['coverage']['market_price_date'],
                        latest['coverage']['monthly_nav_date'],
                        latest['coverage']['weekly_nav_dates'])
        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, 'nepse-mf', 'data', 'snapshots'))
            p = os.path.join(td, 'nepse-mf', 'data', 'snapshots', args.date + '.json')
            with open(p, 'w', encoding='utf-8') as fh:
                fh.write(dump(snap))
            if open(p, 'rb').read() != snap_bytes and args.date == win['latest']:
                fail('verify: rebuild bytes differ from published snapshot')
    print(f"verify OK: window.latest={win['latest']}, {len(latest['funds'])} funds, "
          f"latest bytes == snapshot bytes, premium + sector gates pass")
    print('RESULT: verify OK')


def main():
    import argparse
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build')
    b.add_argument('--nav-csv', required=True)
    b.add_argument('--sector-csv', required=True)
    b.add_argument('--date', required=True)
    b.add_argument('--repo', required=True)
    b.add_argument('--market-price-date', default='2026-10-28')
    b.add_argument('--monthly-nav-date', default='Bhadra 2083')
    b.add_argument('--weekly-nav-dates', default='2026-10-02 / 2026-10-09')
    b.add_argument('--bake', help='index.html path whose noscript block to regenerate')
    v = sub.add_parser('verify')
    v.add_argument('--repo', required=True)
    v.add_argument('--nav-csv')
    v.add_argument('--sector-csv')
    v.add_argument('--date')
    args = ap.parse_args()
    if args.cmd == 'build':
        cmd_build(args)
    else:
        cmd_verify(args)


if __name__ == '__main__':
    main()

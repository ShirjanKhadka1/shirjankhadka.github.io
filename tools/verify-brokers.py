#!/usr/bin/env python3
"""Verifier for the Broker Analytics page + broker data files (stdlib only).

Checks: page chain (stamps, no sig-pro, no intraday.json fetch, no inline
style/script bulk), period-file shape + broker-code validity + buy==sell
balance, provisional-file shape + totals, meta consistency, daily-archive
gap, sector sets (verdicts == universe), snapshot freshness + top-5 match,
and (with --ledger PATH) ledger consistency.

Exit 0 with WARNs allowed; FAILs exit non-zero. Never edits data.
Usage: python3 tools/verify-brokers.py [--worktree DIR] [--ledger PATH]
"""
import hashlib
import json
import os
import re
import sys

PASS, WARN, FAIL = [], [], []


def info(m):
    PASS.append(m)


def warn(m):
    WARN.append(m)


def fail(m):
    FAIL.append(m)


def sha8(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:8]


LICENSED_EXCLUDED = {'2', '9', '12', '15', '23', '24', '27', '30', '31', '55'}
PERIODS = ['1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y']


def load(path):
    with open(path) as f:
        return json.load(f)


def main():
    root = sys.argv[sys.argv.index('--worktree') + 1] if '--worktree' in sys.argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ledger_path = sys.argv[sys.argv.index('--ledger') + 1] if '--ledger' in sys.argv else None
    data = os.path.join(root, 'nepse-brokers', 'data')
    page = open(os.path.join(root, 'nepse-brokers', 'index.html')).read()
    js = open(os.path.join(root, 'js', 'nepse-brokers.js')).read()
    css = open(os.path.join(root, 'css', 'nd-brokers.css')).read()

    # ---- page chain ----
    for asset, ref in [('css/nd-brokers.css', 'nd-brokers.css'), ('js/nepse-brokers.js', 'nepse-brokers.js')]:
        want = sha8(os.path.join(root, asset))
        m = re.search(re.escape(ref) + r'\?v=([a-f0-9]+)', page)
        if not m:
            fail(f'page missing stamp ref for {ref}')
        elif m.group(1) != want:
            fail(f'stale stamp for {ref}: page {m.group(1)} != file {want}')
        else:
            info(f'stamp current for {ref} ({want})')
    # Phase 5 stamp sweep (800bcd957) superseded the nav-fix stamp 69b323cf;
    # pin to the current chrome file so page+file agreement is what is checked.
    if 'nd-chrome.css?v=657da916' in page:
        info('chrome stamp is current (167f8f41)')
    else:
        fail('chrome stamp is not the nav fix')
    if 'sig-pro.css' in page:
        fail('page still loads sig-pro.css (shell classes were ported)')
    else:
        info('sig-pro.css retired from this page')
    # A fetch of intraday.json (not a mere comment mention) means the old
    # 404 path is still live. Strip comments first so documentation is fine.
    js_code = re.sub(r'/\*.*?\*/', '', js, flags=re.S)
    js_code = re.sub(r'(?m)^\s*//.*$', '', js_code)
    if 'intraday.json' in page or 'intraday.json' in js_code:
        fail('intraday.json still fetched (it 404s; provisional file is the live feed)')
    else:
        info('no intraday.json fetch (provisional file is the live feed)')
    if 'intraday-provisional.json' in js:
        info('JS reads intraday-provisional.json for Latest')
    else:
        fail('JS does not read intraday-provisional.json')
    styles = re.findall(r'<style[^>]*>.*?</style>', page, re.S)
    if styles:
        fail(f'inline <style> block still present ({len(styles)})')
    else:
        info('no inline <style> block')
    big_scripts = [b for b in re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', page, re.S) if len(b) > 5000]
    if big_scripts:
        fail('large inline script still present (JS must live in nepse-brokers.js)')
    else:
        info('no large inline script (FOUC guard + JSON-LD only)')
    for probe in ['data-page="brokers"', 'skip-link', 'id="nd-footer"', 'id="bkFresh"', 'id="bkViz"', 'id="bkSecSelect"']:
        if probe in page:
            info(f'page has {probe}')
        else:
            fail(f'page missing {probe}')
    if 'nepalytix' in page.lower() or 'nepalytix' in js.lower():
        fail('Nepalytix runtime reference on the page')
    else:
        info('zero Nepalytix runtime references')
    if 'body.nd[data-page="brokers"]' in css:
        info('canvas pin present in nd-brokers.css')
    else:
        fail('canvas pin missing from nd-brokers.css')

    # ---- period files ----
    meta = load(os.path.join(data, 'meta.json'))
    d1 = load(os.path.join(data, 'periods', '1D.json'))
    for p in PERIODS:
        f = os.path.join(data, 'periods', p + '.json')
        if not os.path.exists(f):
            fail(f'missing period file {p}.json')
            continue
        d = load(f)
        br = d.get('brokers', [])
        if not isinstance(br, list) or not br:
            fail(f'{p}: brokers is not a non-empty list')
            continue
        bad = [b.get('code') for b in br if str(b.get('code')) in LICENSED_EXCLUDED]
        if bad:
            fail(f'{p}: excluded/defunct broker codes present: {bad}')
        tb = sum(b.get('buy_value') or 0 for b in br)
        ts = sum(b.get('sell_value') or 0 for b in br)
        if abs(tb - ts) > 0.01:
            fail(f'{p}: buy/sell imbalance buy={tb:,.2f} sell={ts:,.2f}')
        else:
            info(f'{p}: {len(br)} brokers, buy==sell Rs {tb:,.2f}')
        if not isinstance(d.get('symbols'), dict) or not d['symbols']:
            fail(f'{p}: symbols missing/empty')
        if not isinstance(d.get('accumulation'), list) or not isinstance(d.get('distribution'), list):
            fail(f'{p}: accumulation/distribution missing')
        if d.get('from', '') > d.get('to', ''):
            fail(f'{p}: from > to')
    if os.path.exists(os.path.join(data, 'periods', '2D.json')):
        warn('orphan period file 2D.json exists but no period pill offers it')
    if meta.get('latest') == d1.get('to'):
        info(f"meta.latest == 1D.to ({meta.get('latest')})")
    else:
        fail(f"meta.latest {meta.get('latest')} != 1D.to {d1.get('to')}")
    if meta.get('earliest') == '2026-07-15':
        info('meta.earliest 2026-07-15 (broker history start)')

    # ---- provisional file ----
    prov = load(os.path.join(data, 'intraday-provisional.json'))
    if prov.get('provisional') is not True:
        fail('provisional file: provisional flag is not true')
    if prov.get('symbol_only') is not True:
        fail('provisional file: symbol_only flag is not true')
    syms = prov.get('symbols', {})
    if not syms:
        fail('provisional file: no symbols')
    else:
        tot = sum((v.get('amount') or 0) for v in syms.values())
        if abs(tot - (prov.get('total_amount') or 0)) > 1.0:
            fail(f"provisional symbol amounts sum {tot:,.2f} != total_amount {prov.get('total_amount')}")
        else:
            info(f"provisional {prov.get('date')}: {len(syms)} symbols, {prov.get('source_trades')} trades, Rs {prov.get('total_amount'):,.2f}")

    # ---- daily archive gap ----
    daily_dir = os.path.join(data, 'daily')
    daily_dates = sorted(f[:-5] for f in os.listdir(daily_dir) if f.endswith('.json'))
    if daily_dates and daily_dates[-1] < (meta.get('latest') or ''):
        warn(f"daily archive ends {daily_dates[-1]} but meta.latest is {meta.get('latest')} — asof view cannot serve later sessions (period views cover them)")
    info(f'daily archive: {len(daily_dates)} files, {daily_dates[0] if daily_dates else "?"} → {daily_dates[-1] if daily_dates else "?"}')

    # ---- sector sets ----
    verdicts = load(os.path.join(root, 'nepse-chart', 'data', 'verdicts.json'))
    universe = load(os.path.join(root, 'nepse-chart', 'data', 'universe.json'))
    vset = set((verdicts.get('verdicts') or {}).keys())
    uni_entries = universe.get('symbols') or []
    uni_map = {e.get('s'): e.get('n') for e in uni_entries if isinstance(e, dict)}
    uset = set(uni_map.keys())
    if vset == uset:
        info(f'sector join: {len(vset)} verdicts symbols == {len(uset)} universe symbols')
    else:
        fail(f'verdicts/universe symbol sets differ: verdicts {len(vset)}, universe {len(uset)}')
    missing_names = [s for s in vset if not uni_map.get(s)]
    if missing_names:
        warn(f'universe names missing for: {missing_names[:5]}')

    # ---- snapshot freshness + top-5 match ----
    snap = page[page.index('<!-- SNAP-START -->'):page.index('<!-- SNAP-END -->')]
    m = re.search(r'· (\d{4}-\d{2}-\d{2}) · (\d+) trading days', snap)
    if not m:
        fail('snapshot asof line not found')
    elif m.group(1) != d1.get('to'):
        fail(f"snapshot asof {m.group(1)} != 1D.to {d1.get('to')} (re-run the baker)")
    else:
        info(f'snapshot current: {m.group(1)}, {m.group(2)} trading days')
    names = load(os.path.join(data, 'brokers.json'))
    top5 = sorted(d1['brokers'], key=lambda b: b.get('total', 0), reverse=True)[:5]
    rows = re.findall(r'<tr><td>(\d)</td><td>([^<]+)</td><td>Rs ([\d.]+) Cr</td><td>Rs ([\d.]+) Cr</td><td>([+-]?[\d.]+) Cr</td>', snap)
    if len(rows) != 5:
        fail(f'snapshot has {len(rows)} rows, expected 5')
    else:
        ok = True
        for (i, name, b, s, n), br in zip(rows, top5):
            exp = (names.get(br['code']), round(br['buy_value'] / 1e7, 1), round(br['sell_value'] / 1e7, 1), round(br['net'] / 1e7, 1))
            if (name, float(b), float(s), float(n)) != exp:
                ok = False
        if ok:
            info('snapshot top-5 matches 1D exactly (names + rounded Cr)')
        else:
            fail('snapshot top-5 does not match 1D')

    # ---- ledger consistency ----
    if ledger_path:
        led = load(ledger_path)
        if led.get('daily_end') != (daily_dates[-1] if daily_dates else None):
            fail('ledger daily_end does not match daily archive')
        else:
            info('ledger daily_end matches daily archive')
        if led.get('meta_latest') != meta.get('latest'):
            fail('ledger meta_latest does not match meta.json')
        else:
            info('ledger meta_latest matches meta.json')
        if led.get('provisional_date') != prov.get('date'):
            fail('ledger provisional_date does not match provisional file')
        else:
            info('ledger provisional_date matches provisional file')

    print(f'PASS {len(PASS)} infos, WARN {len(WARN)}, FAIL {len(FAIL)}')
    for w in WARN:
        print('  WARN:', w)
    for f in FAIL:
        print('  FAIL:', f)
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())

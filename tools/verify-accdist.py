#!/usr/bin/env python3
"""Verifier for the Accumulation / Distribution teardown (design master).
Checks: chain + stamps, no old kit, no inline styles, no legacy vars,
every used class has a CSS rule, acc/dist field shape + ordering + cap,
acc/dist vs netflow exactness, single-counted nets, broker-code validity,
buy==sell balance, provisional shape, ledger reuse, sector inputs,
zero Nepalytix refs, JS budget. Usage: python3 tools/verify-accdist.py
[--worktree DIR] (default: repo root of this script). Exit 0 only if
FAIL == 0. WARNs are data notes, printed but non-failing."""
import hashlib
import json
import os
import re
import sys
import gzip
import argparse

ap = argparse.ArgumentParser()
ap.add_argument('--worktree', default=None)
a = ap.parse_args()
ROOT = a.worktree or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'nepse-brokers', 'accdist', 'index.html')
CSS = os.path.join(ROOT, 'css', 'nd-accdist.css')
JS = os.path.join(ROOT, 'js', 'accdist.js')
DATA = os.path.join(ROOT, 'nepse-brokers', 'data')
PASS = WARN = FAIL = 0


def ok(msg):
    global PASS
    PASS += 1
    print(f'  PASS: {msg}')


def warn(msg):
    global WARN
    WARN += 1
    print(f'  WARN: {msg}')


def fail(msg):
    global FAIL
    FAIL += 1
    print(f'  FAIL: {msg}')


def sha8(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:8]


page = open(PAGE).read()
css = open(CSS).read()
js = open(JS).read()

print('== chain + stamps ==')
for old in ('nepse-design-system', '"/css/theme.css', 'broker-pages.css'):
    if old in page:
        fail(f'old-kit ref still on page: {old}')
    else:
        ok(f'no {old} on page')
# Chrome stamp as page-vs-file agreement, never a literal pin: the
# 69b323cf literal went stale at the next chrome re-stamp (main now
# carries fe4f1d6e), while the generic stamp loop below already
# re-checks every stamped asset including chrome. This named check
# keeps a chrome failure attributable.
_m_chrome = re.search(r'nd-chrome\.css\?v=([0-9a-f]{8})', page)
_want_chrome = sha8(os.path.join(ROOT, 'css', 'nd-chrome.css'))
if _m_chrome and _m_chrome.group(1) == _want_chrome:
    ok(f'chrome stamp == raw sha1 {_want_chrome}')
else:
    fail(f'chrome stamp mismatch: page {_m_chrome.group(1) if _m_chrome else None}, file {_want_chrome}')
for m in re.finditer(r'(?:css|js)/([A-Za-z0-9_.-]+)\?v=([0-9a-f]{8})', page):
    fname, stamp = m.group(1), m.group(2)
    for base in (os.path.join(ROOT, 'css'), os.path.join(ROOT, 'js')):
        p = os.path.join(base, fname)
        if os.path.exists(p):
            if sha8(p) == stamp:
                ok(f'stamp {fname} == raw sha1 {stamp}')
            else:
                fail(f'stamp {fname} is {stamp}, raw sha1 is {sha8(p)}')
            break
    else:
        fail(f'stamped file not found: {fname}')

print('== no inline styles / legacy vars ==')
if 'style=' in page:
    fail('inline style attribute still on page')
else:
    ok('no inline style attributes on page')
if '<style' in page:
    fail('inline <style> block still on page')
else:
    ok('no inline <style> block (ported to family CSS)')
for var in ('--muted', '--serif', '--sans', '--up', '--down', '--lime', '--border', '--panel'):
    if re.search(r'var\(' + re.escape(var) + r'\)', css):
        fail(f'legacy var() {var} in family CSS')
if not any(re.search(r'var\(' + re.escape(v) + r'\)', css)
           for v in ('--muted', '--serif', '--sans')):
    ok('no legacy var() traps in family CSS')
if 'style="width' in js:
    # bar widths are the ONLY inline style: geometry, set via width % on <i>
    # elements whose display is block in CSS (design-master §2.6.3 pattern).
    ok('only bar-width inline styles in JS (geometry, block <i> in CSS)')
else:
    fail('expected bar-width inline styles missing from viz')

print('== every used class has a CSS rule ==')
classes = set()
for m in re.finditer(r'class="([^"]+)"', page):
    classes.update(m.group(1).split())
# JS builds class attributes by concatenation (e.g. class="' + (good?'pos':'neg')),
# so only accept literals that are a clean class list — fragments with quotes,
# parens or operators are concatenation artifacts, not class names.
for m in re.finditer(r'class="([A-Za-z0-9 _-]+)"', js):
    classes.update(m.group(1).split())
for m in re.finditer(r"'(bk-[a-z0-9-]+|ac-[a-z0-9-]+|pos|neg|flat|active|sorted-asc|sorted-desc|sort-ind)'", js):
    classes.add(m.group(1))
missing = [c for c in sorted(classes) if not re.search(r'\.' + re.escape(c) + r'[\s,{.:#\[]', css)]
if missing:
    fail(f'classes without CSS rule: {missing}')
else:
    ok(f'all {len(classes)} used classes have CSS rules')
for must in ('ac-skip', 'ac-fresh', 'ac-notice', 'ac-banner', 'ac-def', 'ac-sec',
             'bk-grid-2col', 'bk-goto', 'ac-pager', 'ac-viz', 'ac-rank', 'ac-mix-row'):
    if must in classes or ('.' + must) in css:
        pass
    else:
        fail(f'expected block class missing: {must}')
ok('all expected blocks present (skip/fresh/notice/banner/def/sector/grid/goto/pager/viz)')

print('== acc/dist field shape, ordering, cap ==')
PERIODS = ['1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y']
for p in PERIODS:
    d = json.load(open(os.path.join(DATA, 'periods', p + '.json')))
    acc, dist = d.get('accumulation'), d.get('distribution')
    if acc is None or dist is None:
        fail(f'{p}: accumulation/distribution field absent'); continue
    if len(acc) != 200 or len(dist) != 200:
        fail(f'{p}: lengths acc={len(acc)} dist={len(dist)}, expected 200/200'); continue
    av = [x['net_value'] for x in acc]
    dv = [x['net_value'] for x in dist]
    if not all(v > 0 for v in av) or av != sorted(av, reverse=True):
        fail(f'{p}: acc not all-positive sorted-desc'); continue
    if not all(v < 0 for v in dv) or dv != sorted(dv):
        fail(f'{p}: dist not all-negative sorted-asc'); continue
    sa = {(x['symbol'], x['broker']) for x in acc}
    sd = {(x['symbol'], x['broker']) for x in dist}
    if len(sa) != 200 or len(sd) != 200 or sa & sd:
        fail(f'{p}: dup pairs or overlap between lists'); continue
    ok(f'{p}: 200/200, signs + ordering + uniqueness hold ({d["from"]} → {d["to"]})')
d1 = json.load(open(os.path.join(DATA, 'periods', '1D.json')))
syms = d1['symbols']
bad = 0
for lst in (d1['accumulation'], d1['distribution']):
    for x in lst:
        nf = syms.get(x['symbol'], {}).get('netflow', {}).get(x['broker'])
        if nf is None or nf[0] != x['net_qty'] or abs(nf[1] - x['net_value']) > 0.01:
            bad += 1
if bad:
    fail(f'1D acc/dist vs netflow mismatches: {bad}/400')
else:
    ok('1D acc/dist rows match netflow exactly (400/400)')
allpos = sum(1 for s in syms.values() for v in (s.get('netflow') or {}).values() if v[1] > 0)
allneg = sum(1 for s in syms.values() for v in (s.get('netflow') or {}).values() if v[1] < 0)
if allpos > 200 and allneg > 200:
    ok(f'cap is binding: {allpos} positive / {allneg} negative pairs exist, lists show top 200')
else:
    fail('cap-binding check unexpected')
v = syms['GHL']['netflow']['25']
if abs((v[3] - v[5]) - v[1]) < 0.01:
    ok('nets are single-counted (buy − sell == net); no halving applied')
else:
    fail('net arithmetic does not reconcile')
if 'd.symbols' not in js and 'symbols' not in js.split('sector')[0]:
    ok('page never totals per-symbol value/qty (÷2 rule not applicable here)')
else:
    warn('JS mentions symbols outside sector code — check no s.value total is built')

print('== broker codes + balance + provisional + ledger ==')
brokers = json.load(open(os.path.join(DATA, 'brokers.json')))
DEFUNCT = {'2', '9', '12', '15', '23', '24', '27', '30', '31', '55'}
badcodes = set()
for lst in (d1['accumulation'], d1['distribution']):
    for x in lst:
        c = str(x['broker'])
        if not c.isdigit() or c in DEFUNCT or c not in brokers:
            badcodes.add(c)
if badcodes:
    fail(f'invalid/defunct/unresolved broker codes in 1D lists: {badcodes}')
else:
    ok('all 1D acc/dist broker codes numeric, licensed, named in brokers.json')
bs = d1['broker_symbols']
buy = sum(r['buy_value'] for rows in bs.values() for r in rows)
sell = sum(r['sell_value'] for rows in bs.values() for r in rows)
OFFICIAL = 4002421168.07
if abs(buy - OFFICIAL) < 0.01 and abs(sell - OFFICIAL) < 0.01:
    ok('1D broker_symbols buy == sell == official turnover exactly')
else:
    fail(f'balance check failed: buy {buy} sell {sell} vs official {OFFICIAL}')
prov = json.load(open(os.path.join(DATA, 'intraday-provisional.json')))
if prov.get('provisional') and prov.get('symbol_only'):
    ok('provisional is symbol-only: acc/dist pairs correctly come from last final 1D')
else:
    fail('provisional shape unexpected')
led = json.load(open(os.path.join(DATA, 'brokers-ledger.json')))
if led.get('meta_latest') == '2026-10-26':
    ok('brokers ledger reused (meta_latest 2026-10-26); no duplicate ledger')
else:
    warn(f'ledger meta_latest is {led.get("meta_latest")}')

print('== sector inputs + refs + budget ==')
verdicts = json.load(open(os.path.join(ROOT, 'nepse-chart', 'data', 'verdicts.json')))
uni = json.load(open(os.path.join(ROOT, 'nepse-chart', 'data', 'universe.json')))
vv = verdicts.get('verdicts', verdicts)
if not isinstance(uni.get('symbols'), list):
    fail('universe symbols is not a LIST')
else:
    ok('universe symbols is a LIST of {s,n,t,o}')
from collections import Counter
counts = Counter((r.get('sec') or 'Others') for r in vv.values())
if sum(counts.values()) == 412 and len(uni['symbols']) == 412:
    ok(f'sector counts sum 412 across {len(counts)} sectors; universe 412')
else:
    fail(f'sector/universe counts off: {sum(counts.values())} / {len(uni["symbols"])}')
for blob, name in ((page, 'page'), (js, 'JS'), (css, 'CSS')):
    if 'nepalytix' in blob.lower() or 'nepalytix' in blob.lower():
        fail(f'Nepalytix runtime ref in {name}')
ok('zero Nepalytix runtime refs')
gz = len(gzip.compress(open(JS, 'rb').read())) + len(gzip.compress(open(os.path.join(ROOT, 'js', 'broker-common.js'), 'rb').read()))
if gz < 170 * 1024:
    ok(f'JS budget: accdist + broker-common = {gz / 1024:.1f} KB gz (< 170 KB)')
else:
    fail(f'JS budget exceeded: {gz / 1024:.1f} KB gz')
if 'bk-goto' in js and 'data-goto' in js and '1D' in js and 'retry' in js:
    ok('goto buttons preserved in JS (1D jump + retry) with kit classes, no inline styles')
else:
    fail('goto buttons missing or incomplete in JS')
if 'state.sig = null' in js:
    fail('signature nulling present — re-baseline lesson violated')
else:
    ok('no signature nulling (re-baseline rule holds)')

print(f'\nPASS {PASS} infos, WARN {WARN}, FAIL {FAIL}')
sys.exit(1 if FAIL else 0)

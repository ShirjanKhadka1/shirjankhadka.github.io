#!/usr/bin/env python3
"""Verifier for the Broker Trade Pattern teardown (stdlib only).

Checks the rebuilt page chain + shared broker-common.js fix + the data
files this page actually reads. Never edits data. Exits 0 iff FAIL == 0.
Usage: python3 tools/verify-trade-pattern.py [--worktree DIR]
"""
import argparse
import gzip
import hashlib
import json
import os
import re
import sys

PASS = 0
WARN = 0
FAIL = 0


def check(name, ok, level='fail', detail=''):
    global PASS, WARN, FAIL
    if ok:
        PASS += 1
        print(f'  PASS: {name}')
    elif level == 'warn':
        WARN += 1
        print(f'  WARN: {name} ({detail})')
    else:
        FAIL += 1
        print(f'  FAIL: {name} ({detail})')


def sha1_8(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:8]


def strip_comments(js):
    js = re.sub(r'/\*.*?\*/', '', js, flags=re.S)
    js = re.sub(r'(?m)^\s*//.*$', '', js)
    return js


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--worktree', default='.')
    args = ap.parse_args()
    root = args.worktree
    page = open(os.path.join(root, 'nepse-brokers', 'trade-pattern', 'index.html')).read()
    common = open(os.path.join(root, 'js', 'broker-common.js')).read()
    tpjs = open(os.path.join(root, 'js', 'trade-pattern.js')).read()
    css = open(os.path.join(root, 'css', 'nd-trade-pattern.css')).read()

    # ---- 1. Page chain ----
    for dead in ['/css/theme.css', '/css/nepse-design-system.css', '/css/broker-pages.css']:
        check(f'no {dead} in chain', dead not in page)
    check('chrome stamp is nav fix 69b323cf', 'nd-chrome.css?v=69b323cf' in page)
    check('family css stamp = sha1', f"nd-trade-pattern.css?v={sha1_8(os.path.join(root, 'css', 'nd-trade-pattern.css'))}" in page)
    check('broker-common stamp = sha1', f"broker-common.js?v={sha1_8(os.path.join(root, 'js', 'broker-common.js'))}" in page)
    check('trade-pattern js stamp = sha1', f"trade-pattern.js?v={sha1_8(os.path.join(root, 'js', 'trade-pattern.js'))}" in page)
    check('head order tokens/fonts/editorial/cinema/chrome/family',
          page.index('nd-tokens.css') < page.index('fonts.css') < page.index('nd-editorial-theme.css')
          < page.index('nd-cinema.css') < page.index('nd-chrome.css') < page.index('nd-trade-pattern.css'))
    check('skip-link present', 'tp-skip' in page and 'href="#main"' in page and 'id="main"' in page)
    check('body data-page trade-pattern', 'data-page="trade-pattern"' in page)
    check('no inline <style>', '<style' not in page)
    inlines = re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', page, re.S)
    check('inline scripts are boots only (no fetch/setInterval)',
          all('fetch(' not in s and 'setInterval' not in s for s in inlines)
          and sum(len(s) for s in inlines) < 1000)
    pills = re.findall(r'data-p="([^"]+)"', page)
    check('period pills = full set', pills == ['latest', '1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y'], str(pills))
    for mount in ['tpFresh', 'tpNotice', 'tpBanner', 'tpSecSelect', 'tpSecBody', 'tpSecPrev', 'tpSecNext', 'tpSecShowing', 'tpSecSum']:
        check(f'mount {mount} present', f'id="{mount}"' in page)
    for legacy in ['--serif', '--muted', '--card', '--hairline', '--green-900']:
        # Match whole var() references only: var(--nd-muted) must NOT trip --muted.
        check(f'no legacy var {legacy} in page/css',
              f'var({legacy})' not in page and f'var({legacy})' not in css)
    note = re.search(r'<p class="bk-note">(.*?)</p>', page, re.S)
    check('footer law not hand-duplicated in note',
          note is not None and 'Not investment advice' not in note.group(1))
    check('no Nepalytix refs', 'nepalytix' not in page.lower() and 'nepalytix' not in tpjs.lower()
          and 'nepalytix' not in css.lower())

    # ---- 2. Shared broker-common.js: fix + interface ----
    code = strip_comments(common)
    check('common fetches intraday-provisional.json', 'intraday-provisional.json' in code)
    check('common no longer fetches intraday.json', 'intraday.json' not in code)
    check('common loadPeriod signature unchanged', 'function loadPeriod(p, asof)' in code)
    for fn in ['BASE', 'fmtN', 'fmtV', 'fmtQ', 'esc', 'cls', 'loadMeta', 'loadBrokers', 'loadPeriod', 'label', 'makeSortable']:
        check(f'common public interface keeps {fn}', fn in code)
    check('common label() untouched (live-today string)', "live today" in code)
    check('common provisional fallback keeps _fallback flag', '_fallback: true' in code)
    check('common adds _provState/_provAsOf', '_provState' in code and '_provAsOf' in code)
    check('trade-pattern js uses esc() on injected strings', 'BC.esc(' in tpjs)
    check('trade-pattern js 60s tick', 'setInterval(tick, 60000)' in tpjs)
    check('trade-pattern js change-gate (signature compare)', 'signature(' in tpjs and 'changed' in tpjs)
    check('trade-pattern js no off-DB fetches',
          all(u.startswith('/nepse-chart/data/') or u.startswith('/nepse-brokers/data/')
              for u in re.findall(r"fetch\('([^']+)'", tpjs)))
    gz = len(gzip.compress(tpjs.encode())) + len(gzip.compress(common.encode()))
    check('page js gz budget (170KB)', gz < 170 * 1024, f'{gz} bytes')

    # ---- 3. Data this page reads ----
    data = os.path.join(root, 'nepse-brokers', 'data')
    for p in ['1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y']:
        check(f'period file {p}.json present', os.path.exists(os.path.join(data, 'periods', p + '.json')))
    check('orphan 2D.json not offered (data note only)', not os.path.exists(os.path.join(data, 'periods', '2D.json'))
          or '2D' not in pills, level='warn', detail='orphan 2D.json exists but no pill offers it')
    d1 = json.load(open(os.path.join(data, 'periods', '1D.json')))
    buy = sum(b.get('buy_value') or 0 for b in d1['brokers'])
    sell = sum(b.get('sell_value') or 0 for b in d1['brokers'])
    check('1D buy == sell balance', abs(buy - sell) < 0.01, f'{buy} vs {sell}')
    excluded = {'2', '9', '12', '15', '23', '24', '27', '30', '31', '55'}
    codes = {b['code'] for b in d1['brokers']}
    check('1D codes numeric + licensed', all(re.fullmatch(r'\d+', c) for c in codes) and not (codes & excluded))
    check('1D broker_symbols keys == broker codes', set(d1.get('broker_symbols', {}).keys()) == codes)
    check('1D codes include 92-101', {'92', '93', '94', '95', '96', '97', '98', '99', '100', '101'} <= codes)
    prov = json.load(open(os.path.join(data, 'intraday-provisional.json')))
    check('provisional is symbol-only', prov.get('symbol_only') is True)
    tot = sum(v.get('amount') or 0 for v in prov.get('symbols', {}).values())
    check('provisional symbol-sum == total_amount', abs(tot - (prov.get('total_amount') or 0)) < 0.01,
          f'{tot} vs {prov.get("total_amount")}')
    led_path = os.path.join(data, 'brokers-ledger.json')
    check('brokers ledger exists (reused, not duplicated)', os.path.exists(led_path))
    if os.path.exists(led_path):
        led = json.load(open(led_path))
        check('ledger provisional asof == live provisional asof',
              led.get('provisional_asof') == prov.get('asof'),
              f"{led.get('provisional_asof')} vs {prov.get('asof')}")
        check('ledger provisional state sane',
              led.get('provisional_state') in ('final-published', 'provisional', None))
    v = json.load(open(os.path.join(root, 'nepse-chart', 'data', 'verdicts.json')))
    u = json.load(open(os.path.join(root, 'nepse-chart', 'data', 'universe.json')))
    syms = u.get('symbols', [])
    check('universe symbols is a LIST of {s,n,...}', isinstance(syms, list) and syms
          and all('s' in s and 'n' in s for s in syms[:5]))
    check('verdicts == universe sets (412)', set(v['verdicts'].keys()) == {s['s'] for s in syms}
          and len(syms) == 412, f'{len(syms)} symbols')
    secs = {r.get('sec') for r in v['verdicts'].values() if r.get('sec')}
    check('15 sectors', len(secs) == 15, str(sorted(secs)))

    print(f'PASS {PASS} infos, WARN {WARN}, FAIL {FAIL}')
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

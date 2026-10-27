#!/usr/bin/env python3
"""Verifier for the Broker Zero-Sum teardown (2026-10-27).
Runs against a worktree root (default: this script's parent dir's parent).
Exit 0 only when every PASS holds; WARNs are data notes, FAILs block deploy.
"""
import gzip, hashlib, json, math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'nepse-broker-zero-sum/index.html')
FAM = os.path.join(ROOT, 'css/nd-zero-sum.css')
JS = os.path.join(ROOT, 'js/zero-sum.js')
PASS, WARN, FAIL = [], [], []

def ok(name, cond, detail=''):
    (PASS if cond else FAIL).append(name + ((' :: ' + detail) if detail and not cond else ''))
def warn(name, detail=''):
    WARN.append(name + ((' :: ' + detail) if detail else ''))

def sha8(p):
    with open(p, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:8]

def loadj(p):
    with open(p) as f:
        return json.load(f)

def main():
    html = open(PAGE).read()
    fam = open(FAM).read()
    js = open(JS).read()
    cinema = open(os.path.join(ROOT, 'css/nd-cinema.css')).read()
    chrome = open(os.path.join(ROOT, 'css/nd-chrome.css')).read()
    tokens = open(os.path.join(ROOT, 'css/nd-tokens.css')).read()
    editorial = open(os.path.join(ROOT, 'css/nd-editorial-theme.css')).read()

    # 1. Stamps == raw SHA-1 first-8
    for label, path, expect in [
        ('editorial', 'css/nd-editorial-theme.css', 'b875f30d'),
        ('cinema', 'css/nd-cinema.css', '857a8acb'),
        ('chrome-css', 'css/nd-chrome.css', '69b323cf'),
        ('family-css', 'css/nd-zero-sum.css', None),
        ('nd-chrome-js', 'js/nd-chrome.js', '74c1c8b7'),
        ('freshness-badge', 'js/freshness-badge.js', '9b77cf10'),
        ('zero-sum-js', 'js/zero-sum.js', None),
    ]:
        got = sha8(os.path.join(ROOT, path))
        pin = re.search(re.escape(path.split('/')[-1]) + r'\?v=([0-9a-f]{8})', html)
        ok('stamp:' + label, pin and pin.group(1) == got,
           'page pins %s, file hashes %s' % (pin.group(1) if pin else None, got))
        if expect:
            ok('stamp-expected:' + label, got == expect, 'got %s want %s' % (got, expect))

    # 2. No old-kit refs (theme.css matched as a standalone filename, so
    # nd-editorial-theme.css does not false-positive)
    for bad in ['nepse-design-system', 'broker-pages.css', 'broker-common.js']:
        ok('no-old-kit:' + bad, bad not in html and bad not in js, 'found in page/js')
    ok('no-old-kit:theme.css', re.search(r'(?<![\w-])theme\.css', html) is None
       and re.search(r'(?<![\w-])theme\.css', js) is None, 'standalone theme.css referenced')
    ok('chrome-defer', 'nd-chrome.js?v=' in html and re.search(r'nd-chrome\.js\?v=[0-9a-f]+\" defer', html) is not None, 'nd-chrome script tag lacks defer')

    # 3. No legacy vars / hardcoded colours in family CSS; tokens defined
    defined = set(re.findall(r'--([a-z0-9-]+)\s*:', tokens))
    used = set(re.findall(r'var\(--([a-z0-9-]+)', fam))
    ok('family-tokens-defined', used <= defined, 'undefined: %s' % sorted(used - defined))
    ok('family-no-hardcoded-hex', re.search(r'#[0-9a-fA-F]{3,8}\b', fam) is None, 'hex colour in family CSS')
    ok('no-border-2', '--nd-border-2' not in fam and '--nd-border-2' not in js, 'stale token still referenced')
    ok('no-inline-style-html', 'style="' not in html, 'inline style in HTML')
    ok('no-style-block-html', '<style' not in html, '<style> block in HTML')

    # 4. Class coverage: HTML classes + JS-emitted zs-/cx-/num classes must have a rule.
    # JS builds class strings by concatenation, so extract word tokens, not
    # whole class="..." attribute values (those capture expression fragments).
    css_all = fam + cinema + chrome
    html_classes = set()
    for m in re.finditer(r'class="([^"]+)"', html):
        html_classes |= set(m.group(1).split())
    js_classes = set(re.findall(r'\b(zs-[a-z0-9-]+|cx-[a-z0-9-]+)\b', js))
    if '"num' in js or "'num" in js or 'class="num' in js:
        js_classes.add('num')
    missing = []
    for c in sorted(html_classes | js_classes):
        if c == 'on':
            continue  # active tab styled via kit button[aria-pressed="true"]; 'on' is a marker only
        if not re.search(r'\.' + re.escape(c) + r'(?![a-z0-9-])', css_all):
            missing.append(c)
    ok('class-coverage', not missing, 'no rule for: %s' % missing)

    # 5. Structural elements
    for el in ['zsFresh', 'zsNotice', 'boardPager', 'holdPager', 'distPager',
               'sector', 'zsSecSelect', 'zsSecBody', 'zsSecPager', 'zsSecSum',
               'skip-link', 'main', 'symSel', 'symSearch', 'winTabs']:
        ok('element:' + el, ('id="%s"' % el) in html or ('class="skip-link"' in html and el == 'skip-link'),
           'missing id/class ' + el)
    ok('canvas-pin', 'body.nd[data-page="broker-zero-sum"]' in fam and 'var(--nd-bg)' in fam,
       'theme-scoped canvas pin missing')
    ok('fetch-token', 'v=20261027a' in js, 'data fetch token not bumped')
    ok('change-gate', 'setInterval(tick, 60000)' in js and 'STATE.sig' in js and 'document.hidden' in js,
       'change-gated refresh not present')
    ok('rebaseline', 're-baseline' in js or 're-baseline' in open(JS).read() or 'STATE.sig = signature(STATE.data)' in js,
       'view-change re-baseline missing')
    ok('gz-size', len(gzip.compress(open(JS, 'rb').read(), compresslevel=9)) <= 170 * 1024,
       'zero-sum.js gz %d bytes' % len(gzip.compress(open(JS, 'rb').read(), compresslevel=9)))

    # 6. Data files
    windows = [1, 7, 15, 30, 90, 180, 365]
    datas = {}
    for w in windows:
        p = os.path.join(ROOT, 'data/broker-zero-sum-%d.json' % w)
        ok('window-file:%d' % w, os.path.exists(p), 'missing')
        if not os.path.exists(p):
            continue
        d = loadj(p)
        datas[w] = d
        ok('schema:%d' % w, d.get('schema') == 'nd-broker-zero-sum/v1', str(d.get('schema')))
        m = d['market']
        ok('identity-qty:%d' % w, m['total_buy_qty'] == m['total_sell_qty'],
           '%s vs %s' % (m['total_buy_qty'], m['total_sell_qty']))
        ok('identity-amt:%d' % w, abs(m['total_turnover'] - m.get('total_sell_amt', m['total_turnover'])) < 0.01
           if 'total_sell_amt' in m else True, 'market has no sell total field; buy==sell checked at symbol level below')
        # symbol-level identity: summary buy==sell qty+amt
        bad = [s for s, r in d['symbols'].items()
               if r['summary']['total_buy_qty'] != r['summary']['total_sell_qty']
               or abs(r['summary']['total_buy_amt'] - r['summary']['total_sell_amt']) > 0.01]
        ok('symbol-identity:%d' % w, not bad, 'mismatched: %s' % bad[:5])
        # stance == sign(net_q)
        bad = [s for s, r in d['symbols'].items()
               if (r['net_qty'] > 0 and r['stance'] != 'ACCUMULATING')
               or (r['net_qty'] < 0 and r['stance'] != 'DISTRIBUTING')
               or (r['net_qty'] == 0 and r['stance'] != 'FLAT')]
        ok('stance-sign:%d' % w, not bad, 'mismatched: %s' % bad[:5])
        # board sorted |net_amt| desc
        amts = [abs(r['net_amt']) for r in d['board']]
        ok('board-sort:%d' % w, amts == sorted(amts, reverse=True), 'board not sorted by |net_amt| desc')
        # board rows match symbols stance/net
        bad = [r['symbol'] for r in d['board']
               if d['symbols'][r['symbol']]['stance'] != r['stance']
               or d['symbols'][r['symbol']]['net_amt'] != r['net_amt']]
        ok('board-agrees:%d' % w, not bad, 'mismatched: %s' % bad[:5])
        # market stance counts
        cnt = {'ACCUMULATING': 0, 'DISTRIBUTING': 0, 'FLAT': 0}
        for r in d['symbols'].values():
            cnt[r['stance']] += 1
        ok('stance-counts:%d' % w, (cnt['ACCUMULATING'], cnt['DISTRIBUTING'], cnt['FLAT']) ==
           (m['accumulating'], m['distributing'], m['flat']), str(cnt))
        # forward note + spread
        f = d.get('forward') or {}
        if f:
            ok('forward-note:%d' % w, 'not a forecast' in (f.get('note') or ''), 'note lacks "not a forecast"')
            if f.get('accumulating') and f.get('distributing'):
                spread = f['accumulating']['mean_fwd_pct'] - f['distributing']['mean_fwd_pct']
                ok('forward-spread:%d' % w, abs(spread - f['spread_acc_minus_dist_pp']) <= 0.01,
                   '%s vs %s' % (spread, f['spread_acc_minus_dist_pp']))

    # cohort top-decile + buyers/sellers top-15 (full 30D, samples elsewhere)
    def cohort_check(d, label):
        bad = []
        for s, r in d['symbols'].items():
            hold = r.get('holders') or []
            dist = r.get('distributors') or []
            for side, rows, coh in (('acc', hold, r.get('accum')), ('dist', dist, r.get('dist'))):
                if not coh:
                    continue
                n = len([x for x in rows if (x[1] > 0 if side == 'acc' else x[1] < 0)])
                want_n = max(1, math.ceil(n / 10))
                if coh['count'] != want_n:
                    bad.append((s, side, 'count', coh['count'], want_n))
                    continue
                srt = sorted(rows, key=lambda x: abs(x[1]), reverse=True)[:want_n]
                if set(coh['brokers']) != set(str(x[0]) for x in srt):
                    bad.append((s, side, 'members'))
        ok('cohort-decile:' + label, not bad, str(bad[:5]))
    def top15_check(d, label):
        # Builder rule (build-broker-zero-sum.py side_rows): ALL active brokers
        # sorted by GROSS side qty desc, broker code asc on ties, capped at 15
        # — with NO zero filter, so the tail pads with zero-qty brokers when
        # fewer than 15 brokers traded that side (e.g. BENH buyers end in
        # 0-share rows). Flat brokers (net 0) appear here but in NEITHER flow
        # table, so full re-derivation from the file is impossible; verify
        # everything the file CAN prove: cap, order, qty agreement with flow
        # rows where present, and no wrongly-excluded flow broker.
        bad = []
        for s, r in d['symbols'].items():
            rows = (r.get('holders') or []) + (r.get('distributors') or [])
            by_row = {str(x[0]): x for x in rows}
            for side, key, col in (('buyers', 'buyers', 3), ('sellers', 'sellers', 4)):
                got = r.get(key) or []
                if len(got) > 15:
                    bad.append((s, side, 'len', len(got)))
                    continue
                order = [(b['qty'], int(b['broker'])) for b in got]
                if order != sorted(order, key=lambda t: (-t[0], t[1])):
                    bad.append((s, side, 'order'))
                    continue
                for b in got:
                    if b['broker'] in by_row and by_row[b['broker']][col] != b['qty']:
                        bad.append((s, side, 'qty', b['broker']))
                if len(got) == 15:
                    minq = got[-1]['qty']
                    inset = set(b['broker'] for b in got)
                    for x in rows:
                        if x[col] > minq and str(x[0]) not in inset:
                            bad.append((s, side, 'excluded', str(x[0])))
                else:
                    inset = set(b['broker'] for b in got)
                    for x in rows:
                        if x[col] > 0 and str(x[0]) not in inset:
                            bad.append((s, side, 'missing', str(x[0])))
        ok('top15:' + label, not bad, str(bad[:5]))
    if 30 in datas:
        cohort_check(datas[30], '30D-full')
        top15_check(datas[30], '30D-full')
    for w in windows:
        if w != 30 and w in datas:
            sub = {'symbols': dict(list(datas[w]['symbols'].items())[:50])}
            cohort_check(sub, '%dD-sample50' % w)

    # history ledger agreement
    hist = loadj(os.path.join(ROOT, 'data/broker-zero-sum-history.json'))
    entries = hist['entries'] if isinstance(hist, dict) else hist
    for w, d in datas.items():
        ok('history-agrees:%d' % w, d.get('history_recent') == entries,
           'window history_recent != history file')
        break  # one window suffices; all files share the ledger

    # broker codes: licensed set (1-101 minus 9 never-licensed codes) plus
    # defunct 55, which the builder keeps as a name-only dict entry — it must
    # never appear in any flow row (verified across all windows below).
    licensed = set(str(c) for c in range(1, 102)) - {'2', '9', '12', '15', '23', '24', '27', '30', '31'}
    if 30 in datas:
        codes = set(datas[30]['brokers'].keys())
        ok('broker-codes-licensed', codes <= licensed | {'55'}, 'unlicensed: %s' % sorted(codes - licensed - {'55'}))
        ok('broker-codes-numeric', all(c.isdigit() for c in codes), 'non-numeric code')
    n55 = 0
    for d in datas.values():
        for r in d['symbols'].values():
            n55 += sum(1 for row in (r.get('holders') or []) + (r.get('distributors') or [])
                       if str(row[0]) == '55')
    ok('broker-55-never-trades', n55 == 0, '%d flow rows for defunct 55' % n55)

    # 1D anchor vs Oct-16 eod archive
    eod = loadj(os.path.expanduser('~/workspace/nepse-data-archive/eod/eod-2026-10-16.json'))
    ms = {row['detail']: row['value'] for row in eod['market_summary']}
    if 1 in datas:
        m1 = datas[1]['market']
        ok('anchor-turnover', abs(m1['total_turnover'] - ms['Total Turnover Rs:']) < 0.01,
           '%s vs %s' % (m1['total_turnover'], ms['Total Turnover Rs:']))
        ok('anchor-shares', m1['total_buy_qty'] == ms['Total Traded Shares'],
           '%s vs %s' % (m1['total_buy_qty'], ms['Total Traded Shares']))
        ok('anchor-scrips', m1['symbols_traded'] == ms['Total Scrips Traded'],
           '%s vs %s' % (m1['symbols_traded'], ms['Total Scrips Traded']))

    # sector block inputs
    vpath = os.path.join(ROOT, 'nepse-chart/data/verdicts.json')
    upath = os.path.join(ROOT, 'nepse-chart/data/universe.json')
    if os.path.exists(vpath) and os.path.exists(upath):
        v = loadj(vpath); u = loadj(upath)
        secs = {}
        for row in (v.get('verdicts') or {}).values():
            secs[row.get('sec') or 'Others'] = secs.get(row.get('sec') or 'Others', 0) + 1
        ok('sector-sum-412', sum(secs.values()) == 412, 'sum %d' % sum(secs.values()))
        ok('universe-412', len(u.get('symbols') or []) == 412, 'universe %d' % len(u.get('symbols') or []))
        ok('universe-list-shape', isinstance(u.get('symbols'), list) and all(
            set(e.keys()) >= {'s', 'n'} for e in (u.get('symbols') or [])), 'universe entries not {s,n,...}')
        ok('sector-count-15', len(secs) == 15, 'sectors %d' % len(secs))
    else:
        warn('sector-inputs', 'verdicts/universe not in worktree; sector block verified at QA render instead')

    print('PASS %d / WARN %d / FAIL %d' % (len(PASS), len(WARN), len(FAIL)))
    for x in WARN:
        print('WARN: ' + x)
    for x in FAIL:
        print('FAIL: ' + x)
    return 1 if FAIL else 0

if __name__ == '__main__':
    sys.exit(main())

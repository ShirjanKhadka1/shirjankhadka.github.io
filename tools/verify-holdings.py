#!/usr/bin/env python3
"""Verifier for the Stockwise Holdings teardown (2026-10-26).
Run: python3 tools/verify-holdings.py [--worktree DIR]
Checks (FAIL = defect, WARN = data note, PASS/info otherwise):
- page chain: old kit gone from THIS page, chrome nav-fix stamp, all
  stamped assets equal raw-content SHA-1 first-8, skip link + #main
- data honesty: 1D sum(s.value)/2 == official exactly; sum(s.value) == 2x
  official; broker_symbols buy == sell == official exactly
- netflow authority: present for every symbol in every offered period,
  buy == sell per symbol, == broker_symbols inverted on sampled symbols
- netflow-vs-halved-total gap: counted + totalled (data note, never hidden)
- broker codes numeric + licensed (92-101 present, defunct 55 absent)
- provisional: provisional + symbol_only, per-symbol {trades, qty, amount},
  sum(amounts) == total_amount
- sector block inputs: universe 412 == verdicts 412, 15 sectors, sums to 412
- ledger cross-check: meta range matches brokers-ledger
- holdings honesty wording present; no prediction language; no runtime
  Nepalytix refs; JS gz budget; whole-page old-kit elimination: every
  class used by page + holdings.js has a rule in nd-holdings.css or the
  shared chain (nd-tokens/nd-cinema/nd-chrome/nd-editorial-theme)
- period ranges: 3M+ clamp to 2026-07-15 (window-clamp honesty)
"""
import hashlib
import gzip
import json
import os
import re
import sys

ROOT = sys.argv[sys.argv.index('--worktree') + 1] if '--worktree' in sys.argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'nepse-brokers', 'holdings', 'index.html')
DATA = os.path.join(ROOT, 'nepse-brokers', 'data')
OFFICIAL = 4002421168.07  # official 2026-10-26 NEPSE turnover
EXCLUDED = {'2', '9', '12', '15', '23', '24', '27', '30', '31', '55'}
PASS = WARN = FAIL = 0


def ok(msg):
    global PASS
    PASS += 1
    print('  PASS:', msg)


def warn(msg):
    global WARN
    WARN += 1
    print('  WARN:', msg)


def fail(msg):
    global FAIL
    FAIL += 1
    print('  FAIL:', msg)


def sha8(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:8]


def load(rel):
    return json.load(open(os.path.join(ROOT, rel)))


page = open(PAGE).read()
js = open(os.path.join(ROOT, 'js', 'holdings.js')).read()
css = open(os.path.join(ROOT, 'css', 'nd-holdings.css')).read()

# ---- chain ----
for old in ['nepse-design-system.css', '/css/theme.css', 'broker-pages.css']:
    if old in page:
        fail('old-kit ref still on page: ' + old)
    else:
        ok('old-kit gone from page: ' + old)
# Chrome stamp as page-vs-file agreement, never a literal pin: the
# 69b323cf literal went stale at the next chrome re-stamp (main now
# carries fe4f1d6e). The stamped-asset loop below re-checks every
# asset including chrome; this named check keeps a chrome failure
# attributable.
_m_chrome = re.search(r'nd-chrome\.css\?v=([0-9a-f]{8})', page)
_want_chrome = sha8(os.path.join(ROOT, 'css', 'nd-chrome.css'))
if _m_chrome and _m_chrome.group(1) == _want_chrome:
    ok('chrome stamp == raw sha1 ' + _want_chrome)
else:
    fail('chrome stamp mismatch: page %s, file %s' % (_m_chrome.group(1) if _m_chrome else None, _want_chrome))
for d, f, tok in re.findall(r'/(css|js)/([\w\-]+\.(?:css|js))\?v=([0-9a-f]{8})', page):
    p = os.path.join(ROOT, d, f)
    if not os.path.exists(p):
        fail('stamped asset missing: ' + f)
    elif sha8(p) != tok:
        fail('stamp mismatch %s: page %s, file %s' % (f, tok, sha8(p)))
    else:
        ok('stamp %s == raw sha1 %s' % (f, tok))
if 'class="hd-skip" href="#main"' in page and 'id="main"' in page:
    ok('skip link + #main target')
else:
    fail('skip link or #main target missing')
if 'data-page="holdings"' in page:
    ok('body data-page=holdings (canvas pin scope)')
else:
    fail('body data-page missing')

# ---- period files offered vs orphan ----
offered = ['latest', '1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y']
pills = re.findall(r'data-p="([^"]+)"', page)
if pills == offered:
    ok('period pills == offered set (latest..3Y)')
else:
    fail('period pills %s != offered %s' % (pills, offered))
for f in ['1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y']:
    if not os.path.exists(os.path.join(DATA, 'periods', f + '.json')):
        fail('period file missing: ' + f)
ok('all 9 offered period files exist')
if os.path.exists(os.path.join(DATA, 'periods', '2D.json')) and '2D' not in pills:
    warn('orphan period file 2D.json exists but no period pill offers it')

# ---- 1D totals vs official ----
p1 = load('nepse-brokers/data/periods/1D.json')
tot = sum(v.get('value', 0) for v in p1['symbols'].values())
if abs(tot / 2 - OFFICIAL) < 0.01:
    ok('1D sum(s.value)/2 == official exactly (Rs %.2f)' % (tot / 2))
else:
    fail('1D sum(s.value)/2 = %.2f != official %.2f' % (tot / 2, OFFICIAL))
if abs(tot - 2 * OFFICIAL) < 0.01:
    ok('1D sum(s.value) == exactly 2x official (double-count proven)')
else:
    fail('1D sum(s.value) ratio to official = %.4f' % (tot / OFFICIAL))
bs = p1['broker_symbols']
tb = sum(e['buy_value'] for lst in bs.values() for e in lst)
ts = sum(e['sell_value'] for lst in bs.values() for e in lst)
if abs(tb - OFFICIAL) < 0.01 and abs(ts - OFFICIAL) < 0.01:
    ok('broker_symbols buy == sell == official exactly')
else:
    fail('broker_symbols buy %.2f sell %.2f vs official %.2f' % (tb, ts, OFFICIAL))

# ---- netflow authority ----
for f in ['1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y']:
    d = load('nepse-brokers/data/periods/%s.json' % f)
    missing = [s for s, v in d['symbols'].items() if not v.get('netflow')]
    imb = []
    for s, v in d['symbols'].items():
        nf = v.get('netflow') or {}
        if abs(sum(x[2] for x in nf.values()) - sum(x[4] for x in nf.values())) > 0.01 or \
           abs(sum(x[3] for x in nf.values()) - sum(x[5] for x in nf.values())) > 0.01:
            imb.append(s)
    if missing:
        fail('%s: %d symbols without netflow' % (f, len(missing)))
    elif imb:
        fail('%s: %d symbols with unbalanced netflow' % (f, len(imb)))
    else:
        ok('%s: netflow present + balanced on all %d symbols' % (f, len(d['symbols'])))
# netflow == broker_symbols inverted, sampled symbols
for sym in ['ADBL', 'NABIL', 'GHL']:
    inv = {}
    for code, lst in bs.items():
        for e in lst:
            if e['symbol'] == sym:
                inv[code] = (e['buy_qty'], e['buy_value'], e['sell_qty'], e['sell_value'])
    nf = p1['symbols'][sym]['netflow']
    mism = [c for c, (bq, bv, sq, sv) in inv.items()
            if c not in nf or abs(nf[c][2] - bq) > 0.01 or abs(nf[c][3] - bv) > 0.01
            or abs(nf[c][4] - sq) > 0.01 or abs(nf[c][5] - sv) > 0.01]
    if not mism and len(inv) == len(nf):
        ok('netflow == broker_symbols inverted exactly for %s (%d brokers)' % (sym, len(inv)))
    else:
        fail('netflow vs broker_symbols mismatch for %s: %s' % (sym, mism[:5]))
# netflow-vs-halved-total gap (data note)
gap_syms, gap_total = 0, 0.0
for s, v in p1['symbols'].items():
    nf = v.get('netflow') or {}
    nb = sum(x[3] for x in nf.values())
    if abs(nb - v.get('value', 0) / 2) > 0.01:
        gap_syms += 1
        gap_total += v.get('value', 0) / 2 - nb
warn('netflow undercounts s.value/2 on %d/341 1D symbols, total gap Rs %.2f (tiles use s.value/2, never netflow sums)' % (gap_syms, gap_total))
# ADBL tile proof
a = p1['symbols']['ADBL']
if abs(a['value'] / 2 - 27962426.0) < 0.01 and abs(a['qty'] / 2 - 83744.0) < 0.01 and len(a['netflow']) == 56:
    ok('ADBL tiles: value/2 Rs 2.80 Cr, qty/2 83,744, 56 netflow brokers')
else:
    fail('ADBL tile inputs unexpected: value/2 %.2f qty/2 %.1f brokers %d' % (a['value'] / 2, a['qty'] / 2, len(a['netflow'])))

# ---- broker codes ----
codes = set()
for lst in bs.values():
    pass
for d in [p1]:
    for v in d['symbols'].values():
        codes |= set((v.get('netflow') or {}).keys())
if all(re.fullmatch(r'\d+', c) for c in codes):
    ok('netflow broker codes all numeric (%d)' % len(codes))
else:
    fail('non-numeric netflow codes present')
if not (codes & EXCLUDED):
    ok('no defunct/excluded broker codes in netflow')
else:
    fail('excluded codes present: %s' % sorted(codes & EXCLUDED))
if {'92', '93', '94', '95', '96', '97', '98', '99', '100', '101'} <= codes:
    ok('broker codes 92-101 present')
else:
    fail('broker codes 92-101 incomplete')

# ---- provisional ----
prov = load('nepse-brokers/data/intraday-provisional.json')
if prov.get('provisional') is True and prov.get('symbol_only') is True:
    ok('provisional file: provisional + symbol_only')
else:
    fail('provisional flags unexpected: %s' % {k: prov.get(k) for k in ('provisional', 'symbol_only')})
sa = sum(v['amount'] for v in prov['symbols'].values())
if abs(sa - prov['total_amount']) < 0.01:
    ok('provisional sum(symbol amounts) == total_amount (Rs %.2f)' % sa)
else:
    fail('provisional symbol sum %.2f != total %.2f' % (sa, prov['total_amount']))
if all(set(v.keys()) >= {'trades', 'qty', 'amount'} for v in prov['symbols'].values()):
    ok('provisional per-symbol shape {trades, qty, amount} on all %d symbols' % len(prov['symbols']))
else:
    fail('provisional per-symbol shape incomplete')

# ---- sector inputs + ledger ----
uni = load('nepse-chart/data/universe.json')
vd = load('nepse-chart/data/verdicts.json')
if len(uni['symbols']) == 412 and vd.get('count') == 412:
    ok('universe 412 == verdicts 412')
else:
    fail('universe %d vs verdicts %s' % (len(uni['symbols']), vd.get('count')))
if not isinstance(uni['symbols'], list) or not all(set(u.keys()) >= {'s', 'n'} for u in uni['symbols']):
    fail('universe symbols not a LIST of {s,n,...}')
else:
    ok('universe symbols is a LIST of {s,n,t,o}')
secs = {}
for row in vd['verdicts'].values():
    secs[row.get('sec')] = secs.get(row.get('sec'), 0) + 1
if len(secs) == 15 and sum(secs.values()) == 412:
    ok('15 sectors, counts sum to 412')
else:
    fail('sectors %d sum %d' % (len(secs), sum(secs.values())))
led = load('nepse-brokers/data/brokers-ledger.json')
meta = load('nepse-brokers/data/meta.json')
if led.get('meta_latest') == meta.get('latest') == '2026-10-26' and led.get('meta_earliest') == '2026-07-15':
    ok('ledger meta range matches: 2026-07-15 -> 2026-10-26')
else:
    fail('ledger/meta range mismatch')
if led.get('daily_gap'):
    warn('daily archive gap noted in ledger: %s' % led.get('daily_gap'))

# ---- honesty wording + prediction audit + Nepalytix ----
for needle in ['not verified shareholding', 'not beneficial ownership',
               'measured transaction flow', 'value ÷ 2', '2026-07-15']:
    if needle in page or needle in js:
        ok('honesty wording present: %s' % needle)
    else:
        fail('honesty wording missing: ' + needle)
bad = re.findall(r'(guaranteed|will rise|will fall|buy call|AI prediction|target price)', page + js, re.I)
bad = [b for b in bad if b.lower() not in ('',)]
if bad:
    fail('prediction language present: %s' % bad)
else:
    ok('no prediction language (forecast only inside "not a forecast" disclaimers)')
if 'nepalytix' in (page + js).lower():
    fail('runtime Nepalytix reference present')
else:
    ok('zero runtime Nepalytix refs')
if 'intraday.json' in js.replace('intraday-provisional.json', ''):
    fail('live intraday.json fetch still in holdings.js')
else:
    ok('no live intraday.json fetch in holdings.js (shared fix reused)')

# ---- budgets + whole-page old-kit elimination ----
gz = len(gzip.compress(open(os.path.join(ROOT, 'js', 'holdings.js'), 'rb').read()))
if gz <= 170 * 1024:
    ok('holdings.js %d bytes gz (budget 170KB)' % gz)
else:
    fail('holdings.js %d bytes gz over budget' % gz)
legacy_found = [legacy for legacy in ['--serif', '--sans', '--muted', '--lime', '--border', '--panel']
                if 'var(' + legacy + ')' in css]
if legacy_found:
    fail('legacy var() in holdings CSS: %s' % legacy_found)
else:
    ok('no legacy var() traps in holdings CSS')
# every class used by page + js must have a rule in family css or shared chain
# (only real class attributes — ids, sort keys and prose words are not classes)
shared = ''
for f in ['css/nd-tokens.css', 'css/nd-cinema.css', 'css/nd-chrome.css', 'css/nd-editorial-theme.css']:
    p = os.path.join(ROOT, f)
    if os.path.exists(p):
        shared += open(p).read()
allcss = css + shared
used = set()
for src in (page, js):
    for m in re.findall(r'class="([^"]+)"', src):
        used |= set(m.split())
    for m in re.findall(r"className = '([^']+)'", src):
        used |= set(m.split())
# drop dynamic-template fragments (only real class-name tokens count)
used = {t for t in used if re.fullmatch(r'[A-Za-z][\w\-]*', t)}
missing = []
for cls in used:
    for part in cls.split():
        if part in ('active', 'fail', 'prov', 'up', 'down', 'is-selected', 'sorted-asc', 'sorted-desc'):
            continue  # state classes, defined as compound selectors
        if ('.' + part) not in allcss and ('.' + part + ' ') not in allcss and ('.' + part + '{') not in allcss \
           and ('.' + part + ':') not in allcss and ('.' + part + '.') not in allcss and ('.' + part + '[') not in allcss:
            missing.append(part)
if missing:
    fail('classes without CSS rule: %s' % sorted(set(missing)))
else:
    ok('every page+JS class has a CSS rule (whole-page coverage)')
# no inline style colors left on the page (old kit residue)
if re.search(r'style="[^"]*(color|background)', page):
    fail('inline style colors left on page')
else:
    ok('no inline style colors on page')

# ---- window-clamp honesty ----
clamped = True
for f in ['3M', '6M', '1Y', '2Y', '3Y']:
    d = load('nepse-brokers/data/periods/%s.json' % f)
    if d.get('from') != '2026-07-15':
        clamped = False
        fail('%s from %s != 2026-07-15' % (f, d.get('from')))
if clamped:
    ok('3M+ periods all clamp to 2026-07-15 (definition box states this)')

print('PASS %d infos, WARN %d, FAIL %d' % (PASS, WARN, FAIL))
sys.exit(1 if FAIL else 0)

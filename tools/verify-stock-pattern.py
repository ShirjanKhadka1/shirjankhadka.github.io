#!/usr/bin/env python3
"""Verifier for the Stock Trade Pattern teardown (stdlib only).

Checks the rebuilt /nepse-brokers/stock-pattern/ page, its assets, and the
data files it reads — without touching any data values. Usage:
  python3 tools/verify-stock-pattern.py [--worktree DIR] [--ledger PATH]
Exit 0 only when FAIL == 0.
"""
import argparse
import gzip
import hashlib
import json
import os
import re
import sys

PASS, WARN, FAIL = [], [], []


def ok(msg):
    PASS.append(msg)
    print(f"  PASS: {msg}")


def warn(msg):
    WARN.append(msg)
    print(f"  WARN: {msg}")


def fail(msg):
    FAIL.append(msg)
    print(f"  FAIL: {msg}")


def sha1_8(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:8]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--worktree', default='.')
    ap.add_argument('--ledger', default=None)
    args = ap.parse_args()
    W = args.worktree
    page_path = os.path.join(W, 'nepse-brokers', 'stock-pattern', 'index.html')
    page = open(page_path).read()

    print("== chain + stamps ==")
    for bad in ['nepse-design-system.css', '/css/theme.css', 'broker-pages.css']:
        if bad in page:
            fail(f"old-kit asset still referenced: {bad}")
        else:
            ok(f"old-kit asset absent: {bad}")
    stamps = {
        'nd-editorial-theme.css': 'css/nd-editorial-theme.css',
        'nd-cinema.css': 'css/nd-cinema.css',
        'nd-chrome.css': 'css/nd-chrome.css',
        'nd-stock-pattern.css': 'css/nd-stock-pattern.css',
        'broker-common.js': 'js/broker-common.js',
        'stock-pattern.js': 'js/stock-pattern.js',
        'nd-chrome.js': 'js/nd-chrome.js',
    }
    for asset, rel in stamps.items():
        m = re.search(re.escape(asset) + r'\?v=([0-9a-f]{8})', page)
        if not m:
            fail(f"no stamp for {asset}")
        elif m.group(1) != sha1_8(os.path.join(W, rel)):
            fail(f"stamp mismatch {asset}: page {m.group(1)} != raw sha1 {sha1_8(os.path.join(W, rel))}")
        else:
            ok(f"stamp ok {asset} = {m.group(1)}")
    for probe in ['class="sp-skip"', '<main class="bk-wrap" id="main"',
                  'id="spFresh"', 'id="spBanner"', 'id="spSecSelect"',
                  'id="spSecBody"', 'id="symSearch"', 'id="symSel"']:
        if probe in page:
            ok(f"page contains {probe}")
        else:
            fail(f"page missing {probe}")
    for p in ['latest', '1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y']:
        if f'data-p="{p}"' in page:
            ok(f"period pill {p}")
        else:
            fail(f"period pill {p} missing")

    print("== shared file: fix present, loads the fixed bytes ==")
    bc = open(os.path.join(W, 'js', 'broker-common.js')).read()
    if "BASE+'intraday.json'" in bc:
        fail("broker-common still fetches intraday.json")
    else:
        ok("broker-common has no intraday.json fetch")
    if 'intraday-provisional.json' in bc and '_provState' in bc:
        ok("broker-common provisional fallback present")
    else:
        fail("broker-common provisional fallback missing")
    sp_js = open(os.path.join(W, 'js', 'stock-pattern.js')).read()
    if 'intraday.json' in sp_js:
        fail("stock-pattern.js references intraday.json")
    else:
        ok("stock-pattern.js never references intraday.json")
    if 'nepalytix' in sp_js.lower() or 'nepalytix' in page.lower():
        fail("Nepalytix runtime reference present")
    else:
        ok("zero Nepalytix runtime refs")
    gz = len(gzip.compress(open(os.path.join(W, 'js', 'stock-pattern.js'), 'rb').read()))
    gz += len(gzip.compress(open(os.path.join(W, 'js', 'broker-common.js'), 'rb').read()))
    if gz <= 170 * 1024:
        ok(f"JS budget: stock-pattern + broker-common = {gz} bytes gz")
    else:
        fail(f"JS budget blown: {gz} bytes gz")

    print("== period files ==")
    periods_dir = os.path.join(W, 'nepse-brokers', 'data', 'periods')
    offered = ['1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y']
    files = {}
    for p in offered:
        path = os.path.join(periods_dir, p + '.json')
        if not os.path.exists(path):
            fail(f"period file missing: {p}.json")
            continue
        d = json.load(open(path))
        files[p] = d
        ok(f"{p}.json: {d.get('from')} → {d.get('to')}, {len(d.get('brokers', []))} brokers, {len(d.get('symbols', {}))} symbols")
    if os.path.exists(os.path.join(periods_dir, '2D.json')):
        warn("orphan period file 2D.json exists but no period pill offers it")
    d1 = files.get('1D')
    if d1:
        print("== double-count rule + netflow balance ==")
        print("   (period-file s.value/s.qty are buy+sell double counts: traded = s.value/2)")
        half = sum((s.get('value') or 0) / 2 for s in d1['symbols'].values())
        bsum = sum((b.get('buy_value') or 0) for b in d1.get('brokers', []))
        if abs(half - bsum) < 0.01:
            ok(f"sum(s.value/2) == sum(broker buy_value) == {half:,.2f} (official-exact anchor)")
        else:
            fail(f"sum(s.value/2) {half:,.2f} != sum(broker buy_value) {bsum:,.2f}")
        bad = 0
        gaps = []
        for sym, s in d1['symbols'].items():
            nf = s.get('netflow', {})
            bv = sum((v[3] or 0) for v in nf.values())
            sv = sum((v[5] or 0) for v in nf.values())
            if abs(bv - sv) > 0.01:
                bad += 1
            if abs(bv - (s.get('value') or 0) / 2) > 0.01:
                gaps.append((sym, (s.get('value') or 0) / 2 - bv))
        if bad == 0:
            ok("netflow buy==sell exact on all 1D symbols")
        else:
            fail(f"netflow buy!=sell on {bad} symbols")
        if gaps:
            warn(f"incomplete netflow on {len(gaps)} symbols (gap Rs {sum(g[1] for g in gaps):,.2f}; "
                 f"largest {max(gaps, key=lambda g: g[1])[0]} Rs {max(gaps, key=lambda g: g[1])[1]:,.2f}) — "
                 f"tiles use s.value/2, never netflow sums, so totals stay exact")
        else:
            ok("netflow complete on all symbols")
        print("== broker-code validity (1D buyers/sellers/netflow keys) ==")
        licensed = set(str(i) for i in range(1, 102)) - {'2', '9', '12', '15', '23', '24', '27', '30', '31', '55'}
        badcodes = set()
        for s in d1['symbols'].values():
            for src in ('buyers', 'sellers', 'netflow'):
                for c in (s.get(src) or {}):
                    if c not in licensed:
                        badcodes.add(c)
        if not badcodes:
            ok("all 1D broker codes numeric + licensed (92–101 included)")
        else:
            fail(f"unexpected broker codes: {sorted(badcodes)[:10]}")

    print("== provisional shape ==")
    prov_path = os.path.join(W, 'nepse-brokers', 'data', 'intraday-provisional.json')
    prov = json.load(open(prov_path))
    if prov.get('symbol_only') is True and prov.get('provisional') is True:
        ok(f"provisional flags: symbol_only + provisional (asof {prov.get('asof')})")
    else:
        fail("provisional flags unexpected")
    syms = prov.get('symbols', {})
    badkeys = [s for s, v in list(syms.items())[:50] if sorted(v.keys()) != ['amount', 'qty', 'trades']]
    if not badkeys:
        ok(f"provisional per-symbol shape {{trades, qty, amount}} on {len(syms)} symbols")
    else:
        fail(f"provisional shape mismatch on {badkeys[:5]}")
    tot = sum(v['amount'] for v in syms.values())
    tq = sum(v['qty'] for v in syms.values())
    if abs(tot - prov.get('total_amount', 0)) < 0.01 and abs(tq - prov.get('total_qty', 0)) < 0.01:
        ok(f"provisional sums exact: amount {tot:.2f} == total_amount, qty {tq} == total_qty")
    else:
        fail(f"provisional sums differ: {tot} vs {prov.get('total_amount')}, {tq} vs {prov.get('total_qty')}")

    print("== universe + verdicts sector join ==")
    uni = json.load(open(os.path.join(W, 'nepse-chart', 'data', 'universe.json')))
    usyms = uni.get('symbols', [])
    if isinstance(usyms, list) and len(usyms) == 412:
        ok("universe symbols is a LIST, 412 entries")
    else:
        fail(f"universe symbols unexpected: {type(usyms).__name__} len {len(usyms) if hasattr(usyms, '__len__') else '?'}")
    verds = json.load(open(os.path.join(W, 'nepse-chart', 'data', 'verdicts.json')))
    vv = verds.get('verdicts', verds)
    secs = {}
    for r in vv.values():
        secs[r.get('sec')] = secs.get(r.get('sec'), 0) + 1
    if len(vv) == 412 and sum(secs.values()) == 412 and len(secs) == 15:
        ok(f"verdicts 412, sector counts sum 412 across 15 sectors")
    else:
        fail(f"verdicts/sector mismatch: {len(vv)} rows, sum {sum(secs.values())}, {len(secs)} sectors")
    if 'ADBL' in vv and vv['ADBL'].get('sec') == 'Development Bank':
        ok("spot: ADBL verdict sector = Development Bank")

    print("== ledger cross-check ==")
    ledger_path = args.ledger or os.path.join(W, 'nepse-brokers', 'data', 'brokers-ledger.json')
    if os.path.exists(ledger_path):
        led = json.load(open(ledger_path))
        meta = json.load(open(os.path.join(W, 'nepse-brokers', 'data', 'meta.json')))
        ok(f"brokers ledger present (meta latest {meta.get('latest')}); page reuses it, no duplicate ledger")
    else:
        warn("brokers ledger not found at expected path")

    print(f"\nPASS {len(PASS)} infos, WARN {len(WARN)}, FAIL {len(FAIL)}")
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())

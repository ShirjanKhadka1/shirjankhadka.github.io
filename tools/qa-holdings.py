#!/usr/bin/env python3
"""Playwright QA for the Stockwise Holdings teardown (2026-10-26).
Run: python3 tools/qa-holdings.py [--worktree DIR] [--port N]
Serves the worktree on localhost and asserts, per theme/viewport:
- zero console/page errors, zero document overflow
- canvas rgb matches the overview tokens (dark 10,12,16 / light 246,247,249)
- ADBL tiles + table + viz + sector block numbers match the data files
- refresh gate: unchanged tick DOM-stable; SELECTION-THEN-MUTATION tick
  re-renders with notice (the re-baseline lesson — fake clock installed
  BEFORE navigation); aborted tick keeps old view; boot failure is honest
Screenshots go to qa-shots/ (evidence only, never deployed).
"""
import json
import os
import subprocess
import sys
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial

ROOT = sys.argv[sys.argv.index('--worktree') + 1] if '--worktree' in sys.argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 8903
OUT = os.path.join(ROOT, 'qa-shots')
os.makedirs(OUT, exist_ok=True)

CHECKS = []


def check(name, ok, detail=''):
    CHECKS.append((name, ok, detail))
    print(('  PASS: ' if ok else '  FAIL: ') + name + ((' — ' + str(detail)) if detail else ''))


def serve():
    h = partial(SimpleHTTPRequestHandler, directory=ROOT)
    ThreadingHTTPServer(('127.0.0.1', PORT), h).serve_forever()


threading.Thread(target=serve, daemon=True).start()
time.sleep(1)

p1 = json.load(open(os.path.join(ROOT, 'nepse-brokers/data/periods/1D.json')))
adbl = p1['symbols']['ADBL']
nf = adbl['netflow']
top = max(nf.items(), key=lambda kv: abs(kv[1][1]))
print('ADBL truth: value/2 %.2f qty/2 %.0f brokers %d top-net %s %s' % (
    adbl['value'] / 2, adbl['qty'] / 2, len(nf), top[0], top[1][1]))

from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    def new_page(theme, width):
        ctx = browser.new_context(viewport={'width': width, 'height': 900})
        if theme == 'light':
            ctx.add_init_script("try{localStorage.setItem('sk-theme','light')}catch(e){}")
        pg = ctx.new_page()
        return ctx, pg

    def load_adbl(pg):
        pg.goto('http://127.0.0.1:%d/nepse-brokers/holdings/' % PORT, wait_until='networkidle', timeout=30000)
        pg.wait_for_function("!!document.querySelector('#symSel option[value=\"ADBL\"]')", timeout=15000)
        pg.select_option('#symSel', 'ADBL')
        pg.wait_for_selector('#hdBody tr', timeout=15000)
        pg.wait_for_timeout(1000)

    # ---------- dark 1280 ----------
    errs = []
    ctx, pg = new_page('dark', 1280)
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    load_adbl(pg)
    body = pg.inner_text('body')
    check('dark: ADBL traded value Rs 2.80 Cr', 'Rs 2.80 Cr' in body)
    check('dark: ADBL traded qty 83,744', '83,744' in body)
    check('dark: ADBL avg Rs 333.90', 'Rs 333.90' in body)
    check('dark: table Showing 1–25 of 56', 'Showing 1–25 of 56' in body)
    check('dark: top net bar is broker 29 at Rs -71.44 L', 'Rs -71.44 L' in body)
    check('dark: provisional strip present', 'PROVISIONAL — ADBL' in body and 'NOT FINAL' in body)  # inner_text renders the uppercased head
    check('dark: holdings definition visible', 'not verified shareholding' in body and 'not beneficial ownership' in body)
    check('dark: sector block 412 stocks', '412 stocks' in body)
    check('dark: sector selected-stock mark', pg.locator('#hdSecBody tr.is-selected').count() >= 1)
    check('dark: 0 console errors', not errs, errs[:2])
    check('dark: 0 document overflow', pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') == 0)
    check('dark: canvas rgb(10, 12, 16)', pg.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(10, 12, 16)',
          pg.evaluate("getComputedStyle(document.body).backgroundColor"))
    pg.screenshot(path=os.path.join(OUT, 'holdings-dark-1280.png'), full_page=True)
    ctx.close()

    # ---------- light 1280 ----------
    errs = []
    ctx, pg = new_page('light', 1280)
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    load_adbl(pg)
    body = pg.inner_text('body')
    check('light: ADBL tiles render', 'Rs 2.80 Cr' in body and '83,744' in body)
    check('light: canvas rgb(246, 247, 249)', pg.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(246, 247, 249)',
          pg.evaluate("getComputedStyle(document.body).backgroundColor"))
    check('light: 0 console errors', not errs, errs[:2])
    check('light: 0 document overflow', pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') == 0)
    pg.screenshot(path=os.path.join(OUT, 'holdings-light-1280.png'), full_page=True)
    ctx.close()

    # ---------- 390 dark ----------
    errs = []
    ctx, pg = new_page('dark', 390)
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    load_adbl(pg)
    check('390: 0 document overflow', pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') == 0)
    check('390: 0 console errors', not errs, errs[:2])
    pg.screenshot(path=os.path.join(OUT, 'holdings-dark-390.png'), full_page=True)
    ctx.close()

    # ---------- gate proofs (fake clock BEFORE navigation) ----------
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.clock.install()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:%d/nepse-brokers/holdings/' % PORT, wait_until='networkidle', timeout=30000)
    pg.wait_for_function("!!document.querySelector('#symSel option[value=\"ADBL\"]')", timeout=15000)
    pg.select_option('#symSel', 'ADBL')
    pg.wait_for_selector('#hdBody tr', timeout=15000)
    # node identity is compared IN-PAGE (evaluate cannot return DOM nodes)
    pg.evaluate('window.__probe = window.__hdTile')
    fresh0 = pg.inner_text('#hdFresh')
    pg.clock.fast_forward(61000)
    pg.wait_for_timeout(500)
    fresh1 = pg.inner_text('#hdFresh')
    check('gate: unchanged tick keeps tile node identity', pg.evaluate('window.__probe === window.__hdTile'), 'probe survived 61s fast-forward')
    check('gate: unchanged tick moves freshness line', fresh0 != fresh1, fresh1[:60])
    # selection-then-mutation: re-baseline proof (the 2026-10-26 lesson:
    # the select handler re-baselines the signature, so a data change in
    # the first tick window after a selection is NOT swallowed)
    prov = json.load(open(os.path.join(ROOT, 'nepse-brokers/data/intraday-provisional.json')))
    mutated = dict(prov)
    mutated['asof'] = '2026-10-26T15:30:00.000000+05:45'
    pg.route('**/intraday-provisional.json', lambda r: r.fulfill(json=mutated))
    pg.clock.fast_forward(61000)
    pg.wait_for_timeout(800)
    notice = pg.inner_text('#hdNotice')
    check('gate: selection-then-mutation re-renders (tile node replaced)', pg.evaluate('window.__probe !== window.__hdTile'))
    check('gate: selection-then-mutation shows update notice', 'Holdings data updated' in notice, notice)
    check('gate: mutated strip time 15:30 visible', '15:30' in pg.inner_text('body'))
    pg.unroute_all(behavior='wait')
    # aborted provisional tick: values kept, fallback banner shown
    # (load() degrades to the cached 1D fallback rather than blanking;
    # the strip disappears and the freshness line says the feed is down)
    pg.route('**/intraday-provisional.json', lambda r: r.abort())
    pg.clock.fast_forward(61000)
    pg.wait_for_timeout(800)
    body_after = pg.inner_text('body')
    check('gate: aborted tick keeps tile values', 'Rs 2.80 Cr' in body_after and 'Showing 1–25 of 56' in body_after)
    check('gate: aborted tick shows fallback banner/freshness', 'Live feed unavailable' in body_after)
    real_errs = [e for e in errs if 'ERR_FAILED' not in e]  # ERR_FAILED x2 are this test's own intentional route aborts
    check('gate: 0 real console errors through gate proofs', not real_errs, real_errs[:2])
    ctx.close()

    # ---------- boot failure ----------
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.route('**/nepse-brokers/data/**', lambda r: r.abort())
    pg.route('**/nepse-chart/data/**', lambda r: r.abort())
    pg.goto('http://127.0.0.1:%d/nepse-brokers/holdings/' % PORT, wait_until='networkidle', timeout=30000)
    pg.wait_for_timeout(2000)
    body = pg.inner_text('body')
    check('boot failure: honest empty state, never blank', 'could not be loaded' in body or 'not available' in body)
    ctx.close()

    # ---------- period switch ----------
    ctx, pg = new_page('dark', 1280)
    load_adbl(pg)
    pg.click('#bkPeriods button[data-p="1D"]')
    pg.wait_for_timeout(2000)
    check('period switch 1D: freshness shows Final range', 'Final' in pg.inner_text('#hdFresh'), pg.inner_text('#hdFresh')[:80])
    check('period switch 1D: ADBL tiles still render', 'Rs 2.80 Cr' in pg.inner_text('body'))
    ctx.close()

    browser.close()

fails = [c for c in CHECKS if not c[1]]
print('QA %d/%d checks passed' % (len(CHECKS) - len(fails), len(CHECKS)))
sys.exit(1 if fails else 0)

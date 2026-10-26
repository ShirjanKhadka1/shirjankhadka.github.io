#!/usr/bin/env python3
"""Playwright QA for the Stock Trade Pattern teardown.

Serves the worktree on localhost and asserts, per theme/viewport:
tiles + provisional strip + tables + sector block against the data files,
canvas rgb, zero console errors, zero overflow, and the change-gate proofs
(unchanged tick DOM-stable / mutated tick re-renders / aborted tick keeps
view / boot failure honest). Screenshots go to qa-shots/ (excluded from
deploy). Usage: python3 tools/qa-stock-pattern.py [--worktree DIR]
"""
import argparse
import json
import os
import subprocess
import sys
import time

ap = argparse.ArgumentParser()
ap.add_argument('--worktree', default='.')
args = ap.parse_args()
W = os.path.abspath(args.worktree)
PORT = 8911
BASE = f'http://localhost:{PORT}/nepse-brokers/stock-pattern/'

fails = []
def check(name, cond, extra=''):
    print(f"  {'PASS' if cond else 'FAIL'}: {name} {extra}")
    if not cond:
        fails.append(name)

d1 = json.load(open(os.path.join(W, 'nepse-brokers/data/periods/1D.json')))
prov = json.load(open(os.path.join(W, 'nepse-brokers/data/intraday-provisional.json')))
adbl = d1['symbols']['ADBL']
prov_adbl = prov['symbols']['ADBL']
print(f"ADBL final: value/2={adbl['value']/2:,.1f} qty/2={adbl['qty']/2:,.0f} avg={adbl['avg_rate']}")
print(f"ADBL provisional: amount={prov_adbl['amount']:,.1f} qty={prov_adbl['qty']:,.0f} trades={prov_adbl['trades']}")

srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)],
                       cwd=W, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        # ---- dark 1280: select ADBL, verify rendered figures ----
        pg = b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE, wait_until='networkidle', timeout=30000)
        pg.wait_for_timeout(2500)
        pg.locator('#symSel').select_option('ADBL')
        pg.wait_for_timeout(2000)
        body = pg.inner_text('body')
        for probe in ['Rs 2.80 Cr', '83,744', '333.90', 'Rs 2.47 Cr', '73,976',
                      '185', 'Showing 1–25 of 25', 'Showing 1–25 of 412',
                      'Provisional (as of 14:53 NPT)', 'last final 2026-10-26']:
            check(f"dark renders '{probe}'", probe in body)
        check('ADBL sector row marked selected', '●' in body)
        check('no 2x tile (Rs 5.59 Cr absent)', 'Rs 5.59 Cr' not in body)
        check('canvas dark rgb(10, 12, 16)',
              pg.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(10, 12, 16)')
        check('zero console errors', not errs, str(errs[:2]))
        check('zero overflow 1280',
              pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") == 0)
        pg.screenshot(path=os.path.join(W, 'qa-shots', 'stock-pattern-dark-1280.png'), full_page=True)

        # ---- refresh gate: unchanged tick keeps DOM, mutated re-renders ----
        # NOTE: the fake clock must be installed BEFORE navigation, otherwise
        # the page's 60s setInterval (created at load) keeps real time and
        # no tick ever fires — an earlier QA run passed the unchanged-tick
        # check vacuously for exactly this reason. Re-do it on a fresh page.
        pg.close()
        pg = b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.clock.install()
        pg.goto(BASE, wait_until='networkidle', timeout=30000)
        pg.wait_for_timeout(2500)
        pg.locator('#symSel').select_option('ADBL')
        pg.wait_for_timeout(1500)
        fresh_before = pg.inner_text('#spFresh')
        check('probe tile identity readable',
              pg.evaluate("window.__spTile === document.querySelector('.bk-tile')") is True)
        pg.clock.fast_forward(121000)
        pg.wait_for_timeout(2000)
        check('unchanged tick: tile identity survives',
              pg.evaluate("window.__spTile === document.querySelector('.bk-tile')"))
        check('unchanged tick: freshness clock advances',
              pg.inner_text('#spFresh') != fresh_before)
        check('unchanged tick: zero console errors', not errs, str(errs[:2]))
        # mutated provisional: amount +1,000,000 for ADBL.
        # The mutation route MUST be registered AFTER boot+selection: if it
        # is live at boot, boot already sees mutated values and the tick is
        # (correctly) not a change. The clock, by contrast, must be
        # installed BEFORE navigation or the page's interval keeps real time.
        mutated = json.loads(json.dumps(prov))
        mutated['symbols']['ADBL']['amount'] += 1000000
        def handle(route):
            route.fulfill(status=200, content_type='application/json', body=json.dumps(mutated))
        pg2 = b.new_page(viewport={'width': 1280, 'height': 900})
        pg2.clock.install()
        pg2.goto(BASE, wait_until='networkidle', timeout=30000)
        pg2.wait_for_timeout(2500)
        pg2.locator('#symSel').select_option('ADBL')
        pg2.wait_for_timeout(1500)
        before = pg2.inner_text('body')
        check('mutated tick: baseline is unmutated (Rs 2.47 Cr, no 2.57)',
              'Rs 2.47 Cr' in before and 'Rs 2.57 Cr' not in before)
        pg2.route('**/intraday-provisional.json', handle)
        pg2.clock.fast_forward(61000)
        pg2.wait_for_timeout(3000)
        after = pg2.inner_text('body')
        check('mutated tick: notice appears', 'Stock data updated' in after)
        check('mutated tick: provisional value moves (Rs 2.57 Cr)',
              'Rs 2.57 Cr' in after)
        pg2.close()

        # ---- aborted tick keeps old view ----
        pg3 = b.new_page(viewport={'width': 1280, 'height': 900})
        pg3.clock.install()
        pg3.goto(BASE, wait_until='networkidle', timeout=30000)
        pg3.wait_for_timeout(2500)
        pg3.locator('#symSel').select_option('ADBL')
        pg3.wait_for_timeout(1500)
        pg3.route('**/nepse-brokers/data/**', lambda r: r.abort())
        pg3.route('**/nepse-chart/data/**', lambda r: r.abort())
        pg3.clock.fast_forward(121000)
        pg3.wait_for_timeout(1500)
        b3 = pg3.inner_text('body')
        check('aborted tick: old tiles kept', 'Rs 2.80 Cr' in b3)
        # NOTE: loadPeriod absorbs a provisional abort via its cached-1D
        # fallback (in-memory periodCache), so the honest outcome is the
        # FALLBACK banner/freshness, not a failure line. True failure needs
        # the period fetch itself to reject uncached (boot-failure case).
        check('aborted tick: fallback banner shown', 'Live feed unavailable' in b3)
        pg3.close()

        # ---- boot failure: honest empty state ----
        pg4 = b.new_page(viewport={'width': 1280, 'height': 900})
        pg4.route('**/nepse-brokers/data/**', lambda r: r.abort())
        pg4.route('**/nepse-chart/data/**', lambda r: r.abort())
        pg4.goto(BASE, wait_until='networkidle', timeout=30000)
        pg4.wait_for_timeout(2500)
        b4 = pg4.inner_text('body')
        check('boot failure: honest empty state',
              ('could not be loaded' in b4 or 'not available' in b4) and 'Rs 2.80 Cr' not in b4)
        pg4.close()

        # ---- light 1280 (seeded theme, as shared chrome persists dark otherwise) ----
        pg5 = b.new_page(viewport={'width': 1280, 'height': 900})
        pg5.add_init_script("localStorage.setItem('sk-theme','light')")
        pg5.goto(BASE, wait_until='networkidle', timeout=30000)
        pg5.wait_for_timeout(2500)
        check('canvas light rgb(246, 247, 249)',
              pg5.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(246, 247, 249)')
        pg5.screenshot(path=os.path.join(W, 'qa-shots', 'stock-pattern-light-1280.png'), full_page=True)
        pg5.close()

        # ---- 390px ----
        pg6 = b.new_page(viewport={'width': 390, 'height': 844})
        pg6.goto(BASE, wait_until='networkidle', timeout=30000)
        pg6.wait_for_timeout(2500)
        pg6.locator('#symSel').select_option('ADBL')
        pg6.wait_for_timeout(1500)
        check('zero overflow 390',
              pg6.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") == 0)
        pg6.screenshot(path=os.path.join(W, 'qa-shots', 'stock-pattern-dark-390.png'), full_page=True)
        pg6.close()
        b.close()
finally:
    srv.terminate()

print(f"\nQA {'PASS' if not fails else 'FAIL'} ({len(fails)} failures: {fails})")
sys.exit(1 if fails else 0)

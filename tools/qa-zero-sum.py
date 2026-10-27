#!/usr/bin/env python3
"""Playwright QA for the Broker Zero-Sum teardown (2026-10-27).
Serves the worktree on localhost, then checks dark + light + 390px renders,
value matches against the data files, and the change-gate proofs:
  - unchanged tick: DOM stable, only the freshness line moves
  - mutated tick after a symbol selection: notice + re-render (re-baseline proof)
  - aborted tick: old view kept + failure freshness variant
  - boot failure: honest empty state, never blank
Fake clock is installed BEFORE navigation in every gate proof.
Screenshots land in qa-shots/ (evidence only, never deployed).
"""
import functools, json, os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'qa-shots')
PORT = 8931
BASE = 'http://127.0.0.1:%d/nepse-broker-zero-sum/' % PORT
FAIL = []


def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else ' :: ' + str(detail)))
    if not cond:
        FAIL.append(name)


def serve():
    handler = functools.partial(SimpleHTTPRequestHandler, directory=ROOT)
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    os.makedirs(SHOTS, exist_ok=True)
    d30 = json.load(open(os.path.join(ROOT, 'data/broker-zero-sum-30.json')))
    uni = json.load(open(os.path.join(ROOT, 'nepse-chart/data/universe.json')))
    ghl_name = d30['symbols']['GHL']['name']
    first_page_syms = [e['s'] for e in uni['symbols'][:25]]
    mark_sym = next(s for s in first_page_syms if s in d30['symbols'])
    print('mark_sym=%s ghl_name=%s' % (mark_sym, ghl_name))

    mutated = {'on': False, 'mode': 'continue'}
    dmut = json.loads(json.dumps(d30))
    dmut['asof'] = '2026-10-17'
    dmut['market']['total_turnover'] += 1000000
    dmut['board'][0]['net_amt'] += 1000000
    dmut['symbols']['GHL']['net_amt'] += 1000000

    def route_30(route):
        if mutated['mode'] == 'abort':
            route.abort()
        elif mutated['on']:
            route.fulfill(status=200, content_type='application/json',
                          body=json.dumps(dmut))
        else:
            route.continue_()

    def route_all_zs(route):
        route.abort()

    httpd = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()

        def new_page(theme, width):
            ctx = browser.new_context(viewport={'width': width, 'height': 900})
            pg = ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
            pg.on('console', lambda m: errs.append('console.' + m.type + ': ' + m.text)
                  if m.type == 'error' else None)
            pg.add_init_script("localStorage.setItem('sk-theme', '%s')" % theme)
            return ctx, pg, errs

        # ---- dark 1280: values + canvas + overflow + screenshot ----
        ctx, pg, errs = new_page('dark', 1280)
        pg.goto(BASE)
        pg.wait_for_selector('#boardBody tr[data-sym]', timeout=20000)
        pg.wait_for_function("document.querySelector('#zsSecSum').textContent.includes('stocks')",
                            timeout=20000)
        canvas = pg.evaluate("getComputedStyle(document.body).backgroundColor")
        check('canvas-dark', canvas == 'rgb(10, 12, 16)', canvas)
        stat = pg.inner_text('#statStrip')
        check('stat-turnover-93.38', '93.38 arab' in stat, stat[:200])
        legend = pg.inner_text('#stanceDist')
        check('stance-176-212-35', '176' in legend and '212' in legend and '35' in legend, legend[:200])
        row0 = pg.inner_text('#boardBody tr[data-sym]:first-child')
        check('board-first-GHL-60.51', 'GHL' in row0 and '60.51 crore' in row0, row0)
        check('board-pager-1-25-423', pg.inner_text('#boardShowing') == 'Showing 1–25 of 423',
              pg.inner_text('#boardShowing'))
        check('detail-cohort-net', '60.51 crore' in pg.inner_text('#cohortFace'),
              pg.inner_text('#cohortFace')[:200])
        opts = pg.eval_on_selector('#symSel', "el => Array.from(el.options).slice(0,3).map(o => o.text)")
        check('symsel-name-format', opts[0].startswith(opts[0].split(' — ')[0] + ' — '), opts)
        check('sector-sum-412', '412 stocks' in pg.inner_text('#zsSecSum'), pg.inner_text('#zsSecSum'))
        check('fresh-line', 'Tape as of 2026-10-16' in pg.inner_text('#zsFresh'), pg.inner_text('#zsFresh'))
        # Authoritative overflow signal: the page itself must not scroll
        # horizontally. (Element scans false-positive on intentionally
        # off-screen chrome: skip-link, drawer panel.)
        ov = pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
        check('overflow-dark-1280', ov,
              pg.evaluate("document.documentElement.scrollWidth"))
        pg.screenshot(path=os.path.join(SHOTS, 'zero-sum-dark-1280.png'), full_page=True)
        # board pager Next / Prev
        pg.click('#boardPager button[data-dir="1"]')
        pg.wait_for_function("document.querySelector('#boardShowing').textContent.includes('26–50')")
        check('board-pager-next', pg.inner_text('#boardShowing') == 'Showing 26–50 of 423',
              pg.inner_text('#boardShowing'))
        pg.click('#boardPager button[data-dir="-1"]')
        pg.wait_for_function("document.querySelector('#boardShowing').textContent.includes('1–25')")
        # sector select: Hydropower
        pg.select_option('#zsSecSelect', 'Hydropower')
        pg.wait_for_function("document.querySelector('#zsSecSum').textContent.includes('113 stocks')")
        check('sector-hydropower-113', '113 stocks' in pg.inner_text('#zsSecSum'),
              pg.inner_text('#zsSecSum'))
        # sector marker: select a symbol on page 1 of All, then check its row mark
        pg.select_option('#zsSecSelect', 'All')
        pg.wait_for_function("document.querySelector('#zsSecSum').textContent.includes('412 stocks')")
        pg.select_option('#symSel', mark_sym)
        pg.wait_for_function(
            "document.querySelector('#zsSecBody tr[data-sym=\"%s\"] .zs-sec-mark').textContent === '●'" % mark_sym)
        check('sector-marker', True)
        # name search
        sub = ghl_name.split()[0][:5]
        pg.fill('#symSearch', sub)
        pg.wait_for_function("document.querySelector('#detailHead .zs-sym').textContent === 'GHL'")
        check('name-search-GHL', True)
        ctx.close()

        # ---- light 1280 ----
        ctx, pg, errs = new_page('light', 1280)
        pg.goto(BASE)
        pg.wait_for_selector('#boardBody tr[data-sym]', timeout=20000)
        canvas = pg.evaluate("getComputedStyle(document.body).backgroundColor")
        check('canvas-light', canvas == 'rgb(246, 247, 249)', canvas)
        pg.screenshot(path=os.path.join(SHOTS, 'zero-sum-light-1280.png'), full_page=True)
        ctx.close()

        # ---- dark 390 ----
        ctx, pg, errs = new_page('dark', 390)
        pg.goto(BASE)
        pg.wait_for_selector('#boardBody tr[data-sym]', timeout=20000)
        ov = pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
        check('overflow-dark-390', ov,
              pg.evaluate("document.documentElement.scrollWidth"))
        pg.screenshot(path=os.path.join(SHOTS, 'zero-sum-dark-390.png'), full_page=True)
        ctx.close()

        # ---- gate proofs (fake clock BEFORE navigation) ----
        ctx, pg, errs = new_page('dark', 1280)
        pg.route('**/broker-zero-sum-30.json*', route_30)
        pg.clock.install()
        pg.goto(BASE)
        pg.wait_for_selector('#boardBody tr[data-sym]', timeout=20000)
        pg.evaluate("window.__tile = document.querySelector('#statStrip .cx-stat')")
        stat_before = pg.inner_html('#statStrip')
        board_before = pg.inner_html('#boardBody')
        fresh_before = pg.inner_text('#zsFresh')
        pg.clock.fast_forward(61000)
        pg.wait_for_function(
            "document.querySelector('#zsFresh').textContent !== '%s'" % fresh_before.replace("'", "\\'"),
            timeout=10000)
        check('unchanged-tick-dom-stable',
              pg.inner_html('#statStrip') == stat_before and pg.inner_html('#boardBody') == board_before
              and pg.evaluate("window.__tile === document.querySelector('#statStrip .cx-stat')"),
              'DOM re-rendered on unchanged tick')
        check('unchanged-tick-no-notice', pg.inner_text('#zsNotice') == '',
              pg.inner_text('#zsNotice'))
        # selection-then-mutation: select ADBL, then mutate, then tick
        pg.select_option('#symSel', 'ADBL')
        pg.wait_for_function("document.querySelector('#detailHead .zs-sym').textContent === 'ADBL'")
        mutated['on'] = True
        pg.clock.fast_forward(61000)
        pg.wait_for_function("document.querySelector('#zsNotice').textContent.includes('Zero-sum data updated')",
                            timeout=10000)
        check('mutated-tick-notice', True)
        check('mutated-tick-rerender',
              '2026-10-17' in pg.inner_text('#zsFresh')
              and pg.inner_text('#boardBody tr[data-sym]:first-child') != board_before.split('</tr>')[0],
              pg.inner_text('#zsFresh'))
        check('mutated-tick-board-value',
              '60.51 crore' not in pg.inner_text('#boardBody tr[data-sym]:first-child')
              or '60.52' in pg.inner_text('#boardBody tr[data-sym]:first-child'),
              pg.inner_text('#boardBody tr[data-sym]:first-child'))
        # aborted tick keeps old view + failure freshness
        board_now = pg.inner_html('#boardBody')
        mutated['on'] = False
        mutated['mode'] = 'abort'
        pg.clock.fast_forward(61000)
        pg.wait_for_function(
            "document.querySelector('#zsFresh').textContent.includes('Live feed unavailable')",
            timeout=10000)
        check('aborted-tick-keeps-view', pg.inner_html('#boardBody') == board_now, 'view changed on failed tick')
        # The harness abort itself logs one browser 'Failed to load resource'
        # message; anything else is a real page error.
        real_errs = [e for e in errs if 'Failed to load resource' not in e]
        check('console-errors-gate-page', not real_errs, real_errs[:3])
        ctx.close()

        # ---- boot failure: honest empty state ----
        ctx, pg, errs = new_page('dark', 1280)
        pg.route('**/broker-zero-sum-*.json*', route_all_zs)
        pg.goto(BASE)
        pg.wait_for_function(
            "document.querySelector('#boardBody').textContent.includes('Data is being prepared')",
            timeout=20000)
        check('boot-failure-empty-state',
              'could not be loaded' in pg.inner_text('#zsFresh'), pg.inner_text('#zsFresh'))
        ctx.close()
        browser.close()
    httpd.shutdown()
    print('QA FAILURES: %d' % len(FAIL))
    for f in FAIL:
        print('FAILED: ' + f)
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())

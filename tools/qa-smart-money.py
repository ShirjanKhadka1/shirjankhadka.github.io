#!/usr/bin/env python3
"""Playwright QA for the Broker Smart Money teardown (2026-10-27).
Serves the worktree on localhost; fake clock installed BEFORE
navigation. Checks: canvas rgb, unchanged-tick DOM stability,
selection-then-mutation re-baseline proof, aborted-tick failure
honesty, boot failure, pagers, sector block, name search,
missing-detail empty state, 0 console errors, 0 overflow.
Usage: python3 tools/qa-smart-money.py  (writes qa-shots/)
Exit 0 only when all checks pass."""
import json, os, subprocess, sys, time

WT = os.path.expanduser('~/workspace/wt-smart-money')
PORT = 8912
BASE = f'http://localhost:{PORT}/nepse-broker-smart-money/'
PASS = []
FAIL = []
def check(name, cond, extra=''):
    (PASS if cond else FAIL).append(name)
    print(('  PASS ' if cond else '  FAIL ') + name + (f' [{extra}]' if extra and not cond else ''))

def main():
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)],
                           cwd=WT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        from playwright.sync_api import sync_playwright
        data = json.load(open(os.path.join(WT, 'data/broker-smart-money.json')))
        with sync_playwright() as p:
            b = p.chromium.launch()
            # ---- canvas + boot render (dark + light, 1280 + 390) ----
            for theme in ['dark', 'light']:
                pg = b.new_page(viewport={'width': 1280, 'height': 900})
                pg.on('console', lambda m: None)
                errs = []
                pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
                pg.on('pageerror', lambda e: errs.append(str(e)))
                pg.add_init_script(f"localStorage.setItem('sk-theme','{theme}');")
                pg.goto(BASE, wait_until='networkidle', timeout=30000)
                pg.wait_for_timeout(2500)
                bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
                want = 'rgb(10, 12, 16)' if theme == 'dark' else 'rgb(246, 247, 249)'
                check(f'canvas {theme} == overview token ({bg})', bg == want, bg)
                body = pg.inner_text('body')
                check(f'{theme}: masthead + freshness line present',
                      'Broker Smart Money' in body and 'Checked' in body and 'Board as of 2026-10-26' in body)
                check(f'{theme}: 0 console errors', not errs, str(errs[:2]))
                check(f'{theme}: 0 horizontal overflow at 1280',
                      pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') == 0)
                pg.close()
            # ---- 390px ----
            pg = b.new_page(viewport={'width': 390, 'height': 844})
            pg.add_init_script("localStorage.setItem('sk-theme','dark');")
            pg.goto(BASE, wait_until='networkidle', timeout=30000)
            pg.wait_for_timeout(2500)
            check('390px: 0 horizontal overflow',
                  pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') == 0)
            pg.close()
            # ---- unchanged tick: DOM stable, only freshness moves ----
            pg = b.new_page(viewport={'width': 1280, 'height': 900})
            pg.clock.install()
            pg.goto(BASE, wait_until='networkidle', timeout=30000)
            pg.wait_for_timeout(1500)
            pg.evaluate("""() => {
              window.__stat = document.querySelector('#statStrip .cx-stat');
              window.__statId = window.__stat;
              window.__board = document.querySelector('#boardBody');
              window.__freshBefore = document.querySelector('#smFresh').textContent;
            }""")
            pg.clock.fast_forward(61000)
            pg.wait_for_timeout(500)
            stable = pg.evaluate("""() => {
              const s = document.querySelector('#statStrip .cx-stat') === window.__statId;
              const f = document.querySelector('#smFresh').textContent !== window.__freshBefore;
              const n = document.querySelector('#smNotice').textContent === '';
              return {statSame: s, freshMoved: f, noNotice: n};
            }""")
            check('unchanged tick: stat tile node identity survives', stable['statSame'])
            check('unchanged tick: freshness line advances', stable['freshMoved'])
            check('unchanged tick: no update notice', stable['noNotice'])
            # ---- selection-then-mutation: re-baseline proof ----
            pg.evaluate("document.querySelector('#symSel').value = 'NABIL'; document.querySelector('#symSel').dispatchEvent(new Event('change'))")
            pg.wait_for_timeout(500)
            pg.route('**/data/broker-smart-money.json*', lambda route: route.fulfill(
                status=200, content_type='application/json',
                body=json.dumps({**data, 'asof': '2026-10-27',
                                 'board': [{**data['board'][0], 'skilled_net_amt': 999999999.0}] + data['board'][1:]})))
            pg.clock.fast_forward(61000)
            pg.wait_for_timeout(800)
            mut = pg.evaluate("""() => ({
              notice: document.querySelector('#smNotice').textContent,
              fresh: document.querySelector('#smFresh').textContent,
              head: document.querySelector('#detailHead').textContent.slice(0, 20)
            })""")
            check('selection-then-mutation: update notice appears', 'Smart-money data updated' in mut['notice'], mut['notice'])
            check('selection-then-mutation: freshness shows new asof', '2026-10-27' in mut['fresh'], mut['fresh'])
            pg.unroute('**/data/broker-smart-money.json*')
            pg.close()
            # ---- aborted tick keeps old view + failure freshness ----
            pg = b.new_page(viewport={'width': 1280, 'height': 900})
            pg.clock.install()
            pg.goto(BASE, wait_until='networkidle', timeout=30000)
            pg.wait_for_timeout(1500)
            before = pg.evaluate("document.querySelector('#boardBody').innerHTML.length")
            pg.route('**/data/broker-smart-money.json*', lambda route: route.abort())
            pg.clock.fast_forward(61000)
            pg.wait_for_timeout(500)
            ab = pg.evaluate("""() => ({
              len: document.querySelector('#boardBody').innerHTML.length,
              fresh: document.querySelector('#smFresh').textContent
            })""")
            check('aborted tick: old board kept', ab['len'] == before)
            check('aborted tick: failure freshness line', 'failed' in ab['fresh'], ab['fresh'])
            pg.close()
            # ---- boot failure: honest empty state ----
            pg = b.new_page(viewport={'width': 1280, 'height': 900})
            pg.route('**/data/broker-smart-money.json*', lambda route: route.abort())
            pg.goto(BASE, wait_until='networkidle', timeout=30000)
            pg.wait_for_timeout(1500)
            boot = pg.evaluate("""() => ({
              board: document.querySelector('#boardBody').textContent,
              fresh: document.querySelector('#smFresh').textContent
            })""")
            check('boot failure: board error row (never blank)', 'could not be loaded' in boot['board'])
            check('boot failure: freshness failure line', 'could not be loaded' in boot['fresh'], boot['fresh'])
            pg.close()
            # ---- pagers, sector block, search, missing-detail ----
            pg = b.new_page(viewport={'width': 1280, 'height': 900})
            pg.goto(BASE, wait_until='networkidle', timeout=30000)
            pg.wait_for_timeout(2500)
            pg.click('#boardPager .sm-pager-next')
            pg.wait_for_timeout(300)
            check('board pager Next -> 26-50',
                  'Showing 26–50 of 287 names' in pg.inner_text('#boardPager'), pg.inner_text('#boardPager'))
            pg.click('#leaderPager .sm-pager-next')
            pg.wait_for_timeout(300)
            check('leaderboard pager Next -> 26-50',
                  'Showing 26–50 of 91 brokers' in pg.inner_text('#leaderPager'), pg.inner_text('#leaderPager'))
            pg.select_option('#smSectorSel', 'Hydropower')
            pg.wait_for_timeout(300)
            check('sector Hydropower -> 113 stocks',
                  'Showing 1–25 of 113 stocks' in pg.inner_text('#sectorCount'), pg.inner_text('#sectorCount'))
            first_sec = pg.inner_text('#sectorBody tr:first-child')
            check('sector row shows real company name', 'Hydro' in first_sec or 'Limited' in first_sec, first_sec[:60])
            pg.fill('#smSectorSearch', 'Ghalemdi')
            pg.wait_for_timeout(300)
            check('sector name search finds GHL', 'GHL' in pg.inner_text('#sectorBody'))
            pg.fill('#smSectorSearch', '')
            pg.fill('#symSearch', 'Machhapuchhre')
            pg.wait_for_timeout(300)
            check('board name search finds MBL', 'MBL' in pg.inner_text('#boardBody'))
            pg.fill('#symSearch', '')
            pg.select_option('#symSel', 'MLBLPO')
            pg.wait_for_timeout(300)
            check('missing-detail row: honest empty state (not previous stock)',
                  'No skilled-broker breakdown' in pg.inner_text('#readingLine'), pg.inner_text('#readingLine')[:80])
            # ---- screenshots ----
            os.makedirs(os.path.join(WT, 'qa-shots'), exist_ok=True)
            pg.set_viewport_size({'width': 1280, 'height': 900})
            pg.screenshot(path=os.path.join(WT, 'qa-shots/smart-money-dark-1280.png'), full_page=True)
            pg.add_init_script("localStorage.setItem('sk-theme','light');")
            pg.reload(wait_until='networkidle')
            pg.wait_for_timeout(2500)
            pg.screenshot(path=os.path.join(WT, 'qa-shots/smart-money-light-1280.png'), full_page=True)
            pg.close()
            pg = b.new_page(viewport={'width': 390, 'height': 844})
            pg.goto(BASE, wait_until='networkidle', timeout=30000)
            pg.wait_for_timeout(2500)
            pg.screenshot(path=os.path.join(WT, 'qa-shots/smart-money-dark-390.png'), full_page=True)
            pg.close()
            b.close()
    finally:
        srv.terminate()
    print(f'\nRESULT: PASS {len(PASS)} / FAIL {len(FAIL)}')
    if FAIL: print('FAILED:', FAIL)
    return 1 if FAIL else 0

if __name__ == '__main__':
    sys.exit(main())

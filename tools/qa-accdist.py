#!/usr/bin/env python3
"""Playwright QA for the accdist teardown: renders dark/light/390px,
screenshots, console errors, overflow, key values vs data files, and the
change-gate proofs (fake clock installed BEFORE navigation):
 1. unchanged tick keeps DOM, only freshness moves
 2. period-change-then-mutation tick re-renders with notice (re-baseline lesson)
 3. aborted provisional tick keeps list values, banner goes fallback
 4. boot failure renders honest empty state with goto buttons
Usage: python3 tools/qa-accdist.py [port] (serves worktree via http.server).
Screenshots land in qa-shots/ (excluded from deploy)."""
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = sys.argv[1] if len(sys.argv) > 1 else '8911'
BASE = f'http://localhost:{PORT}/nepse-brokers/accdist/'
SHOTS = os.path.join(ROOT, 'qa-shots')
os.makedirs(SHOTS, exist_ok=True)

srv = subprocess.Popen(['python3', '-m', 'http.server', PORT], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
checks, fails = [], []


def check(name, cond, detail=''):
    checks.append((name, bool(cond), detail))
    print(('  PASS ' if cond else '  FAIL ') + name + (f' — {detail}' if detail and not cond else ''))


try:
    from playwright.sync_api import sync_playwright
    d1 = json.load(open(os.path.join(ROOT, 'nepse-brokers/data/periods/1D.json')))
    top_acc, top_dist = d1['accumulation'][0], d1['distribution'][0]
    brokers = json.load(open(os.path.join(ROOT, 'nepse-brokers/data/brokers.json')))
    with sync_playwright() as p:
        b = p.chromium.launch()
        # --- dark 1280 render ---
        pg = b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE, wait_until='networkidle', timeout=30000)
        pg.wait_for_timeout(2500)
        body = pg.inner_text('body')
        check('title renders', 'Accumulation / Distribution' in body)
        check('top acc tile', 'Rs 6.39 Cr' in body and 'GHL' in body,
              f'acc[0]={top_acc}')
        check('top dist tile', 'Rs -5.30 Cr' in body and 'HDL' in body,
              f'dist[0]={top_dist}')
        check('acc pager', 'Showing 1–25 of 200' in body)
        check('dist pager', body.count('Showing 1–25 of 200') >= 2)
        check('sector block', '412 stocks' in body)
        check('freshness line', 'Checked' in body and 'next check in 60 seconds' in body)
        check('definition box', 'not verified shareholding' in body and 'not beneficial ownership' in body)
        check('top-200 stated', 'top 200' in body.lower())
        check('no console errors', not errs, str(errs[:3]))
        check('no overflow 1280', pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') == 0)
        check('canvas dark', pg.evaluate(
            "getComputedStyle(document.body).backgroundColor") == 'rgb(10, 12, 16)')
        pg.screenshot(path=os.path.join(SHOTS, 'accdist-dark-1280.png'), full_page=True)
        # --- light 1280 (seed theme like a user toggle) ---
        pg2 = b.new_page(viewport={'width': 1280, 'height': 900})
        pg2.add_init_script("localStorage.setItem('sk-theme','light');")
        errs2 = []
        pg2.on('console', lambda m: errs2.append(m.text) if m.type == 'error' else None)
        pg2.on('pageerror', lambda e: errs2.append(str(e)))
        pg2.goto(BASE, wait_until='networkidle', timeout=30000)
        pg2.wait_for_timeout(2500)
        check('canvas light', pg2.evaluate(
            "getComputedStyle(document.body).backgroundColor") == 'rgb(246, 247, 249)')
        check('no console errors (light)', not errs2, str(errs2[:3]))
        pg2.screenshot(path=os.path.join(SHOTS, 'accdist-light-1280.png'), full_page=True)
        # --- 390px ---
        pg3 = b.new_page(viewport={'width': 390, 'height': 844})
        pg3.goto(BASE, wait_until='networkidle', timeout=30000)
        pg3.wait_for_timeout(2500)
        check('no overflow 390', pg3.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') == 0)
        pg3.screenshot(path=os.path.join(SHOTS, 'accdist-dark-390.png'), full_page=True)
        # --- gate proofs (fake clock BEFORE navigation) ---
        prov = json.load(open(os.path.join(ROOT, 'nepse-brokers/data/intraday-provisional.json')))
        mut = dict(prov)
        mut['asof'] = '2026-10-26T16:00:00+05:45'
        st = {'mut': False, 'abort_prov': False, 'abort_all': False}

        def handler(route):
            url = route.request.url
            if st['abort_all']:
                route.abort()
                return
            if 'intraday-provisional' in url and st['abort_prov']:
                route.abort()
                return
            if 'intraday-provisional' in url:
                route.fulfill(status=200, content_type='application/json',
                              body=json.dumps(mut if st['mut'] else prov))
                return
            route.continue_()
        pg4 = b.new_page(viewport={'width': 1280, 'height': 900})
        pg4.clock.install()
        pg4.route('**/nepse-brokers/data/**', handler)
        pg4.goto(BASE, wait_until='networkidle', timeout=30000)
        pg4.wait_for_timeout(2000)
        # 1. unchanged tick: node identity survives
        pg4.evaluate("window.__ac = document.querySelector('.bk-tiles');")
        pg4.clock.fast_forward(61000)
        pg4.wait_for_timeout(1000)
        check('unchanged tick DOM-stable',
              pg4.evaluate("window.__ac === document.querySelector('.bk-tiles')"))
        # 2. period-change-then-mutation: 1D (load re-baselines) -> latest -> mutate -> tick
        pg4.locator('#bkPeriods button[data-p="1D"]').click()
        pg4.wait_for_timeout(1500)
        pg4.locator('#bkPeriods button[data-p="latest"]').click()
        pg4.wait_for_timeout(1500)
        st['mut'] = True
        pg4.clock.fast_forward(61000)
        pg4.wait_for_timeout(1500)
        notice = pg4.locator('#acNotice').inner_text() if pg4.locator('#acNotice').count() else ''
        check('period-change-then-mutation re-renders with notice',
              'updated' in notice.lower(), f'notice={notice!r}')
        check('post-mutation DOM re-rendered',
              pg4.evaluate("window.__ac !== document.querySelector('.bk-tiles')"))
        # 3. aborted provisional tick: values kept, fallback banner
        first_before = pg4.locator('#accBody tr').first.inner_text()
        st['mut'] = False
        st['abort_prov'] = True
        pg4.clock.fast_forward(61000)
        pg4.wait_for_timeout(1500)
        first_after = pg4.locator('#accBody tr').first.inner_text()
        banner = pg4.locator('#acBanner').inner_text() if pg4.locator('#acBanner').count() else ''
        check('aborted tick keeps list values', first_before == first_after,
              f'{first_before!r} vs {first_after!r}')
        check('aborted tick shows fallback banner', 'unavailable' in banner.lower(), f'banner={banner[:80]!r}')
        # 4. boot failure: honest empty state with goto buttons
        st['abort_all'] = True
        pg5 = b.new_page(viewport={'width': 1280, 'height': 900})
        pg5.route('**/nepse-brokers/data/**', handler)
        pg5.goto(BASE, wait_until='networkidle', timeout=30000)
        pg5.wait_for_timeout(2500)
        b5 = pg5.inner_text('body')
        check('boot failure honest empty state',
              'could not be loaded' in b5 and 'See the latest session' in b5 and 'Retry' in b5)
        b.close()
    npass = sum(1 for _, c, _ in checks if c)
    print(f'\nQA: {npass}/{len(checks)} checks passed')
    sys.exit(0 if npass == len(checks) else 1)
finally:
    srv.terminate()

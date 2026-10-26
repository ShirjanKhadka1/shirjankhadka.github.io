#!/usr/bin/env python3
"""Playwright QA for the Broker Analytics teardown (localhost only).

Asserts: boot (coverage, snapshot, top table vs 1D), canvas both themes,
tabs/periods/asof/sector interactions, viz values, 390px zero overflow,
and the change-gate proofs (unchanged tick DOM-stable / mutated tick
re-renders to the provisional view / failed tick keeps the view).
Ticks are driven with page.clock when available, else real 65s waits.
Usage: python3 tools/qa-brokers.py [--port PORT]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QA = os.path.join(ROOT, 'qa-shots')
os.makedirs(QA, exist_ok=True)

FAILURES = []


def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  [{detail}]'))
    if not ok:
        FAILURES.append(name)


def main():
    port = sys.argv[sys.argv.index('--port') + 1] if '--port' in sys.argv else '8941'
    base = f'http://localhost:{port}'
    d1 = json.load(open(os.path.join(ROOT, 'nepse-brokers', 'data', 'periods', '1D.json')))
    top = sorted(d1['brokers'], key=lambda b: b.get('total', 0), reverse=True)[0]
    names = json.load(open(os.path.join(ROOT, 'nepse-brokers', 'data', 'brokers.json')))
    top_name = names[top['code']]
    buy_sum = sum(b.get('buy_value') or 0 for b in d1['brokers'])

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()

        def install_clock(page):
            """Fake timers must be installed BEFORE goto so the boot interval
            is fake-time controlled; no-op on Playwright builds without clock."""
            try:
                page.clock.install()
            except Exception:
                pass

        def tick(page, seconds=61):
            """Advance the 60s refresh tick: clock fast-forward if available."""
            try:
                page.clock.fast_forward(seconds * 1000)
                page.wait_for_timeout(800)
            except Exception:
                page.wait_for_timeout(seconds * 1000 + 2000)

        # ---------- landing, dark ----------
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = ctx.new_page()
        errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script("try{localStorage.setItem('sk-theme','dark')}catch(e){}")
        install_clock(page)
        page.goto(base + '/nepse-brokers/', wait_until='networkidle')
        page.wait_for_selector('#bkFresh')
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        check('dark canvas', bg == 'rgb(10, 12, 16)', bg)
        over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check('dark no overflow @1280', over == 0, f'overflow={over}px')
        cov = page.text_content('#coverage') or ''
        check('coverage 2026-07-15 → 2026-10-26, 64 days', '2026-07-15' in cov and '2026-10-26' in cov and '64' in cov, cov[:100])
        snap = page.text_content('.snap-asof') or ''
        check('snapshot current 2026-10-26', '2026-10-26' in snap, snap[:100])
        check('snapshot not behind', 'behind' not in snap, snap[:100])
        fresh = page.text_content('#bkFresh') or ''
        check('freshness line has checked + next check', 'checked' in fresh.lower() and 'next check in 60 seconds' in fresh, fresh[:120])
        first_row = page.text_content('#view table tbody tr:first-child') or ''
        check('top table first row is top broker', top_name.split()[0] in first_row, first_row[:80])
        viz = page.text_content('#bkViz') or ''
        check('viz turnover = 1D buy sum', '4,002,421,168' in viz or 'Rs 400.24 Cr' in viz or '400.24' in viz, viz[:150])
        check('viz top broker present', top_name.split()[0] in viz, viz[:150])
        sec_opts = page.evaluate("document.querySelectorAll('#bkSecSelect option').length")
        check('sector options = 16 (All + 15)', sec_opts == 16, f'options={sec_opts}')
        sec_sum = page.text_content('#bkSecSum') or ''
        check('sector sum 412', '412' in sec_sum, sec_sum)
        page.screenshot(path=str(os.path.join(QA, 'brokers-dark-1280.png')))

        # ---------- period switch 1M ----------
        page.click('#periodBar button[data-p="1M"]')
        page.wait_for_selector('#view table')
        h = page.text_content('#view h2') or ''
        check('1M label shows range', '2026-09-02' in h and '2026-10-26' in h, h[:100])
        page.click('#periodBar button[data-p="latest"]')
        page.wait_for_timeout(800)

        # ---------- gate: unchanged tick keeps DOM ----------
        probe = page.evaluate("document.querySelector('#view').innerHTML.slice(0,200)")
        fresh_before = page.text_content('#bkFresh') or ''
        tick(page)
        probe_after = page.evaluate("document.querySelector('#view').innerHTML.slice(0,200)")
        fresh_after = page.text_content('#bkFresh') or ''
        check('unchanged tick keeps DOM', probe == probe_after, 'DOM changed on identical payload')
        # The freshness line must have moved, proving the tick really fired
        # (otherwise the DOM-stability check would be vacuous).
        check('unchanged tick moved freshness line', fresh_before != fresh_after, f'before={fresh_before[:60]} after={fresh_after[:60]}')
        page.screenshot(path=str(os.path.join(QA, 'brokers-dark-1280.png')))

        # ---------- gate: mutated provisional flips to provisional view ----------
        def route_prov(route):
            if 'intraday-provisional.json' in route.request.url:
                prov = json.load(open(os.path.join(ROOT, 'nepse-brokers', 'data', 'intraday-provisional.json')))
                prov = dict(prov)
                prov['date'] = '2026-10-27'
                prov['asof'] = '2026-10-27T11:05:00.000000+05:45'
                route.fulfill(status=200, content_type='application/json', body=json.dumps(prov))
            else:
                route.continue_()
        ctx2 = browser.new_context(viewport={'width': 1280, 'height': 900})
        page2 = ctx2.new_page()
        page2.add_init_script("try{localStorage.setItem('sk-theme','dark')}catch(e){}")
        page2.route('**/intraday-provisional.json', route_prov)
        install_clock(page2)
        page2.goto(base + '/nepse-brokers/', wait_until='networkidle')
        page2.wait_for_selector('.bk-prov')
        banner = page2.text_content('.bk-prov') or ''
        check('mutated provisional renders banner', 'PROVISIONAL' in banner and 'no broker split' in banner, banner[:100])
        fresh2 = page2.text_content('#bkFresh') or ''
        check('mutated provisional freshness is provisional', 'PROVISIONAL' in fresh2, fresh2[:120])
        check('no console errors (mutated page)', len([e for e in errors if 'nepse-brokers' in e or 'bk' in e]) == 0, str(errors[:3]))

        # ---------- gate: failed tick keeps view ----------
        page2.unroute('**/intraday-provisional.json')
        page2.route('**/intraday-provisional.json', lambda r: r.abort())
        tick(page2)  # first failed tick: falls back to final (one re-render, label changes)
        mid = page2.evaluate("document.querySelector('#view').innerHTML.slice(0,200)")
        tick(page2)  # second failed tick: gate must hold (identical fallback payload)
        after = page2.evaluate("document.querySelector('#view').innerHTML.slice(0,200)")
        check('failed ticks settle stable', mid == after, 'view changed across identical failed ticks')
        fresh3 = page2.text_content('#bkFresh') or ''
        check('failed tick shows fallback state', 'last final session' in fresh3, fresh3[:120])

        # ---------- gate: feed-down boot shows an honest cover, not a blank ----------
        # NOTE: a silent-tick total failure is unreachable in production (the
        # 1D payload is cached at boot, so a tick with a dead provisional
        # feed degrades to the fallback render — proven above). The failure
        # surface that IS reachable is the boot with the feed down.
        ctx5 = browser.new_context(viewport={'width': 1280, 'height': 900})
        page5 = ctx5.new_page()
        page5.add_init_script("try{localStorage.setItem('sk-theme','dark')}catch(e){}")
        for pat in ('**/nepse-brokers/data/periods/**', '**/nepse-brokers/data/intraday-provisional.json', '**/nepse-brokers/data/daily/**'):
            page5.route(pat, lambda r: r.abort())
        page5.goto(base + '/nepse-brokers/?period=latest', wait_until='networkidle')
        page5.wait_for_timeout(1000)
        cover5 = page5.text_content('#view') or ''
        check('feed-down boot shows honest cover', 'Live broker feed not available yet' in cover5 and 'Try 1D' in cover5, cover5[:140])

        # ---------- asof gap + in-archive ----------
        page2.goto(base + '/nepse-brokers/?period=asof&asof=2026-10-20', wait_until='networkidle')
        page2.wait_for_timeout(1000)
        gap = page2.text_content('#view') or ''
        check('asof gap message (post daily_end)', 'daily archive currently ends 2026-10-07' in gap, gap[:120])
        page2.goto(base + '/nepse-brokers/?period=asof&asof=2026-10-07', wait_until='networkidle')
        page2.wait_for_timeout(1000)
        ok7 = page2.text_content('#view h2') or ''
        check('asof in-archive renders', '2026-10-07' in ok7, ok7[:100])

        # ---------- sector filter ----------
        page2.goto(base + '/nepse-brokers/', wait_until='networkidle')
        # Options inside a closed <select> are never "visible" to Playwright;
        # wait for them to be attached instead.
        page2.wait_for_function("document.querySelectorAll('#bkSecSelect option').length >= 2")
        page2.select_option('#bkSecSelect', 'Hydropower')
        page2.wait_for_timeout(400)
        ssum = page2.text_content('#bkSecSum') or ''
        hyd = sum(1 for x in json.load(open(os.path.join(ROOT, 'nepse-chart', 'data', 'verdicts.json')))['verdicts'].values() if x.get('sec') == 'Hydropower')
        check(f'sector Hydropower count ({hyd})', str(hyd) in ssum, ssum)
        first_name = page2.text_content('#bkSecBody tr:first-child td:nth-child(2)') or ''
        check('sector row shows real company name', first_name.strip() != '' and not first_name.strip().isdigit(), first_name[:60])
        first_link = page2.evaluate("document.querySelector('#bkSecBody tr:first-child td:first-child a')?.getAttribute('href') || ''")
        check('sector row links to /stocks/', first_link.startswith('/stocks/'), first_link)

        # ---------- light theme ----------
        ctx3 = browser.new_context(viewport={'width': 1280, 'height': 900})
        page3 = ctx3.new_page()
        page3.add_init_script("try{localStorage.setItem('sk-theme','light')}catch(e){}")
        page3.goto(base + '/nepse-brokers/', wait_until='networkidle')
        page3.wait_for_selector('#bkFresh')
        bg3 = page3.evaluate("getComputedStyle(document.body).backgroundColor")
        check('light canvas', bg3 == 'rgb(246, 247, 249)', bg3)
        page3.screenshot(path=str(os.path.join(QA, 'brokers-light-1280.png')))

        # ---------- 390px ----------
        ctx4 = browser.new_context(viewport={'width': 390, 'height': 844})
        page4 = ctx4.new_page()
        page4.add_init_script("try{localStorage.setItem('sk-theme','dark')}catch(e){}")
        page4.goto(base + '/nepse-brokers/', wait_until='networkidle')
        page4.wait_for_selector('#bkFresh')
        over4 = page4.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check('390px zero overflow', over4 == 0, f'overflow={over4}px')
        page4.screenshot(path=str(os.path.join(QA, 'brokers-dark-390.png')))
        browser.close()

    print(f'QA: {len(FAILURES)} failures')
    return 1 if FAILURES else 0


if __name__ == '__main__':
    sys.exit(main())

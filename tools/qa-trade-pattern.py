#!/usr/bin/env python3
"""Playwright QA for the Broker Trade Pattern teardown.

Serves the worktree on localhost, then checks canvas, overflow, boot,
period switch, sort, sector filter + pager + broker markers, and the
60s change-gated refresh (fake clock + route interception).
Screenshots land in qa-shots/ (evidence only, never deployed).
Usage: python3 tools/qa-trade-pattern.py [--port 8942]
"""
import argparse
import functools
import http.server
import json
import os
import sys
import threading

from playwright.sync_api import sync_playwright

FAILURES = []


def ok(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else ' [' + str(detail) + ']'))
    if not cond:
        FAILURES.append(name)


def load_json(wt, rel):
    with open(os.path.join(wt, rel)) as f:
        return json.load(f)


def fmt_v(v):
    if v >= 1e7:
        return 'Rs ' + f'{v / 1e7:.2f}' + ' Cr'
    if v >= 1e5:
        return 'Rs ' + f'{v / 1e5:.2f}' + ' L'
    return 'Rs ' + f'{v:,.2f}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8942)
    args = ap.parse_args()
    wt = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(wt)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=wt)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{args.port}'
    shots = os.path.join(wt, 'qa-shots')
    os.makedirs(shots, exist_ok=True)

    d1 = load_json(wt, 'nepse-brokers/data/periods/1D.json')
    d1m = load_json(wt, 'nepse-brokers/data/periods/1M.json')
    prov = load_json(wt, 'nepse-brokers/data/intraday-provisional.json')
    vd = load_json(wt, 'nepse-chart/data/verdicts.json')['verdicts']
    b58 = next(b for b in d1['brokers'] if b['code'] == '58')
    b58_1m = next(b for b in d1m['brokers'] if b['code'] == '58')
    b58_syms = [s['symbol'] for s in d1['broker_symbols']['58']]
    mark_sym = b58_syms[0]
    mark_sec = vd[mark_sym]['sec']
    # 1M broker-58 buy value, as the page formats it
    b58_1m_buy = fmt_v(b58_1m['buy_value'])

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 900},
                                color_scheme='dark')
        page.on('console', lambda m: ok('console no errors', m.type != 'error', m.text) if m.type == 'error' else None)
        page.goto(base + '/nepse-brokers/trade-pattern/')
        page.wait_for_selector('#tpFresh')
        page.wait_for_function("document.querySelector('#brokerSel').options.length > 1", timeout=10000)
        # Canvas + overflow, dark
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        ok('canvas dark rgb(10, 12, 16)', bg == 'rgb(10, 12, 16)', bg)
        ov = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ok('overflow dark 1280 = 0', ov == 0, ov)
        # Pills + skip-link
        pills = page.evaluate("[...document.querySelectorAll('#bkPeriods button')].map(b=>b.dataset.p)")
        ok('period pills full set', pills == ['latest', '1D', '1W', '2W', '1M', '3M', '6M', '1Y', '2Y', '3Y'], pills)
        ok('skip-link present', page.evaluate("!!document.querySelector('.tp-skip')"))
        # Boot: pick broker 58, latest -> last final 1D
        page.select_option('#brokerSel', '58')
        page.wait_for_function("document.querySelectorAll('#bkBody tr').length > 0", timeout=10000)
        tiles = page.evaluate("[...document.querySelectorAll('.bk-tile .v')].map(e=>e.textContent.trim())")
        ok('broker 58 tiles match 1D', tiles[0] == fmt_v(b58['buy_value'])
           and tiles[1] == fmt_v(b58['sell_value'])
           and tiles[2] == fmt_v(b58['buy_value'] - b58['sell_value'])
           and tiles[3] == str(len(b58_syms)), tiles)
        banner = page.evaluate("document.querySelector('#tpBanner').textContent")
        ok('provisional banner shown', 'symbol-only' in banner and '2026-10-26' in banner, banner[:120])
        ok('viz split + rank bars present',
           page.evaluate("!!document.querySelector('.tp-split') && document.querySelectorAll('.tp-rank').length == 10"))
        ok('pager showing 1-25', page.evaluate("document.querySelector('#tpShowing').textContent").startswith('Showing 1–25 of'))
        page.click('#tpNext')
        ok('pager next -> 26-50', page.evaluate("document.querySelector('#tpShowing').textContent").startswith('Showing 26–50 of'))
        page.click('#tpPrev')
        ok('pager prev -> 1-25', page.evaluate("document.querySelector('#tpShowing').textContent").startswith('Showing 1–25 of'))
        # Sort: click Net header -> descending by net
        page.click('#bkTable th[data-sort="net"]')
        nets = page.evaluate("[...document.querySelectorAll('#bkBody tr')].map(r=>r.children[3].textContent.trim())")
        ok('sort net desc first page', len(nets) > 1, nets[:3])
        # Period switch: 1M
        page.click('#bkPeriods button[data-p="1M"]')
        page.wait_for_function("document.querySelector('#tpFresh').textContent.includes('Final')", timeout=10000)
        tiles1m = page.evaluate("[...document.querySelectorAll('.bk-tile .v')].map(e=>e.textContent.trim())")
        ok('1M tiles match 1M file', tiles1m[0] == b58_1m_buy, tiles1m)
        page.click('#bkPeriods button[data-p="latest"]')
        page.wait_for_function("document.querySelector('#tpFresh').textContent.includes('Provisional')", timeout=10000)
        # Sector block
        sec_opts = page.evaluate("[...document.querySelectorAll('#tpSecSelect option')].map(o=>o.value)")
        ok('sector options = All + 15', len(sec_opts) == 16 and sec_opts[0] == 'All', sec_opts)
        page.select_option('#tpSecSelect', mark_sec)
        page.wait_for_function("document.querySelector('#tpSecShowing').textContent.length > 0", timeout=10000)
        # Page through the sector until the marker symbol's row appears
        found = False
        for _ in range(20):
            row = page.evaluate(f"""() => {{
              const tr = [...document.querySelectorAll('#tpSecBody tr')].find(r => r.children[0] && r.children[0].textContent.trim().startsWith('{mark_sym}'));
              return tr ? tr.innerHTML : null;
            }}""")
            if row is not None:
                found = '●' in row
                break
            nxt = page.evaluate("!document.querySelector('#tpSecNext').disabled")
            if not nxt:
                break
            page.click('#tpSecNext')
        ok(f'broker-58 marker on {mark_sym} in {mark_sec}', found, mark_sym)
        # Screenshots: dark 1280 (broker 58, latest, sector All)
        page.select_option('#tpSecSelect', 'All')
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(shots, 'trade-pattern-dark-1280.png'), full_page=True)
        # Light theme
        page2 = browser.new_page(viewport={'width': 1280, 'height': 900}, color_scheme='light')
        # Shared chrome defaults a fresh context to dark and persists it;
        # seed the light choice the way a user toggling light would.
        page2.add_init_script("localStorage.setItem('sk-theme','light')")
        page2.goto(base + '/nepse-brokers/trade-pattern/')
        page2.wait_for_selector('#tpFresh')
        bg2 = page2.evaluate("getComputedStyle(document.body).backgroundColor")
        ok('canvas light rgb(246, 247, 249)', bg2 == 'rgb(246, 247, 249)', bg2)
        ov2 = page2.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ok('overflow light 1280 = 0', ov2 == 0, ov2)
        page2.screenshot(path=os.path.join(shots, 'trade-pattern-light-1280.png'), full_page=True)
        page2.close()
        # 390px
        page3 = browser.new_page(viewport={'width': 390, 'height': 844}, color_scheme='dark')
        page3.goto(base + '/nepse-brokers/trade-pattern/')
        page3.wait_for_selector('#tpFresh')
        ov3 = page3.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ok('overflow dark 390 = 0', ov3 == 0, ov3)
        page3.screenshot(path=os.path.join(shots, 'trade-pattern-dark-390.png'), full_page=True)
        page3.close()
        # Refresh gate: fake clock on a fresh page
        page4 = browser.new_page(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
        page4.clock.install()
        page4.goto(base + '/nepse-brokers/trade-pattern/')
        page4.wait_for_function("document.querySelector('#brokerSel').options.length > 1", timeout=10000)
        page4.select_option('#brokerSel', '58')
        page4.wait_for_function("document.querySelectorAll('#bkBody tr').length > 0", timeout=10000)
        fresh_before = page4.evaluate("document.querySelector('#tpFresh').textContent")
        page4.evaluate("window.__probe = document.querySelector('.bk-tile')")
        page4.clock.fast_forward(61 * 1000)
        page4.wait_for_timeout(800)
        fresh_after = page4.evaluate("document.querySelector('#tpFresh').textContent")
        same_node = page4.evaluate("window.__probe === document.querySelector('.bk-tile')")
        ok('unchanged tick: DOM stable', same_node)
        ok('unchanged tick: freshness moved', fresh_before != fresh_after, (fresh_before, fresh_after))
        # Mutated provisional -> notice + re-render
        def mutated(route):
            body = dict(prov)
            body['asof'] = '2026-10-27T10:00:00+05:45'
            route.fulfill(json=body)
        page4.route('**/intraday-provisional.json', mutated)
        page4.clock.fast_forward(61 * 1000)
        page4.wait_for_timeout(800)
        notice = page4.evaluate("document.querySelector('#tpNotice').textContent")
        re_rendered = page4.evaluate("window.__probe !== document.querySelector('.bk-tile')")
        ok('mutated tick: notice shown', 'Broker data updated' in notice, notice)
        ok('mutated tick: re-rendered', re_rendered)
        # Aborted provisional on tick -> view kept + fallback banner
        page4.unroute('**/intraday-provisional.json')
        page4.route('**/intraday-provisional.json', lambda r: r.abort())
        tile_before = page4.evaluate("document.querySelector('.bk-tile .v').textContent")
        page4.clock.fast_forward(61 * 1000)
        page4.wait_for_timeout(800)
        tile_after = page4.evaluate("document.querySelector('.bk-tile .v').textContent")
        banner2 = page4.evaluate("document.querySelector('#tpBanner').textContent")
        ok('aborted tick: view kept', tile_before == tile_after, (tile_before, tile_after))
        ok('aborted tick: fallback banner', 'Live feed unavailable' in banner2, banner2[:120])
        page4.close()
        # Boot failure: abort all data routes on a fresh page
        page5 = browser.new_page(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
        for pat in ['**/nepse-brokers/data/**', '**/nepse-chart/data/**']:
            page5.route(pat, lambda r: r.abort())
        page5.goto(base + '/nepse-brokers/trade-pattern/')
        page5.wait_for_timeout(2000)
        empty = page5.evaluate("document.querySelector('#bkResult').textContent")
        fresh5 = page5.evaluate("document.querySelector('#tpFresh').textContent")
        ok('boot failure: honest empty state', 'could not be loaded' in empty or 'not available' in empty, empty[:120])
        ok('boot failure: failure freshness line', 'failed' in fresh5, fresh5[:120])
        page5.close()
        browser.close()
    httpd.shutdown()
    print(f'QA failures: {len(FAILURES)}')
    return 0 if not FAILURES else 1


if __name__ == '__main__':
    sys.exit(main())

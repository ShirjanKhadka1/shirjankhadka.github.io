#!/usr/bin/env python3
"""Bake a static broker-coverage snapshot into nepse-brokers/index.html.

Reads nepse-brokers/data/meta.json + periods/1D.json and writes a plain-HTML
snapshot between SNAP-START / SNAP-END markers, so crawlers and no-JS
visitors see real coverage info. The interactive views below remain the live
surface. Run after export_broker_data.py (or standalone); safe to re-run.
"""
import hashlib
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(REPO, 'nepse-brokers', 'index.html')
DATA = os.path.join(REPO, 'nepse-brokers', 'data')


def cr(x):
    return f'{x / 1e7:.1f}'


def main():
    meta = json.load(open(os.path.join(DATA, 'meta.json')))
    d1 = json.load(open(os.path.join(DATA, 'periods', '1D.json')))
    names = json.load(open(os.path.join(DATA, 'brokers.json')))
    brokers = sorted(d1.get('brokers', []), key=lambda b: b.get('total', 0), reverse=True)[:5]

    rows = []
    for i, b in enumerate(brokers, 1):
        net = b.get('net', 0) or 0
        net_s = ('+' if net >= 0 else '') + f'{net / 1e7:.1f}'
        rows.append(
            f'      <tr><td>{i}</td><td>{names.get(b.get("code", "?"), "Broker " + str(b.get("code", "?")))}</td>'
            f'<td>Rs {cr(b.get("buy_value", 0))} Cr</td>'
            f'<td>Rs {cr(b.get("sell_value", 0))} Cr</td>'
            f'<td>{net_s} Cr</td></tr>')

    frag = (
        '<section class="snap" aria-label="Broker coverage snapshot">\n'
        f'  <h2>Latest session broker flow <span class="snap-asof">· {d1.get("to", "")} · '
        f'{meta.get("trading_days", "?")} trading days on record ({meta.get("earliest", "?")} → {meta.get("latest", "?")})</span></h2>\n'
        '  <div class="scrollx" tabindex="0" role="region" aria-label="Latest session broker flow table"><table class="bk-table nd-table">\n'
        '    <thead><tr><th>#</th><th>Broker</th><th>Bought</th><th>Sold</th><th>Net flow</th></tr></thead>\n'
        '    <tbody>\n' + '\n'.join(rows) + '\n    </tbody>\n'
        '  </table></div>\n'
        '  <p class="snap-note">Static snapshot · net bought/sold is transaction flow, not verified shareholding. '
        f'The interactive period selectors below range from 1D to 3Y; views show whatever history is on record (currently from {meta.get("earliest", "?")}, growing daily).</p>\n'
        '</section>')

    html = open(PAGE).read()
    a = html.index('<!-- SNAP-START -->') + len('<!-- SNAP-START -->')
    b = html.index('<!-- SNAP-END -->')
    html = html[:a] + '\n' + frag + '\n' + html[b:]
    open(PAGE, 'w').write(html)
    print(f'snapshot baked into nepse-brokers/index.html ({len(brokers)} brokers, asof {d1.get("to")})')
    # Daily archive end: the asof view's honest gap boundary, kept fresh here
    # so the page never claims a daily file exists past the archive.
    daily_dir = os.path.join(DATA, 'daily')
    daily_dates = sorted(f[:-5] for f in os.listdir(daily_dir) if f.endswith('.json'))
    js_path = os.path.join(REPO, 'js', 'nepse-brokers.js')
    if daily_dates:
        js = open(js_path).read()
        js2, n = re.subn(r"var DAILY_END = '[^']*'", f"var DAILY_END = '{daily_dates[-1]}'", js)
        assert n == 1, 'DAILY_END not found in nepse-brokers.js'
        if js2 != js:
            open(js_path, 'w').write(js2)
            print(f'DAILY_END refreshed to {daily_dates[-1]} in js/nepse-brokers.js')
        else:
            print(f'DAILY_END already {daily_dates[-1]}')
    # Re-stamp the page's JS reference from the shipped bytes. This baker is
    # the only writer of nepse-brokers.js (DAILY_END), so the page's ?v=
    # stamp must track the file it ships. The Oct-30 snapshot PR (#242)
    # changed DAILY_END without re-stamping (the Oct-29 PR #106 had updated
    # the stamp by hand), which left every later daily run failing the
    # verifier's stamp check. Computing the stamp here makes the bake
    # self-consistent, and self-healing on no-change days too.
    stamp = hashlib.sha1(open(js_path, 'rb').read()).hexdigest()[:8]
    html = open(PAGE).read()
    html2, n = re.subn(r'nepse-brokers\.js\?v=[a-f0-9]+', f'nepse-brokers.js?v={stamp}', html)
    assert n == 1, 'nepse-brokers.js stamp ref not found exactly once in page'
    if html2 != html:
        open(PAGE, 'w').write(html2)
        print(f'JS stamp refreshed to {stamp} in nepse-brokers/index.html')
    else:
        print(f'JS stamp already {stamp}')


if __name__ == '__main__':
    sys.exit(main())

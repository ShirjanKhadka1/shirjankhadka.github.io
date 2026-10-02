#!/usr/bin/env python3
"""Bake a static broker-coverage snapshot into nepse-brokers/index.html.

Reads nepse-brokers/data/meta.json + periods/1D.json and writes a plain-HTML
snapshot between SNAP-START / SNAP-END markers, so crawlers and no-JS
visitors see real coverage info. The interactive views below remain the live
surface. Run after export_broker_data.py (or standalone); safe to re-run.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(REPO, 'nepse-brokers', 'index.html')
DATA = os.path.join(REPO, 'nepse-brokers', 'data')


def cr(x):
    return f'{x / 1e7:.1f}'


def main():
    meta = json.load(open(os.path.join(DATA, 'meta.json')))
    d1 = json.load(open(os.path.join(DATA, 'periods', '1D.json')))
    brokers = sorted(d1.get('brokers', []), key=lambda b: b.get('total', 0), reverse=True)[:5]

    rows = []
    for i, b in enumerate(brokers, 1):
        net = b.get('net', 0) or 0
        net_s = ('+' if net >= 0 else '') + f'{net / 1e7:.1f}'
        rows.append(
            f'      <tr><td>{i}</td><td>Broker {b.get("code", "?")}</td>'
            f'<td>Rs {cr(b.get("buy_value", 0))} Cr</td>'
            f'<td>Rs {cr(b.get("sell_value", 0))} Cr</td>'
            f'<td>{net_s} Cr</td></tr>')

    frag = (
        '<section class="snap" aria-label="Broker coverage snapshot">\n'
        f'  <h2>Latest session broker flow <span class="snap-asof">· {d1.get("to", "")} · '
        f'{meta.get("trading_days", "?")} trading days on record ({meta.get("earliest", "?")} → {meta.get("latest", "?")})</span></h2>\n'
        '  <div class="scrollx"><table class="bk-table">\n'
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


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Nepse Decode — corporate-actions verifier (read-only).

Cross-checks the published pipeline files against each other and against
the baked page, WITHOUT touching any data value:

  nepse-chart/data/corporate-actions.json  (the notice archive)
  nepse-chart/data/div-live.json          (dividend figures + book-closes)
  nepse-chart/data/verdicts.json          (sector per symbol)
  nepse-chart/data/universe.json          (company names)
  nepse-actions/index.html                (baked page, generator output)
  css/nd-actions.css, js/nepse-actions.js (page assets, stamp-checked)
  data/corporate-actions-ledger.json      (if present, consistency-checked)

FAIL = defect (exit 1). WARN = data note that must be reported honestly,
never silently "fixed" by hand-editing a data value. The verifier never
writes to the data files; it only reads them.

Usage: python3 tools/verify-actions.py [--root DIR] [--ledger FILE]
"""
import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path

KNOWN_KINDS = {'dividend', 'bonus-share', 'right-share', 'promoter-share',
               'auction', 'lock-in', 'meeting', 'book-close'}
STATUS_KINDS = {'dividend', 'bonus-share', 'right-share'}
ISO = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def parse_iso(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def sha1_8(p):
    return hashlib.sha1(Path(p).read_bytes()).hexdigest()[:8]


def div_match(div, it):
    """Nearest div-live record by announcement_date within 60 days."""
    if not div or not div.get('companies') or not it.get('symbol'):
        return None
    recs = div['companies'].get(it['symbol'])
    if not recs:
        return None
    ann = parse_iso(it.get('announced'))
    best, best_d = None, 9999
    for r in recs:
        rd = parse_iso(r.get('announcement_date'))
        if not ann or not rd:
            continue
        d = abs((rd - ann).days)
        if d < best_d:
            best, best_d = r, d
    return best if best_d <= 60 else None


def div_bookclose(div, it):
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', str(it.get('bookclose_date') or ''))
    if m:
        return m.group(1), 'item'
    rec = div_match(div, it)
    if rec:
        m2 = re.match(r'^(\d{4}-\d{2}-\d{2})', str(rec.get('bookclose_date') or ''))
        if m2:
            return m2.group(1), 'div-live'
    return '', 'none'


def status_of(div, it, today):
    if it.get('kind') not in STATUS_KINDS:
        return None
    bc, _ = div_bookclose(div, it)
    if ISO.match(bc):
        return 'Closed' if bc < today.isoformat() else 'Open'
    ann = parse_iso(it.get('announced'))
    if ann:
        days = (today - ann).days
        if 0 <= days <= 365:
            return 'Open'
    return None


def main():
    root = Path(sys.argv[sys.argv.index('--root') + 1]) if '--root' in sys.argv else Path('.')
    ledger_arg = Path(sys.argv[sys.argv.index('--ledger') + 1]) if '--ledger' in sys.argv else None
    fails, warns, infos = [], [], []

    def fail(msg):
        fails.append(msg)

    def warn(msg):
        warns.append(msg)

    def info(msg):
        infos.append(msg)

    ca = json.loads((root / 'nepse-chart/data/corporate-actions.json').read_text())
    div = json.loads((root / 'nepse-chart/data/div-live.json').read_text())
    verdicts_doc = json.loads((root / 'nepse-chart/data/verdicts.json').read_text())
    verdicts = verdicts_doc.get('verdicts', verdicts_doc)
    uni = json.loads((root / 'nepse-chart/data/universe.json').read_text())
    items = ca.get('items', [])

    # --- 1. shape ---
    if ca.get('count') != len(items):
        fail(f"count field {ca.get('count')} != len(items) {len(items)}")
    if not ca.get('updated'):
        fail('corporate-actions.json has no updated timestamp')
    if not div.get('asof') or not isinstance(div.get('companies'), dict):
        fail('div-live.json missing asof/companies')

    # --- 2. per-item shape + uniqueness ---
    seen_keys, seen_tuples = set(), set()
    for it in items:
        sym = it.get('symbol') or '-'
        if it.get('kind') not in KNOWN_KINDS:
            fail(f"unknown kind {it.get('kind')!r} on {sym}")
        if not it.get('headline'):
            fail(f"empty headline on {sym} {it.get('announced')}")
        if not parse_iso(it.get('announced')):
            fail(f"bad announced date {it.get('announced')!r} on {sym}")
        if not it.get('verifiedAt'):
            fail(f"missing verifiedAt on {sym} {it.get('announced')}")
        sk = it.get('storyKey')
        if not sk:
            warn(f"missing storyKey on {sym} {it.get('announced')}")
        elif sk in seen_keys:
            fail(f"duplicate storyKey {sk}")
        else:
            seen_keys.add(sk)
        tup = (it.get('kind'), it.get('symbol'), it.get('announced'), it.get('headline'))
        if tup in seen_tuples:
            fail(f"duplicate item {tup}")
        seen_tuples.add(tup)
        if not it.get('symbol'):
            warn(f"empty-symbol item: {it.get('headline', '')[:60]} (preference-share book-closure note)")

    # --- 3. PDF presence + host ---
    for it in items:
        sym = it.get('symbol') or '-'
        pdf = it.get('officialPdf') or ''
        if not pdf:
            warn(f"no officialPdf on {sym} {it.get('announced')} (backfilled item; page renders no PDF link)")
        elif 'nepalstock.com' not in pdf:
            warn(f"officialPdf off-host on {sym}: {pdf[:80]}")

    # --- 4. announced vs PDF path date ---
    for it in items:
        pdf = it.get('officialPdf') or ''
        m = re.search(r'/(\d{4}-\d{2}-\d{2})/', pdf)
        ann = parse_iso(it.get('announced'))
        if m and ann:
            gap = abs((parse_iso(m.group(1)) - ann).days)
            if gap > 3:
                warn(f"announced-vs-PDF gap {gap}d on {it.get('symbol') or '-'} "
                     f"(announced {it.get('announced')}, PDF dated {m.group(1)}; "
                     f"announced = mirror-surface date, not the PDF date)")
        if '&amp;' in str(it.get('headline') or ''):
            warn(f"headline carries a pre-escaped entity on {it.get('symbol') or '-'} "
                 f"(renders as literal &amp;; upstream collector stored an escaped title)")

    # --- 5. div-live join coverage (dividend/bonus items) ---
    div_items = [it for it in items if it.get('kind') in ('dividend', 'bonus-share')]
    matched = [it for it in div_items if div_match(div, it)]
    for it in div_items:
        if not div_match(div, it):
            warn(f"no div-live record for dividend item {it.get('symbol') or '-'} "
                 f"announced {it.get('announced')} (card renders figure-less, honestly)")
    info(f"div-live join: {len(matched)}/{len(div_items)} dividend/bonus items matched")

    # --- 6. book-close resolution + status counts ---
    # NPT date, not system date: at 00:00-05:45 NPT the UTC date is a day behind.
    from datetime import datetime
    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo('Asia/Kathmandu')).date()
    except Exception:
        today = date.today()
    opens = closed = nostatus = 0
    resolved = {}
    for it in items:
        bc, src = div_bookclose(div, it)
        if it.get('kind') in STATUS_KINDS:
            resolved[(it.get('symbol'), it.get('announced'))] = (bc, src)
            st = status_of(div, it, today)
            if st == 'Open':
                opens += 1
            elif st == 'Closed':
                closed += 1
            else:
                nostatus += 1
        else:
            nostatus += 1
    if opens + closed + nostatus != len(items):
        fail('status counts do not sum to item count')
    info(f"status at build date: Open {opens} · Closed {closed} · no status {nostatus}")
    for sym, ann, want_bc, want_src in [
            ('MEN', '2026-10-13', '2026-10-26', 'div-live'),
            ('BARUN', '2026-10-13', '2026-10-28', 'div-live'),
            ('MFIL', '2026-10-09', '2026-10-28', 'item'),
            ('VLUCL', '2026-10-26', '2026-11-02', 'div-live')]:
        got = resolved.get((sym, ann), ('', 'none'))
        if got != (want_bc, want_src):
            fail(f"book-close resolution for {sym} {ann}: got {got}, want {(want_bc, want_src)}")

    # --- 7. sector join ---
    vset = set(verdicts)
    uset = {s['s'] for s in uni.get('symbols', [])}
    if len(vset) != len(uset) or vset != uset:
        fail(f"verdicts/universe symbol sets differ: verdicts {len(vset)}, universe {len(uset)}")
    missing = [it.get('symbol') for it in items if it.get('symbol') and it['symbol'] not in vset]
    if missing:
        warn(f"archive symbols missing from verdicts (no sector join): {missing}")
    info(f"sector join: {len(vset)} verdicts symbols == {len(uset)} universe symbols")

    # --- 8. cross-file staleness ---
    div_newest = max((r.get('announcement_date', '') for recs in div['companies'].values() for r in recs), default='')
    pdf_dates = []
    for it in items:
        m = re.search(r'/(\d{4}-\d{2}-\d{2})/', it.get('officialPdf') or '')
        if m:
            pdf_dates.append(m.group(1))
    newest_pdf = max(pdf_dates) if pdf_dates else ''
    if newest_pdf > div_newest:
        fail(f"newest corporate-actions PDF date {newest_pdf} is newer than div-live's "
             f"newest announcement {div_newest} — dividend calendar may be behind")
    else:
        info(f"staleness: div-live newest announcement {div_newest} >= newest archive PDF date {newest_pdf} — no gap")
    info(f"asof: corporate-actions updated {ca.get('updated')}, div-live asof {div.get('asof')}")

    # --- 9. baked page checks ---
    page = (root / 'nepse-actions/index.html').read_text()
    cards = re.findall(r'<article class="na-card"', page)
    if len(cards) != len(items):
        fail(f"baked cards {len(cards)} != archive items {len(items)}")
    if 'breadcrumb' in page.lower():
        fail('breadcrumb present in baked page (design master §3.2 forbids it)')
    if 'fonts.googleapis.com' in page:
        fail('Google Fonts CDN link present (master requires self-hosted fonts.css)')
    if re.search(r'<script>(?!\s*\(function\(\)\{try\{var t=localStorage)', page):
        fail('inline page script beyond the theme FOUC guard (page logic must live in js/nepse-actions.js)')
    if 'js/nepse-actions.js' not in page:
        fail('js/nepse-actions.js not referenced')
    m = re.search(r'js/nepse-actions\.js\?v=([0-9a-f]{8})', page)
    if not m or m.group(1) != sha1_8(root / 'js/nepse-actions.js'):
        fail('nepse-actions.js stamp is not the file sha1')
    for css, pat in [('nd-editorial-theme.css', r'nd-editorial-theme\.css\?v=([0-9a-f]{8})'),
                     ('nd-cinema.css', r'nd-cinema\.css\?v=([0-9a-f]{8})'),
                     ('nd-chrome.css', r'nd-chrome\.css\?v=([0-9a-f]{8})'),
                     ('nd-actions.css', r'nd-actions\.css\?v=([0-9a-f]{8})')]:
        mm = re.search(pat, page)
        if not mm or mm.group(1) != sha1_8(root / 'css' / css):
            fail(f'{css} stamp is not the file sha1')
    if 'fonts.css' not in page or 'nd-cinema.css' not in page:
        fail('master head stack incomplete (fonts.css / nd-cinema.css missing)')
    if 'For education only. Not investment advice.' not in page:
        fail('verbatim footer-law first sentence missing from page note')
    css = (root / 'css/nd-actions.css').read_text()
    if '[data-theme="dark"] body.nd[data-page="actions"]' not in css:
        fail('theme-scoped canvas pin missing from nd-actions.css')
    if 'class="na-page-btn is-next" id="na-next"' not in page:
        fail('feed Next button lacks lime-primary class')
    opts = len(re.findall(r'<option', page))
    if opts != 16:
        fail(f"sector select options {opts} != 16 (All + 15 sectors)")
    sec_body = re.search(r'<tbody id="na-sector-body">(.*?)</tbody>', page, re.S)
    if not sec_body or sec_body.group(1).count('<tr>') != 25:
        fail('baked sector table is not the 25-row first page')
    chips = len(re.findall(r'class="na-session', page)) - 1  # minus the strip container
    sess_dates = {str(it.get('announced'))[:10] for it in items if it.get('announced')}
    if chips != len(sess_dates) + 1:
        fail(f"session chips {chips} != All + {len(sess_dates)} sessions")
    if page.count('na-viz-panel') != 3:
        fail('viz panels != 3')
    closes = re.search(r'<ul class="na-closes">(.*?)</ul>', page, re.S)
    # Upcoming closes mirror the baker (build-actions-page.js): dividend /
    # bonus / right items whose resolved book-close is today or later.
    # Never a hardcoded count: MEN's 2026-10-26 close made yesterday's list
    # 4 and today's 3 (BHDC was never in the archive's list at all).
    exp_closes = [(it.get('symbol'), div_bookclose(div, it)[0])
                  for it in items if it.get('kind') in STATUS_KINDS]
    exp_closes = [(s, b) for s, b in exp_closes if b and b >= today.isoformat()]
    if not exp_closes:
        if closes:
            fail('baked upcoming-closes list present but none expected')
    elif not closes or closes.group(1).count('<li>') != len(exp_closes):
        got = closes.group(1).count('<li>') if closes else 0
        fail(f"baked upcoming-closes list {got} != expected {len(exp_closes)} "
             f"({', '.join(s + ' ' + b for s, b in exp_closes)})")
    else:
        info(f"baked upcoming-closes: {len(exp_closes)} "
             f"({', '.join(s + ' ' + b for s, b in exp_closes)})")
    info(f"baked page: {len(cards)} cards, {opts} sector options, {chips} session chips, 3 viz panels")

    # --- 10. ledger consistency (if present) ---
    if ledger_arg and Path(ledger_arg).exists():
        led = json.loads(Path(ledger_arg).read_text())
        sess_sum = sum(s.get('count', 0) for s in led.get('sessions', []))
        if sess_sum != len(items):
            fail(f"ledger sessions sum {sess_sum} != items {len(items)}")
        led_items = {(i.get('symbol') or '', i.get('announced')): i for i in led.get('items', [])}
        for it in items:
            li = led_items.get((it.get('symbol') or '', it.get('announced')))
            if not li:
                fail(f"ledger missing item {it.get('symbol')} {it.get('announced')}")
                continue
            bc, src = div_bookclose(div, it)
            if li.get('bookclose', '') != bc or li.get('bookclose_source', '') != src:
                fail(f"ledger bookclose mismatch on {it.get('symbol')}: {li.get('bookclose')}/{li.get('bookclose_source')} vs {bc}/{src}")
        info(f"ledger consistent: {len(led.get('items', []))} items, {len(led.get('sessions', []))} sessions")

    print(f"PASS {len(infos)} infos, WARN {len(warns)}, FAIL {len(fails)}")
    for msg in infos:
        print(f"  info: {msg}")
    for msg in warns:
        print(f"  WARN: {msg}")
    for msg in fails:
        print(f"  FAIL: {msg}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())

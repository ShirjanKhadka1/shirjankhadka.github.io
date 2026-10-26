#!/usr/bin/env python3
"""Nepse Decode — corporate-actions session ledger builder (read-only inputs).

Derives data/corporate-actions-ledger.json from the published pipeline
files (never hand-edits a data value):

  nepse-chart/data/corporate-actions.json  (notice archive)
  nepse-chart/data/div-live.json          (book-closes)
  nepse-chart/data/verdicts.json          (sector per symbol, optional)

Ledger contents:
  sessions        — items grouped by ANNOUNCED date (the notice's session)
  recording_runs  — items grouped by VERIFIED date (when each entered the
                    archive; reconstructed from verifiedAt — the archive
                    carries no separate run log, so pre-archive runs are
                    not inventable and are not claimed)
  items           — per item: resolved book-close + its source (item /
                    div-live / none), status at build time, and the first
                    Closed date (book-close + 1 day, since Closed means
                    book-close < today)
  upcoming_closes — resolved book-closes on/after the build date, nearest first
  data_notes      — computed data-quality notes (missing PDF, missing
                    div-live record, announced-vs-PDF gap, pre-escaped
                    headline entity); reported, never hand-fixed
  runs            — append-only build-run records, idempotent on
                    (run_date, input_hash): a rerun with unchanged inputs
                    appends nothing

Usage: python3 tools/build-actions-ledger.py [--root DIR]
         [--verifier pass|fail|skip] [--page-rebuilt 0|1]
"""
import argparse
import hashlib
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    TODAY = datetime.now(ZoneInfo('Asia/Kathmandu')).date()
except Exception:
    TODAY = date.today()

STATUS_KINDS = {'dividend', 'bonus-share', 'right-share'}
ISO = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def parse_iso(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def div_match(div, it):
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
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='.')
    ap.add_argument('--verifier', default='skip', choices=['pass', 'fail', 'skip'])
    ap.add_argument('--page-rebuilt', default='0', choices=['0', '1'])
    args = ap.parse_args()
    root = Path(args.root)

    ca_bytes = (root / 'nepse-chart/data/corporate-actions.json').read_bytes()
    div_bytes = (root / 'nepse-chart/data/div-live.json').read_bytes()
    ca = json.loads(ca_bytes)
    div = json.loads(div_bytes)
    try:
        verdicts = json.loads((root / 'nepse-chart/data/verdicts.json').read_text())
        vmap = verdicts.get('verdicts', verdicts)
    except FileNotFoundError:
        vmap = {}
    items = sorted(ca.get('items', []),
                   key=lambda i: str(i.get('announced') or ''), reverse=True)

    input_hash = hashlib.sha1(ca_bytes + b'\n' + div_bytes).hexdigest()[:12]

    sessions_d = {}
    runs_d = {}
    ledger_items = []
    notes = []
    for it in items:
        sym = it.get('symbol') or ''
        ann = str(it.get('announced') or '')[:10]
        ver = str(it.get('verifiedAt') or '')[:10]
        bc, src = div_bookclose(div, it)
        st = status_of(div, it, TODAY)
        first_closed = None
        if bc and ISO.match(bc):
            first_closed = (parse_iso(bc) + timedelta(days=1)).isoformat()
        sessions_d.setdefault(ann, []).append(
            {'symbol': sym, 'kind': it.get('kind'), 'headline': it.get('headline')})
        runs_d.setdefault(ver, []).append(it.get('storyKey') or f"{it.get('kind')}|{sym}|{ann}")
        ledger_items.append({
            'symbol': sym, 'kind': it.get('kind'), 'announced': ann,
            'pdf_date': (re.search(r'/(\d{4}-\d{2}-\d{2})/', it.get('officialPdf') or '') or [None, ''])[1],
            'verified_at': ver, 'sector': (vmap.get(sym) or {}).get('sec') if sym in vmap else None,
            'bookclose': bc, 'bookclose_source': src,
            'status_at_build': st, 'first_closed_date': first_closed,
        })
        if not it.get('officialPdf'):
            notes.append({'level': 'WARN', 'item': f"{sym or '-'} {ann}",
                          'message': 'no official PDF link (backfilled item)'})
        if it.get('kind') in ('dividend', 'bonus-share') and not div_match(div, it):
            notes.append({'level': 'WARN', 'item': f"{sym or '-'} {ann}",
                          'message': 'no div-live record; card renders figure-less'})
        pdf_m = re.search(r'/(\d{4}-\d{2}-\d{2})/', it.get('officialPdf') or '')
        ann_d = parse_iso(ann)
        if pdf_m and ann_d and abs((parse_iso(pdf_m.group(1)) - ann_d).days) > 3:
            notes.append({'level': 'WARN', 'item': f"{sym or '-'} {ann}",
                          'message': f"announced-vs-PDF gap {abs((parse_iso(pdf_m.group(1)) - ann_d).days)}d; "
                                     'announced = mirror-surface date, not the PDF date'})
        if '&amp;' in str(it.get('headline') or ''):
            notes.append({'level': 'WARN', 'item': f"{sym or '-'} {ann}",
                          'message': 'headline carries a pre-escaped entity (&amp;)'})

    sessions = [{'date': d, 'count': len(v), 'items': v}
                for d, v in sorted(sessions_d.items(), reverse=True)]
    recording_runs = [{'date': d, 'added': v, 'count': len(v)}
                      for d, v in sorted(runs_d.items(), reverse=True)]
    upcoming = sorted(
        [{'symbol': i['symbol'], 'kind': i['kind'], 'bookclose': i['bookclose'],
          'days_from_build': (parse_iso(i['bookclose']) - TODAY).days}
         for i in ledger_items
         if i['kind'] in STATUS_KINDS and i['bookclose'] and i['bookclose'] >= TODAY.isoformat()],
        key=lambda u: u['bookclose'])

    out_path = root / 'data/corporate-actions-ledger.json'
    prev = {}
    if out_path.exists():
        try:
            prev = json.loads(out_path.read_text())
        except json.JSONDecodeError:
            prev = {}
    runs = prev.get('runs', [])
    run_date = TODAY.isoformat()
    if not any(r.get('run_date') == run_date and r.get('input_hash') == input_hash for r in runs):
        runs.append({'run_date': run_date, 'input_hash': input_hash,
                     'items_total': len(items), 'verifier': args.verifier,
                     'page_rebuilt': args.page_rebuilt == '1'})
    runs = runs[-90:]  # keep the last 90 runs; older history stays in git

    doc = {
        'meta': {
            'built_at_npt': run_date,
            'builder': 'tools/build-actions-ledger.py',
            'sources': {'corporate_actions_updated': ca.get('updated'),
                        'div_live_asof': div.get('asof')},
            'items_total': len(items),
            'sessions_total': len(sessions),
            'provenance': ('sessions group by ANNOUNCED date; recording_runs group by '
                           'VERIFIED date reconstructed from verifiedAt; no separate run log '
                           'exists, so earlier runs are not inventable'),
        },
        'sessions': sessions,
        'recording_runs': recording_runs,
        'items': ledger_items,
        'upcoming_closes': upcoming,
        'data_notes': notes,
        'runs': runs,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'ledger': str(out_path), 'items': len(items),
                      'sessions': len(sessions), 'upcoming_closes': len(upcoming),
                      'notes': len(notes), 'runs_total': len(runs),
                      'input_hash': input_hash}, indent=2))


if __name__ == '__main__':
    main()

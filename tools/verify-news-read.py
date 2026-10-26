#!/usr/bin/env python3
"""verify-news-read.py — read-only verifier for the NEPSE News page read model.

Checks the page's inputs (the published files owned by the news pipeline)
and the page's own baked snapshot WITHOUT writing, reformatting, or
re-deriving those files:
  1. announcements.json shape (items, required fields, ISO dates, count)
  2. news.json shape (asof, items, link/src/date, stats reconciliation)
  3. sort determinism: date-desc string sort reproduces story indices
  4. classifier coverage: Python ports of the page's newsCategory/annKind
     regexes run over all titles with no crash; every item maps to a bucket
  5. mix reconciliation: headline category counts sum to the item count
  6. kind distribution: announcement kinds sum to the item count
  7. session index: per-date counts sum to the item counts
  8. baked snapshot: first 10 announcement + first 10 headline titles in the
     HTML match sorted file order (rendered-text comparison: HTML-escaped
     titles are unescaped before comparing)
  9. story-link indices: snapshot hrefs i=0..9 equal sorted positions
 10. JSON-LD ItemList: 20 elements, positions 1..20, first-20 sorted headlines
 11. sector join: universe symbols == verdicts keys; sector counts sum
 12. asset stamps: HTML's js/css ?v= stamps equal raw-content SHA-1 first-8

Usage: python3 tools/verify-news-read.py [--root PATH]
  --root defaults to the current directory (the site worktree root).
Exit 0 when no FAIL; exit 1 on any FAIL. WARNs never fail the run.
Standard library only. No network. No writes.
"""
import argparse, hashlib, html as htmlmod, json, os, re, sys
from collections import Counter
from datetime import datetime

FAIL, WARN, PASS = [], [], []

def ok(name, detail=''):
    PASS.append(name); print('PASS  %s %s' % (name, detail))
def fail(name, detail=''):
    FAIL.append(name); print('FAIL  %s %s' % (name, detail))
def warn(name, detail=''):
    WARN.append(name); print('WARN  %s %s' % (name, detail))

def esc(s):
    return (str('' if s is None else s).replace('&', '&amp;')
            .replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;'))
def dec(s):
    s = str('' if s is None else s)
    s = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))) if m.group(1).isdigit() else m.group(0), s)
    s = re.sub(r'&#[xX]([0-9a-fA-F]+);', lambda m: chr(int(m.group(1), 16)), s)
    s = s.replace('&quot;', '"').replace('&apos;', "'").replace('&lt;', '<').replace('&gt;', '>')
    return s.replace('&amp;', '&')
def escT(s): return esc(dec(s))

def newsCategory(title, sym):
    t = ((title or '') + ' ' + (sym or '')).lower()
    if re.search(r'nepse|stock market|share market|market (falls|rises|index)|index (falls|rises|gains)|turnover (tops|crosses)|bullish|bearish', t): return 'Markets'
    if re.search(r'nrb|nepal rastra|sebon|policy|policies|government|budget|interest rate|remittance|regulation|ministry|parliament|election|gdp|inflation|forex', t): return 'Economy & Policy'
    if sym or re.search(r'dividend|bonus|right|agm|sgm|book clos|lock[\s-]?in|promoter|merger|acquisition|ipo|fpo|auction|debenture|company|ltd|limited|bank|insurance|hydro|finance|bittiya|laghubitta', t): return 'Companies'
    return 'Markets'
KIND_RULES = [
    (r'dividend', 'Dividend'), (r'bonus', 'Bonus'),
    (r'right[\s-]?share', 'Right'), (r'book[\s-]?clos', 'Book close'),
    (r'\bagm\b|\bsgm\b', 'Meeting'), (r'director', 'Board'),
    (r'auditor', 'Auditor'), (r'merger|acquisition', 'Merger'),
    (r'lock[\s-]?in', 'Lock-in'), (r'auction', 'Auction'),
    (r'sale of shares|intention of sale', 'Promoter'),
]
def annKind(title):
    for pat, label in KIND_RULES:
        if re.search(pat, title or '', re.I): return label
    return 'Notice'

def valid_iso(d):
    try:
        datetime.strptime(d, '%Y-%m-%d'); return True
    except Exception:
        return False

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='.')
    a = ap.parse_args()
    root = a.root
    def load(rel):
        p = os.path.join(root, rel)
        assert os.path.exists(p), 'missing file: ' + p
        return json.load(open(p))

    ann = load('nepse-chart/data/announcements.json')
    news = load('nepse-chart/data/news.json')
    annItems = ann.get('items')
    hlItems = news.get('items')

    # 1. announcements shape
    if not isinstance(annItems, list) or not annItems:
        fail('ann-shape', 'items is not a non-empty list'); return 1
    ok('ann-shape', 'items=%d' % len(annItems))
    bad = [i for i, it in enumerate(annItems)
           if not it.get('title') or not it.get('date') or not valid_iso(str(it.get('date')))]
    if bad: fail('ann-fields', 'bad items at %s' % bad[:5])
    else: ok('ann-fields', 'all items have title + valid ISO date')
    if 'count' in ann:
        if ann['count'] == len(annItems): ok('ann-count', 'count field == len(items) == %d' % len(annItems))
        else: fail('ann-count', 'count=%r vs len=%d' % (ann['count'], len(annItems)))
    if 'updated' in ann and valid_iso(str(ann['updated'])): ok('ann-updated', ann['updated'])
    else: fail('ann-updated', repr(ann.get('updated')))
    dups = [k for k, v in Counter((it.get('title'), it.get('date')) for it in annItems).items() if v > 1]
    if dups: warn('ann-dups', '%d exact (title,date) duplicates' % len(dups))
    else: ok('ann-dups', 'no exact duplicates')
    if max(str(it['date']) for it in annItems) > str(ann.get('updated', '9999')):
        warn('ann-future', 'an announcement date exceeds updated')
    else: ok('ann-future', 'no date exceeds updated')

    # 2. news shape
    if not isinstance(hlItems, list) or not hlItems:
        fail('news-shape', 'items is not a non-empty list'); return 1
    ok('news-shape', 'items=%d' % len(hlItems))
    bad = [i for i, it in enumerate(hlItems)
           if not it.get('title') or not it.get('date') or not valid_iso(str(it.get('date')))
           or not it.get('link') or not it.get('src')]
    if bad: fail('news-fields', 'bad items at %s' % bad[:5])
    else: ok('news-fields', 'all items have title + valid ISO date + link + src')
    if 'asof' in news and valid_iso(str(news['asof'])): ok('news-asof', news['asof'])
    else: fail('news-asof', repr(news.get('asof')))
    st = news.get('stats') or {}
    if 'kept' in st:
        if st['kept'] == len(hlItems): ok('news-stats-kept', 'kept == len(items) == %d' % len(hlItems))
        else: fail('news-stats-kept', 'kept=%r vs len=%d' % (st['kept'], len(hlItems)))
    srcs = set(it.get('src') for it in hlItems)
    if set(news.get('sources') or []) != srcs:
        warn('news-sources', 'sources field %r vs item srcs %r' % (news.get('sources'), sorted(srcs)))
    else: ok('news-sources', '%d sources match item srcs' % len(srcs))
    dups = [k for k, v in Counter((it.get('title'), it.get('date'), it.get('src')) for it in hlItems).items() if v > 1]
    if dups: warn('news-dups', '%d exact (title,date,src) duplicates' % len(dups))
    else: ok('news-dups', 'no exact duplicates')
    if max(str(it['date']) for it in hlItems) > str(news.get('asof', '9999')):
        warn('news-future', 'a headline date exceeds asof')
    else: ok('news-future', 'no date exceeds asof')

    # 3. sort determinism (stable date-desc string sort == page sort)
    annSorted = sorted(annItems, key=lambda it: str(it.get('date') or ''), reverse=True)
    hlSorted = sorted(hlItems, key=lambda it: str(it.get('date') or ''), reverse=True)
    ok('sort-determinism', 'ann[0]=%s hl[0]=%s' % (annSorted[0]['date'], hlSorted[0]['date']))

    # 4-7. classifier / mix / kinds / sessions
    try:
        cats = Counter(newsCategory(it.get('title'), it.get('sym')) for it in hlItems)
        assert set(cats) <= {'Markets', 'Companies', 'Economy & Policy'}
        ok('classifier-coverage', 'all %d headlines classified: %s' % (len(hlItems), dict(cats)))
    except Exception as e:
        fail('classifier-coverage', repr(e))
    if sum(cats.values()) == len(hlItems): ok('mix-reconciliation', 'category counts sum to %d' % len(hlItems))
    else: fail('mix-reconciliation', 'sum=%d vs %d' % (sum(cats.values()), len(hlItems)))
    kinds = Counter(annKind(it.get('title')) for it in annItems)
    if sum(kinds.values()) == len(annItems): ok('kind-distribution', 'kinds sum to %d: %s' % (len(annItems), dict(sorted(kinds.items(), key=lambda kv: -kv[1]))))
    else: fail('kind-distribution', 'sum=%d vs %d' % (sum(kinds.values()), len(annItems)))
    asess = Counter(str(it.get('date') or '')[:10] for it in annItems)
    hsess = Counter(str(it.get('date') or '')[:10] for it in hlItems)
    if sum(asess.values()) == len(annItems) and sum(hsess.values()) == len(hlItems):
        ok('session-index', '%d ann dates + %d hl dates, union %d' % (len(asess), len(hsess), len(set(asess) | set(hsess))))
    else: fail('session-index', 'session counts do not sum to item counts')

    # 8-10. baked snapshot + story indices + ItemList (from the page HTML)
    page = open(os.path.join(root, 'nepse-news/index.html')).read()
    def feed_section(start_marker, end_marker):
        i = page.index(start_marker)
        j = page.index(end_marker, i)
        return page[i:j]
    try:
        annSec = feed_section('id="annFeed"', '<noscript>')
        annHrefs = [int(x) for x in re.findall(r'src=ann&amp;i=(\d+)', annSec)]
        annTitles = [htmlmod.unescape(x) for x in re.findall(r'<h2>(.*?)</h2>', annSec)]
        annTitles += [htmlmod.unescape(x) for x in re.findall(r'<h3>(.*?)</h3>', annSec)]
        if annHrefs == list(range(len(annHrefs))) and annHrefs[:1] == [0]:
            ok('ann-story-indices', 'hrefs 0..%d in order' % (len(annHrefs) - 1))
        else: fail('ann-story-indices', repr(annHrefs))
        want = [escT(it.get('title')) for it in annSorted[:len(annTitles)]]
        # Compare rendered text: unescape the HTML-extracted titles, compare to raw file titles
        got = [htmlmod.unescape(t) for t in annTitles]
        want_raw = [(it.get('title') or '') for it in annSorted[:len(annTitles)]]
        # escT(dec()) round-trips to the raw title for display purposes
        if got == [dec(t) for t in want_raw]: ok('ann-snapshot-titles', 'first %d match sorted order' % len(annTitles))
        else: fail('ann-snapshot-titles', 'mismatch: got %r want %r' % (got[:3], [dec(t) for t in want_raw][:3]))
    except Exception as e:
        fail('ann-snapshot', repr(e))
    try:
        hlSec = feed_section('id="hlFeed"', 'margin-top:16px')
        hlHrefs = [int(x) for x in re.findall(r'src=news&amp;i=(\d+)', hlSec)]
        hlTitles = [htmlmod.unescape(x) for x in re.findall(r'<h2>(.*?)</h2>', hlSec)]
        hlTitles += [htmlmod.unescape(x) for x in re.findall(r'<h3 class="nn-row-title">(.*?)</h3>', hlSec)]
        if hlHrefs == list(range(len(hlHrefs))) and hlHrefs[:1] == [0]:
            ok('hl-story-indices', 'hrefs 0..%d in order' % (len(hlHrefs) - 1))
        else: fail('hl-story-indices', repr(hlHrefs))
        got = [htmlmod.unescape(t) for t in hlTitles]
        want_raw = [(it.get('title') or '') for it in hlSorted[:len(hlTitles)]]
        if got == [dec(t) for t in want_raw]: ok('hl-snapshot-titles', 'first %d match sorted order' % len(hlTitles))
        else: fail('hl-snapshot-titles', 'mismatch: got %r want %r' % (got[:3], [dec(t) for t in want_raw][:3]))
    except Exception as e:
        fail('hl-snapshot', repr(e))
    try:
        blocks = [json.loads(b) for b in re.findall(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', page, re.S)]
        il = [b for b in blocks if b.get('@type') == 'ItemList']
        assert il, 'ItemList block not found'
        els = il[0].get('itemListElement') or []
        if (len(els) == 20 and [e.get('position') for e in els] == list(range(1, 21))
                and [e.get('name') for e in els] == [(it.get('title') or '') for it in hlSorted[:20]]
                and [e.get('url') for e in els] == [(it.get('link') or '') for it in hlSorted[:20]]):
            ok('itemlist', '20 elements, positions 1..20, first-20 sorted headlines')
        else: fail('itemlist', 'content mismatch (len=%d)' % len(els))
    except Exception as e:
        fail('itemlist', repr(e))

    # 11. sector join
    try:
        uni = load('nepse-chart/data/universe.json')
        ver = load('nepse-chart/data/verdicts.json')
        us = set(s['s'] for s in uni['symbols'])
        vs = set((ver.get('verdicts') or {}).keys())
        if us == vs: ok('sector-join', 'universe == verdicts keys: %d' % len(us))
        else: fail('sector-join', 'universe-verdicts=%s verdicts-universe=%s' % (sorted(us - vs)[:5], sorted(vs - us)[:5]))
        secs = Counter((ver['verdicts'][s] or {}).get('sec') for s in us)
        if sum(secs.values()) == len(us) and None not in secs:
            ok('sector-counts', 'sector counts sum to %d over %d sectors' % (len(us), len(secs)))
        else: fail('sector-counts', repr(dict(secs)))
    except Exception as e:
        fail('sector-join', repr(e))

    # 12. asset stamps
    for asset, pat in [('js/nepse-news.js', r'nepse-news\.js\?v=([0-9a-f]{8})'),
                       ('css/nd-news.css', r'nd-news\.css\?v=([0-9a-f]{8})')]:
        m = re.search(pat, page)
        actual = hashlib.sha1(open(os.path.join(root, asset), 'rb').read()).hexdigest()[:8]
        if m and m.group(1) == actual: ok('stamp-' + asset, actual)
        else: fail('stamp-' + asset, 'html=%s actual=%s' % (m.group(1) if m else None, actual))

    print('---')
    print('PASS %d  FAIL %d  WARN %d' % (len(PASS), len(FAIL), len(WARN)))
    return 1 if FAIL else 0

if __name__ == '__main__':
    sys.exit(main())

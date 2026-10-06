#!/usr/bin/env python3
"""Regenerate the static SEO snapshot in nepse-news/index.html from current JSON feeds.

Replicates the page's own JS rendering logic (monoColor, monoText, fmtDate,
annKind, newsCategory, CAT_CLASS, esc/escT) so the no-JS/SEO snapshot matches
what JS users see. Updates the hardcoded 'Updated ...' stamps to today.
"""
import json, re, html, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'nepse-news', 'index.html')

MON3 = {'01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun',
        '07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'}
MONO_COLORS = ['#1d4d3b','#8a6d2f','#334155','#7c2d3e','#2f5d62','#5b4a8a']

def dec(s):
    s = str(s or '')
    return (s.replace('&quot;', '"').replace('&#39;', "'").replace('&lt;', '<')
             .replace('&gt;', '>').replace('&amp;', '&'))
def esc(s):
    return html.escape(str(s or ''), quote=True)
def escT(s):
    return esc(dec(s))
def fmtDate(iso):
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', str(iso or ''))
    if not m: return str(iso or '')
    return '%d %s %s' % (int(m.group(3)), MON3.get(m.group(2), m.group(2)), m.group(1))
def monoColor(sym):
    h = 0
    for ch in str(sym or '?'):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return MONO_COLORS[h % len(MONO_COLORS)]
def monoText(sym):
    s = re.sub(r'[^A-Za-z0-9]', '', str(sym or '?'))
    return (s[:2] or '?').upper()

KIND_RULES = [
    (r'dividend', 'Dividend'), (r'bonus', 'Bonus'),
    (r'right[\s-]?share', 'Right'), (r'book[\s-]?clos', 'Book close'),
    (r'\bagm\b|\bsgm\b', 'Meeting'), (r'director', 'Board'),
    (r'auditor', 'Auditor'), (r'merger|acquisition', 'Merger'),
    (r'lock[\s-]?in', 'Lock-in'), (r'auction', 'Auction'),
    (r'sale of shares|intention of sale', 'Promoter'),
]
def annKind(title):
    t = str(title or '')
    for pat, label in KIND_RULES:
        if re.search(pat, t, re.I):
            return label
    return 'Notice'

def newsCategory(title, sym):
    t = (str(title or '') + ' ' + str(sym or '')).lower()
    if re.search(r'nepse|stock market|share market|market (falls|rises|index)|index (falls|rises|gains)|turnover (tops|crosses)|bullish|bearish', t):
        return 'Markets'
    if re.search(r'nrb|nepal rastra|sebon|policy|policies|government|budget|interest rate|remittance|regulation|ministry|parliament|election|gdp|inflation|forex', t):
        return 'Economy & Policy'
    if sym or re.search(r'dividend|bonus|right|agm|sgm|book clos|lock[\s-]?in|promoter|merger|acquisition|ipo|fpo|auction|debenture|company|ltd|limited|bank|insurance|hydro|finance|bittiya|laghubitta', t):
        return 'Companies'
    return 'Markets'
CAT_CLASS = {'Markets': 'markets', 'Companies': 'companies', 'Economy & Policy': 'economy'}

def symLink(sym):
    if not sym: return ''
    return '<a class="nn-sym" href="/stocks/%s/">%s</a>' % (esc(sym), esc(sym))

def annFeatured(it, i):
    k = annKind(it.get('title'))
    cat = newsCategory(it.get('title'), it.get('sym'))
    return ('<a class="nn-featured" href="/nepse-news/story/?src=ann&amp;i=%d">'
            '<div class="nn-featured-art"><span class="nn-mono-lg" style="background:%s">%s</span></div>'
            '<div class="nn-featured-body"><p class="nn-cat %s">%s · %s</p><h2>%s</h2>'
            '<div class="nn-meta">%s<span>%s</span><span>Official disclosure</span></div></div></a>'
            % (i, monoColor(it.get('sym')), monoText(it.get('sym')),
               CAT_CLASS.get(cat, 'companies'), esc(cat), esc(k),
               escT(it.get('title')), symLink(it.get('sym')), fmtDate(it.get('date'))))

def annCard(it, i):
    k = annKind(it.get('title'))
    cat = newsCategory(it.get('title'), it.get('sym'))
    url = it.get('url') or ''
    domain = ''
    if url:
        parts = url.split('/')
        domain = esc(parts[2]) if len(parts) > 2 else ''
    src_span = '<span class="nn-src">%s</span>' % domain if domain else ''
    return ('<a class="nn-card" href="/nepse-news/story/?src=ann&amp;i=%d">'
            '<div class="nn-card-top"><span class="nn-mono" style="background:%s">%s</span>'
            '<div><p class="nn-cat %s">%s</p><span class="nn-kind">%s</span></div></div>'
            '<h3>%s</h3>'
            '<div class="nn-foot">%s<span>%s</span>%s</div></a>'
            % (i, monoColor(it.get('sym')), monoText(it.get('sym')),
               CAT_CLASS.get(cat, 'companies'), esc(cat), esc(k),
               escT(it.get('title')), symLink(it.get('sym')), fmtDate(it.get('date')), src_span))

def hlFeatured(it, i):
    cat = newsCategory(it.get('title'), it.get('sym'))
    return ('<a class="nn-featured" href="/nepse-news/story/?src=news&amp;i=%d">'
            '<div class="nn-featured-art"><span class="nn-mono-lg" style="background:%s">%s</span></div>'
            '<div class="nn-featured-body"><p class="nn-cat %s">%s · %s</p><h2>%s</h2>'
            '<div class="nn-meta">%s<span>%s</span><span>Attributed to publisher</span></div></div></a>'
            % (i, monoColor(it.get('sym')), monoText(it.get('sym')),
               CAT_CLASS.get(cat, 'companies'), esc(cat), esc(it.get('src') or 'Market'),
               escT(it.get('title')), symLink(it.get('sym')), fmtDate(it.get('date'))))

def hlRow(it, i):
    cat = newsCategory(it.get('title'), it.get('sym'))
    return ('<a class="nn-row" href="/nepse-news/story/?src=news&amp;i=%d">'
            '<span class="nn-mono" style="background:%s">%s</span>'
            '<div><p class="nn-row-kicker"><span class="nn-cat %s">%s</span> · %s</p>'
            '<h3 class="nn-row-title">%s</h3>'
            '<div class="nn-meta">%s<span>%s</span></div></div></a>'
            % (i, monoColor(it.get('sym')), monoText(it.get('sym')),
               CAT_CLASS.get(cat, 'companies'), esc(cat), esc(it.get('src') or 'Market'),
               escT(it.get('title')), symLink(it.get('sym')), fmtDate(it.get('date'))))

def main():
    ann = json.load(open(os.path.join(ROOT, 'nepse-chart', 'data', 'announcements.json')))
    news = json.load(open(os.path.join(ROOT, 'nepse-chart', 'data', 'news.json')))
    annItems = sorted(ann.get('items', []), key=lambda x: str(x.get('date') or ''), reverse=True)
    hlItems = sorted(news.get('items', []), key=lambda x: str(x.get('date') or ''), reverse=True)
    today = fmtDate(ann.get('updated') or '2026-10-06')

    with open(PAGE, encoding='utf-8') as f:
        p = f.read()

    # 1. Freshness badge stamp
    p = p.replace('<span id="nnFresh">Updated 29 Sep 2026</span>',
                  '<span id="nnFresh">Updated %s</span>' % today)

    # 2. Announcements section stamp
    p = re.sub(r'<p class="nn-updated" id="annUpdated">.*?</p>',
               '<p class="nn-updated" id="annUpdated">Official company disclosures · updated %s. '
               'Tapping a symbol opens its chart.</p>' % today, p, count=1, flags=re.S)

    # 3. Announcements feed snapshot (featured + 9 cards)
    ann_feed = (annFeatured(annItems[0], 0) +
                '\n        <h2 class="nn-sec-h">More announcements</h2>\n'
                '        <div class="nn-grid">' +
                ''.join(annCard(it, n) for n, it in enumerate(annItems[1:10], start=1)) +
                '</div>')
    p = re.sub(r'(<div id="annFeed" aria-live="polite">\n).*?(\n      </div>\n      <noscript>)',
               lambda m: m.group(1) + '        ' + ann_feed + m.group(2),
               p, count=1, flags=re.S)

    # 4. Headlines section stamp
    p = re.sub(r'<p class="nn-updated" id="hlUpdated">.*?</p>',
               '<p class="nn-updated" id="hlUpdated">Headlines, editorially reviewed · updated %s.</p>' % today,
               p, count=1, flags=re.S)

    # 5. Headlines feed snapshot (featured + 9 rows)
    hl_feed = (hlFeatured(hlItems[0], 0) +
               '\n        <h2 class="nn-sec-h">More headlines</h2>\n'
               '        <div class="nn-rows">' +
               ''.join(hlRow(it, n) for n, it in enumerate(hlItems[1:10], start=1)) +
               '</div>')
    p = re.sub(r'(<div id="hlFeed" aria-live="polite">\n).*?(\n      </div>)',
               lambda m: m.group(1) + '        ' + hl_feed + m.group(2),
               p, count=1, flags=re.S)

    with open(PAGE, 'w', encoding='utf-8') as f:
        f.write(p)

    print('Snapshot regenerated:')
    print('  announcements: %d items, featured=%s (%s)' % (len(annItems), annItems[0].get('sym'), annItems[0].get('date')))
    print('  headlines: %d items, featured=%s (%s)' % (len(hlItems), hlItems[0].get('sym'), hlItems[0].get('date')))
    print('  stamp:', today)

if __name__ == '__main__':
    main()

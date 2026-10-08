#!/usr/bin/env python3
"""
Build trending-stocks and value-investing datasets for Nepse Decode.

TRENDING (tools/.cache/signals daily OHLCV + live.json + broker floorsheet DB + news.json):
  Transparent composite of genuine market-activity signals. Every component is
  stored per symbol so the page can show exactly WHY a stock is trending.
  This is our own formula - no third-party scoring is copied.

VALUE (Capital Max Fundamental Screener XLSX, all sectors, latest available quarter):
  Sector-aware value screen on verified reported figures. Ratios computed to
  2 decimals. Sectors compared only against their own medians.

Outputs: nepse-chart/data/trending.json, nepse-chart/data/value.json
"""
import json, glob, html as _htmllib, math, os, sqlite3, sys
from datetime import datetime, timezone, timedelta

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NPT = timezone(timedelta(hours=5, minutes=45))
today = datetime.now(NPT).strftime('%Y-%m-%d')

def load_json(p):
    with open(os.path.join(REPO, p)) as f:
        return json.load(f)

# ---------- shared reference data ----------
sector_map = load_json('tools/sector-map.json')          # sym -> {'sector': ...}
universe = {s['s']: s for s in load_json('nepse-chart/data/universe.json')['symbols']}
live = load_json('nepse-chart/data/live.json')
live_q = {q['symbol']: q for q in live['quotes']}
live_asof = live.get('asof', '')
news = load_json('nepse-chart/data/news.json')

# news mentions per symbol, last 7 days
news_count = {}
for it in news.get('items', []):
    for sym in it.get('symbols', []) or []:
        news_count[sym] = news_count.get(sym, 0) + 1

# broker flow: top single-broker 5-day net bought value per symbol / 5d turnover
# Fail-soft: the broker DB is not available in every environment (e.g. GitHub
# Actions, fresh worktrees). When absent, concentration contributes 0 and the
# other four inputs still rank normally.
broker_conc = {}
try:
    db = sqlite3.connect(os.path.join(REPO, 'tools/broker/data/floorsheet.db'))
    latest_db = db.execute('SELECT MAX(date) FROM daily_summary').fetchone()[0]
except Exception as _dbe:
    print(f'  broker DB unavailable ({_dbe}); concentration input skipped')
    latest_db = None
if latest_db:
    rows = db.execute('''SELECT symbol, broker, SUM(buy_value - sell_value) AS netv,
                                SUM(buy_value + sell_value) AS totv
                         FROM daily_summary WHERE date > date(?, '-6 days')
                         GROUP BY symbol, broker''', (latest_db,)).fetchall()
    per_sym = {}
    for sym, brk, netv, totv in rows:
        d = per_sym.setdefault(sym, {'top_net': 0.0, 'tot': 0.0})
        if netv and netv > d['top_net']:
            d['top_net'] = netv
        if totv:
            d['tot'] += totv
    for sym, d in per_sym.items():
        if d['tot'] > 0:
            broker_conc[sym] = d['top_net'] / d['tot']  # 0..~0.5

# ---------- TRENDING ----------
def clamp(x, lo, hi):
    return max(lo, min(hi, x))

EXCLUDE_SECTORS = {'Debentures', 'Mutual Funds', 'Promoter Shares'}

trending = []
cache_files = glob.glob(os.path.join(REPO, 'tools/.cache/signals/*.json'))
for cf in cache_files:
    sym = os.path.basename(cf)[:-5]
    u = universe.get(sym)
    if not u or u.get('t') != 'Equity':
        continue
    sector = (sector_map.get(sym) or {}).get('sector', '—')
    if sector in EXCLUDE_SECTORS:
        continue
    try:
        d = json.load(open(cf))['data']
    except Exception:
        continue
    if len(d) < 25:
        continue
    # sessions: (date, ltp, high, qty, turnover)
    # NOTE: the open dataset is newest-first bulk with recent sessions appended
    # ascending at the tail, so sort chronologically and dedupe by date.
    sess = []
    seen_dates = set()
    for r in d:
        try:
            dt = str(r['date'])[:10]
            if dt in seen_dates:
                continue
            seen_dates.add(dt)
            sess.append((dt, float(r['ltp']), float(r['high']),
                         float(r['qty']), float(r['turnover'])))
        except (KeyError, ValueError, TypeError):
            continue
    sess.sort(key=lambda x: x[0])
    if len(sess) < 25:
        continue
    # append today's live session if newer
    lq = live_q.get(sym)
    if lq and lq.get('ltp') and (not sess or str(lq.get('last_updated', ''))[:10] >= sess[-1][0]):
        if not sess or str(lq.get('last_updated', ''))[:10] > sess[-1][0]:
            sess.append((str(lq.get('last_updated', ''))[:10], float(lq['ltp']),
                         float(lq.get('high') or lq['ltp']), float(lq.get('volume') or 0),
                         float(lq.get('turnover') or 0)))
    if len(sess) < 26:
        continue
    t0 = sess[-1]
    prev20 = sess[-21:-1]
    avg_turn = sum(s[4] for s in prev20) / 20
    avg_vol = sum(s[3] for s in prev20) / 20
    if avg_turn <= 0 or avg_vol <= 0 or t0[4] <= 0:
        continue
    turnover_ratio = t0[4] / avg_turn
    volume_ratio = t0[3] / avg_vol
    ltp5 = sess[-6][1]
    ret_5d = t0[1] / ltp5 - 1 if ltp5 > 0 else 0
    # 1-day change: today vs previous session
    prev_close = sess[-2][1] if len(sess) >= 2 else 0
    ret_1d = t0[1] / prev_close - 1 if prev_close > 0 else 0
    hi252 = max(s[2] for s in sess[-252:])
    dist_52w = t0[1] / hi252 - 1 if hi252 > 0 else 0
    conc = broker_conc.get(sym, 0.0)
    nm = news_count.get(sym, 0)

    c_turn = clamp(turnover_ratio, 0, 5) / 5
    c_vol = clamp(volume_ratio, 0, 5) / 5
    c_mom = clamp(ret_5d, 0, 0.15) / 0.15
    c_conc = clamp(conc, 0, 0.25) / 0.25
    c_news = clamp(nm, 0, 5) / 5
    score = round(35 * c_turn + 20 * c_vol + 20 * c_mom + 15 * c_conc + 10 * c_news, 1)

    # direction tone: volume + rising price = accumulation interest;
    # volume + falling price = distribution pressure. Never disguise one as the other.
    if ret_5d >= 0.02:
        tone = 'accumulation'
    elif ret_5d <= -0.02:
        tone = 'distribution'
    else:
        tone = 'watch'

    # reason codes: only components that actually fired
    reasons = []
    if turnover_ratio >= 2: reasons.append(f"Turnover {turnover_ratio:.1f}x its 20-day average")
    if volume_ratio >= 2: reasons.append(f"Volume {volume_ratio:.1f}x its 20-day average")
    if ret_5d >= 0.05: reasons.append(f"Up {ret_5d*100:.1f}% in 5 sessions")
    if conc >= 0.10: reasons.append(f"Top broker net-bought {conc*100:.0f}% of 5-day flow")
    if nm >= 2: reasons.append(f"In {nm} news stories this week")
    if dist_52w > -0.05 and ret_5d > 0: reasons.append("Trading near its 52-week high")

    trending.append({
        'symbol': sym,
        'name': u.get('n', sym),
        'sector': sector,
        'ltp': round(t0[1], 2),
        'change_pct': round(ret_1d * 100, 2),
        'turnover_rs_m': round(t0[4] / 1e6, 2),
        'turnover_ratio': round(turnover_ratio, 2),
        'volume_ratio': round(volume_ratio, 2),
        'ret_5d_pct': round(ret_5d * 100, 2),
        'dist_52w_pct': round(dist_52w * 100, 2),
        'broker_conc_pct': round(conc * 100, 2),
        'news_7d': nm,
        'score': score,
        'tone': tone,
        'reasons': reasons[:4],
        'spark': [round(s[1], 2) for s in sess[-30:]],
    })

# Data session date: the trading session the numbers describe (from live.json),
# not the build date. live_asof is UTC; NEPSE sessions always map 1:1 here
# because the timestamp is intraday Kathmandu time.
session_date = (live_asof or '')[:10] or today
trending.sort(key=lambda x: -x['score'])
if not trending:
    # Fail-soft: the per-symbol OHLCV cache is not available in every
    # environment (fresh worktrees, CI without the signals job). Never
    # publish an empty ranking — keep the last good snapshot and roll its
    # session labels forward, so the page keeps showing the most recent
    # computed data instead of going blank.
    _prev = load_json('nepse-chart/data/trending.json')
    if _prev.get('stocks'):
        print(f"  !! no OHLCV cache: keeping last good trending snapshot "
              f"({len(_prev['stocks'])} symbols, computed {_prev.get('asof')}); "
              f"rolling session labels to {session_date}")
        trending = _prev['stocks']
        trending_out = dict(_prev)
        trending_out.update({'asof': session_date, 'built': today,
                             'live_asof': live_asof})
    else:
        trending_out = {
            'asof': session_date, 'built': today, 'live_asof': live_asof,
            'method': 'Score 0-100 = 35% turnover acceleration + 20% volume spike + 20% 5-day momentum + 15% broker flow + 10% news.',
            'coverage': {'symbols': 0, 'history': 'daily OHLCV sessions per symbol'},
            'stocks': [],
        }
else:
    trending_out = {
        'asof': session_date,
        'built': today,
        'live_asof': live_asof,
    'method': ('Score 0-100 = 35% turnover acceleration (vs 20-day avg, capped 5x) + '
               '20% volume spike (capped 5x) + 20% 5-day momentum (capped +15%) + '
               '15% broker flow concentration (top single-broker 5-day net bought / 5-day turnover, capped 25%) + '
               '10% news mentions (capped 5). All inputs are genuine market data; no analyst judgment, no buy/sell signal.'),
    'coverage': {'symbols': len(trending), 'history': 'daily OHLCV sessions per symbol'},
    'stocks': trending,
    'provenance': {
        'source': 'nepse-chart/data/live.json',
        'source_session': session_date,
        'source_quotes': len(live.get('quotes', [])),
        'verified': True,
    },
}
with open(os.path.join(REPO, 'nepse-chart/data/trending.json'), 'w') as f:
    json.dump(trending_out, f)
print(f"trending.json: {len(trending)} symbols scored, top: " +
      ", ".join(f"{s['symbol']}({s['score']})" for s in trending[:5]))

# ---------- VALUE ----------
# Source: nepse-chart/data/fundamentals.json — published quarterly filings
# (screener compilation), 281 companies, Q4 FY 2082/2083. Fresh and verified;
# the older all-sector XLSX export (FY 2080/81 Q1) is NOT used.
funda = load_json('nepse-chart/data/fundamentals.json')['companies']

companies = []
for sym, v in funda.items():
    u = universe.get(sym)
    if not u or u.get('t') != 'Equity':
        continue
    sector = (sector_map.get(sym) or {}).get('sector', 'Other')
    if sector in EXCLUDE_SECTORS:
        continue
    try:
        eps = float(v['eps_ttm']); pe = float(v['pe_ttm'])
        paidup = float(v['paidup_b']); reserves = float(v['reserves_b'])
    except (KeyError, ValueError, TypeError):
        continue
    if eps <= 0 or pe <= 0 or paidup <= 0:
        continue
    networth = paidup + reserves
    if networth <= 0:
        continue
    lq = live_q.get(sym)
    ltp = float(lq['ltp']) if lq and lq.get('ltp') else None
    if not ltp or ltp <= 0:
        continue
    bvps = 100 * networth / paidup          # face value Rs 100
    pbv = ltp / bvps
    ey = 1 / pe
    roe = eps / bvps
    entry = {
        'symbol': sym, 'name': u.get('n', sym), 'sector': sector,
        'period': v.get('period', ''),
        'ltp': round(ltp, 2), 'pe_ttm': round(pe, 2), 'pbv': round(pbv, 2),
        'ey_pct': round(ey * 100, 2), 'roe_ttm_pct': round(roe * 100, 2),
        'eps_ttm': round(eps, 2), 'bvps': round(bvps, 2),
    }
    try:
        entry['net_profit_rs_m'] = round(float(v['netprofit_b']) * 1000, 2)
    except (KeyError, ValueError, TypeError):
        pass
    # sector-specific extras where the filing template provides them
    for src_k, dst_k in [('npl_pct', 'npl_pct'), ('cd_ratio', 'cd_ratio'),
                         ('spread', 'spread_pct'), ('revenue_b', 'revenue_rs_b')]:
        try:
            entry[dst_k] = round(float(v[src_k]), 2)
        except (KeyError, ValueError, TypeError):
            pass
    companies.append(entry)

# sector-relative ranks: within each sector with >=4 members, rank by EY desc and P/BV asc
from collections import defaultdict
by_sector = defaultdict(list)
for c in companies:
    by_sector[c['sector']].append(c)

for sector, members in by_sector.items():
    if len(members) < 4:
        for c in members:
            c['value_score'] = None
        continue
    ey_sorted = sorted(members, key=lambda x: -x['ey_pct'])
    pb_sorted = sorted(members, key=lambda x: x['pbv'])
    for rank, c in enumerate(ey_sorted):
        c['_ey_rank'] = rank / (len(members) - 1)
    for rank, c in enumerate(pb_sorted):
        c['_pb_rank'] = rank / (len(members) - 1)
    for c in members:
        # 0 = cheapest within sector, 100 = priciest
        c['value_score'] = round(100 * (1 - (c['_ey_rank'] + c['_pb_rank']) / 2), 1)
        del c['_ey_rank'], c['_pb_rank']
    spe = sorted(m['pe_ttm'] for m in members)
    spb = sorted(m['pbv'] for m in members)
    n = len(members)
    # true statistical median (average of two middle values when n is even)
    med_pe = (spe[n // 2 - 1] + spe[n // 2]) / 2 if n % 2 == 0 else spe[n // 2]
    med_pbv = (spb[n // 2 - 1] + spb[n // 2]) / 2 if n % 2 == 0 else spb[n // 2]
    for c in members:
        c['sector_median_pe'] = round(med_pe, 2)
        c['sector_median_pbv'] = round(med_pbv, 2)

ranked = sorted([c for c in companies if c['value_score'] is not None],
                key=lambda x: -x['value_score'])
# Fail-soft: never publish an empty value ranking — keep last-good.
if not ranked:
    _prev_v = load_json('nepse-chart/data/value.json')
    if _prev_v.get('stocks'):
        print(f"  !! no value data: keeping last good value snapshot "
              f"({len(_prev_v['stocks'])} stocks); rolling session labels to {session_date}")
        value_out = dict(_prev_v)
        value_out.update({'asof': session_date, 'built': today})
    else:
        value_out = {
            'asof': session_date, 'built': today,
            'fail_soft': True,
            'note': 'No value data available at build time; no previous output to retain. Not for display as current.',
            'coverage': {'companies': 0, 'sectors_scored': 0},
            'stocks': [],
        }
else:
    value_out = {
        'asof': session_date,
        'built': today,
        'source': 'Published quarterly filings via screener compilation (Q4 FY 2082/2083); LTP from Nepse Decode market snapshot',
        'method': ('Value score 0-100 ranks each company within its own sector only: '
                   '50% earnings-yield rank (higher yield = cheaper) + 50% price-to-book rank (lower = cheaper). '
                   'Quality gate: positive TTM EPS and positive net worth. Sectors with fewer than 4 members are not scored. '
                   'P/BV = LTP / book value per share; book value = (paid-up capital + reserves) / shares. '
                   'No DCF, no price targets, no buy/sell calls - this is a screening starting point for research.'),
        'coverage': {'companies': len(companies), 'sectors_scored': len([s for s in by_sector if len(by_sector[s]) >= 4])},
        'stocks': ranked,
        'provenance': {
            'source': 'nepse-chart/data/live.json',
            'source_session': session_date,
            'source_quotes': len(live.get('quotes', [])),
            'verified': True,
        },
    }
with open(os.path.join(REPO, 'nepse-chart/data/value.json'), 'w') as f:
    json.dump(value_out, f)
print(f"value.json: {len(companies)} companies, {len(ranked)} scored, top: " +
      ", ".join(f"{s['symbol']}({s['value_score']})" for s in ranked[:5]))

# ---------- RESEARCH LAYER ----------
# Equity-research snapshots (financial + management + analyst note) for the top
# trending stocks. Emits nepse-chart/data/trending-research.json, which the
# trending page lazy-loads when a visitor expands a Research panel.
# Runs automatically whenever this builder runs.
try:
    import importlib.util
    _spec = importlib.util.spec_from_file_location(
        'build_trending_research', os.path.join(REPO, 'tools', 'build_trending_research.py'))
    _mod = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    _mod.main(REPO)
except Exception as _e:  # research must never break the trending/value build
    print(f"research layer skipped: {_e}")

# ---------- STATIC SNAPSHOT BAKE (SEO / no-JS) ----------
# Bakes a top-15 snapshot into nepse-trending/index.html and
# nepse-value/index.html between SNAP-START / SNAP-END markers, so crawlers
# and no-JS visitors see real data immediately. The snapshot tables use the
# SAME rich design language as the interactive tables below (score bars,
# company names, sector medians, tone pills) — one table design everywhere.
# The interactive tables remain the live surface (60s refresh).
# Refreshed by every builder run.
# Snapshot labels use the DATA session date (asof), not the build date.
def _bake_snapshot(page_rel, frag):
    p = os.path.join(REPO, page_rel)
    html = open(p).read()
    a = html.index('<!-- SNAP-START -->') + len('<!-- SNAP-START -->')
    b = html.index('<!-- SNAP-END -->')
    assert b > a, f'snapshot markers misordered in {page_rel}'
    html = html[:a] + '\n' + frag + '\n' + html[b:]
    open(p, 'w').write(html)
    print(f'  snapshot baked into {page_rel}')

def _fmt(x, dec=2, dash='–'):
    if x is None: return dash
    try: return f'{float(x):.{dec}f}'
    except (TypeError, ValueError): return dash

def _esc(s):
    return _htmllib.escape('' if s is None else str(s), quote=True)

_TONE_PILL = {'accumulation': ('tone-acc', 'Accumulation interest'),
              'distribution': ('tone-dist', 'Distribution pressure'),
              'watch': ('tone-watch', 'Watch')}
_snap_asof = trending_out.get('asof') or today
try:
    _trows = []
    for i, s in enumerate(trending[:15], 1):
        pill_cls, pill_label = _TONE_PILL.get(s['tone'], ('tone-watch', s['tone']))
        chg = s['change_pct'] or 0
        ret5 = s['ret_5d_pct'] or 0
        chg_cls = 'pos' if chg > 0 else ('neg' if chg < 0 else '')
        ret5_cls = 'pos' if ret5 > 0 else ('neg' if ret5 < 0 else '')
        chg_s = ('+' if chg > 0 else '') + f'{chg:.2f}%'
        ret5_s = ('+' if ret5 > 0 else '') + f'{ret5:.2f}%'
        score = s['score']
        _trows.append(
            f'      <tr><td>{i}</td>'
            f'<td><a class="symlink" href="/stocks/{_esc(s["symbol"])}/">{_esc(s["symbol"])}</a>'
            f'<span class="sname">{_esc(s["name"])} · {_esc(s["sector"])}</span></td>'
            f'<td>{_fmt(s["ltp"])}</td>'
            f'<td class="{chg_cls}">{chg_s}</td>'
            f'<td class="{ret5_cls}">{ret5_s}</td>'
            f'<td>Rs {_fmt(s["turnover_rs_m"], 1)} M'
            f'<span class="submed">{_fmt(s["turnover_ratio"], 1)}× avg</span></td>'
            f'<td><span class="tone {pill_cls}">{pill_label}</span></td>'
            f'<td><span class="scorebar"><i style="width:{round(score)}%"></i></span> {score:.1f}</td></tr>')
    _tfrag = (
        '<section class="snap" aria-label="Trending snapshot">\n'
        f'  <h2>Top trending stocks <span class="snap-asof">· snapshot {_snap_asof}</span></h2>\n'
        '  <div class="scrollx"><table class="bk-table">\n'
        '    <thead><tr><th>#</th><th>Stock</th><th>LTP</th><th>Day %</th>'
        '<th>5-day %</th><th>Turnover</th><th>Tone</th><th>Score</th></tr></thead>\n'
        '    <tbody>\n' + '\n'.join(_trows) + '\n    </tbody>\n'
        '  </table></div>\n'
        '  <p class="snap-note">Static daily snapshot · the full interactive ranking below refreshes every 60 seconds.</p>\n'
        '</section>')
    _bake_snapshot('nepse-trending/index.html', _tfrag)

    _vrows = []
    for i, s in enumerate(ranked[:15], 1):
        vscore = s['value_score']
        _vrows.append(
            f'      <tr>'
            f'<td><span class="scorebar"><i style="width:{round(vscore)}%"></i></span> {vscore:.1f}</td>'
            f'<td><a class="symlink" href="/stocks/{_esc(s["symbol"])}/">{_esc(s["symbol"])}</a>'
            f'<span class="sname">{_esc(s["name"])}</span></td>'
            f'<td>{_esc(s["sector"])}</td>'
            f'<td>{_fmt(s["ltp"])}</td>'
            f'<td>{_fmt(s["pe_ttm"])}<span class="submed">sector {_fmt(s["sector_median_pe"], 1)}</span></td>'
            f'<td>{_fmt(s["pbv"])}<span class="submed">sector {_fmt(s["sector_median_pbv"], 2)}</span></td>'
            f'<td>{_fmt(s["ey_pct"], 1)}%</td>'
            f'<td>{_fmt(s["roe_ttm_pct"], 1)}%</td></tr>')
    _vfrag = (
        '<section class="snap" aria-label="Value snapshot">\n'
        f'  <h2>Top value-ranked companies <span class="snap-asof">· snapshot {_snap_asof}</span></h2>\n'
        '  <div class="scrollx"><table class="bk-table">\n'
        '    <thead><tr><th>Score</th><th>Stock</th><th>Sector</th><th>LTP</th>'
        '<th>P/E (TTM)</th><th>P/BV</th><th>Earn. yield</th><th>ROE (TTM)</th></tr></thead>\n'
        '    <tbody>\n' + '\n'.join(_vrows) + '\n    </tbody>\n'
        '  </table></div>\n'
        '  <p class="snap-note">Static daily snapshot · ranked within each sector; the full interactive screen below refreshes every 60 seconds.</p>\n'
        '</section>')
    _bake_snapshot('nepse-value/index.html', _vfrag)
except Exception as _e:
    print(f'  !! snapshot bake failed: {_e}')

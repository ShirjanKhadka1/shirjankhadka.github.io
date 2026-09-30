#!/usr/bin/env python3
"""
Equity-research layer for the Trending Stocks page (Nepse Decode).

For the top N trending stocks (by activity score) this builder compiles:
  - financial_snapshot : reported fundamentals (fundamentals.json) + multi-quarter
                         trend direction (quarterly.json) + sector multiple context (value.json)
  - management_snapshot: dividend consistency, AGM regularity, rights/auctions
                         — ONLY from corp-history.json. Promoter/ownership %
                         is NOT in our datasets and is NEVER invented.
  - analyst_note       : 2-4 deterministic sentences connecting the activity
                         signal to the financial/management picture.
                         Educational framing only. No DCF, no targets, no advice.

Every figure traces to our data files; calculated figures are rounded to 2 decimals.

Output: nepse-chart/data/trending-research.json
This file is LAZY-loaded by nepse-trending/index.html (fetched only when a
visitor expands a Research panel), so the initial page weight does not grow.

Chained automatically at the end of tools/build_trending_value.py.
Can also run standalone: python3 tools/build_trending_research.py
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

NPT = timezone(timedelta(hours=5, minutes=45))
TOP_N = 40  # research compiled for top 40 by activity score; page shows 30


def fmt2(x):
    """Round to 2 decimals; return None when not a finite number."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float('inf'), float('-inf')):  # NaN / inf guard
        return None
    return round(v, 2)


def quarter_sort_key(qk):
    # "2082/2083-Q4" -> (2082, 4)
    try:
        fy, q = qk.split('-Q')
        return (int(fy.split('/')[0]), int(q))
    except (ValueError, AttributeError):
        return (0, 0)


def main(repo_root):
    def load(p):
        with open(os.path.join(repo_root, p)) as f:
            return json.load(f)

    today = datetime.now(NPT).strftime('%Y-%m-%d')
    trending = load('nepse-chart/data/trending.json')
    funda = load('nepse-chart/data/fundamentals.json')['companies']
    quarterly = load('nepse-chart/data/quarterly.json')['symbols']
    value_rows = {r['symbol']: r for r in load('nepse-chart/data/value.json').get('stocks', [])}
    corp = load('nepse-chart/data/corp-history.json')['companies']
    live_q = {q['symbol']: q for q in load('nepse-chart/data/live.json')['quotes']}

    # current fiscal-year window for "last 5 fiscal years" (FY starts mid-July)
    cur_fy_start = 2082 if today >= '2026-07-16' else 2081
    fy_window = [f"{y}/{y + 1}" for y in range(cur_fy_start - 4, cur_fy_start + 1)]

    stocks = []
    for rank, tr in enumerate(trending.get('stocks', [])[:TOP_N], start=1):
        sym = tr['symbol']
        fin = build_financial(sym, tr, funda.get(sym), quarterly.get(sym),
                              value_rows.get(sym), live_q.get(sym))
        mgmt = build_management(sym, corp.get(sym), fy_window)
        note = analyst_note(sym, tr.get('name', sym), rank, tr, fin, mgmt)
        stocks.append({
            'symbol': sym,
            'name': tr.get('name', sym),
            'sector': tr.get('sector', '—'),
            'rank': rank,
            'tone': tr.get('tone', 'watch'),
            'activity': {
                'score': tr.get('score'),
                'reasons': tr.get('reasons', [])[:4],
            },
            'financial': fin,
            'management': mgmt,
            'analyst_note': note,
        })

    out = {
        'asof': trending.get('asof', today),
        'method': ('Equity-research snapshots for the top %d activity-ranked stocks. '
                   'Financials: reported quarterly filings (fundamentals.json) with multi-quarter '
                   'net-profit/EPS trend (quarterly.json); sector P/E context from the value screen. '
                   'Management: dividend consistency, AGM regularity and capital actions from the '
                   'corporate-action archive (corp-history.json) only — promoter/ownership percentages '
                   'are not in our datasets and are never estimated. '
                   'Analyst notes are deterministic templates filled with these figures; '
                   'no DCF, no price targets, no buy/sell calls.' % TOP_N),
        'coverage': {'stocks': len(stocks),
                     'of_trending': len(trending.get('stocks', []))},
        'stocks': stocks,
    }
    dest = os.path.join(repo_root, 'nepse-chart/data/trending-research.json')
    with open(dest, 'w') as f:
        json.dump(out, f)
    with_fin = sum(1 for s in stocks if s['financial'])
    with_mgmt = sum(1 for s in stocks if s['management'])
    print(f"trending-research.json: {len(stocks)} stocks "
          f"({with_fin} with fundamentals, {with_mgmt} with corp history)")
    return out


def build_financial(sym, tr, frow, qrow, vrow, lq):
    """Financial snapshot from reported filings. None when no fundamentals."""
    if not frow:
        return None
    try:
        eps = float(frow['eps_ttm'])
        pe = float(frow['pe_ttm'])
        paidup = float(frow['paidup_b'])
        reserves = float(frow['reserves_b'])
    except (KeyError, ValueError, TypeError):
        return None
    if paidup <= 0:
        return None
    networth_b = paidup + reserves
    bvps = 100.0 * networth_b / paidup          # face value Rs 100
    ltp = None
    if lq and lq.get('ltp'):
        try:
            ltp = float(lq['ltp'])
        except (ValueError, TypeError):
            ltp = None
    if not ltp or ltp <= 0:
        ltp = tr.get('ltp')                      # fall back to trending snapshot LTP
    fin = {
        'period': frow.get('period', ''),
        'eps_ttm': fmt2(eps),
        'pe_ttm': fmt2(pe) if pe > 0 else None,
        'pbv': fmt2(ltp / bvps) if (ltp and bvps > 0) else None,
        'bvps': fmt2(bvps),
        'roe_ttm_pct': fmt2(eps / bvps * 100) if bvps > 0 else None,
        'ey_pct': fmt2(100.0 / pe) if pe > 0 else None,
        'revenue_rs_m': fmt2(float(frow['revenue_b']) * 1000) if frow.get('revenue_b') not in (None, '') else None,
        'net_profit_rs_m': fmt2(float(frow['netprofit_b']) * 1000) if frow.get('netprofit_b') not in (None, '') else None,
        'networth_rs_m': fmt2(networth_b * 1000),
    }
    # sector multiple context (value screen, same reported figures)
    if vrow:
        fin['sector_median_pe'] = vrow.get('sector_median_pe')
        fin['sector_median_pbv'] = vrow.get('sector_median_pbv')
    # multi-quarter trend: net profit + EPS TTM direction over up to 8 quarters
    # quarterly.json values are in NPR thousands -> Rs M = /1000
    if qrow and isinstance(qrow.get('quarters'), dict):
        qs = sorted(qrow['quarters'].items(), key=lambda kv: quarter_sort_key(kv[0]))
        nps = [(k, v.get('netprofit')) for k, v in qs
               if isinstance(v, dict) and v.get('netprofit') not in (None, '')]
        epss = [(k, v.get('eps_ttm')) for k, v in qs
                if isinstance(v, dict) and v.get('eps_ttm') not in (None, '')]
        trend = None
        if len(nps) >= 2:
            win = nps[-8:]
            first = float(win[0][1]) / 1000.0
            last = float(win[-1][1]) / 1000.0
            chg = (last - first) / abs(first) * 100 if first != 0 else 0.0
            if chg > 5:
                direction = 'improved'
            elif chg < -5:
                direction = 'weakened'
            else:
                direction = 'held broadly flat'
            trend = {
                'quarters': len(win),
                'first_rs_m': fmt2(first),
                'last_rs_m': fmt2(last),
                'change_pct': fmt2(chg),
                'direction': direction,
            }
            if len(epss) >= 2:
                ewin = epss[-8:]
                ef, el = float(ewin[0][1]), float(ewin[-1][1])
                echg = (el - ef) / abs(ef) * 100 if ef != 0 else 0.0
                trend['eps_direction'] = ('improved' if echg > 5 else
                                          'weakened' if echg < -5 else 'held broadly flat')
        fin['trend'] = trend
    return fin


def build_management(sym, crow, fy_window):
    """Management/governance snapshot from the corporate-action archive only."""
    if not crow:
        return None
    mgmt = {}
    # dividend consistency: fiscal years in the last-5 window with any dividend
    div_years = set()
    latest = None
    for d in crow.get('dividends', []) or []:
        yr = str(d.get('year', '')).strip()
        try:
            total = float(d.get('total_dividend') or 0)
        except (ValueError, TypeError):
            total = 0.0
        if yr in fy_window and total > 0:
            div_years.add(yr)
        if latest is None or yr > str(latest.get('year', '')):
            try:
                bonus = float(d.get('bonus_share') or 0)
            except (ValueError, TypeError):
                bonus = 0.0
            try:
                cash = float(d.get('cash_dividend') or 0)
            except (ValueError, TypeError):
                cash = 0.0
            latest = {'year': yr, 'bonus_pct': fmt2(bonus), 'cash_pct': fmt2(cash)}
    mgmt['dividend_years_last5'] = len(div_years)
    mgmt['dividend_years'] = sorted(div_years)
    mgmt['latest_dividend'] = latest
    # AGM regularity
    agm_years = set()
    for a in crow.get('agms', []) or []:
        md = str(a.get('meeting_date', ''))[:10]
        if len(md) >= 4 and md[:4].isdigit():
            agm_years.add(md[:4])
    mgmt['agm_count'] = len(crow.get('agms', []) or [])
    mgmt['agm_years'] = sorted(agm_years)
    # capital actions
    mgmt['rights_count'] = len(crow.get('rights', []) or [])
    mgmt['auctions_count'] = len(crow.get('auctions', []) or [])
    latest_right = None
    rights = crow.get('rights', []) or []
    if rights:
        r0 = rights[0]
        latest_right = {
            'ratio': str(r0.get('ratio_value', ''))[:24],
            'opening': str(r0.get('opening_date', ''))[:10],
        }
    mgmt['latest_right'] = latest_right
    return mgmt


def analyst_note(sym, name, rank, tr, fin, mgmt):
    """Deterministic 2-4 sentence note tying activity to the numbers."""
    parts = []
    # 1. activity
    reasons = [r for r in (tr.get('reasons') or []) if r][:2]
    if reasons:
        rtxt = '; '.join(r[0].lower() + r[1:] if r else r for r in reasons)
        parts.append(f"{name} ({sym}) ranks #{rank} on today's activity board — {rtxt}.")
    else:
        parts.append(f"{name} ({sym}) ranks #{rank} on today's activity board on turnover and volume interest.")
    # 2. financials
    if fin:
        if (fin.get('eps_ttm') or 0) > 0:
            s = f"Reported fundamentals ({fin['period'] or 'latest filings'}): TTM EPS Rs {fin['eps_ttm']:.2f}."
            pe, smed = fin.get('pe_ttm'), fin.get('sector_median_pe')
            if pe and smed:
                rel = 'above' if pe > smed else 'below'
                s += f" Its P/E of {pe:.2f} sits {rel} the {tr.get('sector', 'sector')} median of {smed:.2f}."
            t = fin.get('trend')
            if t and t['quarters'] >= 2:
                s += (f" Net profit has {t['direction']} over the last {t['quarters']} reported quarters "
                      f"(Rs {t['first_rs_m']:.2f} M to Rs {t['last_rs_m']:.2f} M).")
            parts.append(s)
        else:
            parts.append(f"Reported fundamentals ({fin['period'] or 'latest filings'}): a TTM loss of "
                         f"Rs {abs(fin['eps_ttm']):.2f} per share — earnings multiples do not apply to a loss-making year.")
    else:
        parts.append("No published fundamentals are in our dataset for this symbol, so the activity above is "
                     "pure trading interest with no reported numbers behind it.")
    # 3. management / governance record
    if mgmt:
        d = mgmt['dividend_years_last5']
        bits = [f"dividends in {d} of the last 5 fiscal years"]
        ld = mgmt.get('latest_dividend')
        if ld and ld.get('year'):
            bits.append(f"latest {ld['bonus_pct']:.2f}% bonus + {ld['cash_pct']:.2f}% cash for FY {ld['year']}")
        bits.append(f"{mgmt['agm_count']} AGMs on record")
        if mgmt['rights_count']:
            lr = mgmt.get('latest_right') or {}
            bits.append(f"{mgmt['rights_count']} rights issue(s)"
                        + (f" (latest {lr['ratio']})" if lr.get('ratio') else ""))
        parts.append("On the governance record: " + ", ".join(bits) + ".")
    else:
        parts.append("Our corporate-action archive holds no dividend or AGM record for this symbol.")
    # 4. tie together — educational framing, never advice
    tone = tr.get('tone', 'watch')
    tone_txt = {'accumulation': 'heavy buying interest',
                'distribution': 'heavy selling interest'}.get(tone, 'elevated but directionless interest')
    if fin and (fin.get('eps_ttm') or 0) > 0:
        acct = "a profitable business on reported numbers"
    elif fin:
        acct = "a loss-making business on reported numbers"
    else:
        acct = "no reported numbers to judge it by"
    parts.append(f"The tape shows {tone_txt}; the accounts show {acct}. "
                 "Activity is attention, not a verdict — use this as a starting point for your own research.")
    return " ".join(parts)


if __name__ == '__main__':
    repo = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    main(repo)

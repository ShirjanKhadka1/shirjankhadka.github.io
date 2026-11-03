#!/usr/bin/env python3
"""Charter 4B step 3 — regenerate sector payloads from the master (PR2).

Reads ONLY data/reference/instruments.json for sector/type.
Preserves every numeric value, every asof, every series value, except
where a recomputation is payload-internal and exact (technical
by_sector, sector-symbol sector_rank + board summary counts, VPI
counts). What changes, per file:
  * Row-level sector fields (symbol rows) -> master sector, or the row
    is dropped from sector groupings when the master sector is
    UNCONFIRMED / the type is non-equity for an equity board.
  * Sector keys -> master vocabulary (Banking -> Commercial Bank,
    Hotels And Tourism -> Hotels and Tourism, Manufacturing And
    Processing -> Manufacturing and Processing; old bucket keys
    Debentures / Mutual Funds / Promoter Shares / Others /
    Unclassified are REMOVED, never carried forward).
  * Membership lists that are per-symbol rows (rotation stocks,
    price-rotation stocks) are REGROUPED by master sector (a moved
    symbol lands in its master sector's list, never vanishes).
  * Membership lists that are the INPUT to a computed series
    (sector-indices constituents, seasonality stocks) are handled per
    the file's own method: indices is explicitly "current
    constituents", so constituents are remapped; seasonality calendars
    were computed from the listed stocks, so lists are kept and the
    values are flagged pending (remapping the list while keeping the
    values would misattribute them).
  * Sector-level SERIES/aggregates computed under pre-master
    membership (indices series, rotation rs/returns, strength rows,
    seasonality calendars, price-rotation series, money-flow
    sector_flow nets, symbol-board sector aggregates) are NOT
    recomputed here: recomputing them needs the OHLC/floorsheet
    builders, not this relabelling script. They keep their values,
    gain master keys + a restated note + series_recompute_pending=true,
    and the next scheduled builder run (wired to the master in PR1)
    recomputes them. This disclosure, not a silent relabel, is the
    honest form.
  * Append-only history files (rotation-history, strength-history,
    symbol-history, price-rotation-history) get stamp + note ONLY:
    their entries are never edited by their own contract, and
    relabelling them would rewrite history. Future entries use master
    sectors.
  * Every touched file gains classification_restated with the note:
    "restated 2026-11-03, classification corrected: sector + type
    from data/reference/instruments.json (Charter v4.2 item 4A
    master); UNCONFIRMED rows have no sector and are excluded from
    sector boards (never an Others/Unclassified bucket); TYPE decides
    equity inclusion, never sector."

Files whose builder is not on main (all sector boards + VPI) are
handled by this script, which is shown in the PR; nothing is faked
as a builder run. Stock pages are handled separately by a full
tools/build-symbol-pages.js run (wired builder), NOT by this script.

Usage: python3 tools/regenerate-sector-payloads.py [--check]
  --check: verify only (no writes).
"""
import json
import os
import sys
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
NOTE = ("restated 2026-11-03, classification corrected: sector + type from "
        "data/reference/instruments.json (Charter v4.2 item 4A master); "
        "UNCONFIRMED rows have no sector and are excluded from sector boards "
        "(never an Others/Unclassified bucket); TYPE decides equity inclusion, "
        "never sector.")
OLD_TO_NEW = {
    'Banking': 'Commercial Bank',
    'Hotels And Tourism': 'Hotels and Tourism',
    'Manufacturing And Processing': 'Manufacturing and Processing',
}
BUCKETS = {'Debentures', 'Mutual Funds', 'Promoter Shares', 'Others', 'Other',
           'Unclassified', 'UNCONFIRMED'}


def load_master():
    with open(os.path.join(ROOT, 'data', 'reference', 'instruments.json')) as f:
        doc = json.load(f)
    return {r['symbol']: r for r in doc['instruments']}


def sector_of(m, sym):
    r = m.get(sym)
    if not r or r['sector'] == 'UNCONFIRMED':
        return None
    return r['sector']


def type_of(m, sym):
    r = m.get(sym)
    return r['instrument_type'] if r else None


def rename_key(k):
    if k in BUCKETS:
        return None
    return OLD_TO_NEW.get(k, k)


def stamp(d, pending):
    d['classification_restated'] = {
        'source': 'data/reference/instruments.json',
        'note': NOTE,
        'series_recompute_pending': pending,
    }


def load(p):
    with open(os.path.join(ROOT, p)) as f:
        return json.load(f)


def dump(p, d, check):
    if check:
        return
    path = os.path.join(ROOT, p)
    # Preserve the file's own formatting: indented files stay indented
    # (a compact rewrite would turn a 91k-line file into one line and
    # make the diff unreviewable); compact files stay compact.
    try:
        with open(path, 'rb') as f:
            raw = f.read()
        # Detect the file's own indent width from the first indented
        # line (payloads here use 1-space indents, not 2).
        indent = None
        for line in raw.decode('utf-8', 'replace').splitlines()[1:40]:
            stripped = line.lstrip(' ')
            if stripped.startswith('"') and line.startswith(' '):
                indent = len(line) - len(stripped)
                break
    except OSError:
        indent = None
    with open(path, 'w') as f:
        if indent:
            json.dump(d, f, ensure_ascii=False, indent=indent)
        else:
            json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')


def stamp_only(path, check, report, hist_note):
    d = load(path)
    stamp(d, True)
    d['classification_restated']['history_note'] = hist_note
    dump(path, d, check)
    report.append('%s: stamp-only (append-only history)' % path)


def regroup_stock_lists(m, stocks_dict):
    """Regroup per-symbol rows by master sector (equity only)."""
    new = defaultdict(list)
    for k, v in stocks_dict.items():
        for row in (v if isinstance(v, list) else []):
            sec = sector_of(m, row.get('symbol'))
            if sec is None or type_of(m, row.get('symbol')) != 'EQUITY':
                continue
            new[sec].append(row)
    return {k: new[k] for k in sorted(new)}


def main():
    check = '--check' in sys.argv
    m = load_master()
    equity_by_sector = defaultdict(list)
    for sym, r in m.items():
        if r['instrument_type'] == 'EQUITY' and r['sector'] != 'UNCONFIRMED':
            equity_by_sector[r['sector']].append(sym)
    for v in equity_by_sector.values():
        v.sort()
    unsectorised_equity = sorted(s for s, r in m.items()
                                 if r['instrument_type'] == 'EQUITY' and r['sector'] == 'UNCONFIRMED')
    report = []

    def handle(path, fn, pending):
        d = load(path)
        before = json.dumps(d, sort_keys=True)
        fn(d)
        stamp(d, pending)
        dump(path, d, check)
        report.append('%s: %s' % (path, 'changed' if json.dumps(d, sort_keys=True) != before else 'note-only'))

    # ---- sector-indices (append-only established series: keys +
    # constituents remapped per the file's own "current constituents"
    # method; series values untouched, flagged pending) ----
    def indices(d):
        new = {}
        for k, v in d['sectors'].items():
            nk = rename_key(k)
            if nk is None:
                continue
            v = dict(v)
            v['constituents'] = equity_by_sector.get(nk, [])
            v['constituent_count'] = len(v['constituents'])
            new[nk] = v
        new['Trading'] = {'constituents': equity_by_sector.get('Trading', []),
                          'constituent_count': len(equity_by_sector.get('Trading', [])),
                          'first_date': None, 'last_date': None, 'sessions': 0,
                          'dates': [], 'values': [], 'contributors': [],
                          'note': 'No established series under pre-master membership; series starts at the next keystone append run.'}
        d['sectors'] = new
        d['unsectorised_equity'] = unsectorised_equity
    handle('data/sector-indices.json', indices, True)

    # ---- sector-rotation (+forward: sector entries renamed,
    # stocks lists regrouped to master equity membership) ----
    def rotation(d):
        if isinstance(d.get('sectors'), list):
            out = []
            for s in d['sectors']:
                nk = rename_key(s.get('sector'))
                if nk is None:
                    continue
                s = dict(s)
                s['sector'] = nk
                s['n_stocks'] = len(equity_by_sector.get(nk, []))
                out.append(s)
            d['sectors'] = out
        if isinstance(d.get('stocks'), dict):
            d['stocks'] = regroup_stock_lists(m, d['stocks'])
        if isinstance(d.get('entries'), list):
            out = []
            for e in d['entries']:
                nk = rename_key(e.get('sector'))
                if nk is None:
                    continue
                e = dict(e)
                e['sector'] = nk
                if isinstance(e.get('sectors'), dict):
                    ns = {}
                    for k, v in e['sectors'].items():
                        nk2 = rename_key(k)
                        if nk2 is not None:
                            ns[nk2] = v
                    e['sectors'] = ns
                out.append(e)
            d['entries'] = out
        # unscored rows keep their symbol+reason, sector remapped (or null)
        if isinstance(d.get('unscored'), list):
            for r in d['unscored']:
                if isinstance(r, dict) and 'sector' in r:
                    r['sector'] = sector_of(m, r.get('symbol'))
        # quadrant chart sector aggregates: rename, drop bucket rows
        qc = d.get('quadrant_chart')
        if isinstance(qc, dict) and isinstance(qc.get('sectors'), list):
            out = []
            for r in qc['sectors']:
                nk = rename_key(r.get('sector'))
                if nk is None:
                    continue
                r = dict(r)
                r['sector'] = nk
                out.append(r)
            qc['sectors'] = out
        d['unsectorised_equity'] = unsectorised_equity
    for p in ['data/sector-rotation.json', 'data/sector-rotation-forward.json']:
        if os.path.exists(os.path.join(ROOT, p)):
            handle(p, rotation, True)
    if os.path.exists(os.path.join(ROOT, 'data/sector-rotation-history.json')):
        stamp_only('data/sector-rotation-history.json', check, report,
                   'Append-only history: entries retain pre-master sector labels and '
                   'pre-master membership; the current board is restated. Future entries '
                   'use master sectors.')

    # ---- sector-strength (sector rows renamed; values flagged pending) ----
    def strength(d):
        if isinstance(d.get('rows'), list):
            out = []
            for r in d['rows']:
                nk = rename_key(r.get('sector'))
                if nk is None:
                    continue
                r = dict(r)
                r['sector'] = nk
                out.append(r)
            d['rows'] = out
        d['unsectorised_equity'] = unsectorised_equity
    if os.path.exists(os.path.join(ROOT, 'data/sector-strength.json')):
        handle('data/sector-strength.json', strength, True)
    if os.path.exists(os.path.join(ROOT, 'data/sector-strength-history.json')):
        stamp_only('data/sector-strength-history.json', check, report,
                   'Append-only history: entries retain pre-master sector labels; '
                   'the current board is restated.')

    # ---- sector-symbol (+forward boards: row sectors remapped,
    # sector_rank recomputed within the new sector from payload rows;
    # sector aggregates renamed, values flagged pending) ----
    def symbol_boards(d):
        boards = d.get('boards', {})
        for bk, b in boards.items():
            if not isinstance(b, dict):
                continue
            kept = set()
            if isinstance(b.get('rows'), list):
                rows = []
                for r in b['rows']:
                    sec = sector_of(m, r.get('symbol'))
                    if sec is None or type_of(m, r.get('symbol')) != 'EQUITY':
                        continue
                    r = dict(r)
                    r['sector'] = sec
                    rows.append(r)
                    kept.add(r.get('symbol'))
                by = defaultdict(list)
                for r in rows:
                    by[r['sector']].append(r)
                for sec, rs in by.items():
                    def sortkey(x):
                        v = x.get('return_')
                        return -(v if isinstance(v, (int, float)) else -1e18)
                    rs.sort(key=sortkey)
                    for i, r in enumerate(rs, 1):
                        r['sector_rank'] = i
                b['rows'] = rows
                # board summary counts are exact from the remapped rows
                if isinstance(b.get('summary'), dict):
                    b['summary']['priced'] = len(rows)
                    b['summary']['outperformers'] = sum(1 for r in rows if (r.get('rel_return') or 0) > 0)
                    b['summary']['underperformers'] = sum(1 for r in rows if (r.get('rel_return') or 0) < 0)
                if isinstance(b.get('unscored'), list):
                    b['unscored'] = [r for r in b['unscored']]
                    for r in b['unscored']:
                        if isinstance(r, dict) and 'sector' in r:
                            r['sector'] = sector_of(m, r.get('symbol'))
                    if isinstance(b.get('summary'), dict):
                        b['summary']['unscored'] = len(b['unscored'])
            # sector aggregates: list form (sector dicts) or dict form
            if isinstance(b.get('sectors'), list):
                out = []
                for r in b['sectors']:
                    nk = rename_key(r.get('sector'))
                    if nk is None:
                        continue
                    r = dict(r)
                    r['sector'] = nk
                    out.append(r)
                b['sectors'] = out
            elif isinstance(b.get('sectors'), dict):
                ns = {}
                for k, v in b['sectors'].items():
                    nk = rename_key(k)
                    if nk is not None:
                        ns[nk] = v
                b['sectors'] = ns
            # top/bottom are copies of board rows: remap sector, drop
            # symbols no longer on the board
            for key in ('top', 'bottom'):
                if isinstance(b.get(key), list):
                    out = []
                    for r in b[key]:
                        if r.get('symbol') not in kept:
                            continue
                        r = dict(r)
                        r['sector'] = sector_of(m, r.get('symbol'))
                        out.append(r)
                    b[key] = out
        d['unsectorised_equity'] = unsectorised_equity
    for p in ['data/sector-symbol.json']:
        if os.path.exists(os.path.join(ROOT, p)):
            handle(p, symbol_boards, True)
    if os.path.exists(os.path.join(ROOT, 'data/sector-symbol-forward.json')):
        # entries carry symbols only (leaders lists), no sector fields:
        # stamp + note, entries untouched.
        d = load('data/sector-symbol-forward.json')
        stamp(d, False)
        d['classification_restated']['history_note'] = ('Forward-tracking entries carry '
            'symbols only (no sector labels); the boards they track are restated.')
        dump('data/sector-symbol-forward.json', d, check)
        report.append('data/sector-symbol-forward.json: stamp-only (entries carry no sector labels)')
    if os.path.exists(os.path.join(ROOT, 'data/sector-symbol-history.json')):
        stamp_only('data/sector-symbol-history.json', check, report,
                   'Append-only history: boards retain pre-master sector labels; '
                   'the current board is restated.')

    # ---- sector-seasonality: sector keys renamed; calendar values and
    # stocks lists kept (values were computed from the listed stocks),
    # flagged pending ----
    def seasonality(d):
        if isinstance(d.get('sectors'), dict):
            new = {}
            for k, v in d['sectors'].items():
                nk = rename_key(k)
                if nk is None:
                    continue
                new[nk] = v
            d['sectors'] = new
        # forward ledger: rename sector labels, drop Others entries,
        # keep NEPSE benchmark rows (benchmark, not a sector)
        if isinstance(d.get('forward_ledger'), list):
            out = []
            for e in d['forward_ledger']:
                if e.get('sector') == 'NEPSE':
                    out.append(e)
                    continue
                nk = rename_key(e.get('sector'))
                if nk is None:
                    continue
                e = dict(e)
                e['sector'] = nk
                out.append(e)
            d['forward_ledger'] = out
        d['unsectorised_equity'] = unsectorised_equity
    handle('data/sector-seasonality.json', seasonality, True)

    # ---- sector-price-rotation (+forward) ----
    def price_rotation(d):
        for tf, b in (d.get('boards') or {}).items():
            if not isinstance(b, dict):
                continue
            if isinstance(b.get('data'), list):
                out = []
                for r in b['data']:
                    nk = rename_key(r.get('sector'))
                    if nk is None:
                        continue
                    r = dict(r)
                    r['sector'] = nk
                    if r.get('short') in OLD_TO_NEW:
                        r['short'] = OLD_TO_NEW[r['short']]
                    out.append(r)
                b['data'] = out
            if isinstance(b.get('unscored'), list):
                for r in b['unscored']:
                    if isinstance(r, dict):
                        r['sector'] = sector_of(m, r.get('symbol'))
        if isinstance(d.get('stocks'), dict):
            d['stocks'] = regroup_stock_lists(m, d['stocks'])
        if isinstance(d.get('notes'), list):
            d['notes'] = [('Pre-restatement series folded Trading into Others; from '
                           '2026-11-03 membership follows data/reference/instruments.json '
                           '(Trading separate, UNCONFIRMED excluded from sector boards).')
                          if 'folded into Others' in n else n for n in d['notes']]
        d['unsectorised_equity'] = unsectorised_equity
    for p in ['data/sector-price-rotation.json', 'data/sector-price-rotation-forward.json']:
        if os.path.exists(os.path.join(ROOT, p)):
            handle(p, price_rotation, True)
    if os.path.exists(os.path.join(ROOT, 'data/sector-price-rotation-history.json')):
        stamp_only('data/sector-price-rotation-history.json', check, report,
                   'Append-only history: entries retain pre-master sector labels; '
                   'the current board is restated.')

    # ---- technical-signals: board rows remapped; by_sector RECOMPUTED
    # from board rows (payload-internal, exact). history_recent /
    # changes / cohorts / replay / coverage carry no sector labels.
    def tech(d):
        rows = []
        dropped = []
        for r in d['board']:
            sec = sector_of(m, r.get('symbol'))
            if sec is None or type_of(m, r.get('symbol')) != 'EQUITY':
                dropped.append(r.get('symbol'))
                continue
            r = dict(r)
            r['sector'] = sec
            rows.append(r)
        d['board'] = rows
        by = {}
        for sec in sorted({r['sector'] for r in rows}):
            rs = [r for r in rows if r['sector'] == sec]
            scores = sorted(r['score'] for r in rs if isinstance(r.get('score'), (int, float)))
            med = None
            if scores:
                n = len(scores)
                med = scores[n // 2] if n % 2 else (scores[n // 2 - 1] + scores[n // 2]) / 2
            by[sec] = {'n': len(rs),
                       'median_score': med,
                       'bullish_rated': sum(1 for r in rs if r.get('rating') in ('Strong Buy', 'Buy')),
                       'bearish_rated': sum(1 for r in rs if r.get('rating') in ('Sell', 'Strong Sell'))}
        d['summary']['by_sector'] = by
        d['summary']['symbols_scored'] = len(rows)
        from collections import Counter as _C
        scores = [r['score'] for r in rows if isinstance(r.get('score'), (int, float))]
        d['summary']['rating_counts'] = dict(_C(r.get('rating') for r in rows))
        d['summary']['classification_counts'] = dict(_C(r.get('classification') for r in rows))
        if scores:
            ss = sorted(scores)
            n = len(ss)
            d['summary']['median_score'] = ss[n // 2] if n % 2 else (ss[n // 2 - 1] + ss[n // 2]) / 2
            d['summary']['mean_score'] = round(sum(ss) / n, 2)
        kept = {r['symbol'] for r in rows}
        for key in ('top_scored', 'bottom_scored'):
            if isinstance(d['summary'].get(key), list):
                d['summary'][key] = [s for s in d['summary'][key]
                                     if (s if isinstance(s, str) else s.get('symbol')) in kept]
        d['unsectorised_equity'] = unsectorised_equity
        d['dropped_from_board'] = dropped
    handle('data/technical-signals.json', tech, False)

    # ---- VPI: row sectors remapped (LTP-only equities get true sector);
    # UNCONFIRMED and non-equity rows dropped from the current board;
    # tracking (aggregate history) untouched + disclosed ----
    def vpi(d):
        rows = []
        dropped = []
        for r in d['data']:
            sec = sector_of(m, r.get('symbol'))
            if sec is None or type_of(m, r.get('symbol')) != 'EQUITY':
                dropped.append(r.get('symbol'))
                continue
            r = dict(r)
            r['sector'] = sec
            rows.append(r)
        d['data'] = rows
        d['count'] = len(rows)
        d['dropped_from_board'] = dropped
        d['tracking_note'] = ('tracking is aggregate history and is untouched; '
                              'the current board above is restated.')
        if isinstance(d.get('summary'), dict):
            from collections import Counter
            d['summary']['by_sector'] = dict(Counter(r['sector'] for r in rows))
    handle('data/vpi.json', vpi, False)

    # ---- money-flow: sectors map remapped; sector_flow keys renamed;
    # Others/Unclassified flows moved to disclosed unattributed_flow
    # (not a sector) because pair-level re-attribution is impossible
    # from this file alone ----
    def moneyflow(d):
        new_map = {}
        for sym, sec in d['sectors'].items():
            new_map[sym] = sector_of(m, sym)  # None = UNCONFIRMED (no sector)
        d['sectors'] = new_map
        # Preserve any previously moved entries: the handler must be
        # idempotent (a second run must not drop unattributed_flow).
        unattributed = list(d.get('unattributed_flow', []))
        new_flow = []
        for e in d.get('sector_flow', []):
            nk = rename_key(e.get('sector'))
            if nk is None:
                # Keep the entry auditable but never as a 'sector':
                # the old bucket label moves to former_sector.
                e = dict(e)
                e['former_sector'] = e.pop('sector')
                unattributed.append(e)
            else:
                e = dict(e)
                e['sector'] = nk
                new_flow.append(e)
        d['sector_flow'] = new_flow
        d['unattributed_flow'] = unattributed
        d['unsectorised_note'] = ('sector_flow aggregates computed under pre-master '
                                  'membership; Others/Unclassified entries moved to '
                                  'unattributed_flow (not a sector) pending the next '
                                  'money-flow builder run under master sectors.')
    handle('nepse-money-flow/data/money-flow.json', moneyflow, True)

    # ---- calendar-events: symbol->sector map remapped from master ----
    if os.path.exists(os.path.join(ROOT, 'data/calendar-events.json')):
        def cal(d):
            if isinstance(d.get('sectors'), dict):
                d['sectors'] = {sym: sector_of(m, sym) for sym in d['sectors']}
        handle('data/calendar-events.json', cal, False)

    # ---- generic row-level remap (ranked lists / per-symbol stats,
    # NOT sector groupings): sector = master sector or None, row kept.
    # Sector-keyed dicts encountered are renamed, bucket keys dropped.
    def generic_remap(o, path=''):
        if isinstance(o, dict):
            if 'sector' in o and isinstance(o['sector'], str) and 'symbol' in o:
                o['sector'] = sector_of(m, o['symbol'])
            # symbols-dict values: key is the symbol, value carries sector.
            # Unmastered symbols get null (no sector asserted), never the
            # old bucket label.
            if 'symbols' in o and isinstance(o['symbols'], dict):
                for k, v in o['symbols'].items():
                    if isinstance(v, dict) and 'sector' in v and isinstance(v['sector'], str):
                        v['sector'] = sector_of(m, k)
            # sector-keyed dicts: rename old labels, drop buckets
            for k in list(o.keys()):
                nk = rename_key(k) if k in OLD_TO_NEW or k in BUCKETS else None
                if nk is None and (k in OLD_TO_NEW or k in BUCKETS):
                    del o[k]
                elif nk is not None and nk != k:
                    o[nk] = o.pop(k)
            for v in o.values():
                generic_remap(v, path)
        elif isinstance(o, list):
            for v in o:
                generic_remap(v, path)
        return o

    def generic_file(path, pending):
        def fn(d):
            generic_remap(d)
        handle(path, fn, pending)

    # broker-family boards (ranked / per-symbol, not sector-grouped)
    for p in ['data/broker-smart-money.json', 'data/smart-money-eps.json']:
        if os.path.exists(os.path.join(ROOT, p)):
            generic_file(p, False)
    for p in sorted([f for f in os.listdir(os.path.join(ROOT, 'data'))
                     if f.startswith('broker-zero-sum-') and f.endswith('.json')
                     and 'history' not in f]):
        generic_file('data/' + p, False)
    for p in sorted([f for f in os.listdir(os.path.join(ROOT, 'data'))
                     if f.startswith('price-push-') and f.endswith('.json')
                     and 'history' not in f and 'manifest' not in f]):
        generic_file('data/' + p, False)
    # broker/price-push history ledgers are append-only (and carry no
    # sector fields): stamp-only. The price-push manifest carries no
    # sector fields at all and is left untouched.
    for p in ['data/broker-zero-sum-history.json', 'data/price-push-history.json']:
        if os.path.exists(os.path.join(ROOT, p)):
            stamp_only(p, check, report,
                       'Append-only session ledger: entries retain pre-master labels '
                       '(entries carry no sector fields); the current boards are restated.')

    # sim-benchmarks: rows remapped (kept, null sector allowed); sectors
    # aggregates renamed, bucket aggregates dropped, values pending
    if os.path.exists(os.path.join(ROOT, 'data/sim-benchmarks.json')):
        def sim(d):
            for r in d.get('rows', []):
                if 'sector' in r and 'symbol' in r:
                    r['sector'] = sector_of(m, r['symbol'])
            if isinstance(d.get('sectors'), list):
                out = []
                for r in d['sectors']:
                    nk = rename_key(r.get('sector'))
                    if nk is None:
                        continue
                    r = dict(r)
                    r['sector'] = nk
                    out.append(r)
                d['sectors'] = out
        handle('data/sim-benchmarks.json', sim, True)

    # stock-sector-sentiment (current board): rows remapped (equity
    # board: UNCONFIRMED dropped, Trading kept), sector_rank recomputed
    # by score desc within the new sector (rule verified 268/268 on the
    # old board); sector aggregates renamed, Others aggregate dropped,
    # values flagged pending
    if os.path.exists(os.path.join(ROOT, 'data/stock-sector-sentiment.json')):
        def sentiment(d):
            for w, b in (d.get('boards') or {}).items():
                if not isinstance(b, dict):
                    continue
                rows = []
                for r in b.get('rows', []):
                    sec = sector_of(m, r.get('symbol'))
                    if sec is None or type_of(m, r.get('symbol')) != 'EQUITY':
                        continue
                    r = dict(r)
                    r['sector'] = sec
                    rows.append(r)
                by = defaultdict(list)
                for r in rows:
                    by[r['sector']].append(r)
                for sec, rs in by.items():
                    rs.sort(key=lambda x: -(x.get('score') if isinstance(x.get('score'), (int, float)) else -1e18))
                    for i, r in enumerate(rs, 1):
                        r['sector_rank'] = i
                b['rows'] = rows
                kept = {r['symbol'] for r in rows}
                for key in ('top', 'bottom'):
                    if isinstance(b.get(key), list):
                        out = []
                        for r in b[key]:
                            if isinstance(r, dict) and r.get('symbol') not in kept:
                                continue
                            r = dict(r)
                            if 'sector' in r:
                                r['sector'] = sector_of(m, r.get('symbol'))
                            out.append(r)
                        b[key] = out
                if isinstance(b.get('summary'), dict):
                    b['summary']['scored'] = len(rows)
                    if isinstance(b.get('unscored'), list):
                        b['summary']['unscored'] = len(b['unscored'])
                    for key in ('top_sector', 'bottom_sector'):
                        if b['summary'].get(key) in OLD_TO_NEW:
                            b['summary'][key] = OLD_TO_NEW[b['summary'][key]]
                if isinstance(b.get('sectors'), list):
                    out = []
                    for r in b['sectors']:
                        nk = rename_key(r.get('sector'))
                        if nk is None:
                            continue
                        r = dict(r)
                        r['sector'] = nk
                        out.append(r)
                    b['sectors'] = out
            d['unsectorised_equity'] = unsectorised_equity
            # history_recent: past-session snapshots inside this live file —
            # rename their sector labels to the master vocabulary (values
            # remain past-membership aggregates, flagged pending by the stamp)
            if isinstance(d.get('history_recent'), list):
                for snap in d['history_recent']:
                    if not isinstance(snap, dict):
                        continue
                    if isinstance(snap.get('sectors'), list):
                        out = []
                        for r in snap['sectors']:
                            nk = rename_key(r.get('sector'))
                            if nk is None:
                                continue
                            r = dict(r)
                            r['sector'] = nk
                            out.append(r)
                        snap['sectors'] = out
                    for key in ('top5', 'bottom5'):
                        if isinstance(snap.get(key), list):
                            for r in snap[key]:
                                if isinstance(r, dict) and 'sector' in r:
                                    r['sector'] = sector_of(m, r.get('symbol'))
        handle('data/stock-sector-sentiment.json', sentiment, True)
    for p, note in [
        ('data/stock-sector-sentiment-history.json',
         'Append-only session ledger: entries retain pre-master sector labels; the current board is restated.'),
        ('data/stock-sector-sentiment-board-archive.json',
         'Archive: per-session per-symbol sec fields retain pre-master labels; the current board is restated.'),
    ]:
        if os.path.exists(os.path.join(ROOT, p)):
            stamp_only(p, check, report, note)

    # predictive-diagnostics: scrips remapped (kept, null allowed);
    # sector_track_records keys renamed, bucket keys dropped, pending
    if os.path.exists(os.path.join(ROOT, 'data/predictive-diagnostics.json')):
        def pred(d):
            if isinstance(d.get('scrips'), dict):
                for sym, v in d['scrips'].items():
                    if isinstance(v, dict) and 'sector' in v:
                        v['sector'] = sector_of(m, sym)
            def ren_keys(o):
                if isinstance(o, dict):
                    for k in list(o.keys()):
                        if k in OLD_TO_NEW or k in BUCKETS:
                            nk = rename_key(k)
                            if nk is None:
                                del o[k]
                            else:
                                o[nk] = o.pop(k)
                    for v in o.values():
                        ren_keys(v)
                elif isinstance(o, list):
                    for v in o:
                        ren_keys(v)
            ren_keys(d.get('sector_track_records', {}))
        handle('data/predictive-diagnostics.json', pred, True)

    # market-regime: index_name values are sector-index names from the
    # keystone — rename to match the restated keystone keys, drop the
    # Others index (no Others keystone series anymore), values pending
    if os.path.exists(os.path.join(ROOT, 'data/market-regime.json')):
        def regime(d):
            if isinstance(d.get('indexes'), list):
                out = []
                for r in d['indexes']:
                    nm = r.get('index_name')
                    if nm in BUCKETS:
                        continue
                    r = dict(r)
                    if nm in OLD_TO_NEW:
                        r['index_name'] = OLD_TO_NEW[nm]
                    out.append(r)
                d['indexes'] = out
        handle('data/market-regime.json', regime, True)

    # corporate-actions-ledger: items remapped by symbol (kept, null
    # allowed); no other section carries sector fields (verified)
    if os.path.exists(os.path.join(ROOT, 'data/corporate-actions-ledger.json')):
        def ledger(d):
            for it in d.get('items', []):
                if 'sector' in it and 'symbol' in it:
                    it['sector'] = sector_of(m, it['symbol'])
        handle('data/corporate-actions-ledger.json', ledger, False)

    # verdicts-v2 current payloads: identity sector remapped + type added
    # (same treatment as PR1 dossiers); historical shards stamp-only
    for p in ['data/verdicts-v2.json', 'data/verdicts-v2-summary.json']:
        if os.path.exists(os.path.join(ROOT, p)):
            def v2(d, _p=p):
                for sym, v in (d.get('verdicts') or {}).items():
                    ident = None
                    if isinstance(v, dict):
                        ident = (v.get('evidence') or {}).get('identity')
                        if ident is None and 'sector' in v:
                            # summary form: top-level sector field
                            v['sector'] = sector_of(m, sym)
                            v['instrument_type'] = type_of(m, sym)
                            continue
                    if isinstance(ident, dict):
                        ident['sector'] = sector_of(m, sym)
                        ident['instrument_type'] = type_of(m, sym)
            handle(p, v2, False)
    if os.path.isdir(os.path.join(ROOT, 'data/verdicts-v2.d')):
        for f in sorted(os.listdir(os.path.join(ROOT, 'data/verdicts-v2.d'))):
            if f.endswith('.json'):
                stamp_only('data/verdicts-v2.d/' + f, check, report,
                           'Historical session shard: identity sectors retain pre-master '
                           'labels; the current verdicts payload is restated.')

    # contributors: PROVISIONAL intraday payload owned by the separate
    # contributors-publisher lane (not wired in PR1, not touched here):
    # stamp only, so the file itself carries the restatement note until
    # that lane's wiring lands; a row remap now would be overwritten
    # by the publisher's next run.
    if os.path.exists(os.path.join(ROOT, 'data/contributors.json')):
        d = load('data/contributors.json')
        stamp(d, True)
        d['classification_restated']['publisher_note'] = ('Contributors publisher lane '
            'separate (phase (b), post-close): this provisional payload still carries '
            'pre-master sector labels until that publisher is wired to the master.')
        dump('data/contributors.json', d, check)
        report.append('data/contributors.json: stamp-only (publisher lane separate)')

    for line in report:
        print(line)
    print('master equity by sector:', {k: len(v) for k, v in sorted(equity_by_sector.items())})
    print('unsectorised equity:', unsectorised_equity)
    return 0


if __name__ == '__main__':
    sys.exit(main())

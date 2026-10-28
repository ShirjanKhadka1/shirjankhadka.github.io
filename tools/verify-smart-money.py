#!/usr/bin/env python3
"""Verifier for the Broker Smart Money teardown (2026-10-27).
Checks the rebuilt page + the published Oct-26 payload against
independent recomputation. Read-only: never writes data files.
Usage: python3 tools/verify-smart-money.py [--live /tmp/sm-live.json]
Exit 0 only when FAIL == 0."""
import argparse, bisect, gzip, hashlib, json, math, os, re, sqlite3, sys

WT = os.path.expanduser('~/workspace/wt-smart-money')
DB = os.path.expanduser('~/workspace/wave8-build/repo/tools/broker/data/floorsheet.db')
PASS = WARN = FAIL = 0
def ok(cond, msg):
    global PASS, WARN, FAIL
    if cond: PASS += 1; print(f'  PASS {msg}')
    else: FAIL += 1; print(f'  FAIL {msg}')
def warn(msg):
    global WARN; WARN += 1; print(f'  WARN {msg}')

def sha1_8(p):
    return hashlib.sha1(open(p, 'rb').read()).hexdigest()[:8]

def pct_ranks(vals):
    s = sorted(vals); n = len(s); out = {}
    for v in set(vals):
        if n <= 1: out[v] = 50.0
        else:
            lo = bisect.bisect_left(s, v); hi = bisect.bisect_right(s, v)
            out[v] = 100.0 * (lo + hi - 1) / (2 * (n - 1))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--live', default='/tmp/sm-live.json')
    a = ap.parse_args()
    html_p = os.path.join(WT, 'nepse-broker-smart-money/index.html')
    css_p = os.path.join(WT, 'css/nd-smart-money.css')
    js_p = os.path.join(WT, 'js/smart-money.js')
    payload_p = os.path.join(WT, 'data/broker-smart-money.json')
    hist_p = os.path.join(WT, 'data/broker-smart-money-history.json')
    uni_p = os.path.join(WT, 'nepse-chart/data/universe.json')
    ver_p = os.path.join(WT, 'nepse-chart/data/verdicts.json')
    html = open(html_p).read(); css = open(css_p).read(); js = open(js_p).read()

    print('== chain stamps (raw SHA-1 first-8) ==')
    for label, path, pat in [
        ('editorial', os.path.join(WT, 'css/nd-editorial-theme.css'), r'nd-editorial-theme\.css\?v=([0-9a-f]{8})'),
        ('cinema', os.path.join(WT, 'css/nd-cinema.css'), r'nd-cinema\.css\?v=([0-9a-f]{8})'),
        ('chrome-css', os.path.join(WT, 'css/nd-chrome.css'), r'nd-chrome\.css\?v=([0-9a-f]{8})'),
        ('family-css', css_p, r'nd-smart-money\.css\?v=([0-9a-f]{8})'),
        ('smart-money.js', js_p, r'smart-money\.js\?v=([0-9a-f]{8})'),
        ('nd-chrome.js', os.path.join(WT, 'js/nd-chrome.js'), r'nd-chrome\.js\?v=([0-9a-f]{8})'),
        ('freshness-badge.js', os.path.join(WT, 'js/freshness-badge.js'), r'freshness-badge\.js\?v=([0-9a-f]{8})')]:
        m = re.search(pat, html)
        ok(m and m.group(1) == sha1_8(path), f'{label} stamp {m.group(1) if m else None} == raw {sha1_8(path)}')
    ok('nd-chrome.css?v=69b323cf' in html, 'chrome bumped to nav-fix stamp 69b323cf')
    ok('nd-chrome.js?v=643c6521" defer' in html, 'nd-chrome.js deferred')
    m = re.search(r"broker-smart-money\.json\?v=(\S+?)'", js)
    ok(m and m.group(1) != '20261024a', f'data token fresh ({m.group(1) if m else None} != 20261024a)')

    print('== legacy elimination (every block) ==')
    for pat, name in [(r'nepse-design-system', 'design-system ref'),
                      (r'broker-pages\.css', 'broker-pages ref'),
                      (r'broker-common\.js', 'broker-common ref'),
                      (r'<style', 'inline style block'),
                      (r'style="', 'inline style attribute in HTML')]:
        ok(not re.search(pat, html), f'HTML: no {name}')
    ok('style="' not in css, 'CSS: no inline style attrs (n/a)')
    ok(not re.search(r'#[0-9a-fA-F]{3,8}\b', css), 'family CSS: no hardcoded hex')
    tokens = set(re.findall(r'(--nd-[a-z0-9-]+)\s*:', open(os.path.join(WT, 'css/nd-tokens.css')).read()))
    used_vars = set(re.findall(r'var\((--nd-[a-z0-9-]+)', css))
    ok(used_vars <= tokens, f'family CSS vars all defined in tokens (undefined: {sorted(used_vars - tokens)})')
    # class coverage: HTML class attrs + sm-/cx- tokens inside JS strings
    used = set()
    for c in re.findall(r'class="([^"]+)"', html): used.update(c.split())
    for s in re.findall(r'"([^"]+)"', js):
        for t in re.findall(r'\b(sm-[a-z0-9-]+|cx-[a-z0-9-]+)\b', s): used.add(t)
    defined = set()
    for f in ['css/nd-smart-money.css', 'css/nd-cinema.css', 'css/nd-chrome.css', 'css/nd-editorial-theme.css']:
        defined.update(re.findall(r'\.([a-zA-Z0-9_-]+)(?![a-zA-Z0-9_-])', open(os.path.join(WT, f)).read()))
    # fb-wrap is a hook class only; its layout comes from sm-fbwrap.
    missing = sorted(u for u in used if u not in defined and u not in ('nd', 'fb-wrap'))
    ok(not missing, f'every used class has a rule (missing: {missing})')
    ok('body.nd[data-page="broker-smart-money"]' in css and 'html[data-theme="dark"]' in css and 'html[data-theme="light"]' in css,
       'canvas pin theme-scoped both themes')
    ok('.nd-content' in css, 'nd-content load-bearing rule present')
    for pat, name in [('no-store', 'no-store tick fetch'), ('setInterval', '60s timer'),
                      ('visibilitychange', 'hidden-tab handling'), ('rebaseline()', 're-baseline calls')]:
        ok(pat in js, f'JS refresh: {name}')
    ok('sig = null' not in js.replace('var sig = null', ''), 'JS: signature never nulled after init (gate lesson)')
    ok('smPager' in js or 'sm-pager' in js, 'JS: pagers present')
    ok('smSectorSel' in html and 'sectorBody' in html, 'sector block markup present')
    gz = len(gzip.compress(open(js_p, 'rb').read()))
    ok(gz <= 170 * 1024, f'JS gz {gz} bytes <= 170KB')

    print('== payload structure (published Oct-26 board) ==')
    d = json.load(open(payload_p))
    ok(d.get('schema') == 'nd-broker-smart-money/v1', 'schema nd-broker-smart-money/v1')
    ok(d.get('status') == 'FINAL', 'status FINAL (no provisional feed on this board)')
    ok(d['window']['days'] == 30 and d['window']['sessions_in_window'] == 15, 'window 30d / 15 sessions')
    m = d['market']; sm = d['skill_meta']; board = d['board']; lb = d['leaderboard']
    ok(m['board_symbols'] == len(board) == 287, 'board_symbols == board rows == 287')
    ok(m['positive'] + m['negative'] + m['neutral'] == 287, 'pos+neg+neutral == 287')
    ok(m['board_symbols'] + m['unscoped_symbols'] + m['excluded_instrument_symbols'] == m['symbols_in_window'] == 419,
       'board+unscoped+excluded == symbols_in_window == 419')
    tc = m['tier_counts']
    ok(sum(tc.values()) == 287, 'tier counts sum to 287')
    ok(len(sm['cohort']) == math.ceil(sm['decile_eligible'] / 10) == 9, 'cohort 9 == ceil(90/10)')
    ok(set(sm['cohort']) == {b['broker'] for b in lb if b['in_cohort']}, 'cohort set == in_cohort flags')
    ok(len(lb) == sm['rated_brokers'] == 91, 'leaderboard 91 == rated brokers')
    ranks = [b['rank'] for b in lb if b['rank'] is not None]
    ok(ranks == sorted(ranks) and ranks == list(range(1, len(ranks) + 1)) and
       all(lb[i]['skill_full'] >= lb[i + 1]['skill_full'] for i in range(len(lb) - 1) if lb[i]['rank'] and lb[i + 1]['rank']),
       'leaderboard ranked by skill_full desc, ranks consecutive')
    ok(abs(d['persistence']['spread_pp'] - (d['persistence']['top']['mean_excess_pp'] - d['persistence']['rest']['mean_excess_pp'])) < 0.011,
       'persistence spread == top - rest')
    ok(d['pooled']['all']['n'] == sm['events_full'] == 77179, 'pooled all n == events_full == 77179')
    pos = [r for r in board if r['skilled_net_amt'] > 0]
    pr_amt = pct_ranks([r['skilled_net_amt'] for r in pos])
    pr_bq = pct_ranks([r['broker_quality'] for r in pos if r['broker_quality'] is not None])
    # Score tolerance is DERIVED, not magic: the builder ranks UNROUNDED
    # raw nets/qualities, the payload publishes r2-rounded values, and
    # 2dp quality rounding creates tie groups (up to 9 rows share 0.40).
    # A tie group of size g can shift a mean rank by at most (g-1)/2
    # positions; one position = 100/(n-1) pct points; the score is the
    # mean of two dims, so the bound is (g-1)*100/(4*(n-1)). Observed
    # worst diff 1.369 vs bound 1.370 (9-tie group) — the theory holds
    # exactly. Tiers are checked exactly against payload scores, and
    # board order + rank consecutiveness are checked exactly below.
    from collections import Counter as _C
    g = max(_C(r['broker_quality'] for r in pos if r['broker_quality'] is not None).values())
    tol = (g - 1) * 100.0 / (4 * (len(pos) - 1)) + 0.02
    bad = []
    for r in pos:
        exp = (pr_amt[r['skilled_net_amt']] + (pr_bq.get(r['broker_quality'], 50.0) if r['broker_quality'] is not None else 50.0)) / 2.0
        if abs(exp - r['conviction_score']) > tol: bad.append(r['symbol'])
        want = 'Very High' if r['conviction_score'] >= 80 else 'High' if r['conviction_score'] >= 60 else 'Moderate' if r['conviction_score'] >= 40 else 'Low'
        if r['tier'] != want: bad.append(r['symbol'] + ':tier')
    ok(not bad, f'conviction replicates within derived rounding-tie bound (tol {tol:.3f}, max tie group {g}) + tier thresholds on payload score (bad: {bad[:5]})')
    keyed = sorted(board, key=lambda r: (-(r['conviction_score'] if r['conviction_score'] is not None else -1), -abs(r['skilled_net_amt']), r['symbol']))
    ok([r['symbol'] for r in keyed] == [r['symbol'] for r in board], 'board order == (-score, -|net|, symbol) exactly')
    ranked = [r for r in board if r['conviction_rank'] is not None]
    ok([r['conviction_rank'] for r in ranked] == list(range(1, len(ranked) + 1)) and
       all(ranked[i]['conviction_score'] >= ranked[i + 1]['conviction_score'] for i in range(len(ranked) - 1)),
       'conviction ranks 1..147 consecutive in score order')
    bad = [r['symbol'] for r in board if (r['skilled_net_amt'] <= 0) != (r['tier'] == 'Watch / None')]
    ok(not bad, f'tier partition: Watch/None exactly the non-positive side (bad: {bad[:5]})')
    bad = [r['symbol'] for r in board if r['conviction_score'] is None] 
    ok(set(bad) == {r['symbol'] for r in board if r['tier'] == 'Watch / None'}, 'null scores exactly on Watch/None')
    bad = []
    for r in board:
        if abs(r['intensity_pct'] - round(100.0 * r['skilled_net_amt'] / r['total_turnover'], 2)) > 0.02: bad.append(r['symbol'])
    ok(not bad, f'intensity == 100*skilled_net/total_turnover (bad: {bad[:5]})')
    bad = []
    for r in board:
        det = d['symbols'].get(r['symbol'])
        if det and abs([x for x in det['ladder'] if x['days'] == 30][0]['skilled_net_amt'] - r['skilled_net_amt']) > 0.011: bad.append(r['symbol'])
        if det and len(det['accumulators']) > 12: bad.append(r['symbol'] + ':acc>12')
        if det and len(det['distributors']) > 8: bad.append(r['symbol'] + ':dist>8')
        if det and [x[2] for x in det['accumulators']] != sorted([x[2] for x in det['accumulators']], reverse=True): bad.append(r['symbol'] + ':acc-order')
        if det and [x[2] for x in det['distributors']] != sorted([x[2] for x in det['distributors']]): bad.append(r['symbol'] + ':dist-order')
        if det and any(x[4] and x[3] is None for x in det['accumulators'] + det['distributors']): bad.append(r['symbol'] + ':cohort-unrated')
    ok(not bad, f'ladder/caps/order/cohort-skill checks (bad: {bad[:5]})')
    nodetail = {r['symbol'] for r in board if r['symbol'] not in d['symbols']}
    ok(nodetail == {r['symbol'] for r in board if r['skilled_net_amt'] == 0},
       f'no-detail rows exactly the neutral (net-0) rows: {sorted(nodetail)}')
    hist = json.load(open(hist_p))
    ok([e['asof'] for e in hist['entries']] == [e['asof'] for e in d['history_recent']],
       'history_recent == history ledger entries')
    ok([e['asof'] for e in hist['entries']] == ['2026-10-16', '2026-10-26'], 'ledger [2026-10-16, 2026-10-26]')

    print('== sector data ==')
    u = json.load(open(uni_p)); v = json.load(open(ver_p))
    ok(len(u['symbols']) == 412 and len(v['verdicts']) == 412, 'universe 412 + verdicts 412')
    from collections import Counter
    secs = Counter(v['verdicts'][row['s']]['sec'] for row in u['symbols'] if v['verdicts'].get(row['s'], {}).get('sec'))
    ok(len(secs) == 15 and sum(secs.values()) == 412, f'15 sectors, counts sum 412 (Hydropower {secs.get("Hydropower")})')
    ok(all(row.get('n') for row in u['symbols']), 'every universe row has a real company name')

    print('== live vs worktree (stranded-board check) ==')
    if os.path.exists(a.live):
        live = json.load(open(a.live))
        ok(live.get('asof') == d.get('asof') == '2026-10-26',
           f'live asof {live.get("asof")} == worktree asof {d.get("asof")} (NO stranded board)')
    else:
        warn(f'live file {a.live} missing; stranded check skipped')

    print('== DB spot checks (independent SQL, read-only) ==')
    db = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    cohort = set(sm['cohort'])
    for sym in ['MBL', 'GHL', 'NABIL']:
        rows = db.execute('SELECT broker, SUM(buy_value), SUM(sell_value) FROM daily_summary '
                          'WHERE date >= ? AND date <= ? AND symbol = ? GROUP BY broker',
                          (d['window']['start'], d['window']['end'], sym)).fetchall()
        net = sum((b or 0) - (s or 0) for br, b, s in rows if str(br) in cohort)
        row = next((r for r in board if r['symbol'] == sym), None)
        if row is None:
            warn(f'{sym} not on board; DB cohort net {net:,.2f} (off-board, informational)')
        else:
            ok(abs(net - row['skilled_net_amt']) < 0.05,
               f'{sym}: DB cohort net {net:,.2f} == payload skilled_net {row["skilled_net_amt"]:,.2f}')
    # cross-source: DB buy total vs official EOD turnovers for the
    # sessions where BOTH exist (eod archive holds 9 files; the
    # window's 15 symbol-filtered sessions overlap on 8 — Oct-07 is
    # totals-only in the floorsheet archive and correctly excluded
    # from the DB window sums, so it must not be in the equality).
    tot = db.execute('SELECT SUM(buy_value) FROM daily_summary WHERE date >= ? AND date <= ? AND symbol <> ?',
                     (d['window']['start'], d['window']['end'], '')).fetchone()[0]
    sess = [r[0] for r in db.execute("SELECT DISTINCT date FROM daily_summary WHERE date >= ? AND date <= ? AND symbol <> '' ORDER BY date",
                                     (d['window']['start'], d['window']['end']))]
    off = 0.0; db_part = 0.0; n = 0
    for s in sess:
        p = os.path.expanduser(f'~/workspace/nepse-data-archive/eod/eod-{s}.json')
        if not os.path.exists(p): continue
        e = json.load(open(p))
        ms = e.get('market_summary', [])
        t = next((x['value'] for x in ms if isinstance(x, dict) and x.get('detail', '').strip().rstrip(':') == 'Total Turnover Rs'), None)
        if t is None: continue
        off += float(t)
        db_part += db.execute('SELECT SUM(buy_value) FROM daily_summary WHERE date = ? AND symbol <> ?',
                              (s, '')).fetchone()[0] or 0.0
        n += 1
    print(f'  INFO overlapping sessions {n} | DB buy total {db_part:,.2f} | official EOD sum {off:,.2f}')
    ok(n >= 8 and abs(db_part - off) < 1.0, f'DB buy total == official EOD sum over {n} overlapping sessions (exact)')

    print(f'\nRESULT: PASS {PASS} / WARN {WARN} / FAIL {FAIL}')
    return 1 if FAIL else 0

if __name__ == '__main__':
    sys.exit(main())

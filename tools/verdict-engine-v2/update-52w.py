#!/usr/bin/env python3
"""Verdict Engine v2 — autonomous 52-week high/low updater.

Keeps the archive's 52w high/low fresh without manual re-verification:
- Daily (after market close): reads today's high/low per symbol from
  nepse-chart/data/live.json. If today's high exceeds the stored 52w high,
  or today's low undercuts the stored 52w low, the archive is updated,
  pct_below_52w_high is recomputed, and the change is logged.
- This is INCREMENTAL: it catches new 52w highs/lows (the case the user
  asked to automate). It does not handle 52-week window expiry (an old
  high rolling out of the window) — that needs full price history and is
  covered by periodic manual re-verification.

Only runs when live.json shows market CLOSED (final daily high/low).
Rebuilds float-archive.json and re-validates after any update.

Usage: python3 tools/verdict-engine-v2/update-52w.py [--force]
  --force: run even if market is not CLOSED (for testing).
"""
import json, os, sys, glob, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANUAL = os.path.join(ROOT, 'tools', 'verdict-engine-v2', 'manual')
LOG = os.path.join(MANUAL, '52w-update-log.json')

def load(p, fb=None):
    try:
        return json.load(open(p))
    except Exception:
        return fb

def main():
    force = '--force' in sys.argv
    live = load(os.path.join(ROOT, 'nepse-chart', 'data', 'live.json'), {})
    if not force and live.get('market') != 'CLOSED':
        print(f"update-52w: market is {live.get('market')}, not CLOSED — skipping (use --force to override)")
        return 0
    session = live.get('session_date')
    quotes = {q['symbol']: q for q in live.get('quotes', []) if q.get('symbol')}
    if not quotes:
        print("update-52w: no quotes in live.json — nothing to do")
        return 0

    # Idempotency: skip if this session was already processed
    log = load(LOG, {'updates': []})
    if log.get('last_session') == session and not force:
        print(f"update-52w: session {session} already processed — skipping")
        return 0

    updates = []
    for f in sorted(glob.glob(os.path.join(MANUAL, 'fund-batch*.json'))):
        d = json.load(open(f))
        changed = False
        for sym, r in d.get('stocks', {}).items():
            q = quotes.get(sym)
            if not q:
                continue
            th, tl = q.get('high'), q.get('low')
            if not th or not tl:
                continue
            oh, ol = r.get('high_52w'), r.get('low_52w')
            new_h, new_l = oh, ol
            why = []
            # Only update when today's range EXTENDS the stored 52w range.
            # Never fill a missing 52w range with a single day's data —
            # that would be a 1-day range, not a 52-week range.
            if oh is not None and th > oh:
                new_h = float(th)
                why.append(f'high {oh} -> {new_h}')
            if ol is not None and tl < ol:
                new_l = float(tl)
                why.append(f'low {ol} -> {new_l}')
            if why:
                r['high_52w'] = new_h
                r['low_52w'] = new_l
                if new_h and r.get('ltp'):
                    r['pct_below_52w_high'] = round((new_h - r['ltp']) / new_h * 100, 2)
                    if 'pct_below_52w_high' not in r.get('derived_fields', []):
                        r.setdefault('derived_fields', []).append('pct_below_52w_high')
                r['note'] = ((r.get('note') or '') +
                    f' [AUTO 52w update {session}: {"; ".join(why)}]').strip()
                updates.append({'symbol': sym, 'session': session, 'changes': why})
                changed = True
        if changed:
            json.dump(d, open(f, 'w'), indent=1)

    # append to log
    log['updates'].extend(updates)
    log['last_run'] = datetime.datetime.now().isoformat()
    log['last_session'] = session
    json.dump(log, open(LOG, 'w'), indent=1)

    print(f"update-52w: {len(updates)} symbols updated for session {session}")
    for u in updates[:20]:
        print(f"  {u['symbol']}: {'; '.join(u['changes'])}")
    if len(updates) > 20:
        print(f"  ... and {len(updates)-20} more")

    if updates:
        # rebuild archive + validate
        import subprocess
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'verdict-engine-v2', 'build-float-archive.py')],
                           capture_output=True, text=True)
        print(r.stdout.strip().split('\n')[-1] if r.stdout else 'rebuild done')
    return 0

if __name__ == '__main__':
    sys.exit(main())

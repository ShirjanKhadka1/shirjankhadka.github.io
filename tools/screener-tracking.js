/* Screener tracking: verdict archive + live call ledger.
 *
 * Called by tools/build-nepse-universe.js after verdicts are final
 * (purge + asof correction) and before verdicts.json is written, so
 * the per-verdict tracking fields land in the same file the page
 * already fetches. Additive and deterministic (no timestamps): the
 * only inputs are the build's own verdicts, series and asof.
 *
 * Two files, both under nepse-chart/data/ (inside the universe
 * refresh's publish allowlist):
 * - screener-verdict-archive.json: one lean snapshot per session
 *   (verdict, score, Buy-side streak). Streaks count consecutive
 *   sessions ending that day with a Buy or Strong Buy verdict, and
 *   are exact from the 2026-10-16 tracking start; a symbol appearing
 *   for the first time starts at streak 1 when Buy-side, else 0.
 * - screener-calls.json: every Buy/Strong Buy call as a live record.
 *   A call is created only for a fresh signal (the symbol's own last
 *   date equals the build asof), equity only, never LTP-only, with a
 *   finite stop and target. At most one call per symbol per session,
 *   and at most one open call per symbol. A call closes only on
 *   target (+4xATR), stop (-2xATR) or 20 sessions without either
 *   (expired) — never because a later verdict flipped; the flip is
 *   shown in the verdict changes, not by killing the call. Walks use
 *   daily high/low bars, stop checked before target on each bar,
 *   mirroring the replay's win rule.
 *
 * Throws on unexpected errors; the caller catches, logs loudly and
 * continues the universe build without tracking (never fail the
 * universe over this file).
 */
'use strict';

const RANK = {
  'Strong Buy': 0, 'Buy': 1, 'Hold': 2,
  'Exit / Reduce': 3, 'Strong Exit': 4, 'Insufficient history': 5,
};
const BUY = new Set(['Strong Buy', 'Buy']);
const EXIT = new Set(['Exit / Reduce', 'Strong Exit']);
const MAX_HOLD = 20;

function bisectLeft(dates, target) {
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function walkCall(call, series) {
  // series rows: [date, open, high, low, close, vol, turnover],
  // ascending. Returns a status update (never mutates on 'open' beyond
  // elapsed/return bookkeeping).
  const dates = series.map((r) => r[0]);
  const ei = bisectLeft(dates, call.date);
  if (ei >= dates.length || dates[ei] !== call.date) {
    return { status: 'open', sessions_elapsed: call.sessions_elapsed || 0,
             last_return: call.last_return || null, unknown_series: true };
  }
  const n = series.length;
  for (let j = ei + 1; j <= Math.min(ei + MAX_HOLD, n - 1); j++) {
    const low = series[j][3], high = series[j][2];
    if (low != null && low <= call.sl) {
      return { status: 'closed', exit: 'sl', exit_date: series[j][0],
               sessions_held: j - ei,
               exit_return: Math.round((call.sl / call.entry - 1) * 10000) / 10000,
               last_return: Math.round((call.sl / call.entry - 1) * 10000) / 10000 };
    }
    if (high != null && high >= call.tp) {
      return { status: 'closed', exit: 'tp', exit_date: series[j][0],
               sessions_held: j - ei,
               exit_return: Math.round((call.tp / call.entry - 1) * 10000) / 10000,
               last_return: Math.round((call.tp / call.entry - 1) * 10000) / 10000 };
    }
  }
  if (n - 1 >= ei + MAX_HOLD) {
    const c = series[ei + MAX_HOLD][4];
    return { status: 'closed', exit: 'expired',
             exit_date: series[ei + MAX_HOLD][0],
             sessions_held: MAX_HOLD,
             exit_return: Math.round((c / call.entry - 1) * 10000) / 10000,
             last_return: Math.round((c / call.entry - 1) * 10000) / 10000 };
  }
  const lastClose = series[n - 1][4];
  return { status: 'open', sessions_elapsed: (n - 1) - ei,
           last_return: (lastClose != null && call.entry)
             ? Math.round((lastClose / call.entry - 1) * 10000) / 10000 : null };
}

function persistenceBucket(streak) {
  if (streak <= 1) return 'flash';
  if (streak === 2) return 'mid';
  return 'persistent';
}

function updateScreenerTracking(deps) {
  const { fs, path, OUT, verdicts, symbols, universe, ohlcRows } = deps;
  const asof = universe.asof;
  const archPath = path.join(OUT, 'screener-verdict-archive.json');
  const callsPath = path.join(OUT, 'screener-calls.json');
  let arch = { schema: 'nd-screener-verdict-archive/v1',
    note: 'One lean verdict snapshot per session (verdict, score, '
      + 'Buy-side streak). Streaks count consecutive sessions ending '
      + 'that day with a Buy or Strong Buy verdict, exact from the '
      + '2026-10-16 tracking start.',
    sessions: {} };
  try { const d = JSON.parse(fs.readFileSync(archPath, 'utf8')); if (d.sessions) arch = d; } catch (e) {}
  let callsDoc = { schema: 'nd-screener-calls/v1',
    note: 'Live Buy/Strong Buy call ledger. A call closes only on '
      + 'target (+4xATR), stop (-2xATR) or 20 sessions without either '
      + '(expired) — never because a later verdict flipped. '
      + 'Educational record, not a recommendation.',
    calls: [] };
  try { const d = JSON.parse(fs.readFileSync(callsPath, 'utf8')); if (Array.isArray(d.calls)) callsDoc = d; } catch (e) {}
  const typeOf = {};
  (universe.symbols || []).forEach((r) => { typeOf[r.s] = r.t; });

  const prevDates = Object.keys(arch.sessions).filter((d) => d < asof).sort();
  const prevDate = prevDates.length ? prevDates[prevDates.length - 1] : null;
  const prevSnap = prevDate ? arch.sessions[prevDate] : {};
  const snap = {};
  let nUp = 0, nDown = 0, nHeld = 0, nNew = 0;
  const flips = [];
  for (const sym of symbols) {
    const e = verdicts[sym];
    if (!e) continue;
    const prev = prevSnap[sym];
    let ch = 'new', pv = null, ps = null, st = 0, flip = false;
    if (prev && RANK[prev.v] !== undefined && RANK[e.v] !== undefined) {
      pv = prev.v; ps = prev.s;
      if (RANK[e.v] < RANK[prev.v]) { ch = 'up'; nUp++; }
      else if (RANK[e.v] > RANK[prev.v]) { ch = 'down'; nDown++; }
      else { ch = 'flat'; nHeld++; }
      flip = (BUY.has(prev.v) && EXIT.has(e.v)) ||
             (EXIT.has(prev.v) && BUY.has(e.v));
      if (flip) flips.push({ symbol: sym, from: prev.v, to: e.v });
      st = BUY.has(e.v) ? (prev.st || 0) + 1 : 0;
    } else {
      nNew++;
      st = BUY.has(e.v) ? 1 : 0;
    }
    e.pv = pv; e.ps = ps; e.st = st; e.vc = ch; e.flip = flip;
    snap[sym] = { v: e.v, s: e.s, st };
  }
  arch.sessions[asof] = snap;
  const changes = { prev_session: prevDate, upgraded: nUp,
    downgraded: nDown, held: nHeld, new: nNew, flips };

  // New calls: fresh Buy-side signals only, equity, real OHLC, finite SL/TP.
  const hasCallOn = new Set(callsDoc.calls.map((c) => c.sym + '|' + c.date));
  const hasOpen = new Set(callsDoc.calls.filter((c) => c.status === 'open').map((c) => c.sym));
  let nCreated = 0;
  for (const sym of symbols) {
    const e = verdicts[sym];
    if (!e || !BUY.has(e.v)) continue;
    if (e.asof !== asof) continue;
    if (typeOf[sym] !== 'Equity') continue;
    if (e.l === 1) continue;
    if (!(e.p > 0) || !(e.sl > 0) || !(e.tp > 0)) continue;
    if (hasCallOn.has(sym + '|' + asof) || hasOpen.has(sym)) continue;
    callsDoc.calls.push({ sym, date: asof, entry: e.p, sl: e.sl, tp: e.tp,
      setup: e.setup || null, streak: e.st || 1, status: 'open',
      sessions_elapsed: 0, last_return: null, exit: null, exit_date: null,
      sessions_held: null, exit_return: null, updated_asof: asof });
    hasCallOn.add(sym + '|' + asof);
    hasOpen.add(sym);
    nCreated++;
  }
  // Walk open calls against today's series.
  let nClosed = 0;
  for (const call of callsDoc.calls) {
    if (call.status !== 'open') continue;
    const series = ohlcRows.get(call.sym);
    if (!series || !series.length) continue;
    const upd = walkCall(call, series);
    if (upd.status === 'closed') {
      call.status = 'closed'; call.exit = upd.exit;
      call.exit_date = upd.exit_date; call.sessions_held = upd.sessions_held;
      call.exit_return = upd.exit_return; call.last_return = upd.last_return;
      call.updated_asof = asof;
      nClosed++;
    } else if (!upd.unknown_series) {
      call.sessions_elapsed = upd.sessions_elapsed;
      call.last_return = upd.last_return;
      call.updated_asof = asof;
    }
  }
  // Summary.
  const bySetup = {};
  const byPers = { flash: { decided: 0, wins: 0, n: 0 },
    mid: { decided: 0, wins: 0, n: 0 },
    persistent: { decided: 0, wins: 0, n: 0 } };
  let open = 0, tp = 0, sl = 0, expired = 0;
  for (const c of callsDoc.calls) {
    const bucket = byPers[persistenceBucket(c.streak || 1)];
    bucket.n++;
    if (c.status === 'open') { open++; continue; }
    if (c.exit === 'tp') { tp++; bucket.decided++; bucket.wins++; }
    else if (c.exit === 'sl') { sl++; bucket.decided++; }
    else if (c.exit === 'expired') { expired++; }
    if (c.exit === 'tp' || c.exit === 'sl') {
      const key = c.setup || '(no setup)';
      bySetup[key] = bySetup[key] || { decided: 0, wins: 0 };
      bySetup[key].decided++;
      if (c.exit === 'tp') bySetup[key].wins++;
    }
  }
  const decided = tp + sl;
  callsDoc.asof = asof;
  callsDoc.summary = { asof, prev_session: prevDate, open,
    closed_tp: tp, closed_sl: sl, closed_expired: expired,
    decided, win_rate: decided ? Math.round((tp / decided) * 1000) / 1000 : null,
    created_today: nCreated, closed_today: nClosed,
    by_setup: Object.keys(bySetup).sort().map((k) => ({
      setup: k, decided: bySetup[k].decided, wins: bySetup[k].wins,
      win_rate: bySetup[k].decided
        ? Math.round((bySetup[k].wins / bySetup[k].decided) * 1000) / 1000 : null })),
    by_persistence: byPers };
  fs.writeFileSync(archPath, JSON.stringify(arch));
  fs.writeFileSync(callsPath, JSON.stringify(callsDoc));
  console.log('  screener tracking: prev ' + (prevDate || 'none') +
    ', ' + nUp + ' up / ' + nDown + ' down / ' + nHeld + ' held / ' + nNew +
    ' new, ' + flips.length + ' flips, ' + nCreated + ' calls created, ' +
    nClosed + ' calls closed, ' + open + ' open');
  return changes;
}

module.exports = { updateScreenerTracking, walkCall };

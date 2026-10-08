#!/usr/bin/env node
/**
 * tools/validate-build.js
 * Hard data-validation gates. Exit 0 = pass, exit 1 = FAIL (no deploy).
 *
 * Gates:
 *  0. manifest-present — data/manifest.json exists and parses
 *  1. live-session-current / universe-session-current — session_date matches
 *     the newest expected trading day
 *  2. security-count-stable — quoted count within ±5% of previous manifest
 *     (manual override requires --override-count-gate + --override-count-reason)
 *  3. price-sanity — no null/zero/negative LTP; high>=low>=0 OHLC sanity
 *  4. no-dup-symbols / no-dup-quotes — no duplicate symbols
 *  5. signals-*-fresh — signal files recomputed for the current session
 *  6. all-files-parse — every manifest-tracked file parses as JSON
 *  7. sha256-integrity (S3) — every manifest-tracked file with a recorded
 *     SHA-256 matches it (tamper / truncation / half-write detection)
 *
 * Usage: node tools/validate-build.js [--session YYYY-MM-DD]
 * Writes validation results to nepse-chart/data/validation.json for /status/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');
const td = require('./trading-days');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');

const results = [];
// severity: 'fail' blocks the deploy (default, preserves existing behavior);
// 'flag' records the failure, publishes, and surfaces it for [NEPSE ALERT] —
// it never blocks the deploy. Use 'flag' for anomalies that can be legitimate
// (corporate actions, halts) — flag, do not silently fix.
function gate(name, ok, detail, severity) {
  severity = severity || 'fail';
  results.push({ gate: name, pass: !!ok, detail: detail || '', severity });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}${severity === 'flag' ? ' [flag]' : ''}`);
}
function readData(rel) {
  return JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
}
function readRepo(rel) {
  // manifest file keys are repo-relative (e.g. 'nepse-chart/data/live.json')
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}
function sessionOf(obj) {
  // Prefer the explicit session_date stamp (last trading session, never a
  // weekend/holiday calendar date). Fall back to asof/updated for files
  // written before session_date existed. live.json asof is ISO datetime;
  // universe.json asof is YYYY-MM-DD.
  const a = (obj && (obj.session_date || obj.asof || obj.updated)) || '';
  return String(a).slice(0, 10);
}

// Largest earlier same-session POST-OPEN live.json snapshot committed in git
// history (live-quotes commits every ~15 min). Used by the intraday
// exceptions: mid-session snapshots legitimately GROW through the session
// (observed: 63 quotes at 10:54 NPT → 313 by 12:15 NPT on 2026-10-05), so
// full-day baselines false-fail when schedule drift pushes a pipeline run
// into market hours (seen 2026-10-07: content pipeline ran at 11:49 NPT).
// Pre-open snapshots are excluded — they carry the PREVIOUS session's full
// book (seen 2026-10-06: 359 pre-open quotes stamped session 2026-10-06 at
// 10:45:58 NPT, then 69 at 11:00:43 NPT growing to 318), and would
// false-fail. The count must not COLLAPSE intraday. Requires full git
// history (checkout fetch-depth: 0). Result is cached per process.
let postOpenBaselineCache = null;
function largestPostOpenSnapshot(today) {
  if (postOpenBaselineCache) return postOpenBaselineCache;
  let count = null, src = '';
  try {
    const log = child_process.execSync('git log --format=%H -40 -- nepse-chart/data/live.json', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split('\n').filter(Boolean);
    let skippedTip = false;
    for (const h of log) {
      const snap = JSON.parse(child_process.execSync(`git show ${h}:nepse-chart/data/live.json`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
      if (String(snap.session_date || '').slice(0, 10) !== today) continue;
      if (!skippedTip) { skippedTip = true; continue; } // newest = current working-tree snapshot
      // Pre-open snapshots carry the PREVIOUS session's full book — using one
      // as the "largest same-session" baseline false-fails the gate, so only
      // snapshots captured at/after MARKET_OPEN qualify as the baseline.
      const asofT = snap.asof ? new Date(snap.asof) : null;
      if (asofT && !isNaN(asofT) && td.timeNPT(asofT) < td.MARKET_OPEN) continue;
      const c = Object.keys(snap.quotes || {}).length;
      if (count === null || c > count) { count = c; src = 'same-session post-open snapshot ' + h.slice(0, 7); }
    }
  } catch (e) { /* shallow clone / no history — fall through to floor */ }
  postOpenBaselineCache = { count, src };
  return postOpenBaselineCache;
}

function main() {
  const argSession = (process.argv.find(a => a.startsWith('--session=')) || '').split('=')[1];
  const overrideCountGate = process.argv.includes('--override-count-gate');
  const overrideCountReason = (process.argv.find(a => a.startsWith('--override-count-reason=')) || '').split('=').slice(1).join('=');
  if (overrideCountGate && !overrideCountReason.trim()) {
    console.error('FATAL: --override-count-gate requires a non-empty --override-count-reason');
    process.exit(2);
  }
  if (overrideCountGate) {
    console.log(`OVERRIDE  security-count-stable — reason: ${overrideCountReason}`);
  }
  const now = new Date();
  const expected = argSession || td.expectedSessionDate(now);
  const failures = [];

  // live.json refreshes intraday (live quote snapshots stream in during market
  // hours), so once today's session has started its date IS today — unlike
  // universe.json and the manifest, which are written once per day after the
  // close. Gating live against the last *completed* session false-fails every
  // run during market hours, so this gate uses its own live-aware expectation
  // (wall-clock; --session still governs the universe/signals gates below).
  const expectedLive = (() => {
    const today = td.todayNPT(now);
    if (td.isTradingDay(today) && td.timeNPT(now) >= td.MARKET_OPEN) return today;
    return td.expectedSessionDate(now);
  })();

  // Gate 0: manifest exists and is fresh
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    gate('manifest-present', true, `data/manifest.json session=${manifest.session_date}`);
  } catch (e) {
    gate('manifest-present', false, 'data/manifest.json: ' + e.message);
  }

  // Gate 1: session date matches expected trading day
  let live = null, universe = null;
  try { live = readData('live.json'); } catch (e) { gate('live.json-parse', false, e.message); }
  try { universe = readData('universe.json'); } catch (e) { gate('universe.json-parse', false, e.message); }
  if (live) {
    const s = sessionOf(live);
    gate('live-session-current', s === expectedLive, `live=${s} expected=${expectedLive}`);
  }
  if (universe) {
    const s = sessionOf(universe);
    gate('universe-session-current', s === expected, `universe=${s} expected=${expected}`);
  }

  // Gate 2: quoted count stable vs PREVIOUS build (±5%).
  // Compared against the last good full-day deploy (newest data-* tag)'s
  // manifest live.json row count, NOT HEAD's manifest: the content pipeline's
  // midday manifest rebuild records a mid-session partial count (298 at noon
  // 2026-10-07 vs 359 at the close). live.json only carries securities with
  // quotes (traded), while universe.json lists every listed security incl.
  // untraded debentures / mutual funds / suspended equities. A ±5% band (not ±3%)
  // because suspensions and trading halts legitimately move the count.
  //
  // INTRADAY EXCEPTION: the content pipeline is scheduled for 06:00/18:00 NPT
  // (outside market hours), but GitHub schedule drift can push a run into
  // market hours. Mid-session snapshots legitimately GROW through the session
  // (observed: 63 quotes at 10:54 NPT → 313 by 12:15 NPT on 2026-10-05), so a
  // full-day baseline false-fails. When live.json carries today's still-open
  // session, baseline = the largest earlier same-session snapshot captured at
  // or after MARKET_OPEN already committed (live-quotes commits every ~5 min);
  // pre-open snapshots are excluded because they carry the previous session's
  // full book (seen 2026-10-06: 359 pre-open quotes → 69 at the open) and would
  // false-fail. The count must not collapse intraday. Requires full git
  // history (checkout fetch-depth: 0).
  if (live) {
    const q = Object.values(live.quotes || {}).length;
    const liveSession = sessionOf(live);
    const today = td.todayNPT(now);
    const intraday = liveSession === today && td.isTradingDay(today) && td.timeNPT(now) < td.MARKET_CLOSE;
    let baseline = null, baselineSrc = '';
    try {
      // Baseline = the last good full-day deploy (newest data-* tag), NOT
      // HEAD:data/manifest.json. The content pipeline's midday manifest
      // rebuild records the then-current (mid-session, partial) live.json row
      // count into HEAD's manifest — seen 2026-10-07: 298 rows at noon vs 359
      // at the close → false FAIL (drift 20.5%). The last good tag always
      // carries a full-day close book, which is what "previous build" means.
      let tag = '';
      try {
        tag = child_process.execSync("git tag --list 'data-*' --sort=-creatordate | head -n1", { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      } catch (e) { /* no data tags yet */ }
      const ref = tag || 'HEAD';
      const prev = child_process.execSync('git show ' + ref + ':data/manifest.json', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
      const pm = JSON.parse(prev.toString());
      baseline = pm.files && pm.files['nepse-chart/data/live.json'] && pm.files['nepse-chart/data/live.json'].rows;
      baselineSrc = tag ? ('last good tag ' + tag) : 'previous manifest (HEAD)';
    } catch (e) { /* first run: no baseline */ }
    if (overrideCountGate) {
      gate('security-count-stable', true, `OVERRIDDEN by operator — quotes=${q} baseline=${baseline || 'n/a'} reason="${overrideCountReason}"`);
    } else if (intraday) {
      const pb = largestPostOpenSnapshot(today);
      if (pb.count !== null && pb.count > 0) {
        gate('security-count-stable', q >= pb.count * 0.98,
          `intraday: quotes=${q} baseline=${pb.count} (${pb.src}) — no intraday collapse`);
      } else {
        gate('security-count-stable', q >= 50,
          `intraday: quotes=${q} (no earlier same-session POST-OPEN snapshot; early-session floor 50)`);
      }
    } else if (baseline && typeof baseline === 'number' && baseline > 0) {
      const drift = Math.abs(q - baseline) / baseline;
      gate('security-count-stable', drift <= 0.05, `quotes=${q} baseline=${baseline} (${baselineSrc}) drift=${(drift * 100).toFixed(1)}% band=±5%`);
    } else {
      gate('security-count-stable', q >= 300, `quotes=${q} (no baseline yet; absolute floor 300)`);
    }
    // no duplicate symbols inside the quotes themselves
    const seen = new Set(); const dups = [];
    for (const v of Object.values(live.quotes || {})) {
      if (seen.has(v.symbol)) dups.push(v.symbol); else seen.add(v.symbol);
    }
    gate('no-dup-quotes', dups.length === 0, dups.length ? 'dups: ' + dups.slice(0, 5).join(',') : `${seen.size} unique quoted symbols`);
  }

  // Gate 3: price sanity on every quote
  if (live) {
    const bad = [];
    for (const [sym, q] of Object.entries(live.quotes || {})) {
      if (q.ltp == null || !(q.ltp > 0)) bad.push(`${sym}:ltp=${q.ltp}`);
      else if (q.high != null && q.low != null && (q.high < q.low || q.low < 0)) bad.push(`${sym}:ohlc`);
      if (bad.length >= 10) break;
    }
    gate('price-sanity', bad.length === 0, bad.length ? bad.slice(0, 10).join('; ') : `${Object.keys(live.quotes).length} quotes ok`);
  }

  // Gate 3b (V2 reconciliation): index change reconciles with value delta —
  // for the main index and all 17 sub-indices. FAIL: a wrong index change is
  // never publishable. V4: dedup — live.indices[0] is also NEPSE, skip it.
  if (live) {
    const bad = [];
    const all = [];
    if (live.index) all.push(['NEPSE', live.index]);
    for (const ix of live.indices || []) {
      if (ix.name === 'NEPSE' && live.index) continue; // dedup main index
      all.push([ix.name || '?', ix]);
    }
    for (const [name, ix] of all) {
      if (ix.value == null || ix.previous_close == null || ix.change == null) continue;
      const expect = ix.value - ix.previous_close;
      // The official feed reports the main index change rounded to 1dp while
      // value/previous_close carry more precision (e.g. change=-18.8 vs
      // value-prev=-18.8135) — compare at the change field's own precision so
      // official rounding alone never fails the gate.
      //
      // TOLERANCE 0.05 (was 0.011): NEPSE's own API serves a change field that
      // systematically disagrees with currentValue − previousClose by
      // ~0.014–0.020 — observed 2026-10-08 on three intraday snapshots, where
      // change reconciles EXACTLY against previousClose=2572.33 while the
      // published previousClose field is 2572.3456 (the feed computes change
      // against a differently-rounded previous close). The 0.011
      // rounding-only tolerance false-failed every intraday snapshot and
      // nearly failed the 2026-10-07 close (0.010 vs 0.011). 0.05 keeps the
      // gate's purpose — a genuinely wrong change (stale tick, sign flip,
      // feed glitch) is off by whole points, never hundredths — while the
      // feed's own skew passes.
      const cStr = String(ix.change);
      const dp = cStr.includes('.') ? (cStr.split('.')[1] || '').length : 0;
      const expectRounded = Number(expect.toFixed(dp));
      if (Math.abs(expectRounded - ix.change) > 0.05) bad.push(`${name}: Δ=${ix.change} vs ${expect.toFixed(2)}`);
      if (bad.length >= 8) break;
    }
    gate('index-change-reconciles', bad.length === 0, bad.length ? bad.join('; ') : `${all.length} indices reconcile`, 'fail');
  }

  // Gate 3c (V2 reconciliation): per-quote change and percent_change reconcile
  // with ltp vs previous_close. FAIL: wrong per-symbol math is never publishable.
  if (live) {
    const bad = [];
    const quotes = Array.isArray(live.quotes) ? live.quotes : Object.values(live.quotes || {});
    for (const q of quotes) {
      if (q.ltp == null || q.previous_close == null || !(q.previous_close > 0)) continue;
      const dChange = Math.abs((q.ltp - q.previous_close) - (q.change || 0));
      const dPct = Math.abs(((q.ltp - q.previous_close) / q.previous_close * 100) - (q.percent_change || 0));
      if (dChange > 0.011 || dPct > 0.06) bad.push(`${q.symbol}: chgΔ=${dChange.toFixed(3)} pctΔ=${dPct.toFixed(3)}`);
      if (bad.length >= 10) break;
    }
    gate('quote-math-reconciles', bad.length === 0, bad.length ? bad.slice(0, 10).join('; ') : `${quotes.length} quotes reconcile`, 'fail');
  }

  // Gate 3d (V2 reconciliation): NEPSE circuit limits (±10%). FLAG, not FAIL —
  // corporate actions (bonus/rights price adjustments) legitimately break the
  // band. Flag for human review; never silently fix.
  if (live) {
    const bad = [];
    const quotes = Array.isArray(live.quotes) ? live.quotes : Object.values(live.quotes || {});
    for (const q of quotes) {
      if (q.ltp == null || q.previous_close == null || !(q.previous_close > 0)) continue;
      const move = Math.abs(q.ltp - q.previous_close) / q.previous_close;
      if (move > 0.1001) bad.push(`${q.symbol}: ${(move * 100).toFixed(1)}%`);
      if (bad.length >= 10) break;
    }
    gate('circuit-limits', bad.length === 0, bad.length ? bad.slice(0, 10).join('; ') + ' — review for corporate actions' : 'all within ±10%', 'flag');
  }

  // Gate 3e (V2 reconciliation): sudden jumps beyond 25% in a session. FLAG —
  // can be legitimate (relisting after book closure) but must be seen.
  if (live) {
    const bad = [];
    const quotes = Array.isArray(live.quotes) ? live.quotes : Object.values(live.quotes || {});
    for (const q of quotes) {
      const pc = Math.abs(q.percent_change || 0);
      if (pc > 25) bad.push(`${q.symbol}: ${q.percent_change}%`);
      if (bad.length >= 10) break;
    }
    gate('jump-threshold', bad.length === 0, bad.length ? bad.slice(0, 10).join('; ') : 'no jumps beyond 25%', 'flag');
  }

  // Gate 3f (V4 reconciliation): session totals are internally consistent.
  // Sum of per-quote turnover/volume/trades must be positive on a trading
  // session; the traded-security count must match the quotes array. FAIL:
  // zero totals mean the capture produced an empty or broken session.
  //
  // INTRADAY EXCEPTION: same class as security-count-stable — schedule drift
  // can push the content pipeline into market hours, when only a fraction of
  // the day's securities have traded. The absolute 300 floor false-fails
  // mid-session (seen 2026-10-07 run 37579495891: 288 traded at 11:49 NPT).
  // Intraday the count must not COLLAPSE vs the largest earlier same-session
  // post-open snapshot instead.
  if (live) {
    const quotes = Array.isArray(live.quotes) ? live.quotes : Object.values(live.quotes || {});
    let tTurn = 0, tVol = 0, tTrades = 0;
    for (const q of quotes) {
      tTurn += +q.turnover || 0; tVol += +q.volume || 0; tTrades += +q.trades || 0;
    }
    const problems = [];
    if (!(tTurn > 0)) problems.push('turnover sum = 0');
    if (!(tVol > 0)) problems.push('volume sum = 0');
    if (!(tTrades > 0)) problems.push('trades sum = 0');
    const liveSessionT = sessionOf(live);
    const todayT = td.todayNPT(now);
    const intradayT = liveSessionT === todayT && td.isTradingDay(todayT) && td.timeNPT(now) < td.MARKET_CLOSE;
    if (intradayT) {
      const pbT = largestPostOpenSnapshot(todayT);
      if (pbT.count !== null && pbT.count > 0) {
        if (quotes.length < pbT.count * 0.98) problems.push(`intraday collapse: ${quotes.length} vs post-open baseline ${pbT.count} (${pbT.src})`);
      } else if (quotes.length < 50) {
        problems.push(`intraday early-session: only ${quotes.length} securities traded (< 50)`);
      }
    } else if (quotes.length < 300) {
      problems.push(`only ${quotes.length} securities traded (< 300)`);
    }
    gate('session-totals-consistent', problems.length === 0,
      problems.length ? problems.join('; ') : `turnover=Rs ${(tTurn / 1e9).toFixed(2)}B vol=${(tVol / 1e6).toFixed(1)}M trades=${tTrades} n=${quotes.length}`, 'fail');
  }

  // Gate 3g (V4 reconciliation): universe membership is stable. FLAG, not FAIL —
  // listings/delistings/suspensions legitimately change the count, but a sharp
  // move needs a human look.
  if (live && universe && Array.isArray(universe.symbols)) {
    const quotes = Array.isArray(live.quotes) ? live.quotes : Object.values(live.quotes || {});
    const uCount = universe.symbols.length;
    const qCount = quotes.length;
    const ratio = uCount > 0 ? qCount / uCount : 0;
    gate('universe-membership-stable', ratio >= 0.80,
      `quoted=${qCount} universe=${uCount} (${(ratio * 100).toFixed(1)}%)`, 'flag');
  }

  // Gate 3h (V4 reconciliation): corporate-action adjustment completeness.
  // Symbols that jumped >25% (Gate 3e flags) are cross-checked against the
  // VERIFIED corporate-action archive. A jump with no verified action on record
  // is escalated — the adjustment may be missing. FLAG, never silently fix.
  if (live) {
    let ca = null;
    try { ca = JSON.parse(fs.readFileSync(path.join(DATA, 'corporate-actions.json'), 'utf8')); } catch (e) { /* optional file */ }
    const quotes = Array.isArray(live.quotes) ? live.quotes : Object.values(live.quotes || {});
    const jumpers = quotes.filter((q) => Math.abs(q.percent_change || 0) > 25).map((q) => q.symbol);
    const unexplained = [];
    if (ca && Array.isArray(ca.items)) {
      const caSyms = new Set(ca.items.map((i) => i.symbol || i.s));
      for (const s of jumpers) if (!caSyms.has(s)) unexplained.push(s);
    }
    gate('ca-adjustment-check', true,
      jumpers.length === 0 ? 'no jumps >25%' :
      unexplained.length ? `${jumpers.length} jumpers, NO verified action for: ${unexplained.slice(0, 8).join(',')} — verify adjustment` :
      `${jumpers.length} jumpers all have verified corporate actions`, 'flag');
  }

  // Gate 3i (V4): close-source provenance. Per owner directive 2026-10-04 the
  // close must come from the official NEPSE API. If capture fell back to
  // ShareHub, FLAG for verification against NEPSE — never silently accept a
  // mirrored close.
  if (live) {
    const src = live.close_source || 'unknown (pre-V4 capture)';
    const isOfficial = /official/i.test(src);
    gate('close-source-official', isOfficial,
      `close_source=${src}` + (isOfficial ? '' : ' — verify against NEPSE official'), 'flag');
  }

  // Gate 4: no duplicate symbols in universe
  if (universe && Array.isArray(universe.symbols)) {
    const seen = new Set(); const dups = [];
    for (const s of universe.symbols) {
      const k = s.s || s.symbol;
      if (seen.has(k)) dups.push(k); else seen.add(k);
    }
    gate('no-dup-symbols', dups.length === 0, dups.length ? 'dups: ' + dups.slice(0, 5).join(',') : `${seen.size} unique`);
  }

  // Gate 5: signals recomputed for this session
  for (const f of ['signals/momentum.json', 'signals/trend-relay.json', 'signals/reversal.json']) {
    try {
      const sig = readData(f);
      const gen = String(sig.generated_at || sig.asof || '').slice(0, 10);
      gate(`${f}-fresh`, gen >= expected, `generated=${gen || 'missing'} expected>=${expected}`);
    } catch (e) {
      gate(`${f}-fresh`, false, e.message);
    }
  }

  // Gate 6: every manifest-tracked file still parses
  if (manifest) {
    const bad = [];
    for (const rel of Object.keys(manifest.files || {})) {
      try { readRepo(rel); } catch (e) { bad.push(rel); if (bad.length >= 10) break; }
    }
    gate('all-files-parse', bad.length === 0, bad.length ? bad.join(', ') : `${Object.keys(manifest.files).length} files ok`);
  }

  // Gate 7 (S3): SHA-256 integrity — every manifest-tracked file carrying a
  // recorded sha256 must match it. Catches tampered, truncated, or
  // half-written files BEFORE deploy.
  if (manifest) {
    const bad = [];
    let checked = 0;
    for (const [rel, meta] of Object.entries(manifest.files || {})) {
      if (!meta || !meta.sha256) continue;
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) { bad.push(`${rel}: MISSING`); continue; }
      const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      checked++;
      if (hash !== meta.sha256) bad.push(`${rel}: HASH MISMATCH`);
      if (bad.length >= 10) break;
    }
    gate('sha256-integrity', bad.length === 0, bad.length ? bad.slice(0, 10).join('; ') : `${checked} files verified`);
  }

  const failed = results.filter(r => !r.pass && r.severity !== 'flag');
  const flagged = results.filter(r => !r.pass && r.severity === 'flag');
  const report = {
    ran_at_npt: td.todayNPT(now) + 'T' + td.timeNPT(now) + ':00+05:45',
    expected_session: expected,
    passed: failed.length === 0,
    gates: results,
  };
  if (flagged.length) report.flagged = flagged.map(f => f.gate);
  fs.writeFileSync(path.join(DATA, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${results.length - failed.length - flagged.length}/${results.length} gates passed, ${flagged.length} flagged — validation.json written`);
  if (flagged.length) {
    console.log('FLAGGED for review (deploy continues): ' + flagged.map(f => f.gate).join(', '));
  }
  if (failed.length) {
    console.error('VALIDATION FAILED — deploy blocked.');
    process.exit(1);
  }
}

if (require.main === module) main();

/* Screener performance figures (ROUND 2 / R1, 2026-10-29).
 *
 * Replaces the frozen hand-written "31.0% / 11.4%" regime copy on the
 * screener page with figures COMPUTED FROM THE ARCHIVE BY THE SAME CODE
 * THAT BUILDS THE PAGE, so they cannot go stale again.
 *
 * Source data (all already written by tools/build-nepse-universe.js):
 *   - nepse-chart/data/verdicts.json : per-symbol eval-window replay
 *     { n: decided calls, w: hit rate } in each entry's `tr` field.
 *   - nepse-chart/data/universe.json : per-symbol instrument type `t`.
 *   - data/index-history.json        : market session calendar + closes,
 *     for the eval-window dates and the index return over the window.
 *
 * Equity-only filter (sector+type UNION — either signal excludes):
 *   - universe type must be exactly 'Equity', AND
 *   - verdict sector must NOT be Debentures / Mutual Funds / Promoter
 *     Shares. The builder's per-symbol replay gates on the type field
 *     alone, and that field has mistagged non-equity instruments as
 *     Equity in the past, so the union is what makes the aggregate
 *     honestly equity-only. Symbols missing from the universe file are
 *     excluded (fail closed).
 *
 * Expectancy: a decided call pays +4 ATR on a win and -2 ATR on a loss
 * (the replay frame), so expectancy = hitRate*4 - (1-hitRate)*2 ATR/call.
 * Breakeven is 33.3%. Wins are estimated as sum(n*w) because verdicts.json
 * rounds each per-symbol rate to 3 decimals (max error ~0.05pp on the
 * aggregate); the JSON records wins_est, not an exact win count.
 *
 * Older-window (tune) figure: DELIBERATELY NOT PUBLISHED. The builder
 * strips per-symbol tune results before writing verdicts.json (only
 * unfiltered per-setup aggregates survive in track-record.json, and their
 * setup-call totals do not even reconcile to the tune call total), so no
 * equity-only older-window figure can be recomputed from the shipped
 * archive. Publishing one would repeat the frozen-copy failure. When a
 * future builder retains per-symbol tune results, extend this module
 * with a `tune` block and re-add the sentence — never hand-write it.
 *
 * Page wiring: updateScreenerPage() replaces the text between
 *   <!-- sc-perf:start --> ... <!-- sc-perf:end -->         (methodology note)
 *   <!-- sc-perf-faq:start --> ... <!-- sc-perf-faq:end --> (visible FAQ answer)
 * and rewrites the Hit-rate answer inside the FAQ JSON-LD block. It
 * THROWS when any target is missing — the universe builder catches that
 * and logs loudly (never fail the data build over copy), while the CI
 * check (tools/round2-verify-r1.py) fails the build on stale copy.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const NON_EQ_SECTORS = new Set(['Debentures', 'Mutual Funds', 'Promoter Shares']);
const TR_LOOKBACK = 250, TR_FORWARD = 20;

function fmtD(ymd) {
  const s = String(ymd);
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}
function pct1(x) { return Math.round(x * 1000) / 10; } // fraction -> % with 1 decimal
function r2(x) { return Math.round(x * 100) / 100; }

function computeScreenerPerformance({ verdicts, universe, indexRows }) {
  const typeOf = {};
  (universe.symbols || []).forEach((r) => { typeOf[r.s] = r.t; });
  let securities = 0, decided = 0, winsEst = 0;
  const excluded = { nonEquity: 0, noTr: 0 };
  Object.keys(verdicts).forEach((sym) => {
    const e = verdicts[sym];
    if (!e || !e.tr) { excluded.noTr++; return; }
    const isEqType = typeOf[sym] === 'Equity';
    const isEqSec = !NON_EQ_SECTORS.has(e.sec);
    if (!isEqType || !isEqSec) { excluded.nonEquity++; return; }
    securities++;
    decided += e.tr.n;
    winsEst += e.tr.n * e.tr.w;
  });
  if (!securities || !decided) throw new Error('screener-performance: no equity-only decided calls found');
  const hitRate = winsEst / decided;
  const expectancy = hitRate * 4 - (1 - hitRate) * 2;
  // Eval-window dates on the market calendar, anchored at the batch date.
  const rows = indexRows;
  let anchor = rows.length - 1;
  const asof = universe.asof;
  if (asof) {
    const flat = String(asof).replace(/-/g, '');
    const found = rows.findIndex((r) => String(r[0]) === flat);
    if (found >= 0) anchor = found;
  }
  if (anchor < TR_LOOKBACK + 1) throw new Error('screener-performance: index history too short for a 250-session window');
  const firstSig = rows[anchor - (TR_LOOKBACK - 1)]; // anchor-249
  const lastSig = rows[anchor - TR_FORWARD];         // anchor-20
  const prevClose = rows[anchor - TR_LOOKBACK][4];   // close before first signal session
  const lastClose = lastSig[4];
  const indexReturn = lastClose / prevClose - 1;
  return {
    asof: asof || null,
    method: 'Buy/Strong Buy replayed per signal session; win = +4xATR target before -2xATR stop within 20 sessions (daily high/low); undecided excluded; equity-only by sector+type union; wins estimated from per-symbol rates rounded to 3 decimals in verdicts.json.',
    filter: "universe type == 'Equity' AND verdict sector NOT IN {Debentures, Mutual Funds, Promoter Shares}",
    eval: {
      window: 'most recent 250 sessions, minus the last 20 (forward window still open)',
      window_start: fmtD(firstSig[0]),
      window_end: fmtD(lastSig[0]),
      index_return_pct: pct1(indexReturn),
      index_window_start_close_date: fmtD(rows[anchor - TR_LOOKBACK][0]),
      index_window_end_close_date: fmtD(lastSig[0]),
      securities: securities,
      decided_calls: decided,
      wins_est: r2(winsEst),
      hit_rate_pct: pct1(hitRate),
      expectancy_atr: r2(expectancy),
      breakeven_pct: 33.3,
    },
    excluded: excluded,
    dropped: {
      older_window_hit_rate: 'Not published: the builder does not retain per-symbol older-window (tune) results in the shipped archive, so no equity-only older-window figure can be recomputed from it.',
      frozen_regime_copy: 'Replaced: the previous 31.0%/11.4% regime sentences were hand-written static copy of windows that have rolled away; no 250-session window in the last 500 reproduces them.',
    },
  };
}

// The ONE canonical sentence, shared byte-for-byte by the methodology note,
// the visible FAQ answer and the JSON-LD FAQ answer (ASCII hyphens only,
// so the CI check can match it in all three spots).
function formatPerfSentence(perf) {
  const e = perf.eval;
  const wins = Math.round(e.wins_est);
  return 'Track record, recomputed from the page\'s own archive on every build '
    + '(eval window: signal sessions ' + e.window_start + ' to ' + e.window_end
    + '; batch as of ' + perf.asof + '): equity-only Buy and Strong Buy calls hit '
    + e.hit_rate_pct.toFixed(1) + '% - about ' + wins.toLocaleString('en-US')
    + ' of ' + e.decided_calls.toLocaleString('en-US') + ' decided calls across '
    + e.securities + ' securities - for an expectancy of ' + e.expectancy_atr.toFixed(2)
    + ' ATR per call (a win pays +4 ATR, a loss -2 ATR, so breakeven is 33.3%). '
    + 'The NEPSE index returned ' + (e.index_return_pct >= 0 ? '+' : '')
    + e.index_return_pct.toFixed(1) + '% over the same window ('
    + e.index_window_start_close_date + ' close to ' + e.index_window_end_close_date + ' close).';
}

function replaceBetween(html, start, end, replacement) {
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error('screener-performance: markers missing: ' + start);
  return html.slice(0, a + start.length) + replacement + html.slice(b);
}

function updateScreenerPage(html, perf) {
  const sentence = formatPerfSentence(perf);
  let out = replaceBetween(html, '<!-- sc-perf:start -->', '<!-- sc-perf:end -->', sentence);
  out = replaceBetween(out, '<!-- sc-perf-faq:start -->', '<!-- sc-perf-faq:end -->', ' ' + sentence);
  // JSON-LD Hit-rate answer: replace the whole answer text with the
  // definition base + the canonical sentence. The definition base is the
  // text up to "shows as a dash." — everything after it is the stale copy.
  const re = /("What is the Hit rate column\?","acceptedAnswer":\{"@type":"Answer","text":")([^"]*?shows as a dash\.)[^"]*(")/;
  if (!re.test(out)) throw new Error('screener-performance: JSON-LD Hit-rate answer not found');
  out = out.replace(re, '$1$2 ' + sentence.replace(/\\/g, '\\\\').replace(/\$/g, '$$$$') + '$3');
  return out;
}

module.exports = { computeScreenerPerformance, formatPerfSentence, updateScreenerPage, NON_EQ_SECTORS };

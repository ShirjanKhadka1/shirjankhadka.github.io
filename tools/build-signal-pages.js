#!/usr/bin/env node
/* Builds the three signal pages (momentum / trend-relay / reversal) in the
 * current sig-pro design. THIS BUILDER IS THE SOLE SOURCE OF TRUTH FOR THESE
 * PAGES — including the "Live forward record" sections. Never hand-edit the generated pages under nepse-signals; edit this template and run:
 *     node tools/build-signal-pages.js
 * The forward record's NUMBERS render client-side from live_track_record in
 * each signal JSON (rewritten daily by tools/track-live-signals.py), so they
 * stay fresh with no page rebuild. The builder emits the section shell, the
 * honest empty-state copy, and the renderer.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const DATA = path.join(REPO, 'nepse-chart', 'data', 'signals');
const OUT = path.join(REPO, 'nepse-signals');
const SLUGS = ['momentum', 'trend-relay', 'reversal'];

function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(+n)) return '–';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function pct(n) { const v = fmt(n); return v === '–' ? v : v + '%'; }
function money(n) {
  if (n === null || n === undefined || !Number.isFinite(+n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e7) return 'Rs ' + (n / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return 'Rs ' + (n / 1e5).toFixed(2) + ' L';
  return 'Rs ' + Math.round(n).toLocaleString('en-US');
}
function card(l, v, cls) {
  return '<div class="sig-card ' + cls + '"><div class="sig-card-l">' + l + '</div><div class="sig-card-v">' + v + '</div></div>';
}
/* Server-side twin of the client cardBar below (live pages carry proportion
 * bars on the Win-rate and Deepest-fall cards; kept in sync 2026-10-26). */
function cardBar(l, v, cls, pctVal, col) {
  return '<div class="sig-card ' + cls + '"><div class="sig-card-l">' + l + '</div><div class="sig-card-v">' + v + '</div><div class="cx-prop" style="margin-top:9px"><div class="cx-prop-track"><span class="cx-prop-fill" style="--w:' + pctVal + '%' + (col ? ';background:' + col : '') + '"></span></div></div></div>';
}

// backtest_years is not emitted by build-signals.js; derive it from the window dates.
// (2026-10-09: pages + meta descriptions rendered "undefined years" otherwise.)
function backtestYears(st) {
  if (st.backtest_years) return st.backtest_years;
  const a = new Date(st.backtest_from).getTime(), b = new Date(st.backtest_to).getTime();
  if (!isFinite(a) || !isFinite(b) || b <= a) return '–';
  return fmt((b - a) / (365.25 * 86400000), 1);
}
/* ASCII digits -> Devanagari digits for the Nepali note (period kept ASCII,
 * matching the existing "110.82%" style in that note). */
function devanagariDigits(s) {
  return String(s).replace(/[0-9]/g, d => '०१२३४५६७८९'[+d]);
}
function backtestNote(sys, st) {
  const yrs = backtestYears(st), an = fmt(st.annual_return_pct), win = fmt(st.win_rate_pct),
        dd = fmt(st.max_drawdown_pct), bench = fmt(st.benchmark_cagr_pct), tr = st.total_trades;
  if (sys === 'momentum') {
    const rel = (st.annual_return_pct >= st.benchmark_cagr_pct) ? 'above' : 'below';
    return "<strong>What the backtest says.</strong> Over " + yrs + " years this rule set compounded at " + an + "% a year \u2014 " + rel + " NEPSE buy &amp; hold (" + bench + "%) over the same window, with a worst fall of " + dd + "%. It wins only " + win + "% of trades; it survives on letting winners run to multiples of risk.";
  }
  if (sys === 'trend-relay') return "<strong>What the backtest says.</strong> This patient re-entry system compounded at " + an + "% a year with a worst fall of " + dd + "%. It trades rarely (" + tr + " trades in " + yrs + " years) and wins " + win + "% of them \u2014 a system for waiting, not for action.";
  if (sys === 'reversal') {
    if (st.annual_return_pct < 0) return "<strong>Read this first.</strong> Over " + yrs + " years this system <em>lost</em> money (" + an + "% a year, worst fall " + dd + "%). That is itself the finding: on NEPSE, buying oversold dips against the trend has been a losing approach \u2014 sharp knives keep falling. It is published for education, so you can see exactly why, not as something to trade.";
    return "<strong>Read this first.</strong> Over " + yrs + " years this system made " + an + "% a year (worst fall " + dd + "%). It is published for education \u2014 the finding stands or falls on the data, not as something to trade.";
  }
  return '';
}
function nepaliNote(sys, st) {
  const an = st.annual_return_pct, win = fmt(st.win_rate_pct), tr = st.total_trades;
  const yrsN = devanagariDigits(backtestYears(st));
  if (sys === 'momentum') return "<strong>\u0938\u0902\u0915\u094d\u0937\u0947\u092a\u0964</strong> \u092f\u094b \u092a\u094d\u0930\u0923\u093e\u0932\u0940 \u092c\u0922\u094d\u0926\u094b \u092e\u0942\u0932\u094d\u092f \u092d\u090f\u0915\u093e \u0938\u094d\u091f\u0915 \u0938\u092e\u093e\u0924\u094d\u0928\u0947 \u0928\u093f\u092f\u092e \u0939\u094b \u2014 \u096b\u0966 \u0926\u093f\u0928\u0915\u0948 \u0909\u091a\u094d\u091a\u0924\u092e \u092e\u0942\u0932\u094d\u092f \u0924\u094b\u0921\u0947\u092a\u091b\u093f \u0915\u093f\u0928\u094d\u0928\u0947, \u0938\u094d\u091f\u092a\u2013\u0932\u0938\u0938\u0939\u093f\u0924 \u092c\u093e\u0939\u093f\u0930\u093f\u0928\u0947\u0964 " + yrsN + " \u0935\u0930\u094d\u0937\u0915\u094b \u092a\u0930\u0940\u0915\u094d\u0937\u0923\u092e\u093e \u0935\u093e\u0930\u094d\u0937\u093f\u0915 " + an + '%' + " \u092a\u094d\u0930\u0924\u093f\u092b\u0932; \u091c\u093f\u0924\u094d\u0928\u0947 \u091f\u094d\u0930\u0947\u0921 " + win + '%' + " \u092e\u093e\u0924\u094d\u0930, \u0928\u093e\u092b\u093e \u0920\u0942\u0932\u093e \u0935\u093f\u091c\u0947\u0924\u093e\u092c\u093e\u091f\u0964 \u092f\u094b \u0936\u0948\u0915\u094d\u0937\u093f\u0915 \u091c\u093e\u0928\u0915\u093e\u0930\u0940 \u0939\u094b, \u0932\u0917\u093e\u0928\u0940 \u0938\u0932\u094d\u0932\u093e\u0939 \u0939\u094b\u0907\u0928\u0964";
  if (sys === 'trend-relay') return "<strong>\u0938\u0902\u0915\u094d\u0937\u0947\u092a\u0964</strong> \u092f\u094b \u092a\u094d\u0930\u0923\u093e\u0932\u0940 \u0927\u0948\u0930\u094d\u092f\u092a\u0942\u0930\u094d\u0935\u0915 \u092a\u094d\u0930\u0935\u0943\u0924\u094d\u0924\u093f \u092a\u091b\u094d\u092f\u093e\u0909\u0928\u0947 \u0928\u093f\u092f\u092e \u0939\u094b \u2014 \u0925\u094b\u0930\u0948 \u091f\u094d\u0930\u0947\u0921, \u0932\u093e\u092e\u094b \u0939\u094b\u0932\u094d\u0921\u093f\u0919\u0964 " + yrsN + " \u0935\u0930\u094d\u0937\u092e\u093e " + tr + " \u091f\u094d\u0930\u0947\u0921 \u092e\u093e\u0924\u094d\u0930, \u0935\u093e\u0930\u094d\u0937\u093f\u0915 " + an + '%' + " \u092a\u094d\u0930\u0924\u093f\u092b\u0932\u0964 \u092f\u094b \u0936\u0948\u0915\u094d\u0937\u093f\u0915 \u091c\u093e\u0928\u0915\u093e\u0930\u0940 \u0939\u094b, \u0932\u0917\u093e\u0928\u0940 \u0938\u0932\u094d\u0932\u093e\u0939 \u0939\u094b\u0907\u0928\u0964";
  if (sys === 'reversal') return "<strong>\u0938\u0902\u0915\u094d\u0937\u0947\u092a\u0964</strong> \u092f\u094b \u092a\u094d\u0930\u0923\u093e\u0932\u0940 \u0918\u091f\u0947\u0915\u093e \u0938\u094d\u091f\u0915 \"\u092b\u0930\u094d\u0915\u0928\u094d\u091b\u0928\u094d\" \u092d\u0928\u094d\u0928\u0947 \u0905\u0928\u0941\u092e\u093e\u0928\u092e\u093e \u0915\u093f\u0928\u094d\u0928\u0947 \u0928\u093f\u092f\u092e \u0939\u094b \u2014 \u0924\u0930 " + yrsN + " \u0935\u0930\u094d\u0937\u0915\u094b \u092a\u0930\u0940\u0915\u094d\u0937\u0923\u092e\u093e \u092f\u0938\u0932\u0947 \u092a\u0948\u0938\u093e \u0917\u0941\u092e\u093e\u092f\u094b (\u0935\u093e\u0930\u094d\u0937\u093f\u0915 " + an + '%' + ")\u0964 \u0928\u0947\u092a\u094d\u0938\u0947\u092e\u093e \u092f\u094b \u0936\u0948\u0932\u0940\u0932\u0947 \u0915\u093e\u092e \u0917\u0930\u0947\u0928 \u092d\u0928\u094d\u0928\u0947 \u0907\u092e\u093e\u0928\u0926\u093e\u0930 \u0928\u093f\u0937\u094d\u0915\u0930\u094d\u0937\u0915\u093e \u0932\u093e\u0917\u093f \u092a\u094d\u0930\u0915\u093e\u0936\u093f\u0924 \u0917\u0930\u093f\u090f\u0915\u094b \u0939\u094b\u0964";
  return '';
}

function page(sys, data) {
  const st = data.stats;
  const title = data.title;
  const tagline = data.tagline;
  const pageUrl = 'https://shirjankhadka.com.np/nepse-signals/' + sys + '/';
  const metaDesc = title + ': transparent rule-based NEPSE trading system. Backtested over ' + backtestYears(st) + ' years — ' + fmt(st.annual_return_pct) + '% annual return, ' + fmt(st.win_rate_pct) + '% win rate. Educational only.';
  const genDate = new Date().toISOString().slice(0, 10);
  const tabs = SLUGS.map(s => {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, s + '.json'), 'utf8'));
    const nm = d.title.replace(/ Signal$/, '');
    const active = s === sys ? ' aria-current="page" class="active"' : '';
    return '<a href="/nepse-signals/' + s + '/"' + active + '>' + nm + '</a>';
  }).join('') + '<a href="/nepse-signals/methodology/">Methodology</a>';

  const cards =
    card('Annual return', pct(st.annual_return_pct), st.annual_return_pct >= 0 ? 'up' : 'down') +
    card('Rs 1 Cr became', money(st.final_value), '') +
    cardBar('Win rate', pct(st.win_rate_pct), '', fmt(st.win_rate_pct), '') +
    cardBar('Deepest fall', pct(st.max_drawdown_pct), 'down', fmt(st.max_drawdown_pct), 'var(--nd-down,#F87171)') +
    card('Profit factor', fmt(st.profit_factor), '') +
    card('Avg holding', fmt(st.avg_holding_days, 0) + ' days', '') +
    card('Charges paid', money(st.charges_paid), '') +
    card('Alpha vs NEPSE', pct(st.alpha_pct), st.alpha_pct >= 0 ? 'up' : 'down');

  const backtestNoteHtml = backtestNote(sys, st);
  /* Reversal-only top banner (his call 2026-10-26): a losing system as
   * specified, stated up front in the existing note treatment — copy only,
   * no new styling, so the page's visual design is untouched. */
  const bannerHtml = (sys === 'reversal')
    ? '<div class="note"><strong>Losing system as specified — educational only.</strong> This system\'s backtest profit factor is ' + fmt(st.profit_factor) + ' — below 1.0, so it gave back more than it took. It is published for education, not as something to trade.</div>'
    : '';
  const nepaliNoteHtml = nepaliNote(sys, st);
  const howtoNoteHtml = '<strong>How to read this.</strong> Every number below comes from a mechanical replay of these exact rules on historical NEPSE data (' + st.backtest_from + ' to ' + st.backtest_to + ', ' + data.universe_symbols + ' symbols, Rs 1 Cr portfolio, max 10 positions, ' + data.costs + '). Nothing is hand-picked. The <strong>Live forward record</strong> above tracks the same rules against real sessions since forward tracking began — that is the number to watch. Past performance does not predict future results.';

  const bt = st.best_trade, wt = st.worst_trade;
  const profileRows =
    '<tr><td>Total return</td><td><strong>' + pct(st.total_return_pct) + '</strong></td><td>Capital multiple</td><td><strong>&times;' + fmt(st.capital_multiple) + '</strong></td></tr>\n' +
    '<tr><td>Benchmark (NEPSE buy &amp; hold)</td><td>' + pct(st.benchmark_cagr_pct) + ' / yr</td><td>Alpha</td><td>' + pct(st.alpha_pct) + ' / yr</td></tr>\n' +
    '<tr><td>Total trades</td><td>' + st.total_trades + '</td><td>Win rate</td><td>' + pct(st.win_rate_pct) + '</td></tr>\n' +
    '<tr><td>Profit factor</td><td>' + fmt(st.profit_factor) + '</td><td>Avg win / avg loss</td><td>' + pct(st.avg_win_pct) + ' / ' + pct(st.avg_loss_pct) + '</td></tr>\n' +
    '<tr><td>Sharpe (monthly)</td><td>' + fmt(st.sharpe) + '</td><td>Sortino</td><td>' + fmt(st.sortino) + '</td></tr>\n' +
    '<tr><td>Max drawdown</td><td>' + pct(st.max_drawdown_pct) + '</td><td>Avg holding</td><td>' + fmt(st.avg_holding_days, 0) + ' days</td></tr>\n' +
    '<tr><td>Best trade</td><td>' + (bt ? bt.symbol + ' ' + fmt(bt.pnl_pct) + '%' : '–') + '</td><td>Worst trade</td><td>' + (wt ? wt.symbol + ' ' + fmt(wt.pnl_pct) + '%' : '–') + '</td></tr>\n' +
    '<tr><td>Charges paid</td><td>' + money(st.charges_paid) + '</td><td>Backtest window</td><td>' + st.backtest_from + ' &rarr; ' + st.backtest_to + '</td></tr>\n';

  const rulesHtml = data.rules.map(r => '<li>' + r + '</li>').join('');
  const aboutHtml = title + ' is one of Nepse Decode\'s transparent signal systems. Every rule above is public — there is no hidden model and no "AI prediction". Signals are generated mechanically from daily OHLCV data (corporate-action adjusted); a stock appears here only if it passes every filter, including a Rs 10 lakh average-turnover liquidity bar. This page is educational and is not investment advice.';

  /* honesty: the on-page ledger is capped at the newest 500 rows, so say so */
  const tc = data.trade_counts || {};
  const covNote = (tc.closed_total && tc.closed_in_ledger)
    ? (tc.closed_total > tc.closed_in_ledger
        ? 'ledger holds the newest ' + tc.closed_in_ledger + ' of ' + tc.closed_total + ' finished trades'
        : 'all ' + tc.closed_total + ' finished trades shown')
    : 'finished trades shown';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script>try{var t=localStorage.getItem('sk-theme');if(!t)t='dark';document.documentElement.setAttribute('data-theme',t);if(t==='light')document.documentElement.setAttribute('data-nd-ed','light')}catch(e){}</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0A0C10">
<title>${title} — Nepse Decode Signals</title>
<meta name="description" content="${metaDesc}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nepse Decode">
<meta property="og:title" content="${title} — Nepse Decode Signals">
<meta property="og:description" content="${metaDesc}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="https://shirjankhadka.com.np/assets/images/nepse-decode-og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title} — Nepse Decode Signals">
<meta name="twitter:description" content="${metaDesc}">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebPage","name":"${title} — Nepse Decode Signals","url":"${pageUrl}","description":"${metaDesc}","isPartOf":{"@type":"WebSite","name":"Nepse Decode","url":"https://shirjankhadka.com.np/"},"author":{"@type":"Person","name":"Shirjan Khadka","url":"https://shirjankhadka.com.np/"}}
</script>
<link rel="stylesheet" href="/css/nd-tokens.css?v=e100cabd">
<link rel="stylesheet" href="/css/fonts.css?v=422e31c3">
<link rel="stylesheet" href="/css/nd-chrome.css?v=e2586480">
<link rel="stylesheet" href="/css/nd-cinema.css?v=1aebb748">
<link rel="stylesheet" href="/css/sig-pro.css?v=805f97ca">
</head>
<body class="nd">
<a class="skip-link" href="#main">Skip to content</a>
<div id="nd-header"></div>
<main id="main" class="sig-wrap">
<nav class="sig-tabs" aria-label="Signal systems">${tabs}</nav>
${bannerHtml ? bannerHtml + '\n' : ''}
<section class="sig-hero">
<p class="sig-kicker">Nepse Decode &middot; Chart &amp; signals &middot; rule-based, no black boxes</p>
<h1>${title}</h1>
<p class="sig-lede">${tagline}</p>

<div class="sig-fresh" id="sig-fresh" hidden><span class="dot"></span><span id="sig-fresh-text">Loading…</span></div>
</section>
<p class="sig-sub">The headline numbers below are the <strong>backtest</strong> — a historical simulation (${st.backtest_from} &rarr; ${st.backtest_to}), not live results. What these same rules have produced on real sessions is in the <strong>Live forward record</strong> directly underneath.</p>
<div class="sig-grid">${cards}</div>

<section id="sector-block" hidden>
<h2>Stocks by sector</h2>
<p class="sig-sub">The stocks this system currently holds or tracks, grouped by sector. Pick a sector to filter every table on this page — open positions, closed trades, replay positions, and backtest history. Pick All sectors to reset.</p>
<div class="sig-sectors" id="sector-cards"></div>
<p class="sig-sub" id="sector-note"></p>
</section>

<section id="track-record" hidden>
<h2>Live forward record — what the signals have actually produced</h2>
<p class="sig-sub" id="track-sub">Every live Entry alert becomes a Rs 10 lakh paper trade at the signal close, scored against real forward OHLC. Loading…</p>
<div class="sig-grid" id="track-grid"></div>
<h3>Open paper positions</h3>
<div class="scrollx"><table class="sig-table" id="track-open"><thead><tr>
<th>Date</th><th>Symbol</th><th class="num">Entry</th><th class="num">Stop loss</th><th class="num">Trail stop</th><th class="num">Target 1</th><th class="num">Target 2</th><th class="num">Current</th><th class="num">Unrealized</th><th>Progress to T2</th><th class="num">Sessions</th>
</tr></thead><tbody><tr><td colspan="11">Loading…</td></tr></tbody></table></div>
<h3>Closed paper trades — newest first</h3>
<div class="scrollx"><table class="sig-table" id="track-closed"><thead><tr>
<th>Symbol</th><th class="num">Entry date</th><th class="num">Exit date</th><th class="num">Entry</th><th class="num">Exit</th><th>Exit reason</th><th class="num">P&amp;L %</th><th class="num">P&amp;L Rs</th><th class="num">Sessions</th>
</tr></thead><tbody><tr><td colspan="9">Loading…</td></tr></tbody></table></div>
<h3>Closed-trade P&amp;L distribution</h3>
<div class="sig-dist" id="track-dist"></div>
</section>
<noscript><div class="sig-noscript" style="overflow-x:auto"><!-- baker:forward-record:start --><!-- baker:forward-record:end --></div></noscript>
<div class="note">${backtestNoteHtml}</div>

<div class="note" lang="ne">${nepaliNoteHtml}</div>

<div class="note">${howtoNoteHtml}</div>

<h2>Trade profile — backtest (historical simulation)</h2>
<p class="sig-sub">Hypothetical replay of these exact rules on historical data — not trades anyone took. Real outcomes are in the Live forward record above.</p>
<div class="scrollx"><table class="sig-table">
<tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr>
${profileRows}</table></div>

<h2>Equity curve — Rs 1 Cr through this system</h2>
<canvas id="eqchart"></canvas>
<p class="sig-sub">Weekly marked-to-market equity curve — Rs 1 Cr start, cash + open positions − exit costs. Drawn from the published backtest series, not a forecast.</p>

<h2>The rules (exactly as coded)</h2>
<div class="rules"><ol>${rulesHtml}</ol></div>

<h2>Backtest — positions still open when the replay ended (hypothetical)</h2>
<p class="sig-sub">Positions the historical replay still held when it ended on ${st.backtest_to} — hypothetical, and <strong>not</strong> the system's live positions (live positions are the Open paper positions in the Live forward record above). A replay position exits only on its stop loss or a trail break, while the live forward record also exits at Target 1 or after 20 sessions — so the same signal can be closed in the live record yet still open here. Entry is taken at the signal day's close in the replay; "Current" shows the latest traded price for scale only. Progress shows how far price has moved toward Target 2.</p>
<div class="scrollx"><table class="sig-table" id="alerts"><thead><tr>
<th>Date</th><th>Symbol</th><th>Alert</th><th>Entry</th><th>Stop loss</th><th>Trail stop</th><th>Target 1</th><th>Target 2</th><th>Current</th><th>Unrealized</th><th>Progress</th>
</tr></thead><tbody><tr><td colspan="11">Loading…</td></tr></tbody></table></div>

<h2>Closed history — backtest trades</h2>
<p class="sig-sub">Finished trades from the mechanical backtest replay, newest first — hypothetical, not live trades (${covNote}). The Live forward record above shows what the signals have produced since tracking began. P&amp;L is after the same trading charges the backtest applies.</p>
<div class="scrollx"><table class="sig-table" id="closed"><thead><tr>
<th>Symbol</th><th class="num">Entry date</th><th class="num">Exit date</th><th class="num">Entry price</th><th class="num">Exit price</th><th>Exit reason</th><th class="num">P&amp;L %</th><th class="num">P&amp;L Rs</th><th class="num">Hold days</th>
</tr></thead><tbody id="closed-body"><tr><td colspan="9">Loading trade history…</td></tr></tbody></table></div>
<div class="sig-pager">
      <label>Rows per page
        <select id="closed-size">
          <option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option>
        </select></label>
      <span id="closed-info" aria-live="polite"></span>
      <span style="display:flex;gap:8px;margin-left:auto">
        <button id="closed-prev">← Prev</button>
        <button id="closed-next" class="sig-next">Next →</button>
      </span></div>

<h2>About this system</h2>
<div class="rules"><p>${aboutHtml}</p></div>


<h2>Words on this page, in plain language</h2>
<div class="rules"><dl class="gloss">
<dt>ATR (Average True Range)</dt><dd>How much a stock's price typically swings in a day. A "2 × ATR stop" means: if the price falls twice that typical daily swing below your entry, you exit. It sizes risk to how jumpy the stock is.</dd>
<dt>RSI(14)</dt><dd>A 0–100 gauge of how fast the price has been rising versus falling over the last 14 days. 55–80 means strong upward momentum that is not yet extreme.</dd>
<dt>SMA (simple moving average)</dt><dd>The average closing price over the last N days. Price above its 50-day average means the medium-term trend points up.</dd>
<dt>Breakout</dt><dd>The closing price prints higher than any close of the previous 50 sessions — the market just pushed into new territory.</dd>
<dt>Risk (per trade)</dt><dd>Entry price minus stop price — the most you plan to lose if the trade fails. Targets are measured in multiples of this.</dd>
<dt>T1 / T2 targets</dt><dd>Planned take-profit levels: entry + 1.5 × risk (T1) and entry + 3 × risk (T2).</dd>
<dt>Win rate</dt><dd>The share of finished trades that made money. A low win rate can still profit if winners are much bigger than losers.</dd>
<dt>Profit factor</dt><dd>Total money won divided by total money lost. Above 1.0 means the system took more from the market than it gave back.</dd>
<dt>Max drawdown ("deepest fall")</dt><dd>The worst peak-to-trough loss the portfolio suffered in the backtest — the pain you would have had to sit through.</dd>
<dt>Alpha vs NEPSE</dt><dd>How much more (or less) this system earned per year than simply buying and holding the NEPSE index itself. Negative means buy &amp; hold won.</dd>
<dt>Sharpe / Sortino</dt><dd>Return per unit of bumpiness. Higher means smoother gains. Sortino counts only the bad bumps (losses), ignoring upside jumps.</dd>
<dt>Turnover filter</dt><dd>Stocks trading under Rs 10 lakh a day on average are skipped — too thin to enter and exit cleanly without moving the price.</dd>
</dl></div>

<p class="sig-foot">Data: daily NEPSE OHLCV, corporate-action adjusted — historical bars from the open scraper dataset, recent sessions from our own NEPSE feed. Generated ${genDate}. Educational only — not investment advice.</p>
</main>
<script>
(function(){
  var sys = "${sys}";
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmtN(v){return (v==null||!isFinite(+v))?'–':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});}
  function fmtRs(v){
    if(v==null||!isFinite(+v))return '–';
    var a=Math.abs(v);
    if(a>=1e7)return 'Rs '+(v/1e7).toFixed(2)+' Cr';
    if(a>=1e5)return 'Rs '+(v/1e5).toFixed(2)+' L';
    return 'Rs '+Math.round(v).toLocaleString('en-US');
  }
  function fmtNPT(iso){
    var t=new Date(iso).getTime();if(!isFinite(t))return '';
    var n=new Date(t+5.75*3600*1000);
    var M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function p(x){return ('0'+x).slice(-2);}
    return n.getUTCDate()+' '+M[n.getUTCMonth()]+', '+p(n.getUTCHours())+':'+p(n.getUTCMinutes())+' NPT';
  }
  var eqPts=null;
  function drawEquity(){
    var cv=document.getElementById('eqchart');if(!cv||!eqPts||eqPts.length<2)return;
    var ctx=cv.getContext('2d');
    var W=cv.width=cv.offsetWidth*2,H=cv.height=560;
    var pts=eqPts;
    var vs=pts.map(function(p){return p.v;});
    var mn=Math.min.apply(null,vs),mx=Math.max.apply(null,vs);
    if(mx===mn)mx=mn+1;
    var X=function(i){return 60+i*(W-90)/(pts.length-1);};
    var Y=function(v){return H-40-(v-mn)/(mx-mn)*(H-80);};
    var dark=document.documentElement.getAttribute('data-theme')!=='light';
    var cGrid=dark?'rgba(255,255,255,.07)':'#E2E6EC';
    var cBase=dark?'rgba(154,163,178,.35)':'#CBD2DC';
    var cLine=dark?'#B8E62E':'#4D7C0F';
    var cText=dark?'#9AA3B2':'#4B5563';
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle=cBase;ctx.lineWidth=2;ctx.setLineDash([8,8]);
    ctx.beginPath();ctx.moveTo(60,Y(10000000));ctx.lineTo(W-30,Y(10000000));ctx.stroke();
    ctx.setLineDash([]);
    var grad=ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,dark?'rgba(184,230,46,.28)':'rgba(77,124,15,.22)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
    ctx.strokeStyle=cLine;ctx.lineWidth=3;ctx.lineJoin='round';ctx.beginPath();
    pts.forEach(function(p,i){i?ctx.lineTo(X(i),Y(p.v)):ctx.moveTo(X(i),Y(p.v));});
    ctx.stroke();
    ctx.lineTo(X(pts.length-1),H-40);ctx.lineTo(X(0),H-40);ctx.closePath();
    ctx.fillStyle=grad;ctx.fill();
    ctx.strokeStyle=cGrid;ctx.lineWidth=1;
    for(var g=0;g<=4;g++){var gy=40+g*(H-80)/4;ctx.beginPath();ctx.moveTo(60,gy);ctx.lineTo(W-30,gy);ctx.stroke();}
    ctx.fillStyle=cText;ctx.font='22px Inter,system-ui,sans-serif';
    ctx.fillText('Rs 1 Cr',8,Y(10000000)+8);
    var last=pts[pts.length-1];
    ctx.fillStyle=cLine;ctx.font='bold 24px Inter,system-ui,sans-serif';
    ctx.fillText('Rs '+(last.v/10000000).toFixed(2)+' Cr',W-200,Y(last.v)-14);
  }
  if(window.MutationObserver){
    new MutationObserver(function(m){for(var i=0;i<m.length;i++){if(m[i].attributeName==='data-theme'){drawEquity();break;}}})
      .observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  /* closed-history pagination (rows rendered from JSON below) */
  var cBody=null,cSize=null,cInfo=null,cPrev=null,cNext=null,cPage=0;
  function cRender(){
    if(!cBody)return;
    var rows=cBody.rows,s=cSize?parseInt(cSize.value,10)||50:50;
    var p=Math.max(1,Math.ceil(rows.length/s));
    if(cPage>=p)cPage=p-1;if(cPage<0)cPage=0;
    var lo=cPage*s,hi=Math.min(lo+s,rows.length);
    for(var i=0;i<rows.length;i++)rows[i].style.display=(i>=lo&&i<hi)?'':'none';
    if(cInfo)cInfo.textContent=rows.length?('Showing '+(lo+1)+'–'+hi+' of '+rows.length+' trades'):'No trades';
    if(cPrev){cPrev.disabled=cPage===0;cPrev.style.opacity=cPage===0?'.45':'1';}
    if(cNext){cNext.disabled=cPage>=p-1;cNext.style.opacity=cPage>=p-1?'.45':'1';}
  }
  function initClosedPager(){
    cBody=document.getElementById('closed-body');cSize=document.getElementById('closed-size');
    cInfo=document.getElementById('closed-info');cPrev=document.getElementById('closed-prev');cNext=document.getElementById('closed-next');
    if(!cBody||!cSize)return;
    cPage=0;
    cSize.onchange=function(){cPage=0;cRender();};
    if(cPrev)cPrev.onclick=function(){if(cPage>0){cPage--;cRender();}};
    if(cNext)cNext.onclick=function(){var s=parseInt(cSize.value,10)||50;if(cPage<Math.ceil(cBody.rows.length/s)-1){cPage++;cRender();}};
    cRender();
  }
  /* ---- 60s change-gated refresh + sector filter (teardown 2026-10-27) ----
     Replaces the old 15-min poll + generated_at-only guard. Signature is
     view-independent; view changes RE-BASELINE it, never null it. */
  var lastSig=null, lastData=null, lastLive=null, currentSector=null;
  var secMap=null, nameMap=null, secMapsTried=false, lastPoll=0;
  function loadSectorMaps(){
    if(secMapsTried)return Promise.resolve();
    secMapsTried=true;
    return Promise.all([
      fetch('/nepse-chart/data/verdicts.json').then(function(r){return r.json();}).catch(function(){return null;}),
      fetch('/nepse-chart/data/universe.json').then(function(r){return r.json();}).catch(function(){return null;})
    ]).then(function(res){
      secMap={}; nameMap={};
      var v=res[0], u=res[1];
      if(v&&v.verdicts)Object.keys(v.verdicts).forEach(function(s){var r=v.verdicts[s]; if(r&&r.sec)secMap[s]=r.sec;});
      if(u&&u.symbols)u.symbols.forEach(function(x){if(x&&x.s)nameMap[x.s]=x.n||x.s;});
    });
  }
  function sectorOf(sym){return (secMap&&secMap[sym])||'Unscored';}
  function sigOf(d){
    var lr=d.live_track_record||{}, st=lr.stats||{};
    return [d.generated_at||'', d.asof||'', st.last_updated||'', (d.alerts||[]).length, st.open_positions||0, st.closed_trades||0].join('|');
  }
  function renderFresh(d, failed){
    var fr=document.getElementById('sig-fresh'), ft=document.getElementById('sig-fresh-text');
    if(!fr||!ft)return;
    var now=new Date(), nxt=new Date(now.getTime()+60*1000);
    var parts=[];
    if(d.asof)parts.push('Signals as of '+esc(d.asof));
    if(d.generated_at)parts.push('rebuilt '+fmtNPT(d.generated_at));
    parts.push('checked '+fmtNPT(now.toISOString()));
    parts.push('next check '+fmtNPT(nxt.toISOString()));
    if(failed)parts.push('refresh failed — showing last good data');
    ft.textContent=parts.join(' · ');
    fr.hidden=false;
    fr.classList.toggle('fail', !!failed);
  }
  function rebaseline(){ if(lastData)lastSig=sigOf(lastData); }
  function inSector(sym){ return !currentSector || sectorOf(sym)===currentSector; }
  function emptyRow(cols, base){
    var t=currentSector?('No rows in '+currentSector+' for this table.'):base;
    return '<tr><td colspan="'+cols+'">'+t+'</td></tr>';
  }
  function renderSectorBlock(){
    var sec=document.getElementById('sector-block');
    if(!sec||!lastData)return;
    var lr=lastData.live_track_record||{};
    var syms=[], seen={};
    (lr.open_positions||[]).forEach(function(t){if(t.symbol&&!seen[t.symbol]){seen[t.symbol]=1;syms.push(t.symbol);}});
    (lastData.alerts||[]).forEach(function(a){if(a.symbol&&!seen[a.symbol]){seen[a.symbol]=1;syms.push(a.symbol);}});
    var bySec={};
    syms.forEach(function(s){var k=sectorOf(s); (bySec[k]=bySec[k]||[]).push(s);});
    var cards=document.getElementById('sector-cards');
    var note=document.getElementById('sector-note');
    if(note)note.textContent=secMap?'':'Sector data unavailable — tables shown unfiltered.';
    function cardHtml(k, list){
      var names=list.slice(0,3).map(function(s){return esc((nameMap&&nameMap[s])?nameMap[s]:s);}).join(', ');
      var active=(k===null&&currentSector===null)||(k!==null&&currentSector===k);
      return '<button class="sig-sector" type="button" data-sec="'+esc(k===null?'':k)+'" aria-pressed="'+(active?'true':'false')+'">'+
        '<span class="sig-sector-n">'+esc(k===null?'All sectors':k)+'</span>'+
        '<span class="sig-sector-c">'+list.length+' stock'+(list.length===1?'':'s')+'</span>'+
        (k===null?'':'<span class="sig-sector-t">'+names+'</span>')+'</button>';
    }
    var html=cardHtml(null, syms);
    Object.keys(bySec).sort().forEach(function(k){ html+=cardHtml(k, bySec[k]); });
    cards.innerHTML=html;
    Array.prototype.forEach.call(cards.querySelectorAll('.sig-sector'), function(b){
      b.onclick=function(){
        var v=b.getAttribute('data-sec');
        currentSector=v?v:null;
        renderAll(lastData, lastLive);
        renderSectorBlock();
        rebaseline();
      };
    });
    sec.hidden=false;
  }
  function renderTrack(d){
    /* live forward record — paper trades from real signals.
       Rendered client-side from d.live_track_record (rewritten daily by
       tools/track-live-signals.py): numbers stay fresh with no page rebuild.
       HONESTY RULE: a win/failure rate appears only after trades close. With
       zero closed trades the section says so plainly — never 0%, never blank,
       never the backtest rate. */
    var lr=d.live_track_record, sec=document.getElementById('track-record');
    var sub=document.getElementById('track-sub'), grid=document.getElementById('track-grid');
    function card(l,v,cls){return '<div class="sig-card '+cls+'"><div class="sig-card-l">'+l+'</div><div class="sig-card-v">'+v+'</div></div>';}
    function cardBar(l,v,cls,pct,col){return '<div class="sig-card '+cls+'"><div class="sig-card-l">'+l+'</div><div class="sig-card-v">'+v+'</div><div class="cx-prop" style="margin-top:9px"><div class="cx-prop-track"><span class="cx-prop-fill" style="--w:'+pct+'%;background:'+col+'"></span></div></div></div>';}
    if(!lr||!lr.stats){
      if(sub)sub.textContent='Forward tracking of live alerts begins with the next daily rebuild — no paper trades yet.';
      grid.innerHTML='';
      sec.hidden=false;
      return;
    }
    var s2=lr.stats, since=lr.tracking_started||'2026-10-09', nClosed=s2.closed_trades||0;
    if(nClosed===0){
      if(sub)sub.textContent='No closed paper trades yet — forward tracking since '+since+'. Win and failure rates will appear here once the first paper trades close on real market data.';
      grid.innerHTML=
        card('Win rate','–','')+card('Failure rate','–','')+
        card('Closed trades','0','')+card('Open now',s2.open_positions,'')+
        card('Avg win','–','')+card('Avg loss','–','')+
        card('Profit factor','–','')+card('Best / worst','–','');
    }else{
      if(sub)sub.textContent='Forward-tracked since '+since+' · data through '+(s2.data_through||'–')+'. Every live Entry alert becomes a Rs 10 lakh paper trade at the signal close; exits fire on real forward OHLC — Target 1, stop loss, a ratcheting trailing stop, or a 20-session time exit. P&L is net of 0.5% round-trip charges.';
      var bw=(s2.best_trade?s2.best_trade.symbol+' '+(s2.best_trade.pnl_pct>=0?'+':'')+s2.best_trade.pnl_pct+'%':'–')+' / '+(s2.worst_trade?s2.worst_trade.symbol+' '+(s2.worst_trade.pnl_pct>=0?'+':'')+s2.worst_trade.pnl_pct+'%':'–');
      grid.innerHTML=
        cardBar('Win rate',s2.win_rate_pct+'%',s2.win_rate_pct>=50?'up':'',s2.win_rate_pct,'var(--nd-lime,#B8E62E)')+
        cardBar('Failure rate',s2.failure_rate_pct+'%',s2.failure_rate_pct>=50?'down':'',s2.failure_rate_pct,'var(--nd-down,#F87171)')+
        card('Closed trades',nClosed,'')+
        card('Open now',s2.open_positions,'')+
        card('Avg win','+'+s2.avg_win_pct+'%','up')+
        card('Avg loss',s2.avg_loss_pct+'%','down')+
        card('Profit factor',s2.profit_factor,'')+
        card('Best / worst',esc(bw),'');
    }
    var otb=document.querySelector('#track-open tbody');
    var opens=(lr.open_positions||[]).filter(function(t){return inSector(t.symbol);});
    otb.innerHTML=opens.length?opens.map(function(t){
      var u=t.unrealized_pct>=0?'+'+t.unrealized_pct+'%':t.unrealized_pct+'%';
      return '<tr><td>'+esc(t.entry_date)+'</td><td><strong>'+esc(t.symbol)+'</strong></td>'+
      '<td class="num">'+fmtN(t.entry_price)+'</td><td class="num">'+fmtN(t.stop_loss)+'</td>'+
      '<td class="num">'+fmtN(t.trail_stop)+'</td><td class="num">'+fmtN(t.target_1)+'</td>'+
      '<td class="num">'+fmtN(t.target_2)+'</td><td class="num">'+fmtN(t.current_price)+'</td>'+
      '<td class="num" style="color:var(--nd-'+(t.unrealized_pct>=0?'up':'down')+')">'+esc(u)+'</td>'+
      '<td><div class="prog"><i style="width:'+(t.target_2>t.entry_price?Math.max(0,Math.min(100,(t.current_price-t.entry_price)/(t.target_2-t.entry_price)*100)):0)+'%"></i></div></td>'+
      '<td class="num">'+t.sessions_held+'</td></tr>';
    }).join(''):emptyRow(11, 'No open paper positions right now.');
    var ctb=document.querySelector('#track-closed tbody');
    var closed=(lr.recent_closed||[]).filter(function(t){return inSector(t.symbol);});
    ctb.innerHTML=closed.length?closed.map(function(t){
      var win=t.pnl_pct>=0,er=String(t.exit_reason||'');
      var rp=win?'rp-win':(er.toLowerCase().indexOf('trail')>=0?'rp-trail':'rp-loss');
      return '<tr><td><strong>'+esc(t.symbol)+'</strong></td>'+
      '<td class="num">'+esc(t.entry_date)+'</td><td class="num">'+esc(t.exit_date)+'</td>'+
      '<td class="num">'+fmtN(t.entry_price)+'</td><td class="num">'+fmtN(t.exit_price)+'</td>'+
      '<td><span class="rpill '+rp+'">'+esc(er)+'</span></td>'+
      '<td class="num" style="color:var(--nd-'+(win?'up':'down')+')"><strong>'+(win?'+':'')+t.pnl_pct.toFixed(2)+'%</strong></td>'+
      '<td class="num">'+fmtRs(t.pnl_rs)+'</td>'+
      '<td class="num">'+t.hold_sessions+'</td></tr>';
    }).join(''):emptyRow(9, 'No closed paper trades yet — forward tracking since '+since+'. The ledger fills as real sessions elapse.');
    /* P&L distribution from the same closed ledger (filtered with the tables) */
    var dist=document.getElementById('track-dist');
    if(dist){
      var buckets=[['< −5%',function(p){return p<-5;}],['−5–0%',function(p){return p>=-5&&p<0;}],['0–5%',function(p){return p>=0&&p<5;}],['5–10%',function(p){return p>=5&&p<10;}],['> 10%',function(p){return p>=10;}]];
      var counts=buckets.map(function(b){return 0;});
      closed.forEach(function(t){var p=+t.pnl_pct; buckets.forEach(function(b,i){if(b[1](p))counts[i]++;});});
      var mx=Math.max.apply(null,counts);
      dist.innerHTML=mx?buckets.map(function(b,i){
        return '<div class="sig-dist-row"><span class="sig-dist-lab">'+b[0]+'</span><span class="sig-dist-track"><span class="sig-dist-fill" style="width:'+(counts[i]/mx*100)+'%"></span></span><span class="sig-dist-n">'+counts[i]+'</span></div>';
      }).join(''):'<p class="sig-sub">No closed trades yet — the distribution appears here once trades close.</p>';
    }
    sec.hidden=false;
  }
  function renderAlerts(d, live){
    var tb=document.querySelector('#alerts tbody');
    var ltpMap={};
    if(live&&live.quotes){live.quotes.forEach(function(q){if(q.symbol&&q.ltp)ltpMap[q.symbol]=+q.ltp;});}
    var rows=(d.alerts||[]).filter(function(a){return inSector(a.symbol);});
    if(!rows.length){tb.innerHTML=emptyRow(11, 'No positions were still open when the replay ended.');}
    else tb.innerHTML=rows.map(function(a){
      var cur=ltpMap[a.symbol]||+a.current||0;
      var upct=a.entry?Math.round((cur-(+a.entry))/(+a.entry)*10000)/100:(+a.unrealized_pct||0);
      var prog=(+a.target_2)>(+a.entry)?Math.max(0,Math.min(100,(cur-(+a.entry))/((+a.target_2)-(+a.entry))*100)):(+a.progress||0);
      var pnl=upct>=0?'+'+upct+'%':upct+'%';
      var cls=upct>=0?'color:var(--nd-up,#4ADE80)':'color:var(--nd-down,#F87171)';
      return '<tr><td>'+esc(a.date)+'</td><td><strong>'+esc(a.symbol)+'</strong></td>'+
        '<td><span class="tag entry">'+esc(a.alert)+'</span></td>'+
        '<td>'+fmtN(a.entry)+'</td><td>'+fmtN(a.stop_loss)+'</td>'+
        '<td>'+fmtN(a.trail_stop)+'</td><td>'+fmtN(a.target_1)+'</td>'+
        '<td>'+fmtN(a.target_2)+'</td><td>'+fmtN(cur)+'</td>'+
        '<td style="'+cls+'">'+esc(pnl)+'</td>'+
        '<td><div class="prog"><i style="width:'+Math.min(100,prog)+'%"></i></div></td></tr>';
    }).join('');
  }
  function renderClosed(d){
    var cb=document.getElementById('closed-body');
    var trades=(d.recent_trades||[]).filter(function(t){return inSector(t.symbol);});
    if(!trades.length){cb.innerHTML=emptyRow(9, 'No closed trades yet.');}
    else{
      cb.innerHTML=trades.map(function(t){
        var pnl=+t.pnl_pct,win=pnl>=0;
        var er=String(t.exit_reason||'').replace(/-/g,' ');
        var rp=win?'rp-win':(er.indexOf('trail')>=0?'rp-trail':'rp-loss');
        return '<tr><td><strong>'+esc(t.symbol)+'</strong></td>'+
          '<td class="num">'+esc(t.entry_date)+'</td>'+
          '<td class="num">'+esc(t.exit_date)+'</td>'+
          '<td class="num">'+fmtN(t.entry_price)+'</td>'+
          '<td class="num">'+fmtN(t.exit_price)+'</td>'+
          '<td><span class="rpill '+rp+'">'+esc(er||'—')+'</span></td>'+
          '<td class="num" style="color:var(--nd-'+(win?'up':'down')+')"><strong>'+(win?'+':'')+pnl.toFixed(2)+'%</strong></td>'+
          '<td class="num">'+fmtRs(t.pnl_rs)+'</td>'+
          '<td class="num">'+esc(t.hold_days)+'</td></tr>';
      }).join('');
    }
  }
  function renderAll(d, live){
    renderFresh(d, false);
    renderTrack(d);
    renderAlerts(d, live);
    renderClosed(d);
    initClosedPager();
    eqPts=(d.stats&&d.stats.equity_curve)||null;
    drawEquity();
  }
  function loadData(isAuto){
    lastPoll=Date.now();
    var url='/nepse-chart/data/signals/'+sys+'.json'+(isAuto?('?t='+Date.now()):'');
    Promise.all([
      fetch(url,{cache:'no-store'}).then(function(r){return r.json();}),
      fetch('/nepse-chart/data/live.json').then(function(r){return r.json();}).catch(function(){return null;}),
      loadSectorMaps()
    ]).then(function(res){
      var d=res[0], live=res[1];
      if(isAuto&&lastSig!==null&&sigOf(d)===lastSig){
        if(lastData)renderFresh(lastData, false); // clock only, no DOM re-render
        return;
      }
      lastData=d; lastLive=live; lastSig=sigOf(d);
      renderAll(d, live);
      renderSectorBlock();
    }).catch(function(){
      if(isAuto){
        if(lastData)renderFresh(lastData, true); // keep last-good + failure text
        return;
      }
      document.querySelector('#alerts tbody').innerHTML='<tr><td colspan="11">Could not load signal data.</td></tr>';
      var cb=document.getElementById('closed-body');
      if(cb)cb.innerHTML='<tr><td colspan="9">Could not load trade history.</td></tr>';
    });
  }
  loadData(false);
  /* auto-refresh: 60s change-gated poll, skip while hidden, refresh on visible */
  setInterval(function(){ if(!document.hidden)loadData(true); },60*1000);
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden && Date.now()-lastPoll>60*1000)loadData(true);
  });
})();
</script>
<div id="nd-footer"></div>
<script src="/js/nd-chrome.js?v=89886946" defer></script>
<script src="/js/nd-cinema.js?v=90f78cc3" defer></script>
<script src="/js/theme-toggle.js?v=6a6a46c6" defer></script>
</body>
</html>`;
}

for (const sys of SLUGS) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, sys + '.json'), 'utf8'));
  const out = path.join(OUT, sys, 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page(sys, data));
  console.log('wrote ' + out);
}

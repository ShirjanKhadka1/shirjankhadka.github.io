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

// backtest_years is not emitted by build-signals.js; derive it from the window dates.
// (2026-10-09: pages + meta descriptions rendered "undefined years" otherwise.)
function backtestYears(st) {
  if (st.backtest_years) return st.backtest_years;
  const a = new Date(st.backtest_from).getTime(), b = new Date(st.backtest_to).getTime();
  if (!isFinite(a) || !isFinite(b) || b <= a) return '–';
  return fmt((b - a) / (365.25 * 86400000), 1);
}
function backtestNote(sys, st) {
  const yrs = backtestYears(st), an = fmt(st.annual_return_pct), win = fmt(st.win_rate_pct),
        dd = fmt(st.max_drawdown_pct), bench = fmt(st.benchmark_cagr_pct), tr = st.total_trades;
  if (sys === 'momentum') return "<strong>What the backtest says.</strong> Over " + yrs + " years this rule set compounded at " + an + "% a year \u2014 below NEPSE buy &amp; hold (" + bench + "%), but with a far shallower worst fall (" + dd + "% vs the index's deep bear markets). It wins only " + win + "% of trades; it survives on letting winners run to multiples of risk.";
  if (sys === 'trend-relay') return "<strong>What the backtest says.</strong> This patient re-entry system compounded at " + an + "% a year with the shallowest worst fall of the three (" + dd + "%). It trades rarely (" + tr + " trades in " + yrs + " years) and wins " + win + "% of them \u2014 a system for waiting, not for action.";
  if (sys === 'reversal') return "<strong>Read this first.</strong> Over " + yrs + " years this system <em>lost</em> money (" + an + "% a year, worst fall " + dd + "%). That is itself the finding: on NEPSE, buying oversold dips against the trend has been a losing approach \u2014 sharp knives keep falling. It is published for education, so you can see exactly why, not as something to trade.";
  return '';
}
function nepaliNote(sys, st) {
  const an = st.annual_return_pct, win = fmt(st.win_rate_pct), tr = st.total_trades;
  if (sys === 'momentum') return "<strong>\u0938\u0902\u0915\u094d\u0937\u0947\u092a\u0964</strong> \u092f\u094b \u092a\u094d\u0930\u0923\u093e\u0932\u0940 \u092c\u0922\u094d\u0926\u094b \u092e\u0942\u0932\u094d\u092f \u092d\u090f\u0915\u093e \u0938\u094d\u091f\u0915 \u0938\u092e\u093e\u0924\u094d\u0928\u0947 \u0928\u093f\u092f\u092e \u0939\u094b \u2014 \u096b\u0966 \u0926\u093f\u0928\u0915\u0948 \u0909\u091a\u094d\u091a\u0924\u092e \u092e\u0942\u0932\u094d\u092f \u0924\u094b\u0921\u0947\u092a\u091b\u093f \u0915\u093f\u0928\u094d\u0928\u0947, \u0938\u094d\u091f\u092a\u2013\u0932\u0938\u0938\u0939\u093f\u0924 \u092c\u093e\u0939\u093f\u0930\u093f\u0928\u0947\u0964 \u0968\u0969 \u0935\u0930\u094d\u0937\u0915\u094b \u092a\u0930\u0940\u0915\u094d\u0937\u0923\u092e\u093e \u0935\u093e\u0930\u094d\u0937\u093f\u0915 " + an + '%' + " \u092a\u094d\u0930\u0924\u093f\u092b\u0932; \u091c\u093f\u0924\u094d\u0928\u0947 \u091f\u094d\u0930\u0947\u0921 " + win + '%' + " \u092e\u093e\u0924\u094d\u0930, \u0928\u093e\u092b\u093e \u0920\u0942\u0932\u093e \u0935\u093f\u091c\u0947\u0924\u093e\u092c\u093e\u091f\u0964 \u092f\u094b \u0936\u0948\u0915\u094d\u0937\u093f\u0915 \u091c\u093e\u0928\u0915\u093e\u0930\u0940 \u0939\u094b, \u0932\u0917\u093e\u0928\u0940 \u0938\u0932\u094d\u0932\u093e\u0939 \u0939\u094b\u0907\u0928\u0964";
  if (sys === 'trend-relay') return "<strong>\u0938\u0902\u0915\u094d\u0937\u0947\u092a\u0964</strong> \u092f\u094b \u092a\u094d\u0930\u0923\u093e\u0932\u0940 \u0927\u0948\u0930\u094d\u092f\u092a\u0942\u0930\u094d\u0935\u0915 \u092a\u094d\u0930\u0935\u0943\u0924\u094d\u0924\u093f \u092a\u091b\u094d\u092f\u093e\u0909\u0928\u0947 \u0928\u093f\u092f\u092e \u0939\u094b \u2014 \u0925\u094b\u0930\u0948 \u091f\u094d\u0930\u0947\u0921, \u0932\u093e\u092e\u094b \u0939\u094b\u0932\u094d\u0921\u093f\u0919\u0964 \u0968\u0969 \u0935\u0930\u094d\u0937\u092e\u093e " + tr + " \u091f\u094d\u0930\u0947\u0921 \u092e\u093e\u0924\u094d\u0930, \u0935\u093e\u0930\u094d\u0937\u093f\u0915 " + an + '%' + " \u092a\u094d\u0930\u0924\u093f\u092b\u0932\u0964 \u092f\u094b \u0936\u0948\u0915\u094d\u0937\u093f\u0915 \u091c\u093e\u0928\u0915\u093e\u0930\u0940 \u0939\u094b, \u0932\u0917\u093e\u0928\u0940 \u0938\u0932\u094d\u0932\u093e\u0939 \u0939\u094b\u0907\u0928\u0964";
  if (sys === 'reversal') return "<strong>\u0938\u0902\u0915\u094d\u0937\u0947\u092a\u0964</strong> \u092f\u094b \u092a\u094d\u0930\u0923\u093e\u0932\u0940 \u0918\u091f\u0947\u0915\u093e \u0938\u094d\u091f\u0915 \"\u092b\u0930\u094d\u0915\u0928\u094d\u091b\u0928\u094d\" \u092d\u0928\u094d\u0928\u0947 \u0905\u0928\u0941\u092e\u093e\u0928\u092e\u093e \u0915\u093f\u0928\u094d\u0928\u0947 \u0928\u093f\u092f\u092e \u0939\u094b \u2014 \u0924\u0930 \u0968\u0969 \u0935\u0930\u094d\u0937\u0915\u094b \u092a\u0930\u0940\u0915\u094d\u0937\u0923\u092e\u093e \u092f\u0938\u0932\u0947 \u092a\u0948\u0938\u093e \u0917\u0941\u092e\u093e\u092f\u094b (\u0935\u093e\u0930\u094d\u0937\u093f\u0915 " + an + '%' + ")\u0964 \u0928\u0947\u092a\u094d\u0938\u0947\u092e\u093e \u092f\u094b \u0936\u0948\u0932\u0940\u0932\u0947 \u0915\u093e\u092e \u0917\u0930\u0947\u0928 \u092d\u0928\u094d\u0928\u0947 \u0907\u092e\u093e\u0928\u0926\u093e\u0930 \u0928\u093f\u0937\u094d\u0915\u0930\u094d\u0937\u0915\u093e \u0932\u093e\u0917\u093f \u092a\u094d\u0930\u0915\u093e\u0936\u093f\u0924 \u0917\u0930\u093f\u090f\u0915\u094b \u0939\u094b\u0964";
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
  }).join('');

  const cards =
    card('Annual return', pct(st.annual_return_pct), st.annual_return_pct >= 0 ? 'up' : 'down') +
    card('Rs 1 Cr became', money(st.final_value), '') +
    card('Win rate', pct(st.win_rate_pct), '') +
    card('Deepest fall', pct(st.max_drawdown_pct), 'down') +
    card('Profit factor', fmt(st.profit_factor), '') +
    card('Avg holding', fmt(st.avg_holding_days, 0) + ' days', '') +
    card('Charges paid', money(st.charges_paid), '') +
    card('Alpha vs NEPSE', pct(st.alpha_pct), st.alpha_pct >= 0 ? 'up' : 'down');

  const backtestNoteHtml = backtestNote(sys, st);
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
  const aboutHtml = title + ' is one of Nepse Decode\'s transparent signal systems, run by the Alpha Lab engine. Every rule above is public — there is no hidden model and no "AI prediction". Signals are generated mechanically from daily OHLCV data (corporate-action adjusted); a stock appears here only if it passes every filter, including a Rs 10 lakh average-turnover liquidity bar. This page is educational and is not investment advice.';

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
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/nd-chrome.css?v=20261009f">
<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261009b">
<link rel="stylesheet" href="/css/sig-pro.css?v=20261006a">
</head>
<body class="nd">
<a class="skip-link" href="#main">Skip to content</a>
<div id="nd-header"></div>
<main id="main" class="sig-wrap">
<nav class="sig-tabs" aria-label="Signal systems">${tabs}</nav>

<p class="sig-kicker">Nepse Decode &middot; Chart &amp; signals &middot; rule-based, no black boxes</p>
<h1>${title}</h1>
<p class="sig-lede">${tagline}</p>

<div class="sig-fresh" id="sig-fresh" hidden><span class="dot"></span><span id="sig-fresh-text">Loading…</span></div>
<div class="sig-grid">${cards}</div>

<section id="track-record" hidden>
<h2>Live forward record — what the signals have actually produced</h2>
<p class="sig-sub" id="track-sub">Every live Entry alert becomes a Rs 10 lakh paper trade at the signal close, scored against real forward OHLC. Loading…</p>
<div class="sig-grid" id="track-grid"></div>
<h3>Open paper positions</h3>
<div class="scrollx"><table class="sig-table" id="track-open"><thead><tr>
<th>Date</th><th>Symbol</th><th class="num">Entry</th><th class="num">Stop loss</th><th class="num">Trail stop</th><th class="num">Target 1</th><th class="num">Target 2</th><th class="num">Current</th><th class="num">Unrealized</th><th class="num">Sessions</th>
</tr></thead><tbody><tr><td colspan="10">Loading…</td></tr></tbody></table></div>
<h3>Closed paper trades — newest first</h3>
<div class="scrollx"><table class="sig-table" id="track-closed"><thead><tr>
<th>Symbol</th><th class="num">Entry date</th><th class="num">Exit date</th><th class="num">Entry</th><th class="num">Exit</th><th>Exit reason</th><th class="num">P&amp;L %</th><th class="num">Sessions</th>
</tr></thead><tbody><tr><td colspan="8">Loading…</td></tr></tbody></table></div>
</section>
<div class="note">${backtestNoteHtml}</div>

<div class="note" lang="ne">${nepaliNoteHtml}</div>

<div class="note">${howtoNoteHtml}</div>

<h2>Open alerts — positions the system holds right now</h2>
<p class="sig-sub">Entry is taken at the signal day's close. Stops and targets are fixed at entry; the trail updates with price. Progress shows how far the trade has moved toward Target 2.</p>
<div class="scrollx"><table class="sig-table" id="alerts"><thead><tr>
<th>Date</th><th>Symbol</th><th>Alert</th><th>Entry</th><th>Stop loss</th><th>Trail stop</th><th>Target 1</th><th>Target 2</th><th>Current</th><th>Unrealized</th><th>Progress</th>
</tr></thead><tbody><tr><td colspan="11">Loading…</td></tr></tbody></table></div>

<h2>Trade profile — backtest (historical simulation)</h2>
<p class="sig-sub">Hypothetical replay of these exact rules on historical data — not trades anyone took. Real outcomes are in the Live forward record above.</p>
<div class="scrollx"><table class="sig-table">
<tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr>
${profileRows}</table></div>

<h2>Equity curve — Rs 1 Cr through this system</h2>
<canvas id="eqchart"></canvas>

<h2>The rules (exactly as coded)</h2>
<div class="rules"><ol>${rulesHtml}</ol></div>

<h2>Closed history — backtest trades</h2>
<p class="sig-sub">Every finished trade from the mechanical backtest replay, newest first — hypothetical, not live trades. The Live forward record above shows what the signals have produced since tracking began. P&amp;L is after the same trading charges the backtest applies.</p>
<div class="scrollx"><table class="sig-table" id="closed"><thead><tr>
<th>Symbol</th><th class="num">Entry date</th><th class="num">Exit date</th><th class="num">Entry price</th><th class="num">Exit price</th><th>Exit reason</th><th class="num">P&amp;L %</th><th class="num">Hold days</th>
</tr></thead><tbody id="closed-body"><tr><td colspan="8">Loading trade history…</td></tr></tbody></table></div>
<div class="sig-pager">
      <label>Rows per page
        <select id="closed-size">
          <option value="10" selected>10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option>
        </select></label>
      <span id="closed-info" aria-live="polite"></span>
      <span style="display:flex;gap:8px;margin-left:auto">
        <button id="closed-prev">← Prev</button>
        <button id="closed-next">Next →</button>
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

<p class="sig-foot">Data: daily NEPSE OHLCV, corporate-action adjusted. Generated ${genDate}. Educational only — not investment advice.</p>
</main>
<script>
(function(){
  var sys = "${sys}";
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmtN(v){return (v==null||!isFinite(+v))?'–':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});}
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
  var lastGen='';
  function loadData(isAuto){
    var url='/nepse-chart/data/signals/'+sys+'.json'+(isAuto?('?t='+Date.now()):'');
    Promise.all([
      fetch(url).then(function(r){return r.json();}),
      fetch('/nepse-chart/data/live.json').then(function(r){return r.json();}).catch(function(){return null;})
    ]).then(function(res){
      var d=res[0], live=res[1];
      // Live LTP map from our own market data (15-min delayed intraday, final close after 3:20 PM)
      var ltpMap={};
      if(live&&live.quotes){live.quotes.forEach(function(q){if(q.symbol&&q.ltp)ltpMap[q.symbol]=+q.ltp;});}
    if(isAuto&&d.generated_at&&d.generated_at===lastGen)return; // no new build
    if(d.generated_at)lastGen=d.generated_at;
    /* freshness */
    var fr=document.getElementById('sig-fresh'),ft=document.getElementById('sig-fresh-text');
    if(fr&&ft){
      var parts=[];
      if(d.as_of)parts.push('Signals as of '+esc(d.as_of));
      if(d.generated_at)parts.push('rebuilt '+fmtNPT(d.generated_at));
      ft.textContent=parts.length?parts.join(' · '):'Signal data';
      fr.hidden=false;
    }
    /* live forward record — paper trades from real signals.
       Rendered client-side from d.live_track_record (rewritten daily by
       tools/track-live-signals.py): numbers stay fresh with no page rebuild.
       HONESTY RULE: a win/failure rate appears only after trades close. With
       zero closed trades the section says so plainly — never 0%, never blank,
       never the backtest rate. */
    (function(){
      var lr=d.live_track_record, sec=document.getElementById('track-record');
      var sub=document.getElementById('track-sub'), grid=document.getElementById('track-grid');
      function card(l,v,cls){return '<div class="sig-card '+cls+'"><div class="sig-card-l">'+l+'</div><div class="sig-card-v">'+v+'</div></div>';}
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
          card('Win rate',s2.win_rate_pct+'%',s2.win_rate_pct>=50?'up':'')+
          card('Failure rate',s2.failure_rate_pct+'%',s2.failure_rate_pct>=50?'down':'')+
          card('Closed trades',nClosed,'')+
          card('Open now',s2.open_positions,'')+
          card('Avg win','+'+s2.avg_win_pct+'%','up')+
          card('Avg loss',s2.avg_loss_pct+'%','down')+
          card('Profit factor',s2.profit_factor,'')+
          card('Best / worst',esc(bw),'');
      }
      var otb=document.querySelector('#track-open tbody');
      var opens=lr.open_positions||[];
      otb.innerHTML=opens.length?opens.map(function(t){
        var u=t.unrealized_pct>=0?'+'+t.unrealized_pct+'%':t.unrealized_pct+'%';
        return '<tr><td>'+esc(t.entry_date)+'</td><td><strong>'+esc(t.symbol)+'</strong></td>'+
        '<td class="num">'+fmtN(t.entry_price)+'</td><td class="num">'+fmtN(t.stop_loss)+'</td>'+
        '<td class="num">'+fmtN(t.trail_stop)+'</td><td class="num">'+fmtN(t.target_1)+'</td>'+
        '<td class="num">'+fmtN(t.target_2)+'</td><td class="num">'+fmtN(t.current_price)+'</td>'+
        '<td class="num" style="color:var(--nd-'+(t.unrealized_pct>=0?'up':'down')+')">'+esc(u)+'</td>'+
        '<td class="num">'+t.sessions_held+'</td></tr>';
      }).join(''):'<tr><td colspan="10">No open paper positions right now.</td></tr>';
      var ctb=document.querySelector('#track-closed tbody');
      var closed=lr.recent_closed||[];
      ctb.innerHTML=closed.length?closed.map(function(t){
        var win=t.pnl_pct>=0,er=String(t.exit_reason||'');
        var rp=win?'rp-win':(er.toLowerCase().indexOf('trail')>=0?'rp-trail':'rp-loss');
        return '<tr><td><strong>'+esc(t.symbol)+'</strong></td>'+
        '<td class="num">'+esc(t.entry_date)+'</td><td class="num">'+esc(t.exit_date)+'</td>'+
        '<td class="num">'+fmtN(t.entry_price)+'</td><td class="num">'+fmtN(t.exit_price)+'</td>'+
        '<td><span class="rpill '+rp+'">'+esc(er)+'</span></td>'+
        '<td class="num" style="color:var(--nd-'+(win?'up':'down')+')"><strong>'+(win?'+':'')+t.pnl_pct.toFixed(2)+'%</strong></td>'+
        '<td class="num">'+t.hold_sessions+'</td></tr>';
      }).join(''):'<tr><td colspan="8">No closed paper trades yet — forward tracking since '+since+'. The ledger fills as real sessions elapse.</td></tr>';
      sec.hidden=false;
    })();
    /* alerts */
    var tb=document.querySelector('#alerts tbody');
    if(!d.alerts||!d.alerts.length){tb.innerHTML='<tr><td colspan="11">No open positions right now — the system is flat.</td></tr>';}
    else tb.innerHTML=d.alerts.map(function(a){
      // Override stale 'current' with live LTP; recalc unrealized % and progress
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
    /* closed history — client-rendered from JSON (was 500-row SSR bake) */
    var cb=document.getElementById('closed-body');
    var trades=d.recent_trades||[];
    if(!trades.length){cb.innerHTML='<tr><td colspan="8">No closed trades yet.</td></tr>';}
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
          '<td class="num">'+esc(t.hold_days)+'</td></tr>';
      }).join('');
    }
    initClosedPager();
    /* equity curve */
    eqPts=(d.stats&&d.stats.equity_curve)||null;
    drawEquity();
    }).catch(function(){
      if(isAuto)return; // silent on background refresh
      document.querySelector('#alerts tbody').innerHTML='<tr><td colspan="11">Could not load signal data.</td></tr>';
      var cb=document.getElementById('closed-body');
      if(cb)cb.innerHTML='<tr><td colspan="8">Could not load trade history.</td></tr>';
    });
  }
  loadData(false);
  /* auto-refresh: daily-candle data rebuilds once per day; poll every 15 min
     and on tab-visible so the page picks up the new build without reload */
  setInterval(function(){loadData(true);},15*60*1000);
  var lastHidden=0;
  document.addEventListener('visibilitychange',function(){
    if(document.hidden){lastHidden=Date.now();return;}
    if(Date.now()-lastHidden>2*60*1000)loadData(true);
  });
})();
</script>
<div id="nd-footer"></div>
<script src="/js/nd-chrome.js?v=20261006c" defer></script>
<script src="/js/theme-toggle.js?v=20261006c" defer></script>
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

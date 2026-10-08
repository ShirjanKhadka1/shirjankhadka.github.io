#!/usr/bin/env node
/* Generate the three signal pages (momentum / trend-relay / reversal).
 * Bakes headline stats into HTML for SEO; alerts + equity curve load client-side.
 * Usage: node tools/build-signal-pages.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const DATA = path.join(REPO, 'nepse-chart', 'data', 'signals');
const OUT = path.join(REPO, 'nepse-signals');

const SLUGS = ['momentum', 'trend-relay', 'reversal'];

function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function pct(n) { return (n === null || n === undefined || !Number.isFinite(n)) ? '–' : fmt(n) + '%'; }
function holdDays(t) {
  // 2026-10-02: data has no hold_days field; derive calendar days from dates
  if (!t.entry_date || !t.exit_date) return null;
  const a = Date.parse(t.entry_date), b = Date.parse(t.exit_date);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000);
}
function reasonPill(r) {
  // 2026-10-02: design-rich exit-reason pills
  const key = String(r || '').toLowerCase();
  const cls = key.includes('target') ? 'rp-win' : key.includes('stop') ? 'rp-loss' : key.includes('trail') ? 'rp-trail' : 'rp-info';
  return `<span class="rpill ${cls}">${r ? String(r).replace(/-/g, ' ') : '–'}</span>`;
}
function money(n) {
  if (!Number.isFinite(n)) return '–';
  if (Math.abs(n) >= 1e7) return 'Rs ' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return 'Rs ' + (n / 1e5).toFixed(2) + ' L';
  return 'Rs ' + Math.round(n).toLocaleString('en-US');
}

function page(sys, data) {
  const st = data.stats;
  const pageUrl = `https://shirjankhadka.com.np/nepse-signals/${sys}/`;
  const shortDesc = `${data.title}: transparent rule-based NEPSE trading system. Backtested 2003–2026 — ${pct(st.annual_return_pct)} annual return, ${pct(st.win_rate_pct)} win rate. Educational only.`;
  const tabs = SLUGS.map(s => {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, s + '.json'), 'utf8'));
    const active = s === sys ? ' aria-current="page" class="active"' : '';
    return `<a href="/nepse-signals/${s}/"${active}>${d.title.replace(' Signal', '')}</a>`;
  }).join('');

  const cards = [
    ['Annual return', pct(st.annual_return_pct), st.annual_return_pct >= 0 ? 'up' : 'down'],
    ['Rs 1 Cr became', money(st.final_value), ''],
    ['Win rate', pct(st.win_rate_pct), ''],
    ['Deepest fall', pct(st.max_drawdown_pct), 'down'],
    ['Profit factor', fmt(st.profit_factor), ''],
    ['Avg holding', fmt(st.avg_holding_days, 0) + ' days', ''],
    ['Charges paid', money(st.charges_paid), ''],
    ['Alpha vs NEPSE', pct(st.alpha_pct), st.alpha_pct >= 0 ? 'up' : 'down'],
  ].map(([l, v, c]) => `<div class="sig-card ${c}"><div class="sig-card-l">${l}</div><div class="sig-card-v">${v}</div></div>`).join('');

  const rules = data.rules.map(r => `<li>${r}</li>`).join('');

  // Closed history — server-rendered from recent_trades at build time.
  // First 50 rows visible; the rest sit in a hidden tbody revealed by "Show all".
  const trades = Array.isArray(data.recent_trades) ? data.recent_trades : [];
  function tradeRow(t) {
    // 2026-10-08 FIX: data fields are entry_price/exit_price/exit_reason (the 2026-10-02 comment was wrong)
    const pos = (t.pnl_pct || 0) >= 0;
    const cls = pos ? 'color:var(--up)' : 'color:var(--down)';
    const sign = pos ? '+' : '';
    const pc = t.pnl_pct === null || t.pnl_pct === undefined || !Number.isFinite(t.pnl_pct)
      ? '–' : sign + pct(t.pnl_pct);
    const hd = (t.hold_days !== null && t.hold_days !== undefined && Number.isFinite(t.hold_days)) ? t.hold_days : holdDays(t);
    return `<tr><td><strong>${t.symbol}</strong></td><td class="num">${t.entry_date || '–'}</td><td class="num">${t.exit_date || '–'}</td>` +
      `<td class="num">${fmt(t.entry_price)}</td><td class="num">${fmt(t.exit_price)}</td><td>${reasonPill(t.exit_reason)}</td>` +
      `<td class="num" style="${cls}"><strong>${pc}</strong></td><td class="num">${hd === null ? '–' : hd}</td></tr>`;
  }
  const closedFirst = trades.slice(0, 50).map(tradeRow).join('');
  const closedRest = trades.slice(50).map(tradeRow).join('');
  const closedMore = trades.length > 10
    ? `<div class="pg-ctl" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:12px 0 0">
      <label style="font-size:.85rem;color:var(--muted)">Rows per page
        <select id="closed-size" style="margin-left:6px;padding:6px 10px;border:1px solid var(--hairline);border-radius:8px;background:var(--card);font-size:.85rem">
          <option value="10" selected>10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option>
        </select></label>
      <span id="closed-info" style="font-size:.85rem;color:var(--muted)" aria-live="polite"></span>
      <span style="display:flex;gap:8px;margin-left:auto">
        <button id="closed-prev" style="padding:8px 16px;border:1px solid var(--hairline);border-radius:8px;background:var(--card);cursor:pointer;font-size:.85rem">← Prev</button>
        <button id="closed-next" style="padding:8px 16px;border:1px solid var(--hairline);border-radius:8px;background:var(--card);cursor:pointer;font-size:.85rem">Next →</button>
      </span></div>`
    : '';

  const NOTES = {
    'momentum': `<strong>What the backtest says.</strong> Over 23 years this rule set compounded at ${pct(st.annual_return_pct)} a year — below NEPSE buy &amp; hold (${pct(st.benchmark_cagr_pct)}), but with a far shallower worst fall (${pct(st.max_drawdown_pct)} vs the index's deep bear markets). It wins only ${pct(st.win_rate_pct)} of trades; it survives on letting winners run to multiples of risk.`,
    'trend-relay': `<strong>What the backtest says.</strong> This patient re-entry system compounded at ${pct(st.annual_return_pct)} a year with the shallowest worst fall of the three (${pct(st.max_drawdown_pct)}). It trades rarely (${st.total_trades} trades in 23 years) and wins ${pct(st.win_rate_pct)} of them — a system for waiting, not for action.`,
    'reversal': `<strong>Read this first.</strong> Over 23 years this system <em>lost</em> money (${pct(st.annual_return_pct)} a year, worst fall ${pct(st.max_drawdown_pct)}). That is itself the finding: on NEPSE, buying oversold dips against the trend has been a losing approach across two decades — sharp knives keep falling. It is published for education, so you can see exactly why, not as something to trade.`,
  };

  const GLOSSARY = `
<h2 style="font-family:var(--serif);margin-top:28px">Words on this page, in plain language</h2>
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
</dl></div>`;

  const NEPALI = {
    'momentum': `यो प्रणाली बढ्दो मूल्य भएका स्टक समात्ने नियम हो — ५० दिनकै उच्चतम मूल्य तोडेपछि किन्ने, स्टप–लससहित बाहिरिने। २३ वर्षको परीक्षणमा वार्षिक ${pct(st.annual_return_pct)} प्रतिफल; जित्ने ट्रेड ${pct(st.win_rate_pct)} मात्र, नाफा ठूला विजेताबाट। यो शैक्षिक जानकारी हो, लगानी सल्लाह होइन।`,
    'trend-relay': `यो प्रणाली धैर्यपूर्वक प्रवृत्ति पछ्याउने नियम हो — थोरै ट्रेड, लामो होल्डिङ। २३ वर्षमा ${st.total_trades} ट्रेड मात्र, वार्षिक ${pct(st.annual_return_pct)} प्रतिफल। यो शैक्षिक जानकारी हो, लगानी सल्लाह होइन।`,
    'reversal': `यो प्रणाली घटेका स्टक "फर्कन्छन्" भन्ने अनुमानमा किन्ने नियम हो — तर २३ वर्षको परीक्षणमा यसले पैसा गुमायो (वार्षिक ${pct(st.annual_return_pct)})। नेप्सेमा यो शैलीले काम गरेन भन्ने इमानदार निष्कर्षका लागि प्रकाशित गरिएको हो।`,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<script>try{var t=localStorage.getItem('sk-theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${data.title} — Nepse Decode Signals</title>
<meta name="description" content="${shortDesc}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nepse Decode">
<meta property="og:title" content="${data.title} — Nepse Decode Signals">
<meta property="og:description" content="${shortDesc}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="https://shirjankhadka.com.np/assets/images/nepse-decode-og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${data.title} — Nepse Decode Signals">
<meta name="twitter:description" content="${shortDesc}">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebPage","name":"${data.title} — Nepse Decode Signals","url":"${pageUrl}","description":"${shortDesc}","isPartOf":{"@type":"WebSite","name":"Nepse Decode","url":"https://shirjankhadka.com.np/"},"author":{"@type":"Person","name":"Shirjan Khadka","url":"https://shirjankhadka.com.np/"}}
</script>
<link rel="stylesheet" href="/css/nepse-design-system.css">
<link rel="stylesheet" href="/css/nepse-d2.css?v=20261008f">
<link rel="stylesheet" href="/css/theme.css?v=20261002d">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
.sig-tabs{display:flex;gap:4px;border-bottom:2px solid var(--hairline);margin:0 0 24px;flex-wrap:wrap}
.sig-tabs a{padding:10px 18px;color:var(--ink-soft);text-decoration:none;font-weight:600;border-bottom:3px solid transparent;margin-bottom:-2px}
.sig-tabs a.active{color:var(--green-900);border-bottom-color:var(--green-900)}
.sig-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin:20px 0}
@media(min-width:760px){.sig-grid{grid-template-columns:repeat(4,1fr)}}
.sig-card{background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md);padding:18px 20px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.04);transition:box-shadow .2s ease,transform .2s ease}
.sig-card:hover{box-shadow:0 2px 4px rgba(0,0,0,.05),0 8px 20px rgba(0,0,0,.09),0 16px 40px rgba(0,0,0,.06);transform:translateY(-2px)}
.sig-card-l{font-size:.78rem;color:var(--muted);margin-bottom:4px}
.sig-card-v{font-family:var(--serif);font-size:1.35rem;font-weight:700}
.sig-card.up .sig-card-v{color:var(--up)}.sig-card.down .sig-card-v{color:var(--down)}
.sig-table{width:100%;border-collapse:collapse;font-size:.85rem;background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md);overflow:hidden}
.sig-table th,.sig-table td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--hairline-soft);white-space:nowrap}
.sig-table th{background:var(--paper-deep);font-weight:600;color:var(--ink-soft)}
.sig-table tr:last-child td{border-bottom:none}
/* 2026-10-02: design-rich closed-history table — numeric alignment + exit-reason pills;
   steady box between pages */
.sig-table th.num,.sig-table td.num{text-align:right;font-variant-numeric:tabular-nums}
.sig-table tbody tr:hover td{background:var(--paper-deep)}
#closed tbody{min-height:380px}
#closed thead th{position:sticky;top:0;z-index:1}
.rpill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.75rem;font-weight:600;white-space:nowrap;text-transform:capitalize}
.rpill.rp-win{background:color-mix(in srgb,var(--up) 14%,transparent);color:var(--up);border:1px solid color-mix(in srgb,var(--up) 30%,transparent)}
.rpill.rp-loss{background:color-mix(in srgb,var(--down) 14%,transparent);color:var(--down);border:1px solid color-mix(in srgb,var(--down) 30%,transparent)}
.rpill.rp-trail{background:color-mix(in srgb,var(--gold,#b98a2f) 16%,transparent);color:var(--gold,#b98a2f);border:1px solid color-mix(in srgb,var(--gold,#b98a2f) 32%,transparent)}
.rpill.rp-info{background:var(--paper-deep);color:var(--muted);border:1px solid var(--hairline)}
.tag{display:inline-block;padding:2px 10px;border-radius:var(--r-pill);font-size:.75rem;font-weight:600}
.tag.entry{background:var(--green-100);color:var(--green-900)}
.prog{height:6px;background:var(--paper-deep);border-radius:3px;min-width:70px}
.prog i{display:block;height:6px;border-radius:3px;background:var(--green-700)}
.rules{background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md);padding:18px 22px;margin:20px 0}
.rules li{margin:8px 0}
.gloss{display:grid;grid-template-columns:auto 1fr;gap:8px 18px;margin:0}
.gloss dt{font-weight:700;white-space:nowrap}
.gloss dd{margin:0;color:var(--ink-soft)}
@media(max-width:640px){.gloss{grid-template-columns:1fr}.gloss dt{white-space:normal}}
.scrollx{overflow-x:auto;margin:16px 0}
.note{background:var(--gold-soft);border:1px solid var(--hairline);border-radius:var(--r-md);padding:14px 18px;margin:20px 0;font-size:.9rem}
#eqchart{width:100%;height:280px;background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md)}
</style>
</head>
<body class="nd">
<header class="d2-topbar">
  <a class="d2-brand" href="/nepse-decode/"><span class="d2-mark" aria-hidden="true">◈</span> Nepse Decode</a>
  <span style="margin-left:auto" id="d2TopState"></span>
</header>
<nav class="d2-mobilenav" aria-label="Sections"><a href="/nepse-decode/">Overview</a><a href="/nepse-chart/">Chart &amp; signals</a><span class="nav-sub"><a href="/nepse-signals/momentum/"${sys === 'momentum' ? ' class="on" aria-current="page"' : ''}>Momentum</a><a href="/nepse-signals/trend-relay/"${sys === 'trend-relay' ? ' class="on" aria-current="page"' : ''}>Trend Relay</a><a href="/nepse-signals/reversal/"${sys === 'reversal' ? ' class="on" aria-current="page"' : ''}>Reversal</a></span><a href="/nepse-screener/">Screener</a><a href="/nepse-radar/">Warning Radar</a><a href="/nepse-trending/">Trending Stocks</a><a href="/nepse-value/">Value Investing</a><a href="/nepse-brokers/">Broker Analytics</a><a href="/nepse-sectors/">Sectors</a><a href="/nepse-news/">Market news</a><a href="/nepse-watchlist/">Watchlist</a><a href="/nepse-portfolio/">Portfolio</a><a href="/nepse-simulator/">Simulator</a><a href="/nepse-reports/">Reports</a><a href="/nepse-actions/">Corp. actions</a></nav>

<div class="d2-shell">
  <aside class="d2-side" aria-label="Site navigation">
    <a class="d2-brand" href="/nepse-decode/"><span class="d2-mark" aria-hidden="true">◈</span> Nepse Decode</a>
    <nav><a href="/nepse-decode/">Overview</a><a href="/nepse-chart/">Chart &amp; signals</a><span class="nav-sub"><a href="/nepse-signals/momentum/"${sys === 'momentum' ? ' class="on" aria-current="page"' : ''}>Momentum</a><a href="/nepse-signals/trend-relay/"${sys === 'trend-relay' ? ' class="on" aria-current="page"' : ''}>Trend Relay</a><a href="/nepse-signals/reversal/"${sys === 'reversal' ? ' class="on" aria-current="page"' : ''}>Reversal</a></span><a href="/nepse-screener/">Screener</a><a href="/nepse-radar/">Warning Radar</a><a href="/nepse-trending/">Trending Stocks</a><a href="/nepse-value/">Value Investing</a><a href="/nepse-brokers/">Broker Analytics</a><a href="/nepse-sectors/">Sectors</a><a href="/nepse-news/">Market news</a><a href="/nepse-watchlist/">Watchlist</a><a href="/nepse-portfolio/">Portfolio</a><a href="/nepse-simulator/">Simulator</a><a href="/nepse-reports/">Reports</a><a href="/nepse-actions/">Corp. actions</a></nav>
    <p class="d2-side-foot">Free forever · no login</p>
  </aside>

  <main class="d2-main" id="main">
    <div class="d2-wrap">
<div class="d2-fresh-mount"><div data-freshness-badge></div></div>

<p style="color:var(--muted);font-size:.9rem;margin-bottom:4px">Nepse Decode &middot; Chart &amp; signals &middot; rule-based, no black boxes</p>
<h1 style="font-family:var(--serif);font-size:2rem;margin:0 0 6px">${data.title}</h1>
<p style="color:var(--ink-soft);max-width:640px">${data.tagline}</p>

<div class="sig-grid">${cards}</div>

<div class="note">${NOTES[sys] || ''}</div>

<div class="note" lang="ne"><strong>संक्षेप।</strong> ${NEPALI[sys] || ''}</div>

<div class="note"><strong>How to read this.</strong> Every number below comes from a mechanical replay of these exact rules on historical NEPSE data (${st.backtest_from} to ${st.backtest_to}, ${data.universe_symbols} symbols, Rs 1 Cr portfolio, max 10 positions, ${data.costs}). Nothing is hand-picked. Past performance does not predict future results.</div>

<h2 style="font-family:var(--serif);margin-top:28px">Open alerts — positions the system holds right now</h2>
<p style="color:var(--muted);font-size:.9rem">Entry is taken at the signal day's close. Stops and targets are fixed at entry; the trail updates with price. Progress shows how far the trade has moved toward Target 2.</p>
<div class="scrollx"><table class="sig-table" id="alerts"><thead><tr>
<th>Date</th><th>Symbol</th><th>Alert</th><th>Entry</th><th>Stop loss</th><th>Trail stop</th><th>Target 1</th><th>Target 2</th><th>Current</th><th>Unrealized</th><th>Progress</th>
</tr></thead><tbody><tr><td colspan="11">Loading…</td></tr></tbody></table></div>

<h2 class="nd-section-head" style="margin-top:28px"><h2 style="font-family:var(--serif)">Trade profile</h2></h2>
<div class="scrollx"><table class="sig-table">
<tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr>
<tr><td>Total return</td><td><strong>${pct(st.total_return_pct)}</strong></td><td>Capital multiple</td><td><strong>&times;${fmt(st.capital_multiple)}</strong></td></tr>
<tr><td>Benchmark (NEPSE buy &amp; hold)</td><td>${pct(st.benchmark_cagr_pct)} / yr</td><td>Alpha</td><td>${pct(st.alpha_pct)} / yr</td></tr>
<tr><td>Total trades</td><td>${st.total_trades}</td><td>Win rate</td><td>${pct(st.win_rate_pct)}</td></tr>
<tr><td>Profit factor</td><td>${fmt(st.profit_factor)}</td><td>Avg win / avg loss</td><td>${pct(st.avg_win_pct)} / ${pct(st.avg_loss_pct)}</td></tr>
<tr><td>Sharpe (monthly)</td><td>${fmt(st.sharpe)}</td><td>Sortino</td><td>${fmt(st.sortino)}</td></tr>
<tr><td>Max drawdown</td><td>${pct(st.max_drawdown_pct)}</td><td>Avg holding</td><td>${fmt(st.avg_holding_days, 0)} days</td></tr>
<tr><td>Best trade</td><td>${st.best_trade ? st.best_trade.symbol + ' ' + pct(st.best_trade.pnl_pct) : '–'}</td><td>Worst trade</td><td>${st.worst_trade ? st.worst_trade.symbol + ' ' + pct(st.worst_trade.pnl_pct) : '–'}</td></tr>
<tr><td>Charges paid</td><td>${money(st.charges_paid)}</td><td>Backtest window</td><td>${st.backtest_from} &rarr; ${st.backtest_to}</td></tr>
</table></div>

<h2 style="font-family:var(--serif);margin-top:28px">Live track record — forward-tested signals</h2>
<p style="color:var(--muted);font-size:.9rem">Real paper trades from live BUY alerts, tracked daily and updated automatically. Win = hit target, Loss = hit stop, Time exit = closed after 20 days. Every closed trade appears below — nothing is hand-picked.</p>
<div class="sig-grid" id="live-stat-cards" style="margin:16px 0"></div>
<div class="scrollx"><table class="sig-table" id="live-track-table">
<thead><tr><th>Metric</th><th class="num">Value</th><th>Metric</th><th class="num">Value</th></tr></thead>
<tbody id="live-track-body"><tr><td colspan="4">Loading live track record...</td></tr></tbody>
</table></div>
<div id="live-open-positions" style="margin-top:16px"></div>
<div id="live-closed-trades" style="margin-top:16px"></div>

<h2 style="font-family:var(--serif);margin-top:28px">Equity curve — Rs 1 Cr through this system</h2>
<canvas id="eqchart"></canvas>

<h2 style="font-family:var(--serif);margin-top:28px">The rules (exactly as coded)</h2>
<div class="rules"><ol>${rules}</ol></div>

<h2 style="font-family:var(--serif);margin-top:28px">About this system</h2>
<div class="rules"><p>${data.title} is one of Nepse Decode's transparent signal systems, run by the Alpha Lab engine. Every rule above is public — there is no hidden model and no "AI prediction". Signals are generated mechanically from daily OHLCV data (corporate-action adjusted); a stock appears here only if it passes every filter, including a Rs 10 lakh average-turnover liquidity bar. This page is educational and is not investment advice.</p></div>

${GLOSSARY}

<p style="color:var(--muted);font-size:.85rem;margin:32px 0">Data: daily NEPSE OHLCV, corporate-action adjusted. Generated ${new Date().toISOString().slice(0, 10)}. Educational only — not investment advice.</p>
    </div>
  </main>
</div>
<script>
(function(){
  var sys = ${JSON.stringify(sys)};
  fetch('/nepse-chart/data/signals/' + sys + '.json').then(function(r){return r.json()}).then(function(d){
    // alerts
    var tb = document.querySelector('#alerts tbody');
    if (!d.alerts.length) { tb.innerHTML = '<tr><td colspan="11">No open positions right now — the system is flat.</td></tr>'; }
    else tb.innerHTML = d.alerts.map(function(a){
      var pnl = a.unrealized_pct >= 0 ? '+' + a.unrealized_pct + '%' : a.unrealized_pct + '%';
      var cls = a.unrealized_pct >= 0 ? 'color:var(--up)' : 'color:var(--down)';
      return '<tr><td>' + a.date + '</td><td><strong>' + a.symbol + '</strong></td>' +
        '<td><span class="tag entry">' + a.alert + '</span></td>' +
        '<td>' + a.entry.toLocaleString() + '</td><td>' + a.stop_loss.toLocaleString() + '</td>' +
        '<td>' + a.trail_stop.toLocaleString() + '</td><td>' + a.target_1.toLocaleString() + '</td>' +
        '<td>' + a.target_2.toLocaleString() + '</td><td>' + a.current.toLocaleString() + '</td>' +
        '<td style="' + cls + '">' + pnl + '</td>' +
        '<td><div class="prog"><i style="width:' + Math.min(100, a.progress) + '%"></i></div></td></tr>';
    }).join('');
    // Live track record
    var ltr = d.live_track_record;
    var ltb = document.getElementById('live-track-body');
    var lsc = document.getElementById('live-stat-cards');
    if (ltr && ltr.stats && ltb) {
      var s = ltr.stats;
      var wrCls = s.win_rate_pct >= 50 ? 'up' : 'down';
      // Stat cards (design-rich, matching page style)
      if (lsc) {
        lsc.innerHTML =
          '<div class="sig-card ' + wrCls + '"><div class="sig-card-l">Live win rate</div><div class="sig-card-v">' + s.win_rate_pct + '%</div></div>' +
          '<div class="sig-card"><div class="sig-card-l">Signals tracked</div><div class="sig-card-v">' + s.total_signals + '</div></div>' +
          '<div class="sig-card up"><div class="sig-card-l">Wins</div><div class="sig-card-v">' + s.wins + '</div></div>' +
          '<div class="sig-card down"><div class="sig-card-l">Losses</div><div class="sig-card-v">' + s.losses + '</div></div>';
      }
      var wrTxtCls = s.win_rate_pct >= 50 ? 'color:var(--up)' : 'color:var(--down)';
      ltb.innerHTML =
        '<tr><td>Live win rate</td><td class="num" style="' + wrTxtCls + '"><strong>' + s.win_rate_pct + '%</strong></td>' +
        '<td>Signals tracked</td><td class="num">' + s.total_signals + '</td></tr>' +
        '<tr><td>Wins</td><td class="num" style="color:var(--up)">' + s.wins + '</td>' +
        '<td>Losses</td><td class="num" style="color:var(--down)">' + s.losses + '</td></tr>' +
        '<tr><td>Avg win</td><td class="num" style="color:var(--up)">+' + s.avg_win_pct + '%</td>' +
        '<td>Avg loss</td><td class="num" style="color:var(--down)">' + s.avg_loss_pct + '%</td></tr>' +
        '<tr><td>Profit factor</td><td class="num">' + s.profit_factor + '</td>' +
        '<td>Open positions</td><td class="num">' + s.open_positions + '</td></tr>';
      var lop = document.getElementById('live-open-positions');
      if (lop && ltr.open_positions && ltr.open_positions.length) {
        lop.innerHTML = '<h3 style="font-family:var(--serif);font-size:1.1rem;margin:0 0 8px">Currently tracking (' + ltr.open_positions.length + ')</h3>' +
          '<div class="scrollx"><table class="sig-table"><thead><tr><th>Symbol</th><th class="num">Entry date</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">Target</th><th class="num">Current</th><th class="num">Unrealized</th><th class="num">Days</th></tr></thead><tbody>' +
          ltr.open_positions.map(function(t){
            var cls = t.unrealized_pct >= 0 ? 'color:var(--up)' : 'color:var(--down)';
            var sign = t.unrealized_pct >= 0 ? '+' : '';
            return '<tr><td><strong>' + t.symbol + '</strong></td><td class="num">' + (t.entry_date || '–') + '</td><td class="num">' + t.entry_price.toLocaleString() + '</td><td class="num">' + (t.stop_loss ? t.stop_loss.toLocaleString() : '–') + '</td><td class="num">' + (t.target_1 ? t.target_1.toLocaleString() : '–') + '</td><td class="num">' + t.current_price.toLocaleString() + '</td><td class="num" style="' + cls + '"><strong>' + sign + t.unrealized_pct + '%</strong></td><td class="num">' + t.hold_days + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      } else if (lop) {
        lop.innerHTML = '<p style="color:var(--muted);font-size:.9rem">No open positions being tracked right now.</p>';
      }
      // Recent closed — ALL trades, auto-updating (no fixed limit)
      var lct = document.getElementById('live-closed-trades');
      if (lct && ltr.recent_closed && ltr.recent_closed.length) {
        lct.innerHTML = '<h3 style="font-family:var(--serif);font-size:1.1rem;margin:0 0 8px">Closed trades (' + ltr.recent_closed.length + ') — auto-updating</h3>' +
          '<div class="scrollx"><table class="sig-table"><thead><tr><th>Symbol</th><th class="num">Entry date</th><th class="num">Exit date</th><th class="num">Entry</th><th class="num">Exit</th><th>Exit reason</th><th class="num">P&L</th></tr></thead><tbody>' +
          ltr.recent_closed.map(function(t){
            var cls = t.pnl_pct >= 0 ? 'color:var(--up)' : 'color:var(--down)';
            var sign = t.pnl_pct >= 0 ? '+' : '';
            var oc = t.outcome === 'win' ? 'rp-win' : (t.outcome === 'loss' ? 'rp-loss' : 'rp-trail');
            var reason = t.exit_reason || t.outcome || '–';
            return '<tr><td><strong>' + t.symbol + '</strong></td><td class="num">' + (t.entry_date || '–') + '</td><td class="num">' + (t.exit_date || '–') + '</td><td class="num">' + t.entry_price.toLocaleString() + '</td><td class="num">' + t.exit_price.toLocaleString() + '</td><td><span class="rpill ' + oc + '">' + reason + '</span></td><td class="num" style="' + cls + '"><strong>' + sign + t.pnl_pct + '%</strong></td></tr>';
          }).join('') + '</tbody></table></div>';
      } else if (lct) {
        lct.innerHTML = '<p style="color:var(--muted);font-size:.9rem">No closed trades yet — they will appear here automatically as signals complete.</p>';
      }
    } else {
      if (ltb) ltb.innerHTML = '<tr><td colspan="4">No live signals tracked yet — check back after the next rebuild.</td></tr>';
      if (lsc) lsc.innerHTML = '';
    }
    // equity curve
    var cv = document.getElementById('eqchart'), ctx = cv.getContext('2d');
    var W = cv.width = cv.offsetWidth * 2, H = cv.height = 560;
    var pts = d.stats.equity_curve;
    if (pts && pts.length > 1) {
      var vs = pts.map(function(p){return p.v});
      var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
      var X = function(i){ return 60 + i * (W - 90) / (pts.length - 1); };
      var Y = function(v){ return H - 40 - (v - mn) / (mx - mn) * (H - 80); };
      var darkMode = document.documentElement.getAttribute('data-theme') === 'dark';
      var cGrid = darkMode ? 'rgba(245,241,230,.14)' : '#E7DFCE';
      var cLine = darkMode ? '#55b183' : '#0B3D2E';
      var cText = darkMode ? '#99917c' : '#8A8474';
      ctx.strokeStyle = cGrid; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(60, Y(10000000)); ctx.lineTo(W - 30, Y(10000000)); ctx.stroke();
      ctx.strokeStyle = cLine; ctx.lineWidth = 3; ctx.beginPath();
      pts.forEach(function(p, i){ i ? ctx.lineTo(X(i), Y(p.v)) : ctx.moveTo(X(i), Y(p.v)); });
      ctx.stroke();
      ctx.fillStyle = cText; ctx.font = '22px Inter';
      ctx.fillText('Rs 1 Cr', 8, Y(10000000) + 8);
      var last = pts[pts.length - 1];
      ctx.fillStyle = cLine; ctx.font = 'bold 24px Inter';
      ctx.fillText('Rs ' + (last.v/10000000).toFixed(2) + ' Cr', W - 190, Y(last.v) - 12);
    }
  }).catch(function(){ document.querySelector('#alerts tbody').innerHTML = '<tr><td colspan="11">Could not load signal data.</td></tr>'; });
})();
</script>
<script>
// Closed history: client-side pagination with page-size selector.
(function(){
  var body = document.getElementById('closed-body');
  var sizeSel = document.getElementById('closed-size');
  var info = document.getElementById('closed-info');
  var prev = document.getElementById('closed-prev');
  var next = document.getElementById('closed-next');
  if (!body || !sizeSel) return;
  var rows = Array.prototype.slice.call(body.rows);
  var page = 0;
  function size(){ return parseInt(sizeSel.value, 10) || 50; }
  function pages(){ return Math.max(1, Math.ceil(rows.length / size())); }
  function render(){
    var s = size(), p = pages();
    if (page >= p) page = p - 1;
    if (page < 0) page = 0;
    var lo = page * s, hi = Math.min(lo + s, rows.length);
    rows.forEach(function(r, i){ r.style.display = (i >= lo && i < hi) ? '' : 'none'; });
    if (info) info.textContent = rows.length ? ('Showing ' + (lo + 1) + '–' + hi + ' of ' + rows.length + ' trades') : 'No trades';
    if (prev) prev.disabled = page === 0;
    if (next) next.disabled = page >= p - 1;
    [prev, next].forEach(function(b){ if (b) b.style.opacity = b.disabled ? '.45' : '1'; });
  }
  sizeSel.addEventListener('change', function(){ page = 0; render(); });
  if (prev) prev.addEventListener('click', function(){ if (page > 0){ page--; render(); } });
  if (next) next.addEventListener('click', function(){ if (page < pages() - 1){ page++; render(); } });
  render();
})();
</script>
<style>
.sf{border-top:1px solid var(--hairline,#E7DFCE);margin-top:64px;background:var(--paper,#FAF8F2);color:var(--ink-soft,#4A463C);font-family:var(--sans,Inter,system-ui,-apple-system,"Segoe UI",sans-serif)}
.sf-inner{max-width:1200px;margin:0 auto;padding:56px 24px 30px}
.sf-top{display:flex;gap:18px;align-items:flex-start;margin-bottom:42px}
.sf-mark{width:46px;height:46px;border-radius:12px;flex:none;box-shadow:0 2px 10px rgba(11,61,46,.12)}
.sf-name{font-weight:700;font-size:1.06rem;color:var(--ink,#1C1A15);margin:2px 0 8px;letter-spacing:.01em}
.sf-mission{margin:0;max-width:62ch;line-height:1.75;font-size:.92rem;color:var(--ink-soft,#4A463C)}
.sf-cols{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:36px 28px;margin-bottom:42px}
.sf-col h3{font-size:.76rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#8A8474);margin:0 0 16px;font-weight:700}
.sf-col ul{list-style:none;margin:0;padding:0;display:grid;gap:11px}
.sf-col a{color:var(--ink-soft,#4A463C);text-decoration:none;font-size:.92rem;line-height:1.5}
.sf-col a:hover{color:var(--green-900,#0B3D2E);text-decoration:underline}
.sf-note{border-top:1px solid var(--hairline,#E7DFCE);padding-top:26px;font-size:.85rem;line-height:1.75;color:var(--muted,#8A8474);max-width:88ch;margin:0}
.sf-note strong{color:var(--ink-soft,#4A463C)}
.sf-bottom{display:flex;flex-wrap:wrap;gap:10px 20px;justify-content:space-between;align-items:center;margin-top:26px;padding-top:22px;border-top:1px solid var(--hairline,#E7DFCE);font-size:.85rem;color:var(--muted,#8A8474)}
.sf-bottom a{color:var(--ink-soft,#4A463C);text-decoration:none;font-weight:600}
.sf-bottom a:hover{color:var(--green-900,#0B3D2E);text-decoration:underline}
.sf-social{display:flex;gap:16px;align-items:center}
@media(max-width:820px){.sf-cols{grid-template-columns:repeat(2,minmax(0,1fr));gap:32px 20px}}
@media(max-width:520px){.sf-inner{padding:44px 20px 26px}.sf-top{margin-bottom:34px}.sf-cols{margin-bottom:34px}}
</style>
<footer class="sf" aria-label="Nepse Decode site footer">
  <div class="sf-inner">
    <div class="sf-top">
      <svg class="sf-mark" viewBox="0 0 64 64" role="img" aria-label="Nepse Decode iceberg mark"><rect width="64" height="64" rx="14" fill="#013E2E"/><polygon points="32,9 21,25 43,25" fill="#FFFFFF"/><polygon points="32,9 37,25 27,25" fill="#EEF2EF"/><polygon points="13,27.5 51,27.5 45,42 32,57 21,45 15,37" fill="#FFFFFF"/><polygon points="13,27.5 27,27.5 21,45 15,37" fill="#D6DDD9"/><polygon points="51,27.5 45,42 38,27.5" fill="#C6CECA"/><polygon points="32,57 45,42 36,40 28,49" fill="#E4E9E6"/><polygon points="21,45 32,57 28,49 24,44" fill="#D6DDD9"/><rect x="4" y="25" width="56" height="2.6" rx="1.3" fill="#0B3D2E" opacity=".55"/></svg>
      <div>
        <p class="sf-name">Nepse Decode</p>
        <p class="sf-mission">Free, honest NEPSE intelligence for every Nepali investor — live market data, screeners, signals and research, rebuilt every trading day. No login, no paywall, no buy calls.</p>
      </div>
    </div>
    <nav class="sf-cols" aria-label="Footer sections">
      <div class="sf-col">
        <h3>Tools</h3>
        <ul>
          <li><a href="/nepse-screener/">Stock Screener</a></li>
          <li><a href="/nepse-chart/">Chart</a></li>
          <li><a href="/nepse-trending/">Trending Stocks</a></li>
          <li><a href="/nepse-value/">Value Investing</a></li>
          <li><a href="/nepse-signals/momentum/">Trading Signals</a></li>
          <li><a href="/nepse-watchlist/">Watchlist</a></li>
        </ul>
      </div>
      <div class="sf-col">
        <h3>Market data</h3>
        <ul>
          <li><a href="/nepse-decode/">Dashboard</a></li>
          <li><a href="/nepse-brokers/">Broker Analytics</a></li>
          <li><a href="/nepse-sectors/">Sectors</a></li>
          <li><a href="/nepse-news/">Market News</a></li>
          <li><a href="/nepse-actions/">Corp. Actions</a></li>
          <li><a href="/stocks/">All Stocks</a></li>
        </ul>
      </div>
      <div class="sf-col">
        <h3>Research</h3>
        <ul>
          <li><a href="/blog/">Daily Blog</a></li>
          <li><a href="/nepse-decode/">Market Dashboard</a></li>
        </ul>
      </div>
      <div class="sf-col">
        <h3>Company</h3>
        <ul>
          <li><a href="/about.html">About</a></li>
          <li><a href="/contact.html">Contact</a></li>
          <li><a href="/privacy.html">Privacy</a></li>
          <li><a href="https://www.facebook.com/nepsedecode.np" target="_blank" rel="noopener">Facebook Page</a></li>
        </ul>
      </div>
    </nav>
    <p class="sf-note"><strong>Educational use only.</strong> Nothing on this site is investment advice. Prices and figures are compiled from public sources and refreshed every trading day — always verify with your broker before trading.</p>
    <div class="sf-bottom">
      <span>© 2026 Nepse Decode · Built by <a href="/">Shirjan Khadka</a> in Kathmandu, Nepal</span>
      <span class="sf-social"><a href="https://www.facebook.com/nepsedecode.np" target="_blank" rel="noopener">Facebook</a><a href="/blog/">Blog</a><a href="/contact.html">Contact</a></span>
    </div>
  </div>
</footer>
<script src="/js/theme-toggle.js?v=20261001a" defer></script>
</body>
</html>`;
}

for (const sys of SLUGS) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, sys + '.json'), 'utf8'));
  const dir = path.join(OUT, sys);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(sys, data));
  console.log('wrote', path.join(dir, 'index.html'));
}

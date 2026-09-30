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
function money(n) {
  if (!Number.isFinite(n)) return '–';
  if (Math.abs(n) >= 1e7) return 'Rs ' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return 'Rs ' + (n / 1e5).toFixed(2) + ' L';
  return 'Rs ' + Math.round(n).toLocaleString('en-US');
}

function page(sys, data) {
  const st = data.stats;
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

  const NOTES = {
    'momentum': `<strong>What the backtest says.</strong> Over 23 years this rule set compounded at ${pct(st.annual_return_pct)} a year — below NEPSE buy &amp; hold (${pct(st.benchmark_cagr_pct)}), but with a far shallower worst fall (${pct(st.max_drawdown_pct)} vs the index's deep bear markets). It wins only ${pct(st.win_rate_pct)} of trades; it survives on letting winners run to multiples of risk.`,
    'trend-relay': `<strong>What the backtest says.</strong> This patient re-entry system compounded at ${pct(st.annual_return_pct)} a year with the shallowest worst fall of the three (${pct(st.max_drawdown_pct)}). It trades rarely (${st.total_trades} trades in 23 years) and wins ${pct(st.win_rate_pct)} of them — a system for waiting, not for action.`,
    'reversal': `<strong>Read this first.</strong> Over 23 years this system <em>lost</em> money (${pct(st.annual_return_pct)} a year, worst fall ${pct(st.max_drawdown_pct)}). That is itself the finding: on NEPSE, buying oversold dips against the trend has been a losing approach across two decades — sharp knives keep falling. It is published for education, so you can see exactly why, not as something to trade.`,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${data.title} — Nepse Decode Signals</title>
<meta name="description" content="${data.title}: transparent rule-based NEPSE trading system. ${data.tagline} Backtested ${st.backtest_from} to ${st.backtest_to} — annual return ${pct(st.annual_return_pct)}, win rate ${pct(st.win_rate_pct)}. Educational only, not investment advice.">
<link rel="canonical" href="https://shirjankhadka.com.np/nepse-signals/${sys}/">
<link rel="stylesheet" href="/css/nepse-design-system.css">
<style>
.sig-tabs{display:flex;gap:4px;border-bottom:2px solid var(--hairline);margin:0 0 24px;flex-wrap:wrap}
.sig-tabs a{padding:10px 18px;color:var(--ink-soft);text-decoration:none;font-weight:600;border-bottom:3px solid transparent;margin-bottom:-2px}
.sig-tabs a.active{color:var(--green-900);border-bottom-color:var(--green-900)}
.sig-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:20px 0}
@media(min-width:760px){.sig-grid{grid-template-columns:repeat(4,1fr)}}
.sig-card{background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md);padding:14px 16px}
.sig-card-l{font-size:.78rem;color:var(--muted);margin-bottom:4px}
.sig-card-v{font-family:var(--serif);font-size:1.35rem;font-weight:700}
.sig-card.up .sig-card-v{color:var(--up)}.sig-card.down .sig-card-v{color:var(--down)}
.sig-table{width:100%;border-collapse:collapse;font-size:.85rem;background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md);overflow:hidden}
.sig-table th,.sig-table td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--hairline-soft);white-space:nowrap}
.sig-table th{background:var(--paper-deep);font-weight:600;color:var(--ink-soft)}
.sig-table tr:last-child td{border-bottom:none}
.tag{display:inline-block;padding:2px 10px;border-radius:var(--r-pill);font-size:.75rem;font-weight:600}
.tag.entry{background:var(--green-100);color:var(--green-900)}
.prog{height:6px;background:var(--paper-deep);border-radius:3px;min-width:70px}
.prog i{display:block;height:6px;border-radius:3px;background:var(--green-700)}
.rules{background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md);padding:18px 22px;margin:20px 0}
.rules li{margin:8px 0}
.scrollx{overflow-x:auto;margin:16px 0}
.note{background:var(--gold-soft);border:1px solid var(--hairline);border-radius:var(--r-md);padding:14px 18px;margin:20px 0;font-size:.9rem}
#eqchart{width:100%;height:280px;background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md)}
</style>
</head>
<body class="nd">
<main style="max-width:1080px;margin:0 auto;padding:24px 16px">
<nav class="sig-tabs" aria-label="Signal systems">${tabs}</nav>

<p style="color:var(--muted);font-size:.9rem;margin-bottom:4px">Nepse Decode &middot; Chart &amp; signals &middot; rule-based, no black boxes</p>
<h1 style="font-family:var(--serif);font-size:2rem;margin:0 0 6px">${data.title}</h1>
<p style="color:var(--ink-soft);max-width:640px">${data.tagline}</p>

<div class="sig-grid">${cards}</div>

<div class="note">${NOTES[sys] || ''}</div>

<div class="note"><strong>How to read this.</strong> Every number below comes from a mechanical replay of these exact rules on historical NEPSE data (${st.backtest_from} to ${st.backtest_to}, ${data.universe_symbols} symbols, Rs 1 Cr portfolio, max 10 positions, ${data.costs}). Nothing is hand-picked. Past performance does not predict future results.</div>

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

<h2 style="font-family:var(--serif);margin-top:28px">Equity curve — Rs 1 Cr through this system</h2>
<canvas id="eqchart"></canvas>

<h2 style="font-family:var(--serif);margin-top:28px">The rules (exactly as coded)</h2>
<div class="rules"><ol>${rules}</ol></div>

<h2 style="font-family:var(--serif);margin-top:28px">Open alerts — positions the system holds right now</h2>
<p style="color:var(--muted);font-size:.9rem">Entry is taken at the signal day's close. Stops and targets are fixed at entry; the trail updates with price. Progress shows how far the trade has moved toward Target 2.</p>
<div class="scrollx"><table class="sig-table" id="alerts"><thead><tr>
<th>Date</th><th>Symbol</th><th>Alert</th><th>Entry</th><th>Stop loss</th><th>Trail stop</th><th>Target 1</th><th>Target 2</th><th>Current</th><th>Unrealized</th><th>Progress</th>
</tr></thead><tbody><tr><td colspan="11">Loading…</td></tr></tbody></table></div>

<h2 style="font-family:var(--serif);margin-top:28px">About this system</h2>
<div class="rules"><p>${data.title} is one of Nepse Decode's transparent signal systems, run by the Alpha Lab engine. Every rule above is public — there is no hidden model and no "AI prediction". Signals are generated mechanically from daily OHLCV data (corporate-action adjusted); a stock appears here only if it passes every filter, including a Rs 10 lakh average-turnover liquidity bar. This page is educational and is not investment advice.</p></div>

<p style="color:var(--muted);font-size:.85rem;margin:32px 0">Data: daily NEPSE OHLCV, corporate-action adjusted. Generated ${new Date().toISOString().slice(0, 10)}. Educational only — not investment advice.</p>
</main>
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
    // equity curve
    var cv = document.getElementById('eqchart'), ctx = cv.getContext('2d');
    var W = cv.width = cv.offsetWidth * 2, H = cv.height = 560;
    var pts = d.stats.equity_curve;
    if (pts && pts.length > 1) {
      var vs = pts.map(function(p){return p.v});
      var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
      var X = function(i){ return 60 + i * (W - 90) / (pts.length - 1); };
      var Y = function(v){ return H - 40 - (v - mn) / (mx - mn) * (H - 80); };
      ctx.strokeStyle = '#E7DFCE'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(60, Y(10000000)); ctx.lineTo(W - 30, Y(10000000)); ctx.stroke();
      ctx.strokeStyle = '#0B3D2E'; ctx.lineWidth = 3; ctx.beginPath();
      pts.forEach(function(p, i){ i ? ctx.lineTo(X(i), Y(p.v)) : ctx.moveTo(X(i), Y(p.v)); });
      ctx.stroke();
      ctx.fillStyle = '#8A8474'; ctx.font = '22px Inter';
      ctx.fillText('Rs 1 Cr', 8, Y(10000000) + 8);
      var last = pts[pts.length - 1];
      ctx.fillStyle = '#0B3D2E'; ctx.font = 'bold 24px Inter';
      ctx.fillText('Rs ' + (last.v/10000000).toFixed(2) + ' Cr', W - 190, Y(last.v) - 12);
    }
  }).catch(function(){ document.querySelector('#alerts tbody').innerHTML = '<tr><td colspan="11">Could not load signal data.</td></tr>'; });
})();
</script>
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

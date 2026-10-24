/* Broker Zero-Sum Analysis — page logic.
   Data: /data/broker-zero-sum-{window}.json (one file per window),
   built by tools/build-broker-zero-sum.py (schema nd-broker-zero-sum/v1).
   Every buy has an equal sell: per stock and window, broker nets cancel to zero. */
'use strict';

const $ = id => document.getElementById(id);
const fmtInt = n => Number(n || 0).toLocaleString('en-IN');
const fmtMoney = v => {
  const x = Math.abs(v || 0);
  const sign = v < 0 ? '−' : '+';
  if (x >= 1e9) return sign + 'Rs ' + (x / 1e9).toFixed(2) + ' arab';
  if (x >= 1e7) return sign + 'Rs ' + (x / 1e7).toFixed(2) + ' crore';
  if (x >= 1e5) return sign + 'Rs ' + (x / 1e5).toFixed(2) + ' lakh';
  return sign + 'Rs ' + fmtInt(Math.round(x));
};
const fmtAbs = v => fmtMoney(v).replace(/^[+−]/, '');
const fmtQtySigned = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtInt(Math.abs(v || 0));
const fmtRate = v => v == null ? '—' : 'Rs ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stanceLabel = st => st === 'ACCUMULATING' ? 'Accumulating' : st === 'DISTRIBUTING' ? 'Distributing' : 'Flat';
const stanceClass = st => st === 'ACCUMULATING' ? 'zs-pos' : st === 'DISTRIBUTING' ? 'zs-neg' : '';

const WINDOWS = [1, 7, 15, 30, 90, 180, 365];
const STATE = { window: 30, data: null, cache: {}, symbol: null };

function statCard(k, v, s) {
  return '<div class="cx-stat"><p class="cx-stat-k">' + k + '</p><p class="cx-stat-v">' + v + '</p><p class="cx-stat-s">' + s + '</p></div>';
}
function brokerLabel(code, brokers) {
  const name = brokers && brokers[code];
  return '<span class="zs-broker">' + esc(code) + '</span>' + (name ? '<span class="zs-bname">' + esc(name) + '</span>' : '');
}

function renderMarket(d) {
  const m = d.market;
  $('zsSession').textContent = 'Tape through ' + d.asof + ' · ' + d.days + '-day window (' + d.window_start + ' → ' + d.window_end + ') · ' + d.sessions_in_window + ' sessions' + (d.partial ? ' · partial — archive starts ' + d.archive_start : '');
  $('statStrip').innerHTML = [
    statCard('Turnover in window', fmtAbs(m.total_turnover), 'Traded value, ' + (d.days === 1 ? 'the session' : d.days + ' calendar days') + ' · ' + fmtInt(m.total_buy_qty) + ' shares'),
    statCard('The zero sum, verified', fmtInt(m.total_buy_qty), 'Shares bought = shares sold, exactly · Σ broker nets = 0 · ' + (m.identity_verified ? 'identity verified on this tape' : 'identity check pending')),
    statCard('Stocks traded', fmtInt(m.symbols_traded), 'Stocks with broker flow in the window'),
    statCard('Brokers active', fmtInt(m.brokers_active), 'Brokers on the window tape'),
    statCard('Stocks with a cohort net', fmtInt(m.accumulating + m.distributing), m.accumulating + ' accumulating · ' + m.distributing + ' distributing · ' + m.flat + ' flat')
  ].join('');

  const tot = Math.max(1, m.accumulating + m.distributing + m.flat);
  $('stanceDist').innerHTML =
    '<div class="zs-dist-bar">' +
    '<i style="width:' + (100 * m.accumulating / tot) + '%;background:var(--nd-up)"></i>' +
    '<i style="width:' + (100 * m.distributing / tot) + '%;background:var(--nd-down)"></i>' +
    '<i style="width:' + (100 * m.flat / tot) + '%;background:var(--nd-border-2)"></i></div>' +
    '<div class="zs-dist-legend">' +
    '<span><span class="zs-dot" style="background:var(--nd-up)"></span>Accumulating <b>' + fmtInt(m.accumulating) + '</b></span>' +
    '<span><span class="zs-dot" style="background:var(--nd-down)"></span>Distributing <b>' + fmtInt(m.distributing) + '</b></span>' +
    '<span><span class="zs-dot" style="background:var(--nd-border-2)"></span>Flat <b>' + fmtInt(m.flat) + '</b></span></div>';

  const parts = ['Archive: sessions from ' + d.archive_start + ' to ' + d.asof + '.'];
  if (d.gap_dates && d.gap_dates.length) parts.push('Session ' + d.gap_dates.join(', ') + ' has broker totals but no per-stock detail (source gap) — per-stock windows spanning it rest on the sessions the archive holds; market totals are unaffected.');
  if (d.partial) parts.push('This window reaches before the archive start, so it covers ' + d.sessions_in_window + ' sessions only and is marked partial.');
  else parts.push('This window covers ' + d.sessions_in_window + ' sessions.');
  $('coverageNote').textContent = parts.join(' ');
}

function renderTabs() {
  $('winTabs').innerHTML = WINDOWS.map(w =>
    '<button type="button" role="tab" data-win="' + w + '"' + (w === STATE.window ? ' class="on"' : '') + ' aria-pressed="' + (w === STATE.window) + '">' + w + 'D</button>').join('');
  Array.prototype.forEach.call(document.querySelectorAll('#winTabs button'), btn => {
    btn.addEventListener('click', () => loadWindow(Number(btn.getAttribute('data-win'))).catch(err => console.error(err)));
  });
}

function renderBoard(d) {
  $('boardBody').innerHTML = d.board.map((r, i) => '<tr class="zs-rowlink" data-sym="' + esc(r.symbol) + '" tabindex="0">' +
      '<td class="num">' + (i + 1) + '</td>' +
      '<td><span class="zs-broker">' + esc(r.symbol) + '</span>' + (r.name ? '<span class="zs-bname">' + esc(r.name) + '</span>' : '') + '</td>' +
      '<td>' + esc(r.sector || '—') + '</td>' +
      '<td><span class="zs-stance ' + stanceClass(r.stance) + '">' + stanceLabel(r.stance) + '</span></td>' +
      '<td class="num">' + fmtQtySigned(r.net_qty) + '</td>' +
      '<td class="num ' + stanceClass(r.stance) + '">' + fmtMoney(r.net_amt) + '</td>' +
      '<td class="num">' + fmtInt(r.total_qty) + '</td>' +
      '<td class="num">' + fmtAbs(r.total_amt) + '</td></tr>'
  ).join('') || '<tr><td colspan="8" class="zs-loading">No rows.</td></tr>';
  $('boardCount').textContent = d.board.length + ' stocks · window ' + d.days + 'D · click a row to open its detail above';
  Array.prototype.forEach.call(document.querySelectorAll('#boardBody tr[data-sym]'), tr => {
    const go = () => selectSymbol(tr.getAttribute('data-sym'), true);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

function sideTable(rows, brokers) {
  if (!rows.length) return '<tr><td colspan="5" class="zs-loading">No brokers on this side.</td></tr>';
  return rows.map(r => '<tr>' +
    '<td>' + brokerLabel(r.broker, brokers) + '</td>' +
    '<td class="num">' + fmtInt(r.qty) + '</td>' +
    '<td class="num">' + fmtRate(r.avg) + '</td>' +
    '<td class="num ' + (r.net >= 0 ? 'zs-pos' : 'zs-neg') + '">' + fmtQtySigned(r.net) + '</td>' +
    '<td class="num"><span class="zs-share"><span class="zs-share-track"><i style="width:' + Math.min(100, r.percent) + '%"></i></span>' + Number(r.percent).toFixed(1) + '%</span></td></tr>').join('');
}

/* holders/distributors rows are arrays: [broker, net_qty, net_amt, buy_qty, sell_qty] */
function flowTable(rows, brokers) {
  if (!rows.length) return '<tr><td colspan="5" class="zs-loading">No brokers on this side.</td></tr>';
  return rows.map(r => '<tr>' +
    '<td>' + brokerLabel(r[0], brokers) + '</td>' +
    '<td class="num">' + fmtInt(r[3]) + '</td>' +
    '<td class="num">' + fmtInt(r[4]) + '</td>' +
    '<td class="num ' + (r[1] >= 0 ? 'zs-pos' : 'zs-neg') + '">' + fmtQtySigned(r[1]) + '</td>' +
    '<td class="num ' + (r[2] >= 0 ? 'zs-pos' : 'zs-neg') + '">' + fmtMoney(r[2]) + '</td></tr>').join('');
}

function cohortCard(c, sideWord, brokers, sector) {
  if (!c) return '<article class="zs-cohort"><h4>' + (sideWord === 'buyers' ? 'Accumulators' : 'Distributors') + '</h4><p class="zs-cohort-sub">No cohort on this side.</p></article>';
  const chips = c.brokers.map(code => '<li title="' + esc(brokers && brokers[code] ? brokers[code] : '') + '">' + esc(code) + '</li>').join('');
  return '<article class="zs-cohort"><h4>' + (sideWord === 'buyers' ? 'Accumulators' : 'Distributors') + '</h4>' +
    '<p class="zs-cohort-sub">' + c.count + ' broker' + (c.count === 1 ? '' : 's') + ' — the strongest net ' + sideWord + ' of the window (top decile by |net|).</p>' +
    '<ul class="zs-brokers">' + chips + '</ul>' +
    '<div class="zs-kv"><span>Gross ' + (sideWord === 'buyers' ? 'bought' : 'sold') + '</span><b>' + fmtInt(c.tot_qty) + ' shares</b></div>' +
    '<div class="zs-kv"><span>Value</span><b>' + fmtAbs(c.tot_amt) + '</b></div>' +
    '<div class="zs-kv"><span>Average rate</span><b>' + fmtRate(c.avg_rate) + '</b></div>' +
    '<div class="zs-kv"><span>Sector rank by cohort ' + (sideWord === 'buyers' ? 'buy' : 'sell') + ' value</span><b>' + (c.rank ? '#' + c.rank + ' in ' + esc(sector || 'its sector') : '—') + '</b></div></article>';
}

function renderDetail(d, sym) {
  const s = d.symbols[sym];
  if (!s) return;
  const sm = s.summary;
  $('detailHead').innerHTML =
    '<span class="zs-sym">' + esc(sym) + '</span>' +
    '<span class="zs-name">' + esc(s.name || '') + '</span>' +
    '<span class="zs-chip zs-chip-sector">' + esc(s.sector || '—') + '</span>' +
    '<span class="zs-chip ' + (s.stance === 'ACCUMULATING' ? 'zs-chip-acc' : s.stance === 'DISTRIBUTING' ? 'zs-chip-dist' : '') + '">' + stanceLabel(s.stance) + '</span>';

  $('detailStats').innerHTML = [
    statCard('Traded in window', fmtAbs(sm.total_buy_amt), fmtInt(sm.total_buy_qty) + ' shares changed hands'),
    statCard('Brokers net long', fmtInt(sm.buyers_count), fmtInt(sm.sellers_count) + ' net short · ' + fmtInt(sm.flat_count) + ' flat · ' + fmtInt(sm.active_brokers) + ' active'),
    statCard('Cohort net quantity', fmtQtySigned(s.net_qty), 'Accumulator gross buys minus distributor gross sells, in shares')
  ].join('');

  $('cohortFace').innerHTML =
    cohortCard(s.accum, 'buyers', d.brokers, s.sector) +
    '<div class="zs-net"><p class="zs-net-l">Cohort net flow</p><p class="zs-net-v" id="zsNetV">' + fmtMoney(s.net_amt) + '</p><p class="zs-net-s">' + fmtQtySigned(s.net_qty) + ' shares net · ' + stanceLabel(s.stance).toLowerCase() + '</p></div>' +
    cohortCard(s.dist, 'sellers', d.brokers, s.sector);

  const ladder = (s.ladder || []).slice().sort((a, b) => a.days - b.days);
  $('ladderList').innerHTML = ladder.map(L =>
    '<li class="' + (L.days === d.days ? 'zs-lad-cur' : '') + '">' +
    '<p class="zs-lad-d">' + L.days + 'D</p>' +
    '<p class="zs-lad-v ' + (L.net_amt >= 0 ? 'zs-pos' : 'zs-neg') + '">' + fmtMoney(L.net_amt) + '</p>' +
    '<p class="zs-lad-q">' + fmtQtySigned(L.net_qty) + ' shares</p></li>').join('');

  $('buyersBody').innerHTML = sideTable(s.buyers, d.brokers);
  $('sellersBody').innerHTML = sideTable(s.sellers, d.brokers);
  $('holdersBody').innerHTML = flowTable(s.holders, d.brokers);
  $('distributorsBody').innerHTML = flowTable(s.distributors, d.brokers);

  const sel = $('symSel');
  if (sel.value !== sym) sel.value = sym;
}

function renderForward(d) {
  const f = d.forward;
  const sec = $('forward');
  if (!f || !f.accumulating) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  $('forwardSub').textContent = 'The 30-day stance, read at weekly snapshots across the archive, against each stock\'s return over the next 10 sessions (final, corporate-action-adjusted closes). Measured on our own tape — description, not prediction.';
  const row = (label, a) => a && a.n ? '<tr><td>' + label + '</td><td class="num">' + fmtInt(a.n) + '</td>' +
    '<td class="num ' + (a.mean_fwd_pct >= 0 ? 'zs-pos' : 'zs-neg') + '">' + (a.mean_fwd_pct >= 0 ? '+' : '−') + Math.abs(a.mean_fwd_pct).toFixed(2) + '%</td>' +
    '<td class="num">' + (a.median_fwd_pct >= 0 ? '+' : '−') + Math.abs(a.median_fwd_pct).toFixed(2) + '%</td>' +
    '<td class="num">' + a.share_up_pct.toFixed(1) + '%</td></tr>' : '';
  $('forwardBody').innerHTML = row('Accumulating stance', f.accumulating) + row('Distributing stance', f.distributing);
  const nObs = (f.accumulating.n || 0) + (f.distributing.n || 0) + (f.flat ? f.flat.n || 0 : 0);
  const spread = f.spread_acc_minus_dist_pp;
  $('forwardNote').textContent = 'Weekly ' + f.window_days + '-day stance snapshots, ' + f.era_start + ' → ' + f.era_end + ' (' + f.snapshots + ' snapshots, ' + fmtInt(nObs) + ' stock-snapshots). Spread (accumulating minus distributing), ' + f.horizon_sessions + ' sessions later: ' + (spread == null ? '—' : (spread >= 0 ? '+' : '−') + Math.abs(spread).toFixed(2) + ' percentage points') + '. ' + f.note;
}

function renderHistory(d) {
  const rows = (d.history_recent || []).slice().reverse();
  $('historyBody').innerHTML = rows.map(h => '<tr>' +
    '<td>' + esc(h.asof) + '</td>' +
    '<td class="num">' + fmtAbs(h.total_turnover) + '</td>' +
    '<td class="num">' + fmtInt(h.symbols_traded) + '</td>' +
    '<td class="num">' + fmtInt(h.brokers_active) + '</td>' +
    '<td class="num">' + fmtInt(h.accumulating) + '</td>' +
    '<td class="num">' + fmtInt(h.distributing) + '</td>' +
    '<td>' + (h.top_net_flow || []).map(t => esc(t.symbol)).join(', ') + '</td></tr>').join('')
    || '<tr><td colspan="7" class="zs-loading">The ledger starts with the first published session.</td></tr>';
}

function fillSymbolSelect(d) {
  $('symSel').innerHTML = Object.keys(d.symbols).sort().map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
}

function selectSymbol(sym, scroll) {
  if (!STATE.data || !STATE.data.symbols[sym]) return;
  STATE.symbol = sym;
  renderDetail(STATE.data, sym);
  if (scroll) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadWindow(w) {
  STATE.window = w;
  renderTabs();
  if (!STATE.cache[w]) {
    const r = await fetch('/data/broker-zero-sum-' + w + '.json?v=20261024a', { cache: 'no-cache' });
    if (!r.ok) throw new Error('data fetch failed: ' + r.status);
    STATE.cache[w] = await r.json();
  }
  const d = STATE.cache[w];
  STATE.data = d;
  renderMarket(d);
  renderBoard(d);
  fillSymbolSelect(d);
  renderForward(d);
  renderHistory(d);
  const keep = STATE.symbol && d.symbols[STATE.symbol] ? STATE.symbol : (d.board[0] && d.board[0].symbol);
  if (keep) selectSymbol(keep, false);
}

document.addEventListener('DOMContentLoaded', () => {
  $('symSel').addEventListener('change', e => selectSymbol(e.target.value, false));
  $('symSearch').addEventListener('input', e => {
    const q = e.target.value.trim().toUpperCase();
    if (!q || !STATE.data) return;
    const hit = Object.keys(STATE.data.symbols).find(s => s.indexOf(q) === 0) || Object.keys(STATE.data.symbols).find(s => s.indexOf(q) >= 0);
    if (hit) selectSymbol(hit, false);
  });
  loadWindow(30).catch(err => {
    console.error(err);
    $('boardBody').innerHTML = '<tr><td colspan="8" class="zs-loading">Data is being prepared — please check back after the next market close.</td></tr>';
  });
});

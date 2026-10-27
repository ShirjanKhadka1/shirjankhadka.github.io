/* Broker Zero-Sum Analysis — page logic (teardown rebuild 2026-10-27).
   Data: /data/broker-zero-sum-{window}.json (one file per window),
   built by tools/build-broker-zero-sum.py (schema nd-broker-zero-sum/v1).
   Every buy has an equal sell: per stock and window, broker nets cancel to zero.
   Change-gated 60 s refresh: ticks re-fetch the current window file with
   no-store and re-render ONLY on signature change; only the freshness line
   moves on unchanged ticks; failures keep the old view, never blank it.
   View changes (window tab, stock select/search) re-baseline the signature
   after render — they never null it, so a data change arriving in the first
   tick window after a selection is still noticed (trade-pattern gate lesson).
   Totals here are broker-net sums (buy minus sell), single-counted — the
   period-file ÷2 rule does not apply to this page's inputs. */
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
const esc = s => String(s == null ? '' : s).replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));
const stanceLabel = st => st === 'ACCUMULATING' ? 'Accumulating' : st === 'DISTRIBUTING' ? 'Distributing' : 'Flat';
const stanceClass = st => st === 'ACCUMULATING' ? 'zs-pos' : st === 'DISTRIBUTING' ? 'zs-neg' : '';
const nptTime = () => new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false });

const WINDOWS = [1, 7, 15, 30, 90, 180, 365];
const PER = 25;
const STATE = { window: 30, data: null, cache: {}, symbol: null, sig: null, boardPage: 1, holdPage: 1, distPage: 1, secFilter: 'All', secPage: 1, secData: null };

function statCard(k, v, s) {
  return '<div class="cx-stat"><p class="cx-stat-l">' + k + '</p><p class="cx-stat-v">' + v + '</p><p class="cx-stat-s">' + s + '</p></div>';
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
    '<i style="width:' + (100 * m.flat / tot) + '%;background:var(--nd-flat)"></i></div>' +
    '<div class="zs-dist-legend">' +
    '<span><span class="zs-dot" style="background:var(--nd-up)"></span>Accumulating <b>' + fmtInt(m.accumulating) + '</b></span>' +
    '<span><span class="zs-dot" style="background:var(--nd-down)"></span>Distributing <b>' + fmtInt(m.distributing) + '</b></span>' +
    '<span><span class="zs-dot" style="background:var(--nd-flat)"></span>Flat <b>' + fmtInt(m.flat) + '</b></span></div>';

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
    btn.addEventListener('click', () => loadWindow(Number(btn.getAttribute('data-win'))).catch(() => setFresh('fail', STATE.data)));
  });
}

function pagerHTML(prefix, page, total, showingId) {
  const pages = Math.max(1, Math.ceil(total / PER));
  const p = Math.min(page, pages);
  const from = total ? (p - 1) * PER + 1 : 0;
  const to = Math.min(p * PER, total);
  return '<button type="button" class="zs-pager-prev" data-pager="' + prefix + '" data-dir="-1"' + (p <= 1 ? ' disabled' : '') + '>Prev</button>' +
    '<span class="zs-pager-showing" id="' + showingId + '">Showing ' + from + '–' + to + ' of ' + total + '</span>' +
    '<button type="button" class="zs-pager-next" data-pager="' + prefix + '" data-dir="1"' + (p >= pages ? ' disabled' : '') + '>Next</button>';
}
function bindPagers(root, onPage) {
  Array.prototype.forEach.call(root.querySelectorAll('[data-pager]'), btn => {
    btn.addEventListener('click', () => onPage(btn.getAttribute('data-pager'), Number(btn.getAttribute('data-dir'))));
  });
}

function renderBoard(d) {
  const rows = d.board || [];
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  if (STATE.boardPage > pages) STATE.boardPage = pages;
  const slice = rows.slice((STATE.boardPage - 1) * PER, STATE.boardPage * PER);
  $('boardBody').innerHTML = slice.map((r, i) => '<tr class="zs-rowlink" data-sym="' + esc(r.symbol) + '" tabindex="0">' +
      '<td class="num">' + ((STATE.boardPage - 1) * PER + i + 1) + '</td>' +
      '<td><span class="zs-broker">' + esc(r.symbol) + '</span>' + (r.name ? '<span class="zs-bname">' + esc(r.name) + '</span>' : '') + '</td>' +
      '<td>' + esc(r.sector || '—') + '</td>' +
      '<td><span class="zs-stance ' + stanceClass(r.stance) + '">' + stanceLabel(r.stance) + '</span></td>' +
      '<td class="num">' + fmtQtySigned(r.net_qty) + '</td>' +
      '<td class="num ' + stanceClass(r.stance) + '">' + fmtMoney(r.net_amt) + '</td>' +
      '<td class="num">' + fmtInt(r.total_qty) + '</td>' +
      '<td class="num">' + fmtAbs(r.total_amt) + '</td></tr>'
  ).join('') || '<tr><td colspan="8" class="zs-loading">No rows.</td></tr>';
  $('boardCount').textContent = rows.length + ' stocks · window ' + d.days + 'D · ranked by cohort net flow · click a row to open its detail above';
  $('boardPager').innerHTML = '<div class="zs-pager">' + pagerHTML('board', STATE.boardPage, rows.length, 'boardShowing') + '</div>';
  bindPagers($('boardPager'), (prefix, dir) => {
    STATE.boardPage = Math.max(1, STATE.boardPage + dir);
    renderBoard(STATE.data);
  });
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

function renderHoldDist(d, sym) {
  const s = d.symbols[sym];
  if (!s) return;
  const hold = s.holders || [], dist = s.distributors || [];
  const hp = Math.max(1, Math.ceil(hold.length / PER)), dp = Math.max(1, Math.ceil(dist.length / PER));
  if (STATE.holdPage > hp) STATE.holdPage = hp;
  if (STATE.distPage > dp) STATE.distPage = dp;
  $('holdersBody').innerHTML = flowTable(hold.slice((STATE.holdPage - 1) * PER, STATE.holdPage * PER), d.brokers);
  $('distributorsBody').innerHTML = flowTable(dist.slice((STATE.distPage - 1) * PER, STATE.distPage * PER), d.brokers);
  $('holdPager').innerHTML = hold.length > PER ? '<div class="zs-pager">' + pagerHTML('hold', STATE.holdPage, hold.length, 'holdShowing') + '</div>' : '';
  $('distPager').innerHTML = dist.length > PER ? '<div class="zs-pager">' + pagerHTML('dist', STATE.distPage, dist.length, 'distShowing') + '</div>' : '';
  bindPagers($('holdPager'), (prefix, dir) => { STATE.holdPage = Math.max(1, STATE.holdPage + dir); renderHoldDist(STATE.data, STATE.symbol); });
  bindPagers($('distPager'), (prefix, dir) => { STATE.distPage = Math.max(1, STATE.distPage + dir); renderHoldDist(STATE.data, STATE.symbol); });
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
  STATE.holdPage = 1; STATE.distPage = 1;
  renderHoldDist(d, sym);

  const sel = $('symSel');
  if (sel.value !== sym) sel.value = sym;
  renderSectorMarks();
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
  $('forwardBody').innerHTML = row('Accumulating stance', f.accumulating) + row('Distributing stance', f.distributing) + row('Flat stance', f.flat);
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
  $('symSel').innerHTML = Object.keys(d.symbols).sort().map(s => '<option value="' + esc(s) + '">' + esc(s) + (d.symbols[s].name ? ' — ' + esc(d.symbols[s].name) : '') + '</option>').join('');
}

function selectSymbol(sym, scroll) {
  if (!STATE.data || !STATE.data.symbols[sym]) return;
  STATE.symbol = sym;
  renderDetail(STATE.data, sym);
  /* View change, not data change: re-baseline after render, never null. */
  STATE.sig = signature(STATE.data);
  if (scroll) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function signature(d) {
  if (!d) return 'none';
  const sym = STATE.symbol;
  const rec = sym && d.symbols[sym] ? JSON.stringify(d.symbols[sym]) : '';
  const b0 = d.board && d.board[0] ? d.board[0].symbol + ':' + d.board[0].net_amt : '';
  return [STATE.window, d.asof, d.market.total_turnover, d.market.total_buy_qty, d.board.length, b0, sym || '', rec].join('|');
}

function setFresh(kind, d) {
  const el = $('zsFresh');
  if (!el) return;
  const checked = 'Checked ' + nptTime() + ' NPT · next check in 60 seconds';
  if (kind === 'ok' && d) el.textContent = checked + ' · Tape as of ' + d.asof + ' · ' + d.days + 'D window';
  else if (kind === 'fail' && d) el.textContent = 'Live feed unavailable — showing the last final tape (as of ' + d.asof + ') · ' + checked;
  else if (kind === 'fail') el.textContent = 'Live feed unavailable — tape could not be loaded · ' + checked;
  else el.textContent = checked;
}
function setNotice(text) {
  const n = $('zsNotice');
  if (n) n.textContent = text || '';
}

function renderAll(d) {
  renderMarket(d);
  renderBoard(d);
  fillSymbolSelect(d);
  renderForward(d);
  renderHistory(d);
  const keep = STATE.symbol && d.symbols[STATE.symbol] ? STATE.symbol : (d.board[0] && d.board[0].symbol);
  if (keep) selectSymbol(keep, false);
  else STATE.sig = signature(d);
  setFresh('ok', d);
}

async function fetchWindow(w) {
  const r = await fetch('/data/broker-zero-sum-' + w + '.json?v=20261027a', { cache: 'no-store' });
  if (!r.ok) throw new Error('data fetch failed: ' + r.status);
  return r.json();
}

async function loadWindow(w) {
  STATE.window = w;
  STATE.boardPage = 1;
  renderTabs();
  if (!STATE.cache[w]) STATE.cache[w] = await fetchWindow(w);
  const d = STATE.cache[w];
  STATE.data = d;
  renderAll(d);
  setNotice('');
}

async function tick() {
  if (document.hidden || !STATE.data) return;
  try {
    const d = await fetchWindow(STATE.window);
    STATE.cache[STATE.window] = d;
    const sig = signature(d);
    const changed = STATE.sig !== null && sig !== STATE.sig;
    STATE.data = d;
    if (changed) {
      renderAll(d);
      setNotice('Zero-sum data updated · ' + nptTime() + ' NPT');
    } else {
      STATE.sig = sig;
      setFresh('ok', d);
    }
  } catch (err) {
    /* Failure is surfaced in the freshness line, not the console: a failed
       tick every 60 s must not spam the console. */
    setFresh('fail', STATE.data);
  }
}

/* ---- sector block: counts from verdicts sec, names from universe ---- */
async function loadSectorData() {
  if (STATE.secData) return STATE.secData;
  const [v, u] = await Promise.all([
    fetch('/nepse-chart/data/verdicts.json', { cache: 'no-store' }).then(r => r.json()),
    fetch('/nepse-chart/data/universe.json', { cache: 'no-store' }).then(r => r.json())
  ]);
  const names = {};
  (u.symbols || []).forEach(e => { names[e.s] = e.n; });
  const counts = {};
  Object.values(v.verdicts || {}).forEach(row => {
    const s = row.sec || 'Others';
    counts[s] = (counts[s] || 0) + 1;
  });
  const rows = (u.symbols || []).map(e => ({ s: e.s, n: e.n, sec: (v.verdicts[e.s] && v.verdicts[e.s].sec) || 'Others' }));
  STATE.secData = { names, counts, rows, batch: v.asof, total: rows.length };
  return STATE.secData;
}
function renderSectorMarks() {
  const body = $('zsSecBody');
  if (!body || !STATE.secData) return;
  Array.prototype.forEach.call(body.querySelectorAll('tr[data-sym]'), tr => {
    const on = tr.getAttribute('data-sym') === STATE.symbol;
    tr.classList.toggle('zs-sec-cur', on);
    const mark = tr.querySelector('.zs-sec-mark');
    if (mark) mark.textContent = on ? '●' : '';
  });
}
async function renderSector() {
  const sel = $('zsSecSelect'), sum = $('zsSecSum'), body = $('zsSecBody');
  if (!sel || !body) return;
  try {
    const sd = await loadSectorData();
    if (!sel.options.length) {
      const opts = ['<option value="All">All sectors (' + sd.total + ')</option>'];
      Object.keys(sd.counts).sort().forEach(sec => opts.push('<option value="' + esc(sec) + '">' + esc(sec) + ' (' + sd.counts[sec] + ')</option>'));
      sel.innerHTML = opts.join('');
      sel.value = STATE.secFilter;
      sel.addEventListener('change', () => { STATE.secFilter = sel.value; STATE.secPage = 1; renderSector(); });
    }
    const list = STATE.secFilter === 'All' ? sd.rows : sd.rows.filter(r => r.sec === STATE.secFilter);
    const pages = Math.max(1, Math.ceil(list.length / PER));
    if (STATE.secPage > pages) STATE.secPage = pages;
    const slice = list.slice((STATE.secPage - 1) * PER, STATE.secPage * PER);
    body.innerHTML = slice.map(r =>
      '<tr data-sym="' + esc(r.s) + '" class="zs-rowlink"><td><a href="/stocks/' + esc(r.s) + '/"><strong>' + esc(r.s) + '</strong></a></td>' +
      '<td>' + esc(r.n || '') + '</td><td>' + esc(r.sec) + '</td>' +
      '<td class="zs-sec-mark"></td></tr>').join('') || '<tr><td colspan="4" class="zs-loading">No stocks in this sector.</td></tr>';
    sum.textContent = list.length + ' stocks · batch ' + (sd.batch || '');
    $('zsSecPager').innerHTML = '<div class="zs-pager">' + pagerHTML('sec', STATE.secPage, list.length, 'zsSecShowing') + '</div>';
    bindPagers($('zsSecPager'), (prefix, dir) => { STATE.secPage = Math.max(1, STATE.secPage + dir); renderSector(); });
    Array.prototype.forEach.call(body.querySelectorAll('tr[data-sym]'), tr => {
      tr.addEventListener('click', e => {
        if (e.target.tagName === 'A') return;
        const sym = tr.getAttribute('data-sym');
        if (STATE.data && STATE.data.symbols[sym]) selectSymbol(sym, true);
        else setNotice(sym + ' did not trade in this window — detail unchanged.');
      });
    });
    renderSectorMarks();
  } catch (err) {
    body.innerHTML = '<tr><td colspan="4" class="zs-loading">Sector list could not be loaded.</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('symSel').addEventListener('change', e => selectSymbol(e.target.value, false));
  $('symSearch').addEventListener('input', e => {
    const q = e.target.value.trim().toUpperCase();
    if (!q || !STATE.data) return;
    const keys = Object.keys(STATE.data.symbols);
    const hit = keys.find(s => s.indexOf(q) === 0) ||
      keys.find(s => s.indexOf(q) >= 0) ||
      keys.find(s => (STATE.data.symbols[s].name || '').toUpperCase().indexOf(q) >= 0);
    if (hit) selectSymbol(hit, false);
  });
  loadWindow(30).catch(() => {
    $('boardBody').innerHTML = '<tr><td colspan="8" class="zs-loading">Data is being prepared — please check back after the next market close.</td></tr>';
    setFresh('fail', null);
  });
  renderSector().catch(() => {});
  setInterval(tick, 60000);
});

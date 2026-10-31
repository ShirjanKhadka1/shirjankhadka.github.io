/* Sector seasonality (teardown Link 2) — per-sector year x month return
   matrices on BS (primary) and AD calendars, from /data/sector-seasonality.json.
   Composites are Nepse Decode reconstructions from our own OHLC archive
   (see data/sector-indices.json); the forward strip is descriptive
   history only — average, win-rate, sample size, sign-match reliability.
   The stocks panel lists the selected composite's constituents with
   their own best/worst months; the ledger section scores the forward
   calls (predicted sign vs realized return) as months close. */
(function () {
  'use strict';

  var ORDER = ['Banking', 'Development Bank', 'Finance', 'Hotels And Tourism',
    'Hydropower', 'Investment', 'Life Insurance', 'Manufacturing And Processing',
    'Microfinance', 'Non Life Insurance', 'Others', 'Trading', 'NEPSE'];
  var SHORT = {
    BS: ['Bai', 'Jes', 'Ash', 'Shr', 'Bha', 'Asw', 'Kar', 'Man', 'Pou', 'Mag', 'Fal', 'Cha'],
    AD: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  };
  var PAGE = 25;
  var state = { data: null, sector: 'Banking', cal: 'BS',
    stockSort: 'symbol', stockPage: 1, ledgerFilter: 'all', ledgerPage: 1,
    lastLoad: 0, wired: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(x, dp) {
    if (x == null) return '—';
    return (x > 0 ? '+' : '') + x.toFixed(dp == null ? 2 : dp) + '%';
  }

  function heatAttrs(v) {
    if (v == null) return ' class="ss-null"';
    var a = Math.min(Math.abs(v) / 20, 1);
    var alpha = (0.08 + 0.60 * a).toFixed(2);
    return ' class="' + (v >= 0 ? 'ss-pos' : 'ss-neg') + '" style="--ss-a:' + alpha + '" title="' + pct(v) + '"';
  }

  function fwdCard(el, label, f, yearNote) {
    if (!el) return;
    if (!f || f.sample_size === 0) {
      el.innerHTML = '<span class="ss-fwd-lab">' + esc(label) + '</span><div class="ss-fwd-big">—</div>';
      return;
    }
    var cls = f.avg_return >= 0 ? 'pos' : 'neg';
    var rel = (f.sign_match_rate == null)
      ? 'average is 0.00% — no sign to match'
      : 'sign matched the long-run average in <strong>' + f.sign_match_years + ' of ' + f.sample_size +
        ' years</strong> (' + f.sign_match_rate.toFixed(0) + '%)';
    el.innerHTML =
      '<span class="ss-fwd-lab">' + esc(label) + ' · ' + esc(f.month) + (yearNote ? ' ' + esc(yearNote) : '') + '</span>' +
      '<div class="ss-fwd-big ' + cls + '">' + pct(f.avg_return) + '</div>' +
      '<div class="ss-fwd-detail">average return · positive in <strong>' + f.positive_rate.toFixed(0) +
      '%</strong> of ' + f.sample_size + ' years · ' + rel + '</div>';
  }

  function stockCell(month, avg, n) {
    if (month == null || avg == null) return '<span class="ss-mavg dim">—</span>';
    var cls = avg >= 0 ? 'pos' : 'neg';
    return esc(month) + ' · <span class="ss-mavg ' + cls + '">' + pct(avg) + '</span>' +
      ' <span class="ss-mavg dim">(' + n + ' yrs)</span>';
  }

  function renderStocks() {
    var body = $('ssStockBody');
    if (!body || !state.data) return;
    var entry = state.data.sectors[state.sector];
    var note = $('ssStockNote');
    var stocks = entry && entry.stocks && entry.stocks[state.cal];
    if (!stocks) {
      body.innerHTML = '<tr><td colspan="3" class="sn-loading">Stock lists arrive with the next weekly build.</td></tr>';
      if (note) note.hidden = false;
      var cnt = $('ssStockCount');
      if (cnt) cnt.textContent = '';
      var info = $('ssStockInfo');
      if (info) info.textContent = '';
      var pv = $('ssStockPrev'), nx = $('ssStockNext');
      if (pv) pv.disabled = true;
      if (nx) nx.disabled = true;
      return;
    }
    if (note) note.hidden = true;
    var rows = stocks.slice();
    if (state.stockSort === 'best') {
      rows.sort(function (a, b) {
        if (a.best_avg == null && b.best_avg == null) return a.s < b.s ? -1 : 1;
        if (a.best_avg == null) return 1;
        if (b.best_avg == null) return -1;
        return b.best_avg - a.best_avg;
      });
    } else if (state.stockSort === 'worst') {
      rows.sort(function (a, b) {
        if (a.worst_avg == null && b.worst_avg == null) return a.s < b.s ? -1 : 1;
        if (a.worst_avg == null) return 1;
        if (b.worst_avg == null) return -1;
        return a.worst_avg - b.worst_avg;
      });
    } else {
      rows.sort(function (a, b) { return a.s < b.s ? -1 : 1; });
    }
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / PAGE));
    if (state.stockPage > pages) state.stockPage = pages;
    var from = (state.stockPage - 1) * PAGE;
    var page = rows.slice(from, from + PAGE);
    body.innerHTML = page.map(function (st) {
      var name = (st.n && st.n !== st.s) ? '<span class="ss-sname">' + esc(st.n) + '</span>' : '';
      return '<tr><td class="l"><strong>' + esc(st.s) + '</strong>' + name + '</td>' +
        '<td class="r">' + stockCell(st.best, st.best_avg, st.best_n) + '</td>' +
        '<td class="r">' + stockCell(st.worst, st.worst_avg, st.worst_n) + '</td></tr>';
    }).join('') || '<tr><td colspan="3" class="sn-loading">No stocks in this sector.</td></tr>';
    var cnt2 = $('ssStockCount');
    if (cnt2) cnt2.textContent = total + ' stocks · ' +
      rows.filter(function (s) { return s.best != null; }).length + ' with a best/worst month';
    var info2 = $('ssStockInfo');
    if (info2) info2.textContent = total ? ('Showing ' + (from + 1) + '–' + Math.min(from + PAGE, total) + ' of ' + total) : '';
    var pv2 = $('ssStockPrev'), nx2 = $('ssStockNext');
    if (pv2) pv2.disabled = state.stockPage <= 1;
    if (nx2) nx2.disabled = state.stockPage >= pages;
  }

  function renderLedger() {
    var body = $('ssLedgerBody');
    if (!body || !state.data) return;
    var ledger = state.data.forward_ledger;
    var note = $('ssLedgerNote');
    var sumEl = $('ssLedgerSummary');
    if (!ledger) {
      body.innerHTML = '<tr><td colspan="6" class="sn-loading">Forward tracking arrives with the next weekly build.</td></tr>';
      if (note) note.hidden = false;
      if (sumEl) sumEl.textContent = '';
      var info = $('ssLedgerInfo');
      if (info) info.textContent = '';
      var pv = $('ssLedgerPrev'), nx = $('ssLedgerNext');
      if (pv) pv.disabled = true;
      if (nx) nx.disabled = true;
      return;
    }
    if (note) note.hidden = true;
    var resolved = ledger.filter(function (e) { return e.realized_return != null; });
    var matched = resolved.filter(function (e) { return e.matched === true; }).length;
    if (sumEl) {
      if (!resolved.length) {
        sumEl.textContent = ledger.length + ' calls tracked · no resolved calls yet — tracking started ' +
          (state.data.forward_ledger_started || '26 Oct 2026') +
          '; first resolutions arrive when October/Kartik close in the data.';
      } else {
        sumEl.textContent = ledger.length + ' calls tracked · ' + resolved.length + ' resolved · ' +
          matched + ' matched (' + (matched / resolved.length * 100).toFixed(0) + '% of resolved)';
      }
    }
    var rows = ledger;
    if (state.ledgerFilter === 'resolved') rows = resolved;
    else if (state.ledgerFilter === 'pending') rows = ledger.filter(function (e) { return e.realized_return == null; });
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / PAGE));
    if (state.ledgerPage > pages) state.ledgerPage = pages;
    var from = (state.ledgerPage - 1) * PAGE;
    body.innerHTML = rows.slice(from, from + PAGE).map(function (e) {
      var pred = e.predicted_avg == null ? '—' : pct(e.predicted_avg);
      var real = e.realized_return == null ? '—' : pct(e.realized_return);
      var res, cls;
      if (e.realized_return == null) { res = 'Pending'; cls = 'pend'; }
      else if (e.matched === true) { res = '✓ Matched'; cls = 'ok'; }
      else if (e.matched === false) { res = '✗ Missed'; cls = 'miss'; }
      else { res = 'No sign'; cls = 'nosign'; }
      return '<tr><td class="l">' + esc(e.sector) + '</td><td>' + esc(e.calendar) + '</td>' +
        '<td class="l">' + e.year + ' ' + esc(e.month) + '</td>' +
        '<td class="r">' + pred + '</td><td class="r">' + real + '</td>' +
        '<td class="r ss-result ' + cls + '">' + res + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="sn-loading">No calls in this view.</td></tr>';
    var info2 = $('ssLedgerInfo');
    if (info2) info2.textContent = total ? ('Showing ' + (from + 1) + '–' + Math.min(from + PAGE, total) + ' of ' + total) : '';
    var pv2 = $('ssLedgerPrev'), nx2 = $('ssLedgerNext');
    if (pv2) pv2.disabled = state.ledgerPage <= 1;
    if (nx2) nx2.disabled = state.ledgerPage >= pages;
  }

  function render() {
    var entry = state.data.sectors[state.sector];
    if (!entry) return;
    var mx = entry[state.cal];
    var months = mx.months;
    var short = SHORT[state.cal];

    var cov = entry.coverage || {};
    var covEl = $('ssCoverage');
    if (covEl) {
      if (entry.index_type === 'index') {
        covEl.textContent = 'NEPSE index (official history) · ' + cov.first_date + ' → ' + cov.last_date +
          ' · ' + cov.sessions + ' sessions · matrix ' + mx.years[0] + '–' + mx.years[mx.years.length - 1] + ' ' + state.cal;
      } else {
        covEl.textContent = state.sector + ' composite · ' + cov.constituents_now + ' stocks · ' +
          cov.first_date + ' → ' + cov.last_date + ' · ' + cov.sessions + ' sessions · about ' +
          cov.avg_constituents_latest_year + ' contributing per session in ' + cov.last_date.slice(0, 4) +
          ' · matrix ' + mx.years[0] + '–' + mx.years[mx.years.length - 1] + ' ' + state.cal;
      }
    }

    // best / worst cards: giant average first, month name under it
    var b = mx.best_month, w = mx.worst_month;
    var bAvg = $('ssBestAvg'), wAvg = $('ssWorstAvg');
    if (bAvg) bAvg.textContent = b ? pct(mx.monthly_average[b]) : '—';
    if (wAvg) wAvg.textContent = w ? pct(mx.monthly_average[w]) : '—';
    $('ssBestName').textContent = b || '—';
    $('ssWorstName').textContent = w || '—';
    if (b) $('ssBestDetail').innerHTML = 'Averages across ' +
      mx.monthly_sample_size[b] + ' years · positive ' + mx.monthly_positive_rate[b].toFixed(0) + '% of the time.';
    if (w) $('ssWorstDetail').innerHTML = 'Averages across ' +
      mx.monthly_sample_size[w] + ' years · positive only ' + mx.monthly_positive_rate[w].toFixed(0) + '% of the time.';

    var fwd = mx.forward || {};
    fwdCard($('ssFwdThis'), 'This month (in progress)', fwd.this_month,
      fwd.asof_month ? String(fwd.asof_month.year) : '');
    fwdCard($('ssFwdNext'), 'Next month', fwd.next_month, '');

    var head = $('ssHeatHead'), body = $('ssHeatBody');
    if (head && body) {
      head.innerHTML = '<tr><th class="ss-yr">Year</th>' + short.map(function (s) {
        return '<th>' + s + '</th>';
      }).join('') + '<th class="ss-yrt">Year</th></tr>';
      var rows = mx.rows.slice().reverse();
      body.innerHTML = rows.map(function (row) {
        var cells = months.map(function (m) {
          var v = row.values[m];
          return '<td' + heatAttrs(v) + '>' + (v == null ? '·' : pct(v, 1).replace('%', '')) + '</td>';
        }).join('');
        var yr = row.yearly_return;
        var yrCls = yr == null ? 'ss-null' : (yr >= 0 ? 'ss-ypos' : 'ss-yneg');
        return '<tr><td class="ss-yr">' + row.year + '</td>' + cells +
          '<td class="ss-yrt ' + yrCls + '">' + (yr == null ? '·' : pct(yr, 1)) + '</td></tr>';
      }).join('');
    }

    var mb = $('ssMonthBody');
    if (mb) {
      mb.innerHTML = months.map(function (m) {
        var avg = mx.monthly_average[m];
        var cls = m === b ? 'bestm' : m === w ? 'worstm' : '';
        var ac = avg == null ? '' : (avg >= 0 ? 'pos' : 'neg');
        return '<tr class="' + cls + '"><td class="l"><strong>' + esc(m) + '</strong></td>' +
          '<td class="r ' + ac + '">' + pct(avg) + '</td>' +
          '<td class="r">' + (mx.monthly_positive_rate[m] == null ? '—' : mx.monthly_positive_rate[m].toFixed(0) + '%') + '</td>' +
          '<td class="r">' + mx.monthly_sample_size[m] + '</td></tr>';
      }).join('');
    }

    renderStocks();
    renderLedger();
  }

  function syncUrl() {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('sector', state.sector);
      u.searchParams.set('cal', state.cal);
      history.replaceState(null, '', u.toString());
    } catch (e) { /* non-browser context */ }
  }

  function load() {
    fetch('/data/sector-seasonality.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no-data'); return r.json(); })
      .then(function (data) {
        state.data = data;
        state.lastLoad = Date.now();
        if (!data.sectors[state.sector]) state.sector = 'Banking';
        var sel = $('ssSector');
        if (sel) {
          sel.innerHTML = ORDER.filter(function (s) { return data.sectors[s]; }).map(function (s) {
            var label = s === 'NEPSE' ? 'NEPSE Index (official)' : s;
            return '<option value="' + esc(s) + '"' + (s === state.sector ? ' selected' : '') + '>' + esc(label) + '</option>';
          }).join('');
          sel.value = state.sector;
        }
        document.querySelectorAll('.ss-tbtn[data-cal]').forEach(function (btn) {
          btn.classList.toggle('is-on', btn.getAttribute('data-cal') === state.cal);
        });
        render();
      })
      .catch(function () {
        var cov = $('ssCoverage');
        if (cov) cov.textContent = 'Sector seasonality data unavailable right now.';
        var hb = $('ssHeatBody');
        if (hb) hb.innerHTML = '<tr><td class="ss-loading">Unavailable.</td></tr>';
        var sb = $('ssStockBody');
        if (sb) sb.innerHTML = '<tr><td colspan="3" class="sn-loading">Unavailable.</td></tr>';
        var lb = $('ssLedgerBody');
        if (lb) lb.innerHTML = '<tr><td colspan="6" class="sn-loading">Unavailable.</td></tr>';
      });
  }

  function refreshIntervalMs() {
    try {
      var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
      var day = now.getDay();
      if (day === 0 || day === 6) return 2 * 60 * 60 * 1000;
      var mins = now.getHours() * 60 + now.getMinutes();
      if (mins >= 660 && mins < 900) return 5 * 60 * 1000;
      return 30 * 60 * 1000;
    } catch (e) { return 30 * 60 * 1000; }
  }

  function init() {
    var sel = $('ssSector');
    if (!sel) return;
    try {
      var params = new URLSearchParams(window.location.search);
      var s = params.get('sector'), c = params.get('cal');
      if (s && ORDER.indexOf(s) !== -1) state.sector = s;
      if (c === 'BS' || c === 'AD') state.cal = c;
    } catch (e) { /* ignore */ }
    if (!state.wired) {
      state.wired = true;
      sel.addEventListener('change', function () {
        state.sector = sel.value; state.stockPage = 1; syncUrl(); render();
      });
      document.querySelectorAll('.ss-tbtn[data-cal]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.cal = btn.getAttribute('data-cal'); state.stockPage = 1; syncUrl();
          document.querySelectorAll('.ss-tbtn[data-cal]').forEach(function (b) {
            b.classList.toggle('is-on', b === btn);
          });
          render();
        });
      });
      document.querySelectorAll('.ss-tbtn[data-ledger]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.ledgerFilter = btn.getAttribute('data-ledger'); state.ledgerPage = 1;
          document.querySelectorAll('.ss-tbtn[data-ledger]').forEach(function (b) {
            b.classList.toggle('is-on', b === btn);
          });
          renderLedger();
        });
      });
      var sort = $('ssStockSort');
      if (sort) sort.addEventListener('change', function () {
        state.stockSort = sort.value; state.stockPage = 1; renderStocks();
      });
      var sp = $('ssStockPrev'), sn = $('ssStockNext');
      if (sp) sp.addEventListener('click', function () {
        if (state.stockPage > 1) { state.stockPage--; renderStocks(); }
      });
      if (sn) sn.addEventListener('click', function () {
        state.stockPage++; renderStocks();
      });
      var lp = $('ssLedgerPrev'), ln = $('ssLedgerNext');
      if (lp) lp.addEventListener('click', function () {
        if (state.ledgerPage > 1) { state.ledgerPage--; renderLedger(); }
      });
      if (ln) ln.addEventListener('click', function () {
        state.ledgerPage++; renderLedger();
      });
    }
    load();
    setInterval(function () {
      if (document.hidden) return;
      load();
    }, refreshIntervalMs());
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - state.lastLoad > 5 * 60 * 1000) load();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

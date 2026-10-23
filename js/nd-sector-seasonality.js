/* Sector seasonality (teardown Link 2) — per-sector year x month return
   matrices on BS (primary) and AD calendars, from /data/sector-seasonality.json.
   Composites are Nepse Decode reconstructions from our own OHLC archive
   (see data/sector-indices.json); the forward strip is descriptive
   history only — average, win-rate, sample size, sign-match reliability. */
(function () {
  'use strict';

  var ORDER = ['Banking', 'Development Bank', 'Finance', 'Hotels And Tourism',
    'Hydropower', 'Investment', 'Life Insurance', 'Manufacturing And Processing',
    'Microfinance', 'Non Life Insurance', 'Others', 'NEPSE'];
  var SHORT = {
    BS: ['Bai', 'Jes', 'Ash', 'Shr', 'Bha', 'Asw', 'Kar', 'Man', 'Pou', 'Mag', 'Fal', 'Cha'],
    AD: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  };
  var state = { data: null, sector: 'Banking', cal: 'BS' };

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

  function render() {
    var entry = state.data.sectors[state.sector];
    if (!entry) return;
    var mx = entry[state.cal];
    var months = mx.months;
    var short = SHORT[state.cal];

    // coverage line
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

    // best / worst cards
    var b = mx.best_month, w = mx.worst_month;
    $('ssBestName').textContent = b || '—';
    $('ssWorstName').textContent = w || '—';
    if (b) $('ssBestDetail').innerHTML = 'Averages <strong>' + pct(mx.monthly_average[b]) + '</strong> across ' +
      mx.monthly_sample_size[b] + ' years · positive ' + mx.monthly_positive_rate[b].toFixed(0) + '% of the time.';
    if (w) $('ssWorstDetail').innerHTML = 'Averages <strong>' + pct(mx.monthly_average[w]) + '</strong> across ' +
      mx.monthly_sample_size[w] + ' years · positive only ' + mx.monthly_positive_rate[w].toFixed(0) + '% of the time.';

    // forward strip (descriptive history only)
    var fwd = mx.forward || {};
    fwdCard($('ssFwdThis'), 'This month (in progress)', fwd.this_month,
      fwd.asof_month ? String(fwd.asof_month.year) : '');
    fwdCard($('ssFwdNext'), 'Next month', fwd.next_month, '');

    // heatmap
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

    // month summary table
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
  }

  function init() {
    var sel = $('ssSector');
    if (!sel) return;
    fetch('/data/sector-seasonality.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no-data'); return r.json(); })
      .then(function (data) {
        state.data = data;
        sel.innerHTML = ORDER.filter(function (s) { return data.sectors[s]; }).map(function (s) {
          var label = s === 'NEPSE' ? 'NEPSE Index (official)' : s;
          return '<option value="' + esc(s) + '"' + (s === state.sector ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('');
        sel.addEventListener('change', function () { state.sector = sel.value; render(); });
        var btns = document.querySelectorAll('.ss-tbtn');
        btns.forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.cal = btn.getAttribute('data-cal');
            btns.forEach(function (b) { b.classList.toggle('is-on', b === btn); });
            render();
          });
        });
        render();
      })
      .catch(function () {
        var cov = $('ssCoverage');
        if (cov) cov.textContent = 'Sector seasonality data unavailable right now.';
        var hb = $('ssHeatBody');
        if (hb) hb.innerHTML = '<tr><td class="ss-loading">Unavailable.</td></tr>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* Nepse Decode - Quarterly comparison table (Chukul-style).
 * Renders a PARTICULARS x quarters comparison with DIFF (%) on stock pages.
 * Data: /nepse-chart/data/quarterly.json
 * Educational, not investment advice. */
(function () {
  'use strict';

  var QURL = '/nepse-chart/data/quarterly.json';

  // Metric definitions: key in quarterly.json -> display label + format
  var METRICS = [
    { k: 'paidup',    label: 'Paid Up Capital',      fmt: 'money' },
    { k: 'reserves',  label: 'Reserves & Surplus',   fmt: 'money' },
    { k: 'deposits',  label: 'Deposits',             fmt: 'money' },
    { k: 'loans',     label: 'Loans & Advances',     fmt: 'money' },
    { k: 'assets',    label: 'Total Assets',         fmt: 'money' },
    { k: 'revenue',   label: 'Revenue',              fmt: 'money' },
    { k: 'grossprofit', label: 'Gross Profit',       fmt: 'money' },
    { k: 'opprofit',  label: 'Operating Profit',     fmt: 'money' },
    { k: 'netprofit', label: 'Net Profit',           fmt: 'money' },
    { k: 'distprofit', label: 'Distributable Profit', fmt: 'money' },
    { k: 'eps_ttm',   label: 'EPS (TTM)',            fmt: 'rs' },
    { k: 'pe_ttm',    label: 'P/E (TTM)',            fmt: 'x' },
    { k: 'npl_pct',   label: 'NPL Ratio',            fmt: 'pct' },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Format NPR thousands to Nepali units (like Chukul: Ar., Khar., Cr.)
  function fmtMoney(v) {
    if (v == null || !isFinite(v)) return '–';
    var n = v * 1000; // XLSX values are in NPR thousands
    if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + ' Khar.';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + ' Ar.';
    if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + ' Cr.';
    if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + ' L.';
    return Math.round(n).toLocaleString('en-US');
  }

  function fmtVal(v, fmt) {
    if (v == null || !isFinite(v)) return '–';
    if (fmt === 'money') return fmtMoney(v);
    if (fmt === 'rs') return 'Rs ' + Number(v).toFixed(2);
    if (fmt === 'x') return Number(v).toFixed(2) + 'x';
    if (fmt === 'pct') return Number(v).toFixed(2) + '%';
    return String(v);
  }

  function fmtDiff(v) {
    if (v == null || !isFinite(v)) return '–';
    var s = (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    var cls = v > 0 ? 'q-up' : (v < 0 ? 'q-dn' : 'q-flat');
    return '<span class="' + cls + '">' + s + '</span>';
  }

  // Parse "2082/2083-Q4" -> {fy: "2082/2083", q: 4}
  function parseQ(qkey) {
    var m = /^(\d{4}\/\d{4})-Q(\d)$/.exec(qkey);
    if (!m) return null;
    return { fy: m[1], q: parseInt(m[2], 10), key: qkey };
  }

  // Short label: "2082/2083-Q4" -> "Q4 / 082/083"
  function shortQ(qkey) {
    var p = parseQ(qkey);
    if (!p) return qkey;
    var fyShort = p.fy.replace(/^20/, '').replace('/', '/');
    // "2082/2083" -> "082/083"
    fyShort = p.fy.substring(2); // "82/2083" -> hmm
    var parts = p.fy.split('/');
    fyShort = parts[0].substring(2) + '/' + parts[1].substring(2);
    return 'Q' + p.q + ' / ' + fyShort;
  }

  function renderTable(sym, qdata) {
    var quarters = Object.keys(qdata.quarters || {});
    if (!quarters.length) {
      return '<p class="sp-note">No quarterly data available for ' + esc(sym) + ' yet.</p>';
    }

    // Sort quarters descending (newest first)
    quarters.sort().reverse();

    var latest = quarters[0];
    var latestQ = parseQ(latest);

    // Find comparison quarter for DIFF: same quarter last FY, else previous quarter
    var compQ = null;
    if (latestQ) {
      var fyParts = latestQ.fy.split('/');
      var prevFY = (parseInt(fyParts[0], 10) - 1) + '/' + (parseInt(fyParts[1], 10) - 1);
      var yoyKey = prevFY + '-Q' + latestQ.q;
      if (qdata.quarters[yoyKey]) {
        compQ = yoyKey;
      } else if (quarters.length > 1) {
        compQ = quarters[1];
      }
    }

    var html = '<div class="qcomp-wrap">';
    html += '<h3>Quarterly Comparison</h3>';

    if (quarters.length === 1) {
      html += '<p class="sp-note">Showing ' + esc(shortQ(latest)) + ' (latest published). Comparison with prior quarters will appear as more reports are published.</p>';
    }

    html += '<div class="qcomp-scroll"><table class="qcomp">';
    html += '<thead><tr><th class="q-part">Particulars</th>';

    if (compQ) {
      html += '<th class="q-diff">Diff (%)<span class="q-diff-sub">' + esc(shortQ(latest)) + ' vs ' + esc(shortQ(compQ)) + '</span></th>';
    }

    quarters.forEach(function (qk) {
      html += '<th>' + esc(shortQ(qk)) + '</th>';
    });
    html += '</tr></thead><tbody>';

    METRICS.forEach(function (m) {
      var latestV = qdata.quarters[latest][m.k];
      // Skip rows where latest has no data
      if (latestV == null) return;

      html += '<tr><td class="q-part">' + esc(m.label) + '</td>';

      if (compQ) {
        var compV = qdata.quarters[compQ][m.k];
        var diff = null;
        if (compV != null && compV !== 0 && isFinite(compV)) {
          diff = ((latestV - compV) / Math.abs(compV)) * 100;
        }
        html += '<td class="q-diff">' + fmtDiff(diff) + '</td>';
      }

      quarters.forEach(function (qk) {
        var v = qdata.quarters[qk][m.k];
        html += '<td>' + esc(fmtVal(v, m.fmt)) + '</td>';
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += '<p class="sp-note qcomp-src">Source: Published quarterly filings. Figures in NPR. ' +
      'Diff compares the latest quarter against the same quarter last fiscal year when available, ' +
      'otherwise the immediately prior quarter.</p>';
    html += '</div>';
    return html;
  }

  function init() {
    var mount = document.getElementById('qcomp');
    if (!mount) return;

    var sym = mount.getAttribute('data-sym');
    if (!sym) return;

    fetch(QURL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var symData = (d.symbols || {})[sym];
        if (!symData) {
          mount.innerHTML = '<p class="sp-note">Quarterly comparison not yet available for ' + esc(sym) + '.</p>';
          return;
        }
        mount.innerHTML = renderTable(sym, symData);
      })
      .catch(function () {
        mount.innerHTML = '<p class="sp-note">Quarterly data temporarily unavailable.</p>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

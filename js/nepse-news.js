/* NEPSE Alpha Lab — market news panel.
 * Headlines collected daily from Nepali business media (see
 * tools/build-nepse-news.js). Headlines only, always attributed with an
 * outbound link; nothing is rewritten or presented as our own reporting. */
(function () {
  'use strict';

  var mount = document.getElementById('nl-news');
  if (!mount) return;

  var NEWS = null; // {asof, items:[{sym,title,link,src,date}]}

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function symNow() {
    var m = /[?&]s=([A-Za-z0-9/-]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]).toUpperCase() : null;
  }

  function itemHTML(it, showSym) {
    var chip = showSym
      ? '<a class="nl-news-sym" href="?s=' + esc(it.sym) + '">' + esc(it.sym) + '</a>'
      : '';
    return '<article class="nl-news-item">' + chip +
      '<div class="nl-news-body"><a href="' + esc(it.link) + '" target="_blank" rel="noopener">' +
      esc(it.title) + '</a>' +
      '<p>' + esc(it.src) + ' · ' + esc(it.date) + '</p></div></article>';
  }

  function render() {
    if (!NEWS) return;
    var sym = symNow();
    var html = '';
    if (sym && sym !== 'NEPSE') {
      var mine = NEWS.items.filter(function (it) { return it.sym === sym; }).slice(0, 6);
      html += '<h2>Latest news — ' + esc(sym) + '</h2>';
      if (mine.length) {
        html += '<div class="nl-news-list">' +
          mine.map(function (it) { return itemHTML(it, false); }).join('') + '</div>' +
          '<p class="nl-news-more"><a href="/nepse-news/">More NEPSE market news →</a></p>';
      } else {
        html += '<p class="nl-news-empty">No recent headlines mention ' + esc(sym) +
          '. News is collected daily from Nepali business media.</p>';
      }
    } else {
      var latest = NEWS.items.slice(0, 10);
      html += '<h2>Latest market news</h2>' +
        '<p class="nl-scan-sub">Headlines from Nepali business media mentioning listed companies — ' +
        'updated ' + esc(NEWS.asof) + '. We link to the source; we don\u2019t rewrite.</p>';
      if (latest.length) {
        html += '<div class="nl-news-list">' +
          latest.map(function (it) { return itemHTML(it, true); }).join('') + '</div>' +
          '<p class="nl-news-more"><a href="/nepse-news/">More NEPSE market news →</a></p>';
      } else {
        html += '<p class="nl-news-empty">No company headlines in the last 7 days. Check back after the next daily refresh.</p>';
      }
    }
    mount.innerHTML = html;
  }

  fetch('data/news.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (j) { NEWS = j; render(); })
    .catch(function () { mount.innerHTML = ''; mount.style.display = 'none'; });

  // The lab swaps symbols via history.replaceState + verdict re-render;
  // re-render news whenever the verdict block updates.
  var vc = document.getElementById('nl-verdict');
  if (vc && 'MutationObserver' in window) {
    new MutationObserver(function () { render(); }).observe(vc, { childList: true });
  }
})();

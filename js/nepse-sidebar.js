/**
 * js/nepse-sidebar.js — ONE shared suite-navigation component.
 *
 * Every suite sidebar / mobile nav on every page renders from the single
 * NAV_ITEMS list below, so labels, order and hrefs are identical everywhere.
 * The renderer preserves each nav family's own markup conventions
 * (d2-side / nd-side / mobile) and marks the current page active.
 *
 * Label set picked once (2026-10-02, P1-4): Overview, Chart & signals,
 * Momentum, Trend Relay, Reversal, Screener, Trending Stocks, Value
 * Investing, Broker Analytics, Sectors, Market news, Watchlist, Portfolio,
 * Simulator, Reports, Corp. actions.
 *
 * Usage: <script src="/js/nepse-sidebar.js" defer></script>
 * The script re-renders every recognised suite nav idempotently — pages also
 * carry the same markup baked in so first paint is correct with JS off.
 */
(function () {
  'use strict';

  var NAV_ITEMS = [
    { href: '/nepse-decode/', label: 'Overview' },
    { href: '/nepse-chart/', label: 'Chart & signals' },
    { href: '/nepse-signals/momentum/', label: 'Momentum', sub: true },
    { href: '/nepse-signals/trend-relay/', label: 'Trend Relay', sub: true },
    { href: '/nepse-signals/reversal/', label: 'Reversal', sub: true },
    { href: '/nepse-screener/', label: 'Screener' },
    { href: '/nepse-trending/', label: 'Trending Stocks' },
    { href: '/nepse-value/', label: 'Value Investing' },
    { href: '/nepse-brokers/', label: 'Broker Analytics' },
    { href: '/nepse-sectors/', label: 'Sectors' },
    { href: '/nepse-news/', label: 'Market news' },
    { href: '/nepse-watchlist/', label: 'Watchlist' },
    { href: '/nepse-portfolio/', label: 'Portfolio' },
    { href: '/nepse-simulator/', label: 'Simulator' },
    { href: '/nepse-reports/', label: 'Reports' },
    { href: '/nepse-actions/', label: 'Corp. actions' }
  ];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function currentPath() {
    var p = String((typeof location !== 'undefined' && location.pathname) || '/');
    p = p.replace(/\/index\.html$/, '/');
    if (p.charAt(p.length - 1) !== '/') p += '/';
    return p;
  }

  function isActive(href) {
    var cur = currentPath();
    if (href === '/nepse-decode/') return cur === '/nepse-decode/' || cur === '/';
    return cur === href || cur.indexOf(href) === 0;
  }

  function linkHTML(it, activeCls) {
    var active = isActive(it.href);
    return '<a href="' + it.href + '"' +
      (active ? ' class="' + activeCls + '" aria-current="page"' : '') +
      '>' + esc(it.label) + '</a>';
  }

  // family: 'd2'  (plain links, active class "on") or
  //         'nd'  (Suite kicker + nav-sub wrapper, active class "active") or
  //         'ndm' (mobile: nav-sub wrapper, no kicker)
  function navHTML(family) {
    var activeCls = family === 'd2' ? 'on' : 'active';
    var html = family === 'nd' ? '<p class="nav-kicker">Suite</p>' : '';
    var subOpen = false;
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      var it = NAV_ITEMS[i];
      if (it.sub && !subOpen) { html += '<span class="nav-sub">'; subOpen = true; }
      if (!it.sub && subOpen) { html += '</span>'; subOpen = false; }
      html += linkHTML(it, activeCls);
    }
    if (subOpen) html += '</span>';
    return html;
  }

  function render() {
    var d2 = document.querySelectorAll('aside.d2-side > nav, nav.d2-mobilenav');
    for (var i = 0; i < d2.length; i++) d2[i].innerHTML = navHTML('d2');
    var nd = document.querySelectorAll('aside.nd-side > nav.nd-nav');
    for (var j = 0; j < nd.length; j++) nd[j].innerHTML = navHTML('nd');
    var ndm = document.querySelectorAll('nav.nd-mobilenav');
    for (var k = 0; k < ndm.length; k++) ndm[k].innerHTML = navHTML('ndm');
  }

  function init() {
    try { render(); } catch (e) { /* nav stays as baked */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NepseSidebar = { items: NAV_ITEMS, render: render, html: navHTML };
})();

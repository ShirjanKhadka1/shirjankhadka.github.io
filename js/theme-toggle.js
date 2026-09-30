/* ============================================================
   THEME TOGGLE — site-wide light/dark mode
   The <html data-theme> attribute is set BEFORE first paint by a
   tiny inline snippet in <head> (localStorage "sk-theme", falling
   back to prefers-color-scheme), so this deferred script only
   handles the toggle button: injection, clicks, persistence.
   ============================================================ */
(function () {
  'use strict';
  var KEY = 'sk-theme';
  var DARK_BG = '#0e130f';
  var LIGHT_BG = '#FAF8F2';

  function current() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function syncMeta(theme) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', theme === 'dark' ? DARK_BG : LIGHT_BG);
  }

  function syncButton(btn) {
    var dark = current() === 'dark';
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode */ }
    syncMeta(theme);
    document.querySelectorAll('.theme-toggle').forEach(syncButton);
  }

  function makeButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.innerHTML =
      '<svg class="tt-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
      '<svg class="tt-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="4"/>' +
      '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
    syncButton(btn);
    btn.addEventListener('click', function () {
      apply(current() === 'dark' ? 'light' : 'dark');
    });
    return btn;
  }

  function inject() {
    // Collect every header container present; most pages have exactly
    // one, but e.g. nepse-decode has both a mobile topbar and a desktop
    // sidebar in the DOM (one is display:none per breakpoint).
    var targets = [];
    function add(el, ref) {
      if (el && !el.querySelector('.theme-toggle')) targets.push([el, ref]);
    }
    // 1. Portfolio homepage: header.nav .nav-right (before mobile hamburger)
    var navRight = document.querySelector('header.nav .nav-right');
    if (navRight) add(navRight, navRight.querySelector('.nav-toggle'));
    // 2. Blog/articles: header.site-header .header-inner
    var blogHead = document.querySelector('header.site-header .header-inner');
    if (blogHead) add(blogHead, null);
    // 3. Nepse Decode mobile topbar: before the CTA
    var ndTop = document.querySelector('header.nd-topbar');
    if (ndTop) add(ndTop, ndTop.querySelector('.nd-btn'));
    // 4. Nepse Decode desktop sidebar: after the brand
    var side = document.querySelector('.nd-side');
    if (side) {
      var brand = side.querySelector('.brand');
      add(side, brand ? brand.nextSibling : side.firstChild);
    }
    // 5. Suite/stock pages: header.topbar .topbar-in (before the CTA)
    var topIn = document.querySelector('header.topbar .topbar-in');
    if (topIn) add(topIn, topIn.querySelector('.btn.small'));
    // 6. Fallback: first <header>
    if (!targets.length) {
      var hdr = document.querySelector('header');
      if (hdr && !hdr.querySelector('.theme-toggle')) targets.push([hdr, null]);
    }
    if (!targets.length && !document.querySelector('.theme-toggle')) {
      // No header on this page: floating toggle, bottom-right
      var floating = makeButton();
      floating.classList.add('floating');
      document.body.appendChild(floating);
      return;
    }
    targets.forEach(function (t) {
      t[0].insertBefore(makeButton(), t[1] || null);
    });
  }

  function init() {
    syncMeta(current());
    inject();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Cross-tab sync: another tab changed the theme
  window.addEventListener('storage', function (e) {
    if (e.key === KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
      document.documentElement.setAttribute('data-theme', e.newValue);
      syncMeta(e.newValue);
      document.querySelectorAll('.theme-toggle').forEach(syncButton);
    }
  });
})();

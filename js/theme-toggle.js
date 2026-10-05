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
  var DARK_BG = '#12110e';
  var LIGHT_BG = '#FAF7F0';

  function current() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function syncMeta(theme) {
    // D4: every page carries <meta name="theme-color"> (added in <head> right
    // after the viewport meta); create it if a page is missing one, then sync
    // the browser-chrome color to the active theme on every toggle and on init.
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    m.setAttribute('content', theme === 'dark' ? DARK_BG : LIGHT_BG);
  }

  function syncButton(btn) {
    var dark = current() === 'dark';
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    /* Mirror to data-nd-ed so the --nd-* editorial tokens in
       css/nd-editorial-theme.css pick the light palette too (dark is the
       token default = attribute absent). Same mapping as js/nd-chrome.js
       applyTheme(); needed by d2-shell pages that don't load nd-chrome. */
    if (theme === 'light') document.documentElement.setAttribute('data-nd-ed', 'light');
    else document.documentElement.removeAttribute('data-nd-ed');
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
    // One consistent home for the toggle on every page and every
    // viewport: a single floating button, fixed bottom-right.
    // (Header injection was removed 2026-10-01: each page's header DOM
    // differs per breakpoint, which left the button top-left on laptop,
    // top-center on tablet and bottom-right on mobile.)
    if (document.querySelector('.theme-toggle')) return;
    var btn = makeButton();
    btn.classList.add('fixed');
    document.body.appendChild(btn);
  }

  function init() {
    syncMeta(current());
    /* Ensure data-nd-ed mirrors the initial theme for --nd-* token pages
       whose <head> pre-paint snippet predates the mirror. */
    if (current() === 'light') document.documentElement.setAttribute('data-nd-ed', 'light');
    else document.documentElement.removeAttribute('data-nd-ed');
    inject();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // NOTE (2026-10-02, P1-3): no cross-tab `storage` listener. The theme must
  // change ONLY on an explicit toggle click in THIS tab — syncing another
  // tab's write caused silent theme flips with no user input.
})();

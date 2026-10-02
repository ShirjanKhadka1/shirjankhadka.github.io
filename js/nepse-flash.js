/**
 * nepse-flash.js — Price-change flash for the NEPSE suite.
 *
 * Highlights values that moved between polls. Pages opt in by adding
 * `data-flash-symbol="SYM"` to any price element, then calling
 * `NepseFlash.apply(container)` after painting new data:
 *
 *   <div id="heroPrice" data-flash-symbol="NEPSE">2,599.15</div>
 *   NepseFlash.apply(document); // flashes changed symbols for 1.2s
 *
 * The change list comes from NepseData.getChangedSymbols() — computed on
 * every validated snapshot swap (quotes + the NEPSE index as pseudo-symbol
 * "NEPSE"). Direction classes:
 *   nlv-flash-up   — green wash (price rose)
 *   nlv-flash-down — red wash (price fell)
 * Classes are removed after 1.2s. Minimal CSS injected by this module;
 * all classes use the `nlv-` prefix.
 *
 * Load order: nepse-market-config.js → nepse-format.js → nepse-data.js → nepse-flash.js
 */
(function (global) {
  'use strict';

  var CSS_ID = 'nlv-flash-css';
  var FLASH_MS = 1200;

  function injectCss() {
    if (typeof document === 'undefined' || !document.createElement) return;
    if (document.getElementById && document.getElementById(CSS_ID)) return;
    var css =
      '.nlv-flash-up{animation:nlv-flash-up 1.2s ease-out}' +
      '.nlv-flash-down{animation:nlv-flash-down 1.2s ease-out}' +
      '@keyframes nlv-flash-up{' +
      '0%{background-color:rgba(22,163,74,.30);border-radius:6px}' +
      '100%{background-color:transparent}}' +
      '@keyframes nlv-flash-down{' +
      '0%{background-color:rgba(220,38,38,.22);border-radius:6px}' +
      '100%{background-color:transparent}}' +
      '@media (prefers-reduced-motion:reduce){' +
      '.nlv-flash-up,.nlv-flash-down{animation:none}}';
    var style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = css;
    var head = document.head || document.getElementsByTagName('head')[0];
    if (head) head.appendChild(style);
  }

  var NepseFlash = {
    /**
     * Flash every [data-flash-symbol] element inside `container`
     * (default: document) whose symbol changed in the latest snapshot.
     * No-op when NepseData is unavailable or nothing changed.
     */
    apply: function (container) {
      injectCss();
      if (typeof document === 'undefined') return 0;
      var ND = global.NepseData;
      if (!ND || typeof ND.getChangedSymbols !== 'function') return 0;
      var changes;
      try { changes = ND.getChangedSymbols(); } catch (e) { return 0; }
      if (!changes || !changes.length) return 0;
      var dirBySymbol = {};
      for (var i = 0; i < changes.length; i++) {
        dirBySymbol[changes[i].symbol] = changes[i].direction;
      }
      var root = container || document;
      if (typeof root.querySelectorAll !== 'function') return 0;
      var els = root.querySelectorAll('[data-flash-symbol]');
      var flashed = 0;
      for (var j = 0; j < els.length; j++) {
        (function (el) {
          var sym = el.getAttribute('data-flash-symbol');
          var dir = sym && dirBySymbol[sym];
          if (!dir) return;
          var cls = dir === 'up' ? 'nlv-flash-up' : 'nlv-flash-down';
          try {
            el.classList.remove('nlv-flash-up');
            el.classList.remove('nlv-flash-down');
            // Force reflow so re-adding the class restarts the animation.
            void el.offsetWidth;
            el.classList.add(cls);
            setTimeout(function () {
              try { el.classList.remove(cls); } catch (e) { /* ignore */ }
            }, FLASH_MS);
            flashed++;
          } catch (e) { /* ignore */ }
        })(els[j]);
      }
      return flashed;
    },

    /** Flash duration in ms (useful for tests). */
    DURATION_MS: FLASH_MS
  };

  global.NepseFlash = NepseFlash;
})(typeof window !== 'undefined' ? window : this);

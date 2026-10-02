/* ============================================================
   NEPSE LOGOS — shared company-logo component
   ------------------------------------------------------------
   One choke point for every symbol list on the site. Renders the
   company's official logo (self-hosted, from the generated manifest
   js/company-logos.js) inside a circular chip; falls back to a
   sector-tinted monogram when no logo is mapped yet, and swaps to
   the monogram automatically if a logo file fails to load — a row
   never shows a broken image.

   Usage (in any renderer):
     NepseLogo.html('NABIL', 'Commercial Banks', 32)
   Include order (defer): js/company-logos.js THEN js/nepse-logos.js
   THEN the page's own script. Both are tiny and render-blocking-free.

   Manifest pipeline:
     data/company-logos.json --(tools/build-company-logos.js)-->
     js/company-logos.js  (window.NEPSE_LOGOS = { SYM: '/assets/logos/sym.webp' })
   Logos are sourced from official company websites only, normalized
   to webp, and self-hosted under /assets/logos/.
   ============================================================ */
(function () {
  'use strict';

  // Sector-tinted monogram fallback (same family as NepseMono, circular).
  var TINTS = [
    ['#E3EAE1', '#1E5A3C'], // sage
    ['#F0E7D0', '#7A5B23'], // sand
    ['#E9DED4', '#7C3F2C'], // clay
    ['#DDE3E6', '#2F4A5A'], // slate
    ['#E6E2D2', '#5C5A2E'], // moss
    ['#E7E0EC', '#4A3560'], // plum grey
    ['#DAE7E2', '#14524A'], // teal
    ['#EFE5D8', '#6B4A2F']  // bark
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function hashStr(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initials(sym) {
    var s = String(sym || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return s.slice(0, 2) || '?';
  }

  function monoHtml(sym, sector, px) {
    var t = TINTS[hashStr(sector || sym || '?') % TINTS.length];
    return '<span class="co-mono" aria-hidden="true" style="width:' + px + 'px;height:' + px +
      'px;font-size:' + Math.max(9, Math.round(px * 0.34)) + 'px;background:' + t[0] +
      ';color:' + t[1] + '">' + esc(initials(sym)) + '</span>';
  }

  // Called from the <img onerror> hook: swap a dead logo for the monogram.
  function fallback(img) {
    try {
      var wrap = img.parentNode;
      if (!wrap) return;
      wrap.innerHTML = monoHtml(
        img.getAttribute('data-sym'),
        img.getAttribute('data-sector'),
        +(img.getAttribute('data-px') || 32)
      );
    } catch (e) { /* leave the chip as-is */ }
  }

  // Main entry: logo <img> when mapped, monogram otherwise.
  // sector is used for the fallback tint; px defaults to 32.
  function html(sym, sector, px) {
    px = px || 32;
    var src = (window.NEPSE_LOGOS || {})[sym];
    if (!src) return monoHtml(sym, sector, px);
    return '<span class="co-logo" style="width:' + px + 'px;height:' + px + 'px">' +
      '<img src="' + esc(src) + '" alt="' + esc(sym) + ' logo" loading="lazy" draggable="false" ' +
      'data-sym="' + esc(sym) + '" data-sector="' + esc(sector || '') + '" data-px="' + px + '" ' +
      'onerror="NepseLogo.__fb(this)">' +
      '</span>';
  }

  window.NepseLogo = { html: html, mono: monoHtml, __fb: fallback };
})();

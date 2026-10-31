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

   CSP: html() must NOT emit inline event-handler attributes (script-src
   'self' blocks them and hashes cannot cover handlers). Load/error are
   observed via capture-phase document listeners below instead.
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

  // Called when a logo fails to load (capture listener below;
  // formerly the <img onerror> hook): swap a dead logo for the monogram.
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

  // Called when a logo loads (capture listener below;
  // formerly the <img onload> hook). Two display defects a successful
  // load can still have:
  //  1. Blank-on-white artwork: some official logos are white-only art on
  //     transparency (verified: BGWT, GFCL, GUFL have ZERO non-white opaque
  //     pixels) — inside the white chip they render as an empty circle.
  //     Sample the pixels; if under 0.5% of the image is visible ink
  //     (opaque and not near-white), swap to the monogram.
  //  2. Wide wordmarks (aspect >= 2) are illegible squeezed into a circle
  //     at card sizes (a 192x39 mark shows ~6px tall in a 40px chip).
  //     Widen the chip into a pill so the mark renders at a readable size;
  //     never upscale beyond the asset's native width.
  function check(img) {
    try {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return;
      var cw = Math.min(w, 64), chh = Math.max(1, Math.round(cw * h / w));
      var c = document.createElement('canvas');
      c.width = cw; c.height = chh;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, chh);
      var d = ctx.getImageData(0, 0, cw, chh).data, ink = 0, total = cw * chh;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 16 && !(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245)) ink++;
      }
      if (ink / total < 0.005) { fallback(img); return; }
      if (w / h >= 2.0) {
        var px = +(img.getAttribute('data-px') || 32);
        var wrap = img.parentNode;
        if (wrap) {
          wrap.style.width = Math.min(Math.round(px * 1.9), w) + 'px';
          wrap.style.borderRadius = Math.round(px * 0.3) + 'px';
        }
        img.style.width = '92%';
        img.style.height = 'auto';
        img.style.maxHeight = '88%';
      }
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
      '>' +
      '</span>';
  }

  window.NepseLogo = { html: html, mono: monoHtml, __fb: fallback, __chk: check };

  // CSP: logo load/error hooks live here, not as inline attributes.
  // script-src 'self' blocks inline event handlers, and hashes cannot
  // cover them. Capture-phase listeners on document see every logo
  // image — baked, deferred, or injected later — because error/load do
  // not bubble but do capture. This also keeps unrebuilt pages working:
  // their old inline attributes go inert under an enforced policy, but
  // these listeners still fire and perform the same fallback/check.
  // Double handling is safe: fallback() no-ops once the img is detached,
  // and check() recomputes the same styles.
  function onLogoEvent(e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    var wrap = t.parentNode;
    if (!wrap || !wrap.className || wrap.className.indexOf('co-logo') === -1) return;
    if (e.type === 'error') fallback(t);
    else if (e.type === 'load') check(t);
  }
  document.addEventListener('error', onLogoEvent, true);
  document.addEventListener('load', onLogoEvent, true);

  // Race guard: a cached image can finish loading before this deferred
  // script runs — sweep any logo images already in the DOM and check the
  // completed ones. (Later loads are covered by the listeners above.)
  try {
    var sweep = function () {
      var imgs = document.querySelectorAll('.co-logo img');
      for (var i = 0; i < imgs.length; i++) {
        var im = imgs[i];
        if (im.complete) {
          if (im.naturalWidth) check(im);
          else fallback(im);
        }
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep);
    else sweep();
  } catch (e) { /* non-fatal */ }
})();

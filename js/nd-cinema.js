/* Nepse Decode — cinematic data components (Wave F, 2026-10-23)
 * Pairs with css/nd-cinema.css. Three behaviours, all opt-in and all
 * disabled under prefers-reduced-motion:
 *   1. Count-up: the hero index value (#ndIxCard .big, legacy #d2IdxVal)
 *      counts up ONCE when the first real value lands, and the final
 *      frame writes the page's own formatted string — the exact value,
 *      never a rounded stand-in.
 *   2. Depth-lift: [data-cinema-lift] cards tilt a few degrees toward
 *      the pointer (fine pointers only), transform-only.
 *   3. Ticker: an explicit pause/resume button on .d2-ticker
 *      (hover-pause already exists in the page styles; this is the
 *      keyboard/touch-reachable control).
 */
(function () {
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. count-up ---------- */
  function fmtLike(v, decimals) {
    return v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function countUp(el) {
    var finalText = el.textContent.trim();
    var clean = finalText.replace(/,/g, '');
    var target = parseFloat(clean);
    if (!isFinite(target) || reduced) return; // reduced motion: page value stands as-is
    var decimals = (clean.split('.')[1] || '').length;
    var t0 = null, dur = 950;
    el.classList.add('nd-countup');
    function frame(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      if (k < 1) {
        el.textContent = fmtLike(target * e, decimals);
        requestAnimationFrame(frame);
      } else {
        el.textContent = finalText; // EXACT string the page produced
      }
    }
    requestAnimationFrame(frame);
  }
  function armCountUp() {
    var done = false;
    function tryArm() {
      if (done) return true;
      var el = document.querySelector('#ndIxCard .big') || document.getElementById('d2IdxVal');
      if (el && /[\d]/.test(el.textContent) && el.textContent.trim() !== '—') {
        done = true; countUp(el); return true;
      }
      return false;
    }
    if (tryArm()) return;
    var obs = new MutationObserver(function () { if (tryArm()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(function () { obs.disconnect(); }, 20000); // never observe forever
  }

  /* ---------- 2. depth-lift ---------- */
  function armLift() {
    if (reduced) return;
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    document.querySelectorAll('[data-cinema-lift]').forEach(function (card) {
      var raf = 0;
      card.addEventListener('pointermove', function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var r = card.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width - 0.5;
          var py = (e.clientY - r.top) / r.height - 0.5;
          card.style.setProperty('--cin-ry', (px * 5).toFixed(2) + 'deg');
          card.style.setProperty('--cin-rx', (-py * 5).toFixed(2) + 'deg');
          card.style.setProperty('--cin-ty', '-2px');
        });
      });
      card.addEventListener('pointerleave', function () {
        card.style.setProperty('--cin-rx', '0deg');
        card.style.setProperty('--cin-ry', '0deg');
        card.style.setProperty('--cin-ty', '0px');
      });
    });
  }

  /* ---------- 3. ticker pause control ---------- */
  function armTicker() {
    var ticker = document.querySelector('.d2-ticker');
    if (!ticker || ticker.querySelector('.nd-cinema-ticker-toggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nd-cinema-ticker-toggle';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Pause market ticker');
    btn.textContent = '❚❚';
    btn.addEventListener('click', function () {
      var paused = ticker.classList.toggle('nd-ticker-paused');
      btn.setAttribute('aria-pressed', String(paused));
      btn.setAttribute('aria-label', paused ? 'Resume market ticker' : 'Pause market ticker');
      btn.textContent = paused ? '▶' : '❚❚';
    });
    ticker.appendChild(btn);
  }

  function init() { armCountUp(); armLift(); armTicker(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/**
 * js/nd-screener-verdict.js — Concept 03 engine verdict card + pillrow filters.
 * Score, title, and explanation are computed from REAL screener data only.
 * No mock figures. Wires preview-style pill filters to the existing engine.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- Engine verdict from real signal breadth ---------- */
  function computeVerdict() {
    // Read counts from the live signal cards (populated by nepse-screener.js)
    function n(id) {
      var el = $(id);
      var v = el ? parseInt(el.textContent.replace(/,/g, ''), 10) : 0;
      return isFinite(v) ? v : 0;
    }
    var sbuy = n('sc-n-sbuy'), buy = n('sc-n-buy'), hold = n('sc-n-hold');
    var exit = n('sc-n-exit'), sexit = n('sc-n-sexit'), total = n('sc-n-total');
    if (!total) return null;

    var bullish = sbuy + buy;
    var bearish = exit + sexit;
    var bullPct = bullish / total, bearPct = bearish / total;

    // Score: 50 baseline, +/- up to 50 by net bullish breadth
    var score = Math.round(50 + (bullPct - bearPct) * 100);
    score = Math.max(0, Math.min(100, score));

    var title;
    if (score >= 75) title = 'Risk-on';
    else if (score >= 60) title = 'Cautiously constructive';
    else if (score >= 45) title = 'Neutral / mixed';
    else if (score >= 30) title = 'Cautiously defensive';
    else title = 'Risk-off';

    // Explanation from real counts
    var parts = [];
    parts.push(bullish + ' of ' + total + ' securities carry Buy or Strong Buy signals (' +
      Math.round(bullPct * 100) + '%)');
    parts.push(bearish + ' carry Exit signals (' + Math.round(bearPct * 100) + '%)');
    if (bullPct > bearPct * 1.5) parts.push('bullish breadth dominates');
    else if (bearPct > bullPct * 1.5) parts.push('bearish breadth dominates');
    else parts.push('breadth is balanced');

    return { score: score, title: title, why: parts.join('; ') + '.' };
  }

  function renderVerdict() {
    var scoreEl = $('scVerdictScore'), titleEl = $('scVerdictTitle'), whyEl = $('scVerdictWhy');
    if (!scoreEl || !titleEl || !whyEl) return;
    var v = computeVerdict();
    if (!v) {
      scoreEl.textContent = '—'; titleEl.textContent = 'Loading…'; whyEl.textContent = '';
      return;
    }
    scoreEl.textContent = v.score;
    titleEl.textContent = v.title;
    whyEl.textContent = v.why + ' Signals from the rule-based engine, latest batch.';
  }

  /* ---------- Pillrow quick filters → existing engine controls ---------- */
  function setPill(active) {
    var btns = document.querySelectorAll('#scPillRow button');
    btns.forEach(function (b) { b.classList.toggle('active', b === active); });
  }

  function wirePills() {
    var row = $('scPillRow');
    if (!row) return;
    row.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-scr]');
      if (!btn) return;
      setPill(btn);
      var mode = btn.getAttribute('data-scr');
      var sigSel = $('sc-signal'), rsiSel = $('sc-rsi');
      // Reset first
      if (sigSel) sigSel.value = '';
      if (rsiSel) rsiSel.value = '';
      var evt = new Event('change', { bubbles: true });
      if (mode === 'all') {
        var reset = $('sc-reset');
        if (reset) reset.click();
      } else if (mode === 'momentum') {
        // Momentum: Buy-side signals (engine's trend + RSI factors)
        if (sigSel) { sigSel.value = 'Buy'; sigSel.dispatchEvent(evt); }
      } else if (mode === 'value') {
        // Value proxy: Hold-rated (no strong momentum premium)
        if (sigSel) { sigSel.value = 'Hold'; sigSel.dispatchEvent(evt); }
      } else if (mode === 'liquid') {
        // Most liquid: sort by volume descending via table header
        var volTh = document.querySelector('#sc-table th[data-k="vol"]');
        if (volTh) volTh.click();
      } else if (mode === 'weak') {
        if (sigSel) { sigSel.value = 'Exit / Reduce'; sigSel.dispatchEvent(evt); }
      }
    });
  }

  /* ---------- Init: render after screener data loads ---------- */
  function init() {
    if (!$('scVerdictScore')) return;
    wirePills();
    // Re-render verdict whenever the signal cards update (data load + timeframe change)
    var observer = new MutationObserver(function () { renderVerdict(); });
    ['sc-n-sbuy', 'sc-n-total'].forEach(function (id) {
      var el = $(id);
      if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
    // Initial attempt (in case data already loaded)
    setTimeout(renderVerdict, 1500);
    setTimeout(renderVerdict, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

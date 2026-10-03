/**
 * js/nd-screener-verdict.js — Concept 03 engine verdict card + pillrow filters.
 *
 * Multi-factor market verdict computed from REAL screener data only:
 *   Factor 1 — Signal breadth (35%): share of Buy/Strong Buy vs Exit/Strong Exit
 *   Factor 2 — Score momentum  (25%): average engine score across the universe
 *   Factor 3 — RSI posture     (20%): oversold fuel vs overbought caution
 *   Factor 4 — Participation   (25%): session volume vs average (conviction)
 * No mock figures. Pill filters wire to the existing engine controls.
 */
(function () {
  'use strict';

  var VERDICTS_URL = '../nepse-chart/data/verdicts.json';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- Multi-factor verdict from verdicts.json ---------- */
  var verdictCache = null;

  function fetchVerdicts() {
    if (verdictCache) return Promise.resolve(verdictCache);
    return fetch(VERDICTS_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('verdicts unavailable');
      return r.json();
    }).then(function (d) {
      verdictCache = d;
      return d;
    });
  }

  function computeVerdict(d) {
    var all = d && d.verdicts ? d.verdicts : {};
    var syms = Object.keys(all);
    if (!syms.length) return null;

    var nBuy = 0, nExit = 0, nHold = 0, scoreSum = 0, nScore = 0;
    var nOversold = 0, nOverbought = 0, nRsi = 0;
    var volRatioSum = 0, nVol = 0;

    syms.forEach(function (k) {
      var x = all[k] || {};
      var v = String(x.v || '');
      if (/strong buy/i.test(v)) { nBuy += 2; }
      else if (/^buy/i.test(v)) { nBuy += 1; }
      else if (/strong exit/i.test(v)) { nExit += 2; }
      else if (/exit/i.test(v)) { nExit += 1; }
      else { nHold += 1; }

      if (typeof x.s === 'number' && isFinite(x.s)) { scoreSum += x.s; nScore++; }

      var rsi = Number(x.rsi);
      if (isFinite(rsi)) {
        nRsi++;
        if (rsi < 30) nOversold++;
        else if (rsi > 70) nOverbought++;
      }

      var vol = Number(x.vol), avg = Number(x.volAvg);
      if (isFinite(vol) && isFinite(avg) && avg > 0) {
        volRatioSum += vol / avg;
        nVol++;
      }
    });

    var total = syms.length;

    // Factor 1 — Signal breadth (35%): weighted buy vs exit share → 0..100
    var f1 = total ? clamp(50 + ((nBuy - nExit) / (2 * total)) * 100, 0, 100) : 50;

    // Factor 2 — Score momentum (25%): average score mapped from [-10, +10] → 0..100
    var avgScore = nScore ? scoreSum / nScore : 0;
    var f2 = clamp(50 + avgScore * 5, 0, 100);

    // Factor 3 — RSI posture (20%): oversold = latent fuel (bullish), overbought = caution
    var f3 = nRsi ? clamp(50 + ((nOversold - nOverbought) / nRsi) * 100, 0, 100) : 50;

    // Factor 4 — Participation (20%): avg volume ratio; 1.0x = neutral 50
    var avgVolRatio = nVol ? volRatioSum / nVol : 1;
    var f4 = clamp(50 + (avgVolRatio - 1) * 60, 0, 100);

    var score = Math.round(f1 * 0.35 + f2 * 0.25 + f3 * 0.20 + f4 * 0.20);

    var title;
    if (score >= 75) title = 'Risk-on';
    else if (score >= 60) title = 'Cautiously constructive';
    else if (score >= 45) title = 'Neutral / mixed';
    else if (score >= 30) title = 'Cautiously defensive';
    else title = 'Risk-off';

    var bullPct = Math.round((nBuy / (2 * total)) * 100);
    var bearPct = Math.round((nExit / (2 * total)) * 100);

    var parts = [];
    parts.push('signal breadth ' + bullPct + '% buy-side vs ' + bearPct + '% exit-side');
    parts.push('average engine score ' + (avgScore >= 0 ? '+' : '') + avgScore.toFixed(1));
    parts.push('RSI posture: ' + nOversold + ' oversold, ' + nOverbought + ' overbought of ' + nRsi + ' scored');
    parts.push('participation ' + avgVolRatio.toFixed(2) + '× average volume');

    return {
      score: score, title: title,
      why: parts.join(' · ') + '.',
      asof: d.asof || '', total: total,
      factors: [
        { name: 'Signal breadth', w: 35, v: Math.round(f1) },
        { name: 'Score momentum', w: 25, v: Math.round(f2) },
        { name: 'RSI posture', w: 20, v: Math.round(f3) },
        { name: 'Participation', w: 20, v: Math.round(f4) }
      ]
    };
  }

  function renderVerdict() {
    var scoreEl = $('scVerdictScore'), titleEl = $('scVerdictTitle'), whyEl = $('scVerdictWhy');
    if (!scoreEl || !titleEl || !whyEl) return;
    fetchVerdicts().then(function (d) {
      var v = computeVerdict(d);
      if (!v) {
        scoreEl.textContent = '—'; titleEl.textContent = 'Data unavailable'; whyEl.textContent = '';
        return;
      }
      scoreEl.textContent = v.score;
      titleEl.textContent = v.title;
      var fHtml = v.factors.map(function (f) {
        return '<span class="sc-fchip" title="' + esc(f.name) + ' (' + f.w + '% weight)">' +
          esc(f.name) + ' ' + f.v + '</span>';
      }).join('');
      whyEl.innerHTML = esc(v.why) + '<br><span class="sc-factors">' + fHtml + '</span>' +
        '<br><span class="sc-vsrc">Batch of ' + esc(v.asof) + ' · ' + v.total +
        ' securities · mechanical output, not investment advice.</span>';
    }).catch(function () {
      scoreEl.textContent = '—'; titleEl.textContent = 'Data unavailable';
      whyEl.textContent = 'Could not load the verdict batch. Please reload the page.';
    });
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
        // Value proxy: Hold-rated AND oversold RSI — neglected, no momentum premium, washed out
        if (sigSel) { sigSel.value = 'Hold'; sigSel.dispatchEvent(evt); }
        if (rsiSel) { rsiSel.value = 'os'; rsiSel.dispatchEvent(evt); }
      } else if (mode === 'liquid') {
        // Most liquid: sort by volume descending via table header
        var volTh = document.querySelector('#sc-table th[data-k="vol"]');
        if (volTh) volTh.click();
      } else if (mode === 'weak') {
        if (sigSel) { sigSel.value = 'Exit / Reduce'; sigSel.dispatchEvent(evt); }
      }
    });
  }

  /* ---------- Init ---------- */
  function init() {
    if (!$('scVerdictScore')) return;
    wirePills();
    renderVerdict();
    // Re-render when the screener's own data refreshes
    var observer = new MutationObserver(function () {
      verdictCache = null;
      renderVerdict();
    });
    ['sc-n-sbuy', 'sc-n-total'].forEach(function (id) {
      var el = $(id);
      if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

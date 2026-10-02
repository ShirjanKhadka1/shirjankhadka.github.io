/* NEPSE ticker for the blog page (Phase 1: NepseData).
 *
 * Renders an infinite marquee of per-symbol chips from the canonical
 * validated market snapshot (js/nepse-data.js). Quarantined quotes are
 * never shown — NepseData.getQuotes() filters them. Validation failures
 * keep the last-good snapshot and mark it STALE; the note always reflects
 * reality.
 *
 * Fails silent: if the snapshot is missing, older than 72h, or
 * unparseable, the ticker stays hidden. It never breaks the page and
 * never shows zeros or placeholders as real data. Client-side code must
 * NEVER call nepalstock.com directly (CORS + aggressive rate limits);
 * the validated snapshot is the only data source.
 *
 * Requires (in order, before this script):
 *   /js/nepse-market-config.js, /js/nepse-format.js, /js/nepse-data.js
 */
(function () {
  'use strict';

  var WRAP_ID = 'indexTickerWrap';
  var TRACK_ID = 'indexTickerTrack';
  var NOTE_ID = 'indexTickerNote';
  var STALE_MS = 72 * 60 * 60 * 1000; // hide if snapshot older than 72h
  // Marquee speed: the CSS defaults to 45s, but with ~350 symbols the track
  // is ~200,000px wide and 45s becomes an unreadable ~2,200px/s blur.
  // Scale the duration to content width so the tape always drifts at a
  // calm, readable pace no matter how many symbols are listed.
  var TICKER_PX_PER_SEC = 60;
  var lastTickerW = 0;
  var UP = '▲';
  var DOWN = '▼';
  var SEP = '·';

  var F = window.NepseFormat || null;
  var ND = window.NepseData || null;

  function fmt(n) {
    return F ? F.fmtPrice(n) : String(n);
  }

  // Unsigned percent for the chip: the ▲/▼ glyph already carries direction.
  // NepseFormat.fmtPct(1.23) -> "+1.23%"; strip the leading "+".
  function pctAbs(p) {
    var n = Math.abs(Number(p));
    if (!isFinite(n)) return '';
    if (!F) return n.toFixed(2) + '%';
    var s = F.fmtPct(n);
    return s.charAt(0) === '+' ? s.slice(1) : s;
  }

  function validQuote(q) {
    return q && typeof q.symbol === 'string' && q.symbol.length > 0 &&
      typeof q.ltp === 'number' && isFinite(q.ltp) &&
      typeof q.change === 'number' && isFinite(q.change);
  }

  // All untrusted strings go through textContent only; no innerHTML anywhere.
  function chipEl(q) {
    var span = document.createElement('span');
    span.className = 'tick-item';
    var strong = document.createElement('strong');
    strong.textContent = q.symbol;
    span.appendChild(strong);
    span.appendChild(document.createTextNode(' ' + fmt(q.ltp) + ' '));
    var b = document.createElement('b');
    var ch = Number(q.change) || 0;
    b.className = ch > 0 ? 'tick-up' : (ch < 0 ? 'tick-down' : 'tick-flat');
    var glyph = ch > 0 ? UP + ' ' : (ch < 0 ? DOWN + ' ' : '');
    var pct = isFinite(Number(q.percent_change)) ? ' (' + pctAbs(q.percent_change) + ')' : '';
    b.textContent = glyph + fmt(Math.abs(ch)) + pct;
    span.appendChild(b);
    return span;
  }

  function sepEl() {
    var sep = document.createElement('span');
    sep.className = 'tick-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = SEP;
    return sep;
  }

  // One render pass, one source. `note` is the honest source label.
  function render(items, note) {
    items = items.filter(validQuote);
    if (items.length === 0) return false;
    var track = document.getElementById(TRACK_ID);
    var wrap = document.getElementById(WRAP_ID);
    var noteEl = document.getElementById(NOTE_ID);
    if (!track || !wrap) return false;
    while (track.firstChild) track.removeChild(track.firstChild);
    var g1 = document.createElement('div');
    g1.className = 'ticker-group';
    var g2 = document.createElement('div');
    g2.className = 'ticker-group';
    g2.setAttribute('aria-hidden', 'true');
    items.forEach(function (q) {
      g1.appendChild(chipEl(q));
      g1.appendChild(sepEl());
      g2.appendChild(chipEl(q));
      g2.appendChild(sepEl());
    });
    track.appendChild(g1);
    track.appendChild(g2);
    wrap.hidden = false; // unhide BEFORE measuring: offsetWidth is 0 under display:none
    // Constant-speed marquee: measure one group and stretch the 45s CSS
    // default to TICKER_PX_PER_SEC. Only touch the duration when the width
    // actually changed, so routine data polls don't restart the animation.
    var gw = g1.offsetWidth;
    if (gw > 0 && Math.abs(gw - lastTickerW) > 50) {
      lastTickerW = gw;
      track.style.animationDuration = Math.round(gw / TICKER_PX_PER_SEC) + 's';
    }
    if (noteEl && note) noteEl.textContent = note;
    return true;
  }

  function hide() {
    var wrap = document.getElementById(WRAP_ID);
    if (wrap) wrap.hidden = true;
  }

  function noteFor(snapshot, status) {
    var asof = snapshot.asof;
    if (status === 'stale') {
      return 'STALE ' + SEP + ' last verified ' +
        (F ? F.fmtDateTimeNPT(asof) : String(asof));
    }
    if (snapshot.market === 'OPEN') {
      return 'LIVE ' + SEP + ' as of ' + (F ? F.fmtTimeNPT(asof) : String(asof));
    }
    // Market closed: the snapshot is the last closed session — label it so.
    return 'Market closed ' + SEP + ' last session ' +
      (F ? F.fmtDateNPT(asof) : String(asof));
  }

  function onData(snapshot, status) {
    if (!snapshot) { hide(); return; } // loading / error: stay hidden, stay silent
    var age = Date.now() - snapshot.asofMs;
    if (!isFinite(age) || age < 0 || age > STALE_MS) { hide(); return; }
    var items = ND.getQuotes().slice().sort(function (a, b) {
      return a.symbol < b.symbol ? -1 : (a.symbol > b.symbol ? 1 : 0);
    });
    if (!render(items, noteFor(snapshot, status))) hide();
  }

  function init() {
    if (!ND || !document.getElementById(TRACK_ID)) return; // modules missing: stay hidden
    ND.start(); // idempotent
    ND.subscribe(onData);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

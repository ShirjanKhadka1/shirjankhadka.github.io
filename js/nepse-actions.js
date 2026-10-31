/* js/nepse-actions.js — Corporate Actions archive (live layer).
 *
 * Owns the live refresh of /nepse-actions/: kind pills, session strip,
 * symbol search, feed + pager, notice-mix / open-closed / upcoming-close
 * visuals, and the sector stock directory. The baked snapshot in the HTML
 * is the first paint; this file re-renders from the published JSON files.
 *
 * Refresh gate (news fading lesson): the 5-minute tick fetches
 * corporate-actions.json + div-live.json with cache:no-store, but it
 * re-renders ONLY when the render signature changed. On an unchanged
 * tick only the freshness line moves, so cards never flicker or lose
 * DOM state. A genuine change re-renders with an "N new" notice;
 * a failed tick keeps the old feed and reports the failure in the
 * freshness line (it never blanks the baked snapshot).
 *
 * Status is computed at VIEW TIME from the book-close date vs today in
 * Asia/Kathmandu (Open until the book-close passes, then Closed). The
 * book-close resolves from the item itself first, then from the matched
 * div-live record (same nearest-announcement matcher as the figure
 * strips) — so a dividend whose book-close lives only in div-live
 * (VLUCL, MEN, BARUN) still flips on its own. The render signature
 * includes the Kathmandu date, so the first tick after midnight
 * re-renders and flips statuses even when the payloads are identical.
 */
(function () {
  'use strict';

  var CA_URL = '/nepse-chart/data/corporate-actions.json';
  var DIV_URL = '/nepse-chart/data/div-live.json';
  var VERDICTS_URL = '/nepse-chart/data/verdicts.json';
  var UNI_URL = '/nepse-chart/data/universe.json';
  var PAGE = 6, SECTOR_PAGE = 25, TICK_MS = 300000;

  var KIND_LABEL = {
    'dividend': 'Dividend', 'bonus-share': 'Dividend',
    'right-share': 'Right share', 'promoter-share': 'Promoter share',
    'auction': 'Auction', 'lock-in': 'Lock-in',
    'meeting': 'Meeting', 'book-close': 'Book close'
  };
  function normKind(k) { return k === 'bonus-share' ? 'dividend' : (k || ''); }
  function kindLabel(k) { return KIND_LABEL[k] || (k ? k.replace(/-/g, ' ') : 'Notice'); }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }
  function fmtShort(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1];
  }
  function nptToday() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    } catch (e) {
      var kd = new Date(Date.now() + 20700000);
      return kd.getUTCFullYear() + '-' + ('0' + (kd.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + kd.getUTCDate()).slice(-2);
    }
  }
  function nptClock() {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
    } catch (e) { return ''; }
  }
  function daysBetween(a, b) {
    return Math.floor((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  /* ---------------- state ---------------- */
  var items = [], DIV = null, verdicts = null, universe = null, universeNames = {};
  var activeKind = '', activeSession = 'all', page = 1;
  var sectorSel = 'all', sectorPage = 1;
  var lastSig = null, lastStoryKeys = null, hasLoaded = false, verdictsSig = null;

  /* ---------------- data joins ---------------- */
  function divMatch(it) {
    if (!DIV || !DIV.companies || !it.symbol || !DIV.companies[it.symbol]) return null;
    var ann = String(it.announced || ''), best = null, bestD = 9999;
    DIV.companies[it.symbol].forEach(function (r) {
      if (!r.announcement_date || !ann) return;
      var d = Math.abs(daysBetween(r.announcement_date, ann));
      if (d < bestD) { best = r; bestD = d; }
    });
    return bestD <= 60 ? best : null;
  }
  function divBookclose(it) {
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(it.bookclose_date || ''));
    if (m) return m[1];
    var rec = divMatch(it);
    if (rec) { var m2 = /^(\d{4}-\d{2}-\d{2})/.exec(String(rec.bookclose_date || '')); if (m2) return m2[1]; }
    return '';
  }
  /* Status at view time. Promoter/lock-in notices carry no
     book-close and show no status pill. */
  /* Outcome vocabulary (split 2026-10-31) - mirrors the builder. */
  function normOutcome(it) {
    var oc = String(it.outcome || '');
    if (oc === 'withdrawn') return 'withdrawn';
    if (oc === 'no_declaration') return 'no_declaration';
    if (oc !== 'not_distributed') return '';
    var rec = divMatch(it);
    if (rec && (Number(rec.bonus_share) > 0 || Number(rec.cash_dividend) > 0)) return 'withdrawn';
    return 'no_declaration';
  }
  function statusOf(it) {
    var k = String(it.kind || '');
    var oc = normOutcome(it);
    if (oc === 'withdrawn') return 'Closed';
    if (oc === 'no_declaration') return 'No dividend';
    var today = nptToday();
    if (k === 'ipo' || k === 'auction') {
      var winOpen = String(it.opening_date || '').slice(0, 10);
      var winClose = String(it.closing_date || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(winOpen) && /^\d{4}-\d{2}-\d{2}$/.test(winClose)) {
        if (today > winClose) return 'Closed';
        if (today >= winOpen) return 'Open';
        return 'Pending';
      }
      var bc0 = divBookclose(it);
      if (/^\d{4}-\d{2}-\d{2}$/.test(bc0)) return bc0 < today ? 'Closed' : 'Pending';
      var ann0 = /^(\d{4}-\d{2}-\d{2})/.exec(String(it.announced || ''));
      if (ann0) { var days0 = daysBetween(ann0[1], today); if (days0 >= 0 && days0 <= 365) return 'Pending'; }
      return null;
    }
    if (k !== 'dividend' && k !== 'bonus-share' && k !== 'right-share') return null;
    var bc = divBookclose(it);
    if (/^\d{4}-\d{2}-\d{2}$/.test(bc)) return bc < today ? 'Closed' : (k === 'right-share' ? 'Pending' : 'Open');
    var ann = /^(\d{4}-\d{2}-\d{2})/.exec(String(it.announced || ''));
    if (ann) {
      var days = daysBetween(ann[1], today);
      if (days >= 0 && days <= 365) return k === 'right-share' ? 'Pending' : 'Open';
    }
    return null;
  }
  /* Stock-page set, in priority order: (1) the baked cards' own
     link/no-link decisions, scraped from the DOM before the first
     render — the builder derives these from the stocks/ directory,
     which is the ground truth (it holds 428 pages: the 412 universe
     symbols plus debenture/preference lines like NABILP, and dash
     spellings of slash series like GBILD84-85); (2) the universe set
     for symbols that arrived via live refresh after the bake. */
  var bakedPageSet = {};
  (function scrapeBakedChips() {
    var feed = document.getElementById('na-feed');
    if (!feed) return;
    feed.querySelectorAll('a.na-sym').forEach(function (a) {
      bakedPageSet[a.textContent.trim()] = true;
    });
    feed.querySelectorAll('span.na-sym--nolink').forEach(function (s) {
      bakedPageSet[s.textContent.trim()] = false;
    });
  })();
  function stockPageSet() {
    if (universe && universe.symbols) {
      var s = {};
      universe.symbols.forEach(function (u) { s[u.s] = true; });
      return s;
    }
    return null;
  }
  function symChip(sym) {
    if (!sym) return '';
    if (Object.prototype.hasOwnProperty.call(bakedPageSet, sym)) {
      return bakedPageSet[sym]
        ? '<a class="na-sym" href="/stocks/' + esc(sym) + '/">' + esc(sym) + '</a>'
        : '<span class="na-sym na-sym--nolink">' + esc(sym) + '</span>';
    }
    var set = stockPageSet();
    if (set && !set[sym]) return '<span class="na-sym na-sym--nolink">' + esc(sym) + '</span>';
    return '<a class="na-sym" href="/stocks/' + esc(sym) + '/">' + esc(sym) + '</a>';
  }

  /* ---------------- card HTML (mirrors the builder's baked cards) ---------------- */
  function trimNum(v) {
    var s = String(v);
    return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  }
  function figuresHTML(it) {
    if (normKind(it.kind) !== 'dividend') return '';
    if (!DIV || !DIV.companies) return '';
    if (it.facts && typeof it.facts === 'object' && Object.keys(it.facts).length) return '';
    if (/%/.test(String(it.headline || ''))) return '';
    var rec = divMatch(it);
    if (!rec) return '';
    var chips = [];
    function chip(label, val, total) {
      var n = Number(val);
      if (!isFinite(n) || n <= 0) return;
      chips.push('<span class="na-fig' + (total ? ' na-fig-total' : '') +
        '" title="Figures as recorded in the verified investment calendar"><b>' + esc(trimNum(val)) + '%</b>&nbsp;' + esc(label) + '</span>');
    }
    chip('bonus', rec.bonus_share, false);
    chip('cash', rec.cash_dividend, false);
    chip('total', Number(rec.total_dividend) || (Number(rec.bonus_share) || 0) + (Number(rec.cash_dividend) || 0), true);
    return chips.length ? '<div class="na-figs">' + chips.join('') + '</div>' : '';
  }
  function cardHTML(it) {
    var kk = normKind(it.kind), kind = kindLabel(kk), dot = ' <span class="na-dot">·</span> ';
    var st = statusOf(it);
    var status = st
      ? '<span class="na-status ' + (st === 'Open' ? 'is-open' : st === 'Closed' ? 'is-closed' : st === 'Pending' ? 'is-pending' : 'is-nodiv') +
        '" data-bc="' + esc(divBookclose(it)) + '" data-ann="' + esc(String(it.announced || '').slice(0, 10)) + (normOutcome(it) ? '" data-outcome="' + esc(normOutcome(it)) + '"' : '"') + '>' + st + '</span>'
      : '';
    var oc = normOutcome(it);
    var note = oc === 'no_declaration'
      ? '<p class="na-note">Board decided not to distribute a dividend' + (it.fiscal_year ? ' for FY ' + esc(it.fiscal_year) : '') + '.</p>'
      : oc === 'withdrawn'
        ? '<p class="na-note">Proposal withdrawn.</p>'
        : '';
    var facts = '';
    if (it.facts && typeof it.facts === 'object') {
      var rows = [];
      Object.keys(it.facts).forEach(function (k) {
        var v = it.facts[k];
        if (v === null || v === undefined || v === '') return;
        var val = (typeof v === 'number' && v >= 1000) ? v.toLocaleString('en-US') : String(v);
        var label = k.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); });
        rows.push('<div class="na-fact"><dt>' + esc(label) + '</dt><dd>' + esc(val) + '</dd></div>');
      });
      if (rows.length) facts = '<dl class="na-facts">' + rows.join('') + '</dl>';
    }
    return '<article class="na-card" data-kind="' + esc(kk) + '" data-sym="' + esc(String(it.symbol || '').toLowerCase()) + '" data-year="' + esc(String(it.announced || '').slice(0, 4)) + '">' +
      '<div class="na-top"><span class="na-kind k-' + esc(kk) + '">' + esc(kind) + '</span>' +
      symChip(it.symbol) + status + '</div>' +
      '<h3 class="na-head">' + esc(it.headline) + '</h3>' + figuresHTML(it) + facts + note +
      '<p class="na-meta">' + (it.company ? esc(it.company) + dot : '') +
      (it.announced ? 'Announced ' + fmtDate(it.announced) + dot : '') +
      (it.officialPdf ? '<a href="' + esc(it.officialPdf) + '" rel="noopener" target="_blank">Official NEPSE PDF ↗</a>' : '') + '</p></article>';
  }

  /* ---------------- filters + feed ---------------- */
  function isMatch(it) {
    var yearEl = $('na-year'), y = yearEl ? yearEl.value : '';
    var qEl = $('na-q'), s = qEl ? qEl.value.trim().toLowerCase() : '';
    return (!y || String(it.announced || '').slice(0, 4) === y) &&
      (!activeKind || normKind(it.kind) === activeKind) &&
      (activeSession === 'all' || String(it.announced || '').slice(0, 10) === activeSession) &&
      (!s || String(it.symbol || '').toLowerCase().indexOf(s) !== -1);
  }
  function renderFeed() {
    var feed = $('na-feed'), count = $('na-count'), info = $('na-page-info'),
        prev = $('na-prev'), next = $('na-next'), pager = $('na-pager');
    if (!feed) return;
    var filtered = items.filter(isMatch);
    var pages = Math.max(1, Math.ceil(filtered.length / PAGE));
    if (page > pages) page = pages;
    var start = (page - 1) * PAGE, end = Math.min(start + PAGE, filtered.length);
    var years = {};
    filtered.slice(start, end).forEach(function (it) {
      var y = String(it.announced || '').slice(0, 4) || '';
      (years[y] = years[y] || []).push(it);
    });
    var html = '';
    Object.keys(years).sort().reverse().forEach(function (y) {
      if (y) html += '<h2 class="na-year">' + esc(y) + '</h2>';
      html += '<div class="na-feed">' + years[y].map(cardHTML).join('') + '</div>';
    });
    feed.innerHTML = html || '<p class="na-empty">No notices match these filters.</p>';
    if (count) count.textContent = filtered.length + ' of ' + items.length + ' notices';
    if (info) info.textContent = filtered.length
      ? 'Showing ' + (start + 1) + '–' + end + ' of ' + filtered.length + (pages > 1 ? ' · page ' + page + ' of ' + pages : '')
      : 'No notices match.';
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= pages;
    if (pager) pager.style.display = pages > 1 ? '' : 'none';
  }
  function renderSessions() {
    var strip = $('na-session-strip');
    if (!strip) return;
    var counts = {};
    items.forEach(function (it) {
      var d = String(it.announced || '').slice(0, 10);
      if (d) counts[d] = (counts[d] || 0) + 1;
    });
    var dates = Object.keys(counts).sort().reverse();
    var html = '<button type="button" class="na-session' + (activeSession === 'all' ? ' is-active' : '') +
      '" data-session="all" aria-pressed="' + (activeSession === 'all') + '">All · ' + items.length + '</button>';
    dates.forEach(function (d) {
      html += '<button type="button" class="na-session' + (activeSession === d ? ' is-active' : '') +
        '" data-session="' + esc(d) + '" aria-pressed="' + (activeSession === d) + '">' +
        fmtShort(d) + ' · ' + counts[d] + '</button>';
    });
    strip.innerHTML = html;
  }
  function renderViz() {
    var kindEl = $('na-viz-kind'), statusEl = $('na-viz-status'), closesEl = $('na-viz-closes');
    if (!kindEl && !statusEl && !closesEl) return;
    /* Kind mix (display kinds; zero-count kinds render no segment). */
    var kc = {};
    items.forEach(function (it) { var k = normKind(it.kind); kc[k] = (kc[k] || 0) + 1; });
    var total = items.length || 1;
    var order = ['dividend', 'promoter-share', 'right-share', 'auction', 'lock-in', 'meeting', 'book-close'];
    var kinds = order.filter(function (k) { return kc[k]; });
    Object.keys(kc).forEach(function (k) { if (kinds.indexOf(k) === -1) kinds.push(k); });
    if (kindEl) {
      var segs = kinds.map(function (k) {
        return '<span class="na-mix-seg k-' + esc(k) + '" style="width:' + (kc[k] / total * 100).toFixed(1) + '%"></span>';
      }).join('');
      var legend = kinds.map(function (k) {
        return '<span class="na-mix-item"><i class="na-mix-dot k-' + esc(k) + '"></i>' +
          esc(kindLabel(k)) + ' <b>' + kc[k] + '</b></span>';
      }).join('');
      kindEl.innerHTML = '<div class="na-mix-bar" role="img" aria-label="Notice mix: ' +
        kinds.map(function (k) { return kindLabel(k) + ' ' + kc[k]; }).join(', ') + '">' + segs + '</div>' +
        '<div class="na-mix-legend">' + legend + '</div>';
    }
    /* Open / Closed among dividend + rights items. */
    if (statusEl) {
      var open = 0, closed = 0, pending = 0, nodiv = 0, nostatus = 0;
      items.forEach(function (it) {
        var st = statusOf(it);
        if (st === 'Open') open++;
        else if (st === 'Closed') closed++;
        else if (st === 'Pending') pending++;
        else if (st === 'No dividend') nodiv++;
        else nostatus++;
      });
      var bar = open ? '<div class="na-mix-bar" role="img" aria-label="Open ' + open + ', Closed ' + closed + '">' +
        '<span class="na-mix-seg k-open" style="width:' + (open / (open + closed || 1) * 100).toFixed(1) + '%"></span></div>' : '';
      statusEl.innerHTML = '<div class="na-statline"><span><b>' + open + '</b> Open</span>' +
        '<span><b>' + closed + '</b> Closed</span>' + (pending ? '<span><b>' + pending + '</b> Pending</span>' : '') + (nodiv ? '<span><b>' + nodiv + '</b> No dividend</span>' : '') + '</div>' + bar +
        '<p class="na-viz-note">' + nostatus + ' promoter / lock-in notices carry no book-close date and show no status.</p>';
    }
    /* Upcoming book-closes, nearest first. */
    if (closesEl) {
      var today = nptToday();
      var up = [];
      items.forEach(function (it) {
        var k = String(it.kind || '');
        if (k !== 'dividend' && k !== 'bonus-share' && k !== 'right-share') return;
        var bc = divBookclose(it);
        if (bc && bc >= today) up.push({ it: it, bc: bc });
      });
      up.sort(function (a, b) { return a.bc < b.bc ? -1 : (a.bc > b.bc ? 1 : 0); });
      if (!up.length) {
        closesEl.innerHTML = '<p class="na-viz-note">No upcoming book-closes in the archive.</p>';
      } else {
        closesEl.innerHTML = '<ul class="na-closes">' + up.map(function (u) {
          var d = daysBetween(today, u.bc);
          var rel = d === 0 ? 'today' : (d === 1 ? 'tomorrow' : 'in ' + d + ' days');
          return '<li>' + symChip(u.it.symbol) + '<span class="na-close-kind">' + esc(kindLabel(normKind(u.it.kind))) + '</span>' +
            '<span class="na-close-date">' + fmtDate(u.bc) + '</span>' +
            '<span class="na-close-rel">' + rel + '</span></li>';
        }).join('') + '</ul>';
      }
    }
  }

  /* ---------------- sector directory ---------------- */
  function actionsBySymbol() {
    var m = {};
    items.forEach(function (it) { if (it.symbol) m[it.symbol] = (m[it.symbol] || 0) + 1; });
    return m;
  }
  function renderSector() {
    var sel = $('na-sector-select'), body = $('na-sector-body');
    if (!sel || !body || !verdicts || !universe) return;
    var secOf = {};
    Object.keys(verdicts).forEach(function (s) { secOf[s] = verdicts[s].sec || 'Others'; });
    var names = {};
    universe.symbols.forEach(function (u) { names[u.s] = u.n; });
    var counts = {};
    Object.keys(secOf).forEach(function (s) { counts[secOf[s]] = (counts[secOf[s]] || 0) + 1; });
    var sectors = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var total = Object.keys(secOf).length;
    sel.innerHTML = '<option value="all">All sectors (' + total + ')</option>' +
      sectors.map(function (s) {
        return '<option value="' + esc(s) + '"' + (sectorSel === s ? ' selected' : '') + '>' + esc(s) + ' (' + counts[s] + ')</option>';
      }).join('');
    var rows = Object.keys(secOf)
      .filter(function (s) { return sectorSel === 'all' || secOf[s] === sectorSel; })
      .sort();
    var pages = Math.max(1, Math.ceil(rows.length / SECTOR_PAGE));
    if (sectorPage > pages) sectorPage = pages;
    var start = (sectorPage - 1) * SECTOR_PAGE, end = Math.min(start + SECTOR_PAGE, rows.length);
    var acts = actionsBySymbol();
    body.innerHTML = rows.slice(start, end).map(function (s) {
      var mark = acts[s] ? '<span class="na-sec-mark" title="' + acts[s] + ' archive notice(s)">● ' + acts[s] + '</span>' : '';
      return '<tr><td><a class="na-sym" href="/stocks/' + esc(s) + '/">' + esc(s) + '</a> ' + mark + '</td>' +
        '<td>' + esc(names[s] || '') + '</td><td>' + esc(secOf[s]) + '</td></tr>';
    }).join('');
    var info = $('na-sector-info'), prev = $('na-sector-prev'), next = $('na-sector-next'), pager = $('na-sector-pager');
    if (info) info.textContent = 'Showing ' + (rows.length ? (start + 1) + '–' + end + ' of ' + rows.length : '0 of 0') +
      (pages > 1 ? ' · page ' + sectorPage + ' of ' + pages : '');
    if (prev) prev.disabled = sectorPage <= 1;
    if (next) next.disabled = sectorPage >= pages;
    if (pager) pager.style.display = pages > 1 ? '' : 'none';
    var note = $('na-sector-note');
    if (note) note.style.display = 'none';
  }

  /* ---------------- freshness + gate ---------------- */
  function setFresh(ok, updated) {
    var line = $('na-fresh-line');
    if (!line) return;
    var clock = nptClock();
    if (ok) {
      line.innerHTML = 'Archive updated ' + fmtDate(updated) + ' · checked ' + clock + ' NPT · next check in 5 min · ' +
        items.length + ' verified notices';
      line.classList.remove('is-failed');
    } else {
      line.textContent = 'Archive check failed at ' + clock + ' NPT — showing last good data · next retry in 5 min';
      line.classList.add('is-failed');
    }
  }
  function showNew(n) {
    var note = $('na-new-note');
    if (!note) return;
    if (n > 0) {
      note.textContent = n + ' new notice' + (n === 1 ? '' : 's');
      note.style.display = '';
    } else { note.style.display = 'none'; }
  }
  function signature() {
    var key = items.map(function (it) {
      return [it.storyKey || '', it.kind || '', it.symbol || '', it.announced || '',
        it.headline || '', it.bookclose_date || '', it.outcome || ''].join('~');
    }).join('\n');
    var divKey = '';
    if (DIV) {
      divKey = String(DIV.asof || '') + '|' + items.map(function (it) {
        var r = divMatch(it);
        return r ? [r.bonus_share, r.cash_dividend, r.total_dividend, r.announcement_date, r.bookclose_date].join('~') : '-';
      }).join(',');
    }
    /* The Kathmandu date is part of the signature: the first tick after
       midnight re-renders so Open/Closed pills flip even when the
       payloads are byte-identical. */
    return nptToday() + '|' + key + '||' + divKey;
  }
  function load(boot) {
    return Promise.all([
      fetch(CA_URL, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
      }),
      fetch(DIV_URL, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (pair) {
      var d = pair[0], fresh = d.items || [];
      if (!fresh.length) return;
      var prevKeys = lastStoryKeys;
      items = fresh.slice().sort(function (a, b) {
        return String(b.announced || '').localeCompare(String(a.announced || ''));
      });
      DIV = pair[1];
      var sig = signature();
      if (!boot && sig === lastSig) { setFresh(true, d.updated); return; }
      lastSig = sig;
      var keys = items.map(function (it) { return it.storyKey || (it.kind + '|' + (it.symbol || '') + '|' + (it.announced || '')); });
      if (!boot && prevKeys) {
        var known = {};
        prevKeys.forEach(function (k) { known[k] = true; });
        var nNew = keys.filter(function (k) { return !known[k]; }).length;
        showNew(nNew);
      }
      lastStoryKeys = keys;
      hasLoaded = true;
      renderSessions();
      renderViz();
      renderFeed();
      renderSector();
      setFresh(true, d.updated);
    }).catch(function () {
      /* Failure keeps the old feed (or the baked snapshot on boot) and
         says so in the freshness line. It never blanks the page. */
      setFresh(false);
    });
  }
  function loadVerdicts(boot) {
    return Promise.all([
      fetch(VERDICTS_URL, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
      }),
      fetch(UNI_URL, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
      })
    ]).then(function (pair) {
      var sig = String(pair[0].asof || '') + '|' + String(pair[0].count || '');
      if (!boot && sig === verdictsSig) return;
      verdictsSig = sig;
      verdicts = pair[0].verdicts || pair[0];
      universe = pair[1];
      renderSector();
      /* Sector names feed the symbol chips: re-render the feed so
         no-link chips stay correct once the universe is known. */
      if (hasLoaded) renderFeed();
    }).catch(function () {
      var note = $('na-sector-note');
      if (note) { note.textContent = 'Sector directory unavailable — showing baked snapshot.'; note.style.display = ''; }
    });
  }

  /* ---------------- wiring ---------------- */
  function reset() { page = 1; showNew(0); renderFeed(); }
  var pills = document.querySelectorAll('#naPills .na-pill');
  pills.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activeKind = btn.getAttribute('data-kind') || '';
      pills.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      reset();
    });
  });
  var strip = $('na-session-strip');
  if (strip) strip.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('.na-session') : null;
    if (!btn) return;
    activeSession = btn.getAttribute('data-session') || 'all';
    renderSessions();
    reset();
  });
  var yearEl = $('na-year');
  if (yearEl) yearEl.addEventListener('change', reset);
  var qEl = $('na-q');
  if (qEl) qEl.addEventListener('input', reset);
  var prev = $('na-prev'), next = $('na-next');
  if (prev) prev.addEventListener('click', function () { if (page > 1) { page--; renderFeed(); } });
  if (next) next.addEventListener('click', function () {
    if (page < Math.ceil(items.filter(isMatch).length / PAGE)) { page++; renderFeed(); }
  });
  var ssel = $('na-sector-select');
  if (ssel) ssel.addEventListener('change', function () {
    sectorSel = ssel.value; sectorPage = 1; renderSector();
  });
  var sprev = $('na-sector-prev'), snext = $('na-sector-next');
  if (sprev) sprev.addEventListener('click', function () { if (sectorPage > 1) { sectorPage--; renderSector(); } });
  if (snext) snext.addEventListener('click', function () { sectorPage++; renderSector(); });

  load(true);
  loadVerdicts(true);
  setInterval(function () { if (!document.hidden) load(false); }, TICK_MS);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { load(false); loadVerdicts(false); }
  });
})();

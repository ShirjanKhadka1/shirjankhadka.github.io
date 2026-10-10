/**
 * js/nd-chrome.js — Editorial header + footer (D2).
 * Single-row 60px sticky header: brand, Ask/Stock search, six
 * mega-dropdowns, Technical Analysis link, market-status
 * pill, dark/light switch, EN/NE toggle, mobile drawer.
 * Seven-column design-rich footer with company column + disclaimers.
 *
 * Mounts: <div id="nd-header"></div> and <div id="nd-footer"></div>.
 * Requires css/nd-editorial-theme.css + css/nd-chrome.css.
 * All interpolated strings are escaped (see esc()).
 */
(function () {
  'use strict';

  /* ---------------- config ---------------- */

  var NAV = [
    { label: 'Markets', live: true, links: [
      ['Overview', '/nepse-decode/'],
      ['Daily summary', '/nepse-daily/'],
      ['Heat Map', '/nepse-sectors/'],
      ['IPO / FPO', '/nepse-ipo/']
    ]},
    { label: 'Stocks', links: [
      ['Warning Radar', '/nepse-verdicts-v2/'],
      ['Stock Screener', '/nepse-screener/'],
      ['Fair Value', '/nepse-value/'],
      ['Trending Stocks', '/nepse-trending/']
    ]},
    { label: 'Technical Analysis', links: [
      ['Technical Chart', '/nepse-technical/'],
      ['Trading Signals', '/nepse-signals/']
    ]},
    { label: 'Broker', links: [
      ['Top Brokers', '/nepse-brokers/'],
      ['Broker Trade Pattern', '/nepse-brokers/trade-pattern/'],
      ['Stock Trade Pattern', '/nepse-brokers/stock-pattern/'],
      ['Stockwise Holdings', '/nepse-brokers/holdings/'],
      ['Accumulation / Distribution', '/nepse-brokers/accdist/']
    ]},
    { label: 'News', links: [
      ['Market News', '/nepse-news/'],
      ['Market Wrap', '/blog/'],
      ['Corporate Actions', '/nepse-actions/']
    ]},
    { label: 'Trade', links: [
      ['Practice Trading', '/nepse-simulator/'],
      ['Trading Journal', '/nepse-portfolio/'],
      ['Watchlist', '/nepse-watchlist/']
    ]},
    { label: 'Research', links: [
      ['Money Flow', '/nepse-money-flow/'],
      ['Market regime', '/nepse-regime/'],
      ['Seasonality', '/nepse-seasonality/'],
    ]}
  ];

  var PLAIN_LINKS = [];

  /* Nepali chrome dictionary (header/nav/footer chrome only) */
  var NE = {
    'Markets': 'बजार', 'Stocks': 'स्टकहरू', 'Broker': 'ब्रोकर',
    'News': 'समाचार', 'Trade': 'कारोबार', 'Research': 'अनुसन्धान',
    'Technical Analysis': 'प्राविधिक विश्लेषण',
    'searchPh': 'सोध्नुहोस् / स्टक — NABIL प्रयास गर्नुहोस्',
    'brandSub': 'नेप्से चार्ट र बजार डेटा'
  };
  var EN_SEARCH_PH = 'Ask / Stock — try NABIL';

  var LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Nepse Decode iceberg mark"><rect width="64" height="64" rx="14" fill="#013E2E"/><polygon points="32,9 21,25 43,25" fill="#FFFFFF"/><polygon points="32,9 37,25 27,25" fill="#EEF2EF"/><polygon points="13,27.5 51,27.5 45,42 32,57 21,45 15,37" fill="#FFFFFF"/><polygon points="13,27.5 27,27.5 21,45 15,37" fill="#D6DDD9"/><polygon points="51,27.5 45,42 38,27.5" fill="#C6CECA"/><polygon points="32,57 45,42 36,40 28,49" fill="#E4E9E6"/><polygon points="21,45 32,57 28,49 24,44" fill="#D6DDD9"/><rect x="4" y="25" width="56" height="2.5" fill="#013E2E"/></svg>';

  var FB_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="Facebook"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>';
  var FB_URL = 'https://www.facebook.com/nepsedecode.np';

  /* ---------------- utils ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ---------------- market status (NPT clock) ---------------- */

  function nptNow() {
    var now = new Date();
    return new Date(now.getTime() + (5.75 * 3600 + now.getTimezoneOffset() * 60) * 1000);
  }

  function marketState(d) {
    var day = d.getDay(); /* 0 Sun … 6 Sat */
    var mins = d.getHours() * 60 + d.getMinutes();
    if (day === 0 || day === 6) return { code: 'CLOSED', reason: 'Weekend' };
    if (mins >= 645 && mins < 660) return { code: 'PRE-OPEN', reason: '' };   /* 10:45–10:59:59 */
    if (mins >= 660 && mins < 900) return { code: 'LIVE', reason: '' };       /* 11:00–15:00 */
    return { code: 'CLOSED', reason: day === 5 && mins >= 900 ? 'Weekend' : 'After hours' };
  }

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function pillHTML() {
    var d = nptNow(), st = marketState(d);
    var label = DAYS[d.getDay()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' NPT';
    var txt = st.code === 'LIVE' ? 'LIVE · ' + label
      : st.code === 'PRE-OPEN' ? 'PRE-OPEN · ' + label
      : 'MARKET CLOSED · ' + label;
    return '<span class="nd-pill' + (st.code === 'LIVE' ? ' live' : '') + '" role="status" title="Scheduled NEPSE hours — public holidays not yet reflected">' +
      '<span class="dot"></span><span class="nd-pilltxt">' + esc(txt) + '</span></span>';
  }

  function refreshPill() {
    var host = $('#nd-marketpill');
    if (host) host.innerHTML = pillHTML();
  }

  /* ---------------- theme ---------------- */

  function applyTheme(mode) {
    var root = document.documentElement;
    if (mode === 'light') root.setAttribute('data-nd-ed', 'light');
    else root.removeAttribute('data-nd-ed');
    /* mirror legacy data-theme so existing chart observers keep working */
    root.setAttribute('data-theme', mode === 'light' ? 'light' : 'dark');
    store('nd-ed-theme', mode);
    store('sk-theme', mode); /* keep the legacy pre-paint snippet in sync */
    var btn = $('#nd-themebtn');
    if (btn) {
      btn.setAttribute('aria-pressed', mode === 'light' ? 'true' : 'false');
      btn.innerHTML = mode === 'light' ? sunSVG() : moonSVG();
      btn.title = mode === 'light' ? 'Switch to dark' : 'Switch to light';
    }
  }

  function sunSVG() {
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  }
  function moonSVG() {
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  }

  /* ---------------- language ---------------- */

  function lang() { return read('nd-ed-lang') === 'ne' ? 'ne' : 'en'; }

  function t(en) {
    if (en === 'searchPh') return lang() === 'ne' ? NE.searchPh : EN_SEARCH_PH;
    return lang() === 'ne' && NE[en] ? NE[en] : en;
  }

  function applyLang() {
    var l = lang();
    document.documentElement.setAttribute('lang', l === 'ne' ? 'ne' : 'en');
    $all('[data-nd-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-nd-i18n');
      if (key === 'searchPh') el.setAttribute('placeholder', t('searchPh'));
      else el.textContent = t(key);
    });
    $all('.nd-lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', (b.getAttribute('data-l') === l) ? 'true' : 'false');
    });
    store('nd-ed-lang', l);
  }

  /* ---------------- header ---------------- */

  function navHTML() {
    var h = '';
    NAV.forEach(function (m, i) {
      var links = m.links.map(function (l) {
        var cls = isActive(l[1]) ? ' class="active"' : '';
        return '<a href="' + esc(l[1]) + '"' + cls + '>' + esc(l[0]) + '</a>';
      }).join('');
      h += '<div class="nd-navitem" data-i="' + i + '">' +
        '<button class="nd-navbtn nd-focusable" aria-haspopup="true" aria-expanded="false">' +
        (m.live ? '<span class="nd-livedot pulse" aria-hidden="true"></span>' : '') +
        '<span data-nd-i18n="' + esc(m.label) + '">' + esc(t(m.label)) + '</span>' +
        '<span class="car">▾</span></button>' +
        '<div class="nd-drop" role="menu">' + links + '</div></div>';
    });
    PLAIN_LINKS.forEach(function (l) {
      var active = isActive(l[1]) ? ' active' : '';
      h += '<div class="nd-navitem"><a class="nd-navbtn nd-focusable' + active + '" href="' + esc(l[1]) + '">' +
        '<span data-nd-i18n="' + esc(l[0]) + '">' + esc(t(l[0])) + '</span></a></div>';
    });
    return h;
  }

  function isActive(href) {
    var p = String(location.pathname || '/');
    if (href === '/') return p === '/' || p === '/index.html';
    return p === href || p.indexOf(href + '/') === 0 || p === href + 'index.html';
  }

  function headerHTML() {
    return '<header class="nd-bar">' +
      '<a class="nd-brand nd-focusable" href="/nepse-decode/" aria-label="Nepse Decode home">' + LOGO_SVG +
      '<span class="nd-brand-name">Nepse Decode</span></a>' +
      '<div class="nd-search" role="search">' +
      '<span class="nd-sicon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>' +
      '<input id="nd-q" type="search" autocomplete="off" spellcheck="false" ' +
      'placeholder="' + esc(lang() === 'ne' ? t('searchPh') : EN_SEARCH_PH) + '" data-nd-i18n="searchPh" aria-label="Search stocks">' +
      '<span class="nd-skey">/</span>' +
      '<div class="nd-results" id="nd-results" role="listbox" aria-label="Stock results"></div>' +
      '</div>' +
      '<nav class="nd-nav" aria-label="Primary">' + navHTML() + '</nav>' +
      '<div class="nd-cluster">' +
      '<span id="nd-marketpill">' + pillHTML() + '</span>' +
      '<button class="nd-iconbtn nd-focusable" id="nd-themebtn" aria-pressed="false" title="Switch to light"></button>' +
      '<div class="nd-lang" role="group" aria-label="Language">' +
      '<button data-l="en" class="nd-focusable">EN</button><button data-l="ne" class="nd-focusable">ने</button>' +
      '</div>' +
      '<button class="nd-iconbtn nd-focusable nd-burger" id="nd-burger" aria-label="Open menu" aria-expanded="false">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>' +
      '</div>' +
      '</header>';
  }

  /* Fixed overlays mount on <body>, NOT inside #nd-header: the sticky header
     uses backdrop-filter, which per spec becomes the containing block for
     position:fixed descendants and would trap the drawer inside the 60px bar. */
  function overlayHTML() {
    return '<div class="nd-scrim" id="nd-scrim"></div>' +
      '<aside class="nd-drawerpanel" id="nd-drawer" aria-label="Menu">' + drawerHTML() + '</aside>';
  }

  function drawerHTML() {
    var h = '';
    NAV.forEach(function (m) {
      h += '<div class="nd-acc"><button aria-expanded="false"><span>' + esc(t(m.label)) + '</span><span>▾</span></button><div class="nd-accbody">' +
        m.links.map(function (l) {
          var cls = isActive(l[1]) ? ' class="active"' : '';
          return '<a href="' + esc(l[1]) + '"' + cls + '>' + esc(l[0]) + '</a>';
        }).join('') +
        '</div></div>';
    });
    PLAIN_LINKS.forEach(function (l) {
      h += '<div class="nd-acc"><a href="' + esc(l[1]) + '" style="display:block;padding:14px 4px;color:var(--nd-text);text-decoration:none;font-weight:600;">' + esc(t(l[0])) + '</a></div>';
    });
    return h;
  }

  /* ---------------- footer ---------------- */

  var FOOT = [
    ['MARKETS', [['Overview', '/nepse-decode/'], ['Daily summary', '/nepse-daily/'], ['Heat Map', '/nepse-sectors/'], ['IPO / FPO', '/nepse-ipo/']]],
    ['STOCKS', [['Warning Radar', '/nepse-verdicts-v2/'], ['Stock Screener', '/nepse-screener/'], ['Fair Value', '/nepse-value/'], ['Trending Stocks', '/nepse-trending/']]],
    ['TECHNICAL', [['Technical Chart', '/nepse-technical/'], ['Trading Signals', '/nepse-signals/'], ['Momentum Signal', '/nepse-signals/momentum/'], ['Trend Relay', '/nepse-signals/trend-relay/'], ['Reversal Signal', '/nepse-signals/reversal/']]],
    ['BROKER', [['Top Brokers', '/nepse-brokers/'], ['Broker Trade Pattern', '/nepse-brokers/trade-pattern/'], ['Stock Trade Pattern', '/nepse-brokers/stock-pattern/'], ['Stockwise Holdings', '/nepse-brokers/holdings/'], ['Accumulation / Distribution', '/nepse-brokers/accdist/']]],
    ['NEWS', [['Market News', '/nepse-news/'], ['Market Wrap', '/blog/'], ['Corporate Actions', '/nepse-actions/']]],
    ['TRADE', [['Practice Trading', '/nepse-simulator/'], ['Trading Journal', '/nepse-portfolio/'], ['Watchlist', '/nepse-watchlist/']]],
    ['RESEARCH', [['Money Flow', '/nepse-money-flow/'], ['Market regime', '/nepse-regime/'], ['Seasonality', '/nepse-seasonality/']]],
    ['COMPANY', [['Nepse Decode', '/nepse-decode/'], ['__FB__', null], ['info@shirjankhadka.com.np', 'mailto:info@shirjankhadka.com.np'], ['Kathmandu, Nepal', null]]]
  ];

  function footerHTML() {
    var cols = FOOT.map(function (c) {
      return '<div class="nd-footcol"><h3>' + esc(c[0]) + '</h3>' +
        c[1].map(function (l) {
          if (l[0] === '__FB__') return '<a class="nd-fb" href="' + FB_URL + '" target="_blank" rel="noopener" title="Follow Nepse Decode on Facebook">' + FB_SVG + '<span>Nepse Decode</span></a>';
          if (!l[1]) return '<span class="nd-footplain">' + esc(l[0]) + '</span>';
          return '<a href="' + esc(l[1]) + '">' + esc(l[0]) + '</a>';
        }).join('') +
        '</div>';
    }).join('');
    return '<footer class="nd-footwrap">' +
      '<div class="nd-footbrand">' + LOGO_SVG + '<span class="t">Nepse Decode</span></div>' +
      '<p class="nd-footstate">NEPSE charts, the index today, and a daily market summary — in English and नेपाली, built for Nepal\u2019s investors at home and abroad.</p>' +
      '<div class="nd-footchips">' +
      '<span class="nd-footchip">DELAYED MARKET DATA</span>' +
      '<span class="nd-footchip">MON–FRI 11:00–15:00 NPT</span>' +
      '<span class="nd-footchip" id="nd-footsyms">LISTED SECURITIES</span>' +
      '</div>' +
      '<div class="nd-footgrid">' + cols + '</div>' +
      '<div class="nd-made">Made with \u2665 in Nepal for NEPSE investors.<br>' +
      '<span class="np">नेप्से चार्ट, नेप्से इन्डेक्स आज, र शेयर बजारको दैनिक सारांश एकै ठाउँमा।</span></div>' +
      '<div class="nd-legal">' +
      '<span>© 2026 Nepse Decode \u00B7 Shirjan Khadka \u00B7 info@shirjankhadka.com.np</span>' +
      '<span>For education only. Not investment advice.</span>' +
      '<span>Not affiliated with Nepal Stock Exchange Ltd.</span>' +
      '<button class="nd-totop nd-focusable" id="nd-totop">Back to top \u2191</button>' +
      '</div>' +
      '</footer>';
  }

  /* ---------------- search ---------------- */

  var UNI = null, UNI_META = null, uniLoading = false;

  function loadUniverse(cb) {
    if (UNI) return cb(UNI);
    if (uniLoading) { setTimeout(function () { loadUniverse(cb); }, 300); return; }
    uniLoading = true;
    fetch('/nepse-chart/data/universe.json', { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (d) {
      UNI = (d && d.symbols) || [];
      UNI_META = d ? { asof: d.asof, count: d.count } : null;
      cb(UNI);
    }).catch(function () { UNI = []; cb(UNI); });
  }

  /* Footer securities chip: count from the verified universe file, never hardcoded.
   * No "as of" date on the chip itself — the universe rebuilds at each market
   * close, so a mid-session date would look stale to shoppers even though the
   * count is current. The verification date stays in the tooltip. */
  function refreshFootSyms() {
    var el = document.getElementById('nd-footsyms');
    if (!el) return;
    if (UNI_META && UNI_META.count) {
      el.textContent = UNI_META.count + ' LISTED SECURITIES';
      el.setAttribute('title', 'Listed securities in the site universe' +
        (UNI_META.asof ? '; universe verified ' + UNI_META.asof + ' (NPT)' : ''));
    }
  }

  function initSearch() {
    var input = $('#nd-q'), box = $('#nd-results');
    if (!input || !box) return;
    var items = [], sel = -1;

    function render(q) {
      q = q.trim().toUpperCase();
      if (!q) { box.classList.remove('open'); box.innerHTML = ''; items = []; return; }
      loadUniverse(function (u) {
        items = u.filter(function (s) {
          return s.s.indexOf(q) === 0 || (s.n && s.n.toUpperCase().indexOf(q) !== -1);
        }).slice(0, 8);
        sel = items.length ? 0 : -1;
        box.innerHTML = items.map(function (s, i) {
          return '<a href="/stocks/' + esc(s.s) + '/" role="option" aria-selected="' + (i === sel) + '" data-i="' + i + '">' +
            '<span class="sym">' + esc(s.s) + '</span><span class="nm">' + esc(s.n || '') + '</span></a>';
        }).join('') || '<a role="option" aria-selected="false" style="color:var(--nd-dim)">No matches</a>';
        box.classList.add('open');
      });
    }

    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('focus', function () { if (input.value.trim()) render(input.value); });
    input.addEventListener('keydown', function (e) {
      var links = $all('a[data-i]', box);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        links.forEach(function (a, i) { a.setAttribute('aria-selected', i === sel ? 'true' : 'false'); });
      } else if (e.key === 'Enter') {
        if (sel >= 0 && items[sel]) { e.preventDefault(); location.href = '/stocks/' + items[sel].s + '/'; }
      } else if (e.key === 'Escape') {
        box.classList.remove('open'); input.blur();
      }
    });
    box.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-i]');
      if (a && items[+a.getAttribute('data-i')]) location.href = '/stocks/' + items[+a.getAttribute('data-i')].s + '/';
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nd-search')) box.classList.remove('open');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); input.focus();
      }
    });
  }

  /* ---------------- dropdowns ---------------- */

  function initDropdowns() {
    var items = $all('.nd-navitem[data-i]');
    var timer = null;
    function closeAll(except) {
      items.forEach(function (it) {
        if (it === except) return;
        it.classList.remove('open');
        $('.nd-navbtn', it).setAttribute('aria-expanded', 'false');
      });
    }
    items.forEach(function (it) {
      var btn = $('.nd-navbtn', it);
      it.addEventListener('mouseenter', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          closeAll(it); it.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
        }, 120);
      });
      it.addEventListener('mouseleave', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { closeAll(); }, 160);
      });
      btn.addEventListener('click', function () {
        var open = it.classList.contains('open');
        closeAll(); if (!open) { it.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeAll(); btn.blur(); }
        if (e.key === 'ArrowDown') {
          e.preventDefault(); closeAll(it); it.classList.add('open');
          var first = $('.nd-drop a', it); if (first) first.focus();
        }
      });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nd-navitem')) closeAll();
    });
  }

  /* ---------------- drawer ---------------- */

  function initDrawer() {
    var burger = $('#nd-burger'), panel = $('#nd-drawer'), scrim = $('#nd-scrim');
    if (!burger || !panel) return;
    function set(open) {
      panel.classList.toggle('open', open);
      scrim.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    }
    burger.addEventListener('click', function () { set(!panel.classList.contains('open')); });
    scrim.addEventListener('click', function () { set(false); });
    $all('.nd-acc > button', panel).forEach(function (b) {
      b.addEventListener('click', function () {
        var acc = b.parentElement, open = acc.classList.toggle('open');
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }

  /* ---------------- boot ---------------- */

  function boot() {
    var hh = $('#nd-header'), fh = $('#nd-footer');
    if (!hh && !fh) return; /* not an opted-in page */
    if (hh) hh.innerHTML = headerHTML();
    if (fh) fh.innerHTML = footerHTML();
    /* Drawer + scrim are fixed overlays: mount on body so the header's
       backdrop-filter can't trap them (see overlayHTML note). */
    if (!$('#nd-drawer')) document.body.insertAdjacentHTML('beforeend', overlayHTML());

    /* Honor the legacy theme key on first run so returning visitors
       keep the mode they chose before the redesign. */
    var savedTheme = read('nd-ed-theme') || read('sk-theme');
    applyTheme(savedTheme === 'light' ? 'light' : 'dark');
    applyLang();
    initDropdowns();
    initSearch();
    initDrawer();
    refreshPill();
    setInterval(refreshPill, 30000);
    loadUniverse(function () { refreshFootSyms(); });

    var tb = $('#nd-themebtn');
    if (tb) tb.addEventListener('click', function () {
      applyTheme(document.documentElement.hasAttribute('data-nd-ed') ? 'dark' : 'light');
    });
    $all('.nd-lang button').forEach(function (b) {
      b.addEventListener('click', function () {
        store('nd-ed-lang', b.getAttribute('data-l'));
        /* re-render labels */
        var nav = $('.nd-nav');
        if (nav) nav.innerHTML = navHTML();
        var dr = $('#nd-drawer');
        if (dr) { dr.innerHTML = drawerHTML(); initDrawer(); }
        applyLang();
        initDropdowns();
      });
    });
    var top = $('#nd-totop');
    if (top) top.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

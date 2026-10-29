/* Sector Price Rotation page — renders /data/sector-price-rotation.json
   plus /data/sector-price-rotation-forward.json (built by
   tools/build-sector-price-rotation.py from Nepse Decode's own archive).
   Components from the design kit (css/nd-cinema.css): cx-seg timeframe
   tabs + filter pills, cx-rank bars, cx-table board, cx-breadth breadth,
   cx-stat cards. Window tabs switch client-side; board rows select the
   sector in the stocks panel; URL carries ?window= and ?sector=; the page
   re-checks the data on the market-aware schedule (5 min in market hours,
   30 min otherwise, 2 h weekends) and refreshes silently on a new board. */
(function () {
  "use strict";
  var TF_LABEL = { 7: "7-day", 30: "30-day", 90: "90-day", 180: "180-day", 365: "365-day" };
  var PAGE = 25;
  var state = { tf: 30, sector: null, stockSort: "ret-desc", stockPage: 0,
                fwdFilter: "all", fwdPage: 0, board: null, forward: null };
  var timer = null;

  function fmtPct(v) {
    if (v === null || v === undefined) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function $(id) { return document.getElementById(id); }
  /* Realised-window tab labels (2026-10-30): the requested window
     (e.g. 7D) can realise to an earlier base across a holiday gap,
     so tabs print the realised base date + session count.
     '2026-10-16' -> '16 Oct'. */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDate(iso) {
    if (!iso || iso.length < 10) return iso || "";
    var label = parseInt(iso.slice(8, 10), 10) + " " +
      MONTHS[parseInt(iso.slice(5, 7), 10) - 1];
    /* Bases from a prior year (e.g. the 365D window) need the year,
       otherwise '28 Oct' reads as this year's 28 Oct. */
    if (state.board && state.board.asof &&
        iso.slice(0, 4) !== state.board.asof.slice(0, 4))
      label += " ’" + iso.slice(2, 4);
    return label;
  }
  function realisedLabel(tf) {
    var b = state.board && state.board.boards[String(tf)];
    var r = b && b.realised;
    if (!r) return tf + "D";
    return tf + "D · " + shortDate(r.realised_base_date) + " · " +
      r.sessions + " sess";
  }
  function renderScope() {
    if (!state.board || !state.board.scope_note) return;
    var box = document.querySelector(".pr-method");
    if (!box) return;
    var p = $("prScopeNote");
    if (!p) {
      p = document.createElement("p");
      p.id = "prScopeNote";
      box.appendChild(p);
    }
    var un = state.board.boards[String(state.tf)] &&
      state.board.boards[String(state.tf)].unscored;
    p.innerHTML = "<strong>Scope.</strong> " + esc(state.board.scope_note) +
      (un && un.length
        ? " Unscored on this window: " + un.map(function (u) {
            return esc(u.symbol) + " (" + esc(u.sector) + ", " + esc(u.reason) + ")";
          }).join("; ") + "."
        : "");
  }

  function readUrl() {
    try {
      var q = new URLSearchParams(window.location.search);
      var w = parseInt(q.get("window"), 10);
      if (TF_LABEL[w]) state.tf = w;
      var s = q.get("sector");
      if (s) state.sector = s;
    } catch (e) {}
  }
  function writeUrl() {
    try {
      var q = new URLSearchParams(window.location.search);
      q.set("window", state.tf);
      if (state.sector) q.set("sector", state.sector); else q.delete("sector");
      history.replaceState(null, "", window.location.pathname + "?" + q.toString());
    } catch (e) {}
  }

  function renderTabs() {
    var el = $("prTabs");
    /* Long realised labels must wrap like the symbol page's tabs
       (its CSS sets flex-wrap on #winTabs; this strip has no such
       rule, so set it here to keep every tab reachable at 390px). */
    el.style.flexWrap = "wrap";
    el.innerHTML = state.board.timeframes.map(function (tf) {
      return '<button type="button" role="tab" data-tf="' + tf +
        '" aria-pressed="' + (tf === state.tf) + '">' + esc(realisedLabel(tf)) + "</button>";
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        state.tf = parseInt(b.getAttribute("data-tf"), 10);
        state.stockPage = 0;
        writeUrl(); renderTabs(); renderStats(); renderBoard(); renderStockSectors(); renderStocks();
      });
    });
  }

  function boardRows() { return state.board.boards[String(state.tf)].data; }

  function renderStats() {
    var rows = boardRows();
    var rets = rows.map(function (r) { return r.sector_return_pct; }).sort(function (a, b) { return a - b; });
    var med = rets[Math.floor(rets.length / 2)];
    var up = rows.filter(function (r) { return r.sector_return_pct > 0; }).length;
    var cards = [
      { l: TF_LABEL[state.tf] + " leader", v: rows[0].sector + " " + fmtPct(rows[0].sector_return_pct), s: "top of " + rows.length + " sectors" },
      { l: TF_LABEL[state.tf] + " laggard", v: rows[rows.length - 1].sector + " " + fmtPct(rows[rows.length - 1].sector_return_pct), s: "bottom of " + rows.length + " sectors" },
      { l: "Median sector", v: fmtPct(med), s: "middle sector return, this window" },
      { l: "Sectors up", v: up + " / " + rows.length, s: "sectors with a positive return" }
    ];
    $("prStats").innerHTML = cards.map(function (c) {
      return '<div class="cx-stat"><div class="cx-stat-l">' + esc(c.l) + '</div>' +
        '<div class="cx-stat-v">' + esc(c.v) + '</div>' +
        '<div class="cx-stat-s">' + esc(c.s) + "</div></div>";
    }).join("");
  }

  function selectSector(name) {
    state.sector = name; state.stockPage = 0;
    writeUrl(); renderBoard(); renderStockSectors(); renderStocks();
    var sec = document.querySelector('[aria-label="Stocks inside the sector"]');
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderChart(rows) {
    var maxAbs = Math.max.apply(null, rows.map(function (r) {
      return Math.abs(r.sector_return_pct);
    }).concat([0.01]));
    $("prChart").innerHTML = rows.map(function (r, i) {
      var v = r.sector_return_pct;
      var w = Math.max(Math.abs(v) / maxAbs * 100, Math.abs(v) > 0 ? 1.5 : 0);
      return '<div class="cx-rank-row pr-click" role="button" tabindex="0" data-sector="' + esc(r.sector) + '"' +
        ' title="See ' + esc(r.sector) + ' stocks">' +
        '<span class="cx-rank-n">' + (i + 1) + "</span>" +
        '<span class="cx-rank-sym">' + esc(r.short) + "</span>" +
        '<span class="cx-rank-val ' + (v >= 0 ? "pr-up" : "pr-down") + '">' + fmtPct(v) + "</span>" +
        '<span class="cx-rank-track"><i class="cx-rank-fill ' + (v >= 0 ? "up" : "down") +
        '" style="--w:' + w.toFixed(1) + '%"></i></span></div>';
    }).join("");
    Array.prototype.forEach.call($("prChart").querySelectorAll(".pr-click"), function (el) {
      function go() { selectSector(el.getAttribute("data-sector")); }
      el.addEventListener("click", go);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  function movers(list) {
    if (!list.length) return '<span class="pr-none">—</span>';
    return list.map(function (c) {
      return '<span class="pr-mv">' + esc(c.symbol) + " (" + fmtPct(c.return_pct) + ")</span>";
    }).join(", ");
  }

  function breadth(r) {
    var priced = r.priced_count;
    var flat = priced - r.positive_stock_count - r.negative_stock_count;
    var segs = "";
    function seg(n, cls) {
      if (!n || !priced) return "";
      return '<i class="' + cls + '" style="width:' + (100 * n / priced) + '%"></i>';
    }
    segs = seg(r.positive_stock_count, "b-up") + seg(flat, "b-flat") +
           seg(r.negative_stock_count, "b-down");
    return '<span class="pr-bnums"><span class="pr-up">▲ ' + r.positive_stock_count +
      '</span> <span class="pr-down">▼ ' + r.negative_stock_count + "</span></span>" +
      '<span class="cx-breadth pr-breadth" role="img" aria-label="' +
      r.positive_stock_count + " up, " + flat + " unchanged, " +
      r.negative_stock_count + ' down of ' + priced + ' priced">' + segs + "</span>";
  }

  function renderBoard() {
    var b = state.board.boards[String(state.tf)];
    $("prTfLabel").textContent = TF_LABEL[state.tf];
    var r = b.realised;
    $("prWindow").textContent = r
      ? (r.realised_base_date + " → " + b.window_to + " · " +
         r.sessions + " sessions · session " + b.latest_date +
         (r.realised_base_date !== b.window_from
           ? " (" + b.timeframe_days + " calendar days requested; base " +
             "snapped to the last session on or before " + b.window_from + ")"
           : ""))
      : (b.window_from + " → " + b.window_to + " · session " + b.latest_date);
    renderChart(b.data);
    $("prBody").innerHTML = b.data.map(function (r) {
      var d = r.rank_change_1w;
      var dHtml = d === null ? '<span class="pr-none">—</span>'
        : d > 0 ? '<span class="pr-up">▲ ' + d + "</span>"
        : d < 0 ? '<span class="pr-down">▼ ' + (-d) + "</span>"
        : '<span class="pr-none">·</span>';
      var sel = state.sector === r.sector ? ' pr-row-sel' : "";
      return '<tr class="pr-click' + sel + '" role="button" tabindex="0" data-sector="' + esc(r.sector) + '"' +
        ' title="See ' + esc(r.sector) + ' stocks">' +
        '<td class="num">' + r.sector_rank + "</td>" +
        '<td class="sym">' + esc(r.sector) + "</td>" +
        '<td class="num ' + (r.sector_return_pct >= 0 ? "pr-up" : "pr-down") + '">' + fmtPct(r.sector_return_pct) + "</td>" +
        '<td class="num pr-hide-s">' + dHtml + "</td>" +
        "<td>" + breadth(r) + "</td>" +
        '<td class="pr-hide-m">' + movers(r.top_positive_contributors) + "</td>" +
        '<td class="pr-hide-m">' + movers(r.top_negative_contributors) + "</td>" +
        '<td class="num pr-hide-s">' + r.priced_count + "/" + r.constituent_count + "</td>" +
        "</tr>";
    }).join("");
    Array.prototype.forEach.call($("prBody").querySelectorAll(".pr-click"), function (el) {
      function go() { selectSector(el.getAttribute("data-sector")); }
      el.addEventListener("click", go);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  function sectorOrder() {
    return boardRows().map(function (r) { return r.sector; });
  }

  function renderStockSectors() {
    var el = $("prStockSectors");
    if (!state.board.stocks) {
      el.innerHTML = "";
      return;
    }
    if (!state.sector || !state.board.stocks[state.sector]) {
      state.sector = sectorOrder()[0];
    }
    el.innerHTML = sectorOrder().map(function (name) {
      return '<button type="button" role="tab" data-sector="' + esc(name) +
        '" aria-pressed="' + (name === state.sector) + '">' + esc(name) + "</button>";
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        state.sector = b.getAttribute("data-sector"); state.stockPage = 0;
        writeUrl(); renderStockSectors(); renderStocks();
      });
    });
  }

  function pagerHtml(page, total) {
    var pages = Math.max(1, Math.ceil(total / PAGE));
    var from = total ? page * PAGE + 1 : 0;
    var to = Math.min(total, (page + 1) * PAGE);
    return '<span class="pr-pager-info">Showing ' + from + "–" + to + " of " + total + "</span>" +
      '<button type="button" data-dir="-1"' + (page <= 0 ? " disabled" : "") + ">Prev</button>" +
      '<button type="button" data-dir="1"' + (page >= pages - 1 ? " disabled" : "") + ">Next</button>";
  }
  function bindPager(elId, getPage, setPage, render) {
    Array.prototype.forEach.call($(elId).querySelectorAll("[data-dir]"), function (b) {
      b.addEventListener("click", function () {
        setPage(getPage() + parseInt(b.getAttribute("data-dir"), 10));
        render();
      });
    });
  }

  function renderStocks() {
    var body = $("prStockBody"), pager = $("prStockPager");
    if (!state.board.stocks) {
      body.innerHTML = '<tr><td colspan="3" class="pr-loading">Stock lists arrive with the next data publish.</td></tr>';
      pager.innerHTML = "";
      return;
    }
    var rows = (state.board.stocks[state.sector] || []).slice();
    var tf = String(state.tf);
    rows.sort(function (a, b) {
      var va = a.returns[tf], vb = b.returns[tf];
      if (state.stockSort === "sym") return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
      if (va === null && vb === null) return a.symbol < b.symbol ? -1 : 1;
      if (va === null) return 1;
      if (vb === null) return -1;
      return state.stockSort === "ret-asc" ? (va - vb || (a.symbol < b.symbol ? -1 : 1))
                                           : (vb - va || (a.symbol < b.symbol ? -1 : 1));
    });
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.stockPage >= pages) state.stockPage = pages - 1;
    if (state.stockPage < 0) state.stockPage = 0;
    var slice = rows.slice(state.stockPage * PAGE, (state.stockPage + 1) * PAGE);
    body.innerHTML = slice.map(function (r) {
      var v = r.returns[tf];
      return "<tr><td><b>" + esc(r.symbol) + "</b></td><td>" + esc(r.name) + "</td>" +
        '<td class="num ' + (v === null ? "pr-none" : v >= 0 ? "pr-up" : "pr-down") + '">' + fmtPct(v) + "</td></tr>";
    }).join("") || '<tr><td colspan="3" class="pr-loading">No stocks in this sector.</td></tr>';
    pager.innerHTML = pagerHtml(state.stockPage, rows.length);
    bindPager("prStockPager", function () { return state.stockPage; },
      function (p) { state.stockPage = p; }, renderStocks);
  }

  function renderPersist() {
    var p = state.board.persistence;
    $("prPersist").innerHTML = state.board.timeframes.map(function (tf) {
      var s = p.by_timeframe[String(tf)];
      if (!s) return "";
      return '<div class="cx-stat"><div class="cx-stat-l">' + tf + '-day leader</div>' +
        '<div class="cx-stat-v">' + s.leader_still_top3_after_4w_pct.toFixed(1) + "%</div>" +
        '<div class="cx-stat-s pr-stat-s">still top-3 four weeks later · rank correlation ' +
        (s.mean_rank_correlation_4w >= 0 ? "+" : "") + s.mean_rank_correlation_4w.toFixed(3) +
        " · " + s.observations + " weekly boards, trailing " + p.window_years + " years</div></div>";
    }).join("");
  }

  function renderForward() {
    var sumEl = $("prFwdSummary"), body = $("prFwdBody"), pager = $("prFwdPager"), filt = $("prFwdFilter");
    var s = state.board.forward_summary && state.board.forward_summary.overall;
    if (!state.forward) {
      sumEl.textContent = s ? "Tracking started " + state.board.forward_started + " · " + s.tracked + " calls recorded, " + s.resolved + " resolved." : "";
      body.innerHTML = '<tr><td colspan="7" class="pr-loading">Forward tracking arrives with the next data publish.</td></tr>';
      pager.innerHTML = ""; filt.innerHTML = "";
      return;
    }
    var f = state.forward;
    var res = f.entries.filter(function (e) { return e.resolved; });
    var kept = res.filter(function (e) { return e.leader_still_top3_20d; }).length;
    sumEl.textContent = "Tracking started " + f.started + " · " + f.entries.length + " calls recorded, " +
      res.length + " resolved" + (res.length ? " · leaders still top-3 after 20 sessions: " + kept + "/" + res.length : "") + ".";
    filt.innerHTML = [["all", "All"], ["resolved", "Resolved"], ["pending", "Pending"]].map(function (x) {
      return '<button type="button" role="tab" data-f="' + x[0] + '" aria-pressed="' + (state.fwdFilter === x[0]) + '">' + x[1] + "</button>";
    }).join("");
    Array.prototype.forEach.call(filt.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        state.fwdFilter = b.getAttribute("data-f"); state.fwdPage = 0; renderForward();
      });
    });
    var rows = f.entries.slice().sort(function (a, b) {
      return a.board_date < b.board_date ? 1 : a.board_date > b.board_date ? -1 : a.window - b.window;
    });
    if (state.fwdFilter === "resolved") rows = rows.filter(function (e) { return e.resolved; });
    if (state.fwdFilter === "pending") rows = rows.filter(function (e) { return !e.resolved; });
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.fwdPage >= pages) state.fwdPage = pages - 1;
    if (state.fwdPage < 0) state.fwdPage = 0;
    var slice = rows.slice(state.fwdPage * PAGE, (state.fwdPage + 1) * PAGE);
    body.innerHTML = slice.map(function (e) {
      var still = e.resolved ? (e.leader_still_top3_20d ? '<span class="pr-up">Yes</span>' : '<span class="pr-down">No</span>') : '<span class="pr-none">—</span>';
      return "<tr><td>" + esc(e.board_date) + "</td><td>" + e.window + "D</td><td>" + esc(e.leader) + "</td>" +
        "<td>" + e.top3.map(esc).join(", ") + "</td>" +
        '<td class="num ' + (e.fwd_20d_pct === null ? "pr-none" : e.fwd_20d_pct >= 0 ? "pr-up" : "pr-down") + '">' + fmtPct(e.fwd_20d_pct) + "</td>" +
        "<td>" + still + "</td><td>" + (e.resolved_date ? esc(e.resolved_date) : '<span class="pr-none">Pending</span>') + "</td></tr>";
    }).join("") || '<tr><td colspan="7" class="pr-loading">No calls in this filter yet.</td></tr>';
    pager.innerHTML = pagerHtml(state.fwdPage, rows.length);
    bindPager("prFwdPager", function () { return state.fwdPage; },
      function (p) { state.fwdPage = p; }, renderForward);
  }

  function renderAll() {
    renderTabs(); renderStats(); renderBoard(); renderStockSectors(); renderStocks(); renderPersist(); renderForward(); renderScope();
  }

  function fail(msg) {
    $("prSession").textContent = msg;
    $("prBody").innerHTML =
      '<tr><td colspan="8" class="pr-loading">' + esc(msg) + "</td></tr>";
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function load(first) {
    return Promise.all([
      fetchJson("/data/sector-price-rotation.json"),
      fetchJson("/data/sector-price-rotation-forward.json").catch(function () { return null; })
    ]).then(function (res) {
      var board = res[0], forward = res[1];
      var changed = !state.board || state.board.asof !== board.asof;
      state.board = board; state.forward = forward;
      $("prSession").textContent =
        "Session " + board.asof + " · end-of-day board, rebuilt after every close · source: " + board.generated_from;
      if (first || changed) {
        if (!state.board.stocks || !state.board.stocks[state.sector]) state.sector = null;
        renderAll();
      }
    });
  }

  function nextDelayMs() {
    try {
      var parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kathmandu",
        weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
      var get = function (t) { var p = parts.filter(function (x) { return x.type === t; })[0]; return p ? p.value : ""; };
      var wd = get("weekday"), hh = parseInt(get("hour"), 10), mm = parseInt(get("minute"), 10);
      if (wd === "Sat" || wd === "Sun") return 2 * 60 * 60 * 1000;
      var mins = hh * 60 + mm;
      if (mins >= 11 * 60 && mins < 15 * 60) return 5 * 60 * 1000;
      return 30 * 60 * 1000;
    } catch (e) {
      return 30 * 60 * 1000;
    }
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function tick() {
      if (document.hidden) { schedule(); return; }
      load(false).catch(function () {}).then(schedule);
    }, nextDelayMs());
  }

  readUrl();
  var sortEl = $("prStockSort");
  sortEl.addEventListener("change", function () {
    state.stockSort = sortEl.value; state.stockPage = 0; renderStocks();
  });
  load(true).then(function () {
    writeUrl();
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) load(false).catch(function () {});
    });
    schedule();
  }).catch(function () { fail("The board could not be loaded — please refresh."); });
})();

/* Sector Price Rotation page — renders /data/sector-price-rotation.json
   (built by tools/build-sector-price-rotation.py from Nepse Decode's own
   archive). Components from the design kit (css/nd-cinema.css): cx-seg
   timeframe tabs, cx-rank bars, cx-table board, cx-breadth breadth,
   cx-stat persistence cards. One fetch; tabs switch client-side. */
(function () {
  "use strict";
  var TF_LABEL = { 7: "7-day", 30: "30-day", 90: "90-day", 180: "180-day", 365: "365-day" };
  var state = { tf: 30, board: null };

  function fmtPct(v) { return (v > 0 ? "+" : "") + v.toFixed(2) + "%"; }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderTabs() {
    var el = document.getElementById("prTabs");
    el.innerHTML = state.board.timeframes.map(function (tf) {
      return '<button type="button" role="tab" data-tf="' + tf +
        '" aria-pressed="' + (tf === state.tf) + '">' + tf + "D</button>";
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        state.tf = parseInt(b.getAttribute("data-tf"), 10);
        renderTabs(); renderBoard();
      });
    });
  }

  function renderChart(rows) {
    var maxAbs = Math.max.apply(null, rows.map(function (r) {
      return Math.abs(r.sector_return_pct);
    }).concat([0.01]));
    document.getElementById("prChart").innerHTML = rows.map(function (r, i) {
      var v = r.sector_return_pct;
      var w = Math.max(Math.abs(v) / maxAbs * 100, Math.abs(v) > 0 ? 1.5 : 0);
      return '<div class="cx-rank-row">' +
        '<span class="cx-rank-n">' + (i + 1) + "</span>" +
        '<span class="cx-rank-sym">' + esc(r.short) + "</span>" +
        '<span class="cx-rank-val ' + (v >= 0 ? "pr-up" : "pr-down") + '">' + fmtPct(v) + "</span>" +
        '<span class="cx-rank-track"><i class="cx-rank-fill ' + (v >= 0 ? "up" : "down") +
        '" style="--w:' + w.toFixed(1) + '%"></i></span></div>';
    }).join("");
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
    document.getElementById("prTfLabel").textContent = TF_LABEL[state.tf];
    document.getElementById("prWindow").textContent =
      b.window_from + " → " + b.window_to + " · session " + b.latest_date;
    renderChart(b.data);
    document.getElementById("prBody").innerHTML = b.data.map(function (r) {
      var d = r.rank_change_1w;
      var dHtml = d === null ? '<span class="pr-none">—</span>'
        : d > 0 ? '<span class="pr-up">▲ ' + d + "</span>"
        : d < 0 ? '<span class="pr-down">▼ ' + (-d) + "</span>"
        : '<span class="pr-none">·</span>';
      return "<tr>" +
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
  }

  function renderPersist() {
    var p = state.board.persistence;
    document.getElementById("prPersist").innerHTML = state.board.timeframes.map(function (tf) {
      var s = p.by_timeframe[String(tf)];
      if (!s) return "";
      return '<div class="cx-stat"><div class="cx-stat-l">' + tf + '-day leader</div>' +
        '<div class="cx-stat-v">' + s.leader_still_top3_after_4w_pct.toFixed(1) + "%</div>" +
        '<div class="cx-stat-s pr-stat-s">still top-3 four weeks later · rank correlation ' +
        (s.mean_rank_correlation_4w >= 0 ? "+" : "") + s.mean_rank_correlation_4w.toFixed(3) +
        " · " + s.observations + " weekly boards, trailing " + p.window_years + " years</div></div>";
    }).join("");
  }

  function fail(msg) {
    document.getElementById("prSession").textContent = msg;
    document.getElementById("prBody").innerHTML =
      '<tr><td colspan="8" class="pr-loading">' + esc(msg) + "</td></tr>";
  }

  fetch("/data/sector-price-rotation.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (board) {
      state.board = board;
      document.getElementById("prSession").textContent =
        "Session " + board.asof + " · end-of-day board, rebuilt after every close · source: " + board.generated_from;
      renderTabs(); renderBoard(); renderPersist();
    })
    .catch(function () { fail("The board could not be loaded — please refresh."); });
})();

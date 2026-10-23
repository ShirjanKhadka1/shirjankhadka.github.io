/* Sector Price Rotation page — renders /data/sector-price-rotation.json
   (built by tools/build-sector-price-rotation.py from Nepse Decode's own
   archive). Timeframe tabs switch one payload client-side; no other fetch. */
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
      var on = tf === state.tf;
      return '<button type="button" role="tab" aria-selected="' + on + '" data-tf="' + tf +
        '" class="pr-tab' + (on ? " pr-tab-on" : "") + '">' + tf + "D</button>";
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        state.tf = parseInt(b.getAttribute("data-tf"), 10);
        renderTabs(); renderBoard();
      });
    });
  }

  function renderChart(rows) {
    var W = 780, LH = 158, RH = 34, TOP = 10, BOT = 26;
    var H = TOP + RH * rows.length + BOT;
    var vals = rows.map(function (r) { return r.sector_return_pct; });
    var lo = Math.min(0, Math.min.apply(null, vals));
    var hi = Math.max(0, Math.max.apply(null, vals));
    var pad = Math.max((hi - lo) * 0.14, 0.5);
    lo -= pad; hi += pad;
    var plotW = W - LH - 66;
    function X(v) { return LH + (v - lo) / (hi - lo) * plotW; }
    var x0 = X(0);
    var ticks = [];
    for (var i = 0; i <= 4; i++) ticks.push(lo + (hi - lo) * i / 4);
    var s = '<svg class="pr-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Sector returns bar chart">';
    ticks.forEach(function (t) {
      s += '<line class="pr-grid" x1="' + X(t) + '" y1="' + TOP + '" x2="' + X(t) + '" y2="' + (H - BOT) + '"/>' +
        '<text class="pr-tick" x="' + X(t) + '" y="' + (H - BOT + 16) + '" text-anchor="middle">' + t.toFixed(1) + "%</text>";
    });
    rows.forEach(function (r, i) {
      var y = TOP + i * RH;
      var v = r.sector_return_pct;
      var bx = Math.min(x0, X(v)), bw = Math.max(Math.abs(X(v) - x0), 1.5);
      var cls = v >= 0 ? "pr-bar-pos" : "pr-bar-neg";
      s += '<text class="pr-barlab" x="' + (LH - 10) + '" y="' + (y + RH / 2 + 4) + '" text-anchor="end">' + esc(r.short) + "</text>";
      s += '<rect class="' + cls + '" x="' + bx + '" y="' + (y + 7) + '" width="' + bw + '" height="' + (RH - 14) + '" rx="3"/>';
      var vx = v >= 0 ? X(v) + 7 : X(v) - 7;
      s += '<text class="pr-barval ' + (v >= 0 ? "pr-pos-t" : "pr-neg-t") + '" x="' + vx + '" y="' + (y + RH / 2 + 4) +
        '" text-anchor="' + (v >= 0 ? "start" : "end") + '">' + fmtPct(v) + "</text>";
    });
    s += '<line class="pr-zero" x1="' + x0 + '" y1="' + TOP + '" x2="' + x0 + '" y2="' + (H - BOT) + '"/>';
    s += "</svg>";
    document.getElementById("prChart").innerHTML = s;
  }

  function movers(list) {
    if (!list.length) return '<span class="pr-none">—</span>';
    return list.map(function (c) {
      return '<span class="pr-mv">' + esc(c.symbol) + " (" + fmtPct(c.return_pct) + ")</span>";
    }).join(", ");
  }

  function renderBoard() {
    var b = state.board.boards[String(state.tf)];
    document.getElementById("prTfLabel").textContent = TF_LABEL[state.tf];
    document.getElementById("prWindow").textContent =
      b.window_from + " → " + b.window_to + " · session " + b.latest_date;
    renderChart(b.data);
    var body = document.getElementById("prBody");
    body.innerHTML = b.data.map(function (r) {
      var d = r.rank_change_1w;
      var dHtml = d === null ? '<span class="pr-none">—</span>'
        : d > 0 ? '<span class="pr-pos-t">▲ ' + d + "</span>"
        : d < 0 ? '<span class="pr-neg-t">▼ ' + (-d) + "</span>"
        : '<span class="pr-none">·</span>';
      var tot = r.priced_count || 1;
      var share = Math.round(100 * r.positive_stock_count / tot);
      return "<tr>" +
        '<td class="pr-num">' + r.sector_rank + "</td>" +
        "<td><strong>" + esc(r.sector) + "</strong></td>" +
        '<td class="pr-num ' + (r.sector_return_pct >= 0 ? "pr-pos-t" : "pr-neg-t") + '"><strong>' + fmtPct(r.sector_return_pct) + "</strong></td>" +
        '<td class="pr-num pr-hide-s">' + dHtml + "</td>" +
        '<td><span class="pr-bnums"><span class="pr-pos-t">▲ ' + r.positive_stock_count + '</span> <span class="pr-neg-t">▼ ' + r.negative_stock_count + "</span></span>" +
        '<span class="pr-breadth"><span class="pr-breadth-in" style="width:' + share + '%"></span></span></td>' +
        '<td class="pr-hide-m">' + movers(r.top_positive_contributors) + "</td>" +
        '<td class="pr-hide-m">' + movers(r.top_negative_contributors) + "</td>" +
        '<td class="pr-num pr-hide-s">' + r.priced_count + "/" + r.constituent_count + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderPersist() {
    var p = state.board.persistence;
    var el = document.getElementById("prPersist");
    el.innerHTML = state.board.timeframes.map(function (tf) {
      var s = p.by_timeframe[String(tf)];
      if (!s) return "";
      return '<div class="pr-stat"><div class="sk">' + tf + '-day leader</div>' +
        '<div class="sv">' + s.leader_still_top3_after_4w_pct.toFixed(1) + "%</div>" +
        '<div class="ss">still top-3 four weeks later · rank correlation ' +
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
        "Session " + board.asof + " · rebuilt after every close · " + board.generated_from;
      renderTabs(); renderBoard(); renderPersist();
    })
    .catch(function () { fail("The board could not be loaded — please refresh."); });
})();

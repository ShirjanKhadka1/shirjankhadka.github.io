/* ============================================================
   NEPSE DECODE — Blog family script (nd-blog.js)
   Landing (/blog/): renders article grid from data/blog-index.json,
   filters/search/sort/pager, market strip, 60s
   change-gated refresh (unchanged payload moves ONLY the freshness
   line — never rebuilds cards, the fading fix from the news page).
   Articles: reading progress bar, at-a-glance + cited-figures +
   related-symbol blocks injected AFTER the byline (additive only —
   article text is never touched), market strip, copy-link button.
   All data comes from already-published files (blog index,
   verdicts batch, wave1 snapshot). No new source, no prediction.
   ============================================================ */
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  function nptClock(d) {
    try { return d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  }
  function money(n) {
    if (n == null || isNaN(n)) return "—";
    return "Rs " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(n, signed) {
    if (n == null || isNaN(n)) return "—";
    var v = Number(n);
    return (signed && v > 0 ? "+" : "") + v.toFixed(2) + "%";
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* ---------- shared: reveal ---------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- shared: market strip ---------- */
  function initMarket() {
    var els = document.querySelectorAll("[data-bl-market]");
    if (!els.length) return;
    getJSON("/nepse-chart/data/wave1.json").then(function (w) {
      var m = w.market || {}, ix = m.index || {};
      var state = m.close ? "Session closed" : "Session open";
      els.forEach(function (el) {
        var val = el.querySelector(".bl-mkt-value");
        var ch = el.querySelector(".bl-mkt-change");
        var note = el.querySelector(".bl-mkt-note");
        if (val) val.textContent = ix.value == null ? "—" : Number(ix.value).toFixed(2);
        if (ch) {
          ch.textContent = (ix.change == null ? "" : (ix.change > 0 ? "+" : "") + Number(ix.change).toFixed(2) + " (" + pct(ix.pct, true) + ")");
          ch.className = "bl-mkt-change " + (ix.change > 0 ? "up" : (ix.change < 0 ? "down" : ""));
        }
        if (note) note.textContent = "NEPSE · " + state + " · as of " + fmtDate(m.date || w.asof);
      });
    }).catch(function () { /* strip keeps its baked fallback */ });
  }

  /* ================= LANDING ================= */
  function initLanding() {
    var grid = document.getElementById("blGrid");
    var feat = document.getElementById("blFeatured");
    var rail = document.getElementById("blRail");
    var fresh = document.getElementById("blFreshLine");
    var search = document.getElementById("blSearch");
    var secSel = document.getElementById("blSection");
    var sortSel = document.getElementById("blSort");
    var countEl = document.getElementById("blCount");
    var prev = document.getElementById("blPrev");
    var next = document.getElementById("blNext");
    var showing = document.getElementById("blShowing");
    var countline = document.getElementById("blCountline");
    var all = [], sig = null, page = 1, PER = 12, ok = null, lastCheck = null, newCount = 0;
    /* Baked mode: the grid ships with ALL index cards baked in (no-JS
       full archive). While no filter/sort is active and the index is
       unchanged, paging only toggles baked cards — no innerHTML
       rebuild, so no flash and no DOM-probe loss on first paint. */
    var bakedMode = grid && grid.querySelectorAll(".mag-card").length > 0;

    function card(a) {
      var img = a.image ? "<div class=\"mag-fimg\"><img loading=\"lazy\" width=\"1200\" height=\"630\" src=\"" + esc(a.image) + "\" alt=\"" + esc(a.image_alt || a.title) + "\"></div>" : "";
      return "<a class=\"mag-card reveal in\" href=\"/blog/" + esc(a.slug) + "/\">" + img
        + "<div class=\"mag-card-body\"><p class=\"mag-kicker\">" + esc(a.section || "Markets") + "</p>"
        + "<h3>" + esc(a.title) + "</h3>"
        + "<p class=\"mag-dek\">" + esc(a.dek || "") + "</p>"
        + "<p class=\"mag-meta\">" + esc(fmtDate(a.date)) + (a.reading_min ? " · " + a.reading_min + " min read" : "") + "</p></div></a>";
    }
    function railRow(a) {
      var img = a.image ? "<img loading=\"lazy\" width=\"1200\" height=\"630\" src=\"" + esc(a.image) + "\" alt=\"" + esc(a.image_alt || a.title) + "\">" : "";
      return "<a class=\"mag-row\" href=\"/blog/" + esc(a.slug) + "/\">" + img
        + "<div><h4>" + esc(a.title) + "</h4>"
        + "<p class=\"mag-meta\">" + esc(fmtDate(a.date)) + " · " + esc(a.section || "") + "</p></div></a>";
    }
    function featured(a) {
      var img = a.image ? "<div class=\"mag-fimg\"><img width=\"1200\" height=\"630\" src=\"" + esc(a.image) + "\" alt=\"" + esc(a.image_alt || a.title) + "\"></div>" : "";
      return "<a class=\"mag-featured\" href=\"/blog/" + esc(a.slug) + "/\">" + img
        + "<p class=\"mag-kicker\">" + esc(a.section || "Markets") + "</p>"
        + "<h3>" + esc(a.title) + "</h3>"
        + "<p class=\"mag-dek\">" + esc(a.dek || "") + "</p>"
        + "<p class=\"mag-meta\">" + esc(fmtDate(a.date)) + (a.reading_min ? " · " + a.reading_min + " min read" : "") + "</p></a>";
    }
    function filtered() {
      var q = (search && search.value || "").trim().toLowerCase();
      var sec = secSel ? secSel.value : "All";
      var list = all.filter(function (a) {
        if (sec !== "All" && (a.section || "") !== sec) return false;
        if (!q) return true;
        return (a.title || "").toLowerCase().indexOf(q) >= 0
          || (a.dek || "").toLowerCase().indexOf(q) >= 0
          || (a.tags || []).join(" ").toLowerCase().indexOf(q) >= 0;
      });
      if (sortSel && sortSel.value === "old") list = list.slice().reverse();
      return list;
    }
    function renderGrid() {
      if (!grid) return;
      var list = filtered();
      var pages = Math.max(1, Math.ceil(list.length / PER));
      if (page > pages) page = pages;
      if (bakedMode) {
        var cards = grid.querySelectorAll(".mag-card");
        var slice = list.slice((page - 1) * PER, page * PER);
        var keep = {};
        slice.forEach(function (a) { keep["/blog/" + a.slug + "/"] = true; });
        cards.forEach(function (el, i) {
          var href = el.getAttribute("href");
          el.style.display = (i < list.length && keep[href]) ? "" : "none";
        });
      } else {
        var slice2 = list.slice((page - 1) * PER, page * PER);
        grid.innerHTML = slice2.length ? slice2.map(card).join("")
          : "<p class=\"bl-empty\">No articles match this filter.</p>";
      }
      if (countEl) countEl.textContent = list.length + " of " + all.length;
      if (showing) showing.textContent = list.length
        ? "Showing " + ((page - 1) * PER + 1) + "–" + Math.min(page * PER, list.length) + " of " + list.length
        : "No articles";
      if (prev) prev.disabled = page <= 1;
      if (next) next.disabled = page >= pages;
    }
    function renderFresh() {
      if (!fresh || !lastCheck) return;
      var parts = [];
      if (ok === false) parts.push("Index refresh failed");
      else if (all.length) parts.push(all.length + " articles");
      parts.push("checked " + nptClock(lastCheck) + " NPT");
      parts.push(ok === false ? "showing last loaded index · will retry" : "next check in 60 seconds");
      if (newCount > 0) parts.unshift(newCount + " new since last check");
      fresh.textContent = parts.join(" · ");
      fresh.className = "bl-fresh" + (ok === false ? " failed" : "");
    }
    function renderSections() {
      if (!secSel) return;
      var counts = {};
      all.forEach(function (a) { var s = a.section || "Markets"; counts[s] = (counts[s] || 0) + 1; });
      var cur = secSel.value || "All";
      var opts = ["<option value=\"All\">All sections (" + all.length + ")</option>"];
      Object.keys(counts).sort().forEach(function (s) {
        opts.push("<option value=\"" + esc(s) + "\">" + esc(s) + " (" + counts[s] + ")</option>");
      });
      secSel.innerHTML = opts.join("");
      secSel.value = counts[cur] || cur === "All" ? cur : "All";
    }
    function renderLatest() {
      if (!all.length) return;
      if (feat) feat.innerHTML = featured(all[0]);
      if (rail) rail.innerHTML = all.slice(1, 5).map(railRow).join("");
      if (countline) countline.textContent = all.length + " articles · newest " + fmtDate(all[0].date);
    }
    function loadIndex() {
      return getJSON("/data/blog-index.json").then(function (d) {
        var items = (d.articles || []).slice();
        var s = items.length + "|" + items.map(function (a) { return a.slug + "|" + (a.date || ""); }).join("\u0001");
        var changed = s !== sig;
        if (changed) {
          var first = !sig;
          newCount = sig ? items.filter(function (a) {
            return !all.some(function (b) { return b.slug === a.slug; });
          }).length : 0;
          all = items; sig = s;
          /* Any post-boot index change invalidates the baked snapshot:
             fall out of baked mode so the grid re-renders from live data.
             The first load keeps baked mode (baked cards ARE the snapshot). */
          if (!first) bakedMode = false;
          renderSections(); renderLatest(); page = 1; renderGrid();
        }
        ok = true; lastCheck = new Date(); renderFresh();
        return changed;
      }).catch(function () {
        ok = false; lastCheck = new Date(); renderFresh();
        return false;
      });
    }
    if (search) search.addEventListener("input", function () { bakedMode = false; page = 1; renderGrid(); });
    if (secSel) secSel.addEventListener("change", function () { bakedMode = false; page = 1; renderGrid(); });
    if (sortSel) sortSel.addEventListener("change", function () { bakedMode = false; page = 1; renderGrid(); });
    if (prev) prev.addEventListener("click", function () { if (page > 1) { page--; renderGrid(); } });
    if (next) next.addEventListener("click", function () { page++; renderGrid(); });
    loadIndex();
    setInterval(function () { if (!document.hidden) loadIndex(); }, 60000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) loadIndex();
    });
  }

  /* ================= ARTICLES ================= */
  function initArticle() {
    var bar = document.getElementById("progressBar");
    if (bar) {
      (function onScroll() {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        bar.style.transform = "scaleX(" + (max > 0 ? h.scrollTop / max : 0) + ")";
      })();
      window.addEventListener("scroll", function () {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        bar.style.transform = "scaleX(" + (max > 0 ? h.scrollTop / max : 0) + ")";
      }, { passive: true });
    }
    var share = document.querySelector(".share-row");
    if (share && navigator.clipboard) {
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "bl-copy"; btn.textContent = "Copy link";
      btn.addEventListener("click", function () {
        navigator.clipboard.writeText(location.href).then(function () {
          btn.textContent = "Copied!";
          setTimeout(function () { btn.textContent = "Copy link"; }, 2000);
        }).catch(function () {});
      });
      share.appendChild(btn);
    }
    var slug = location.pathname.split("/").filter(Boolean)[1] || "";
    if (!slug) return;
    var byline = document.querySelector(".article-byline");
    var anchor = byline || document.querySelector(".article h1");
    var related = document.querySelector(".related-reading");
    var inner = document.querySelector(".article-inner");
    function insertAfter(node, html) {
      var t = document.createElement("div");
      t.innerHTML = html;
      var el = t.firstElementChild;
      if (node && node.parentNode) node.parentNode.insertBefore(el, node.nextSibling);
      return el;
    }
    getJSON("/data/blog-index.json").then(function (d) {
      var a = (d.articles || []).filter(function (x) { return x.slug === slug; })[0];
      if (!a || !anchor) return;
      /* Single source of truth: the index builder's word count. Counting
         live DOM text over-counts on articles whose body markup has
         unbalanced divs (the browser swallows following sections into
         the body element); the index slice is the verified count and
         matches the landing card. Runtime count is fallback only. */
      var body = document.querySelector(".article-body");
      var words = a.words || (body ? body.textContent.trim().split(/\s+/).length : 0);
      var mins = a.reading_min || Math.max(1, Math.round(words / 200));
      var meta = "<dl>"
        + "<dt>Published</dt><dd>" + esc(fmtDate(a.date)) + "</dd>"
        + "<dt>Section</dt><dd>" + esc(a.section || "—") + "</dd>"
        + "<dt>Reading time</dt><dd>" + mins + " min · " + words.toLocaleString("en-US") + " words</dd>"
        + (a.tags && a.tags.length ? "<dt>Tags</dt><dd>" + a.tags.map(esc).join(" · ") + "</dd>" : "")
        + (a.modified && a.modified !== a.published ? "<dt>Updated</dt><dd>" + esc(fmtDate(a.modified)) + "</dd>" : "")
        + "</dl>";
      var glance = insertAfter(anchor,
        "<section class=\"bl-glance\" aria-label=\"At a glance\"><h2>At a glance</h2>" + meta + "</section>");
      var after = glance;
      if (a.figures && a.figures.length) {
        var chips = a.figures.map(function (f) {
          return "<div class=\"bl-fig\"><strong>" + esc(f.text) + "</strong><span>as cited in this article</span></div>";
        }).join("");
        after = insertAfter(after,
          "<section class=\"bl-figures\" aria-label=\"Key figures\"><h2>Key figures cited</h2>"
          + "<div class=\"bl-fig-grid\">" + chips + "</div>"
          + "<p class=\"bl-fig-cap\">Figures quoted from this article's own summary. "
          + "Full context and sources are in the article body below.</p></section>");
      }
      if (a.related_symbols && a.related_symbols.length) {
        var box = insertAfter(after,
          "<section class=\"bl-syms\" aria-label=\"Companies mentioned\"><h2>Companies mentioned</h2>"
          + "<div class=\"bl-sym-row\" data-bl-syms></div></section>");
        getJSON("/nepse-chart/data/verdicts.json").then(function (v) {
          var vd = v.verdicts || {};
          var row = box.querySelector("[data-bl-syms]");
          row.innerHTML = a.related_symbols.map(function (s) {
            var r = vd[s];
            if (!r) return "";
            var cls = r.ch == null ? "" : (r.ch > 0 ? "up" : (r.ch < 0 ? "down" : ""));
            return "<a class=\"bl-sym\" href=\"/stocks/" + esc(s) + "/\"><b>" + esc(s) + "</b>"
              + "<span class=\"p\">" + money(r.p) + "</span>"
              + "<span class=\"c " + cls + "\">" + (r.ch == null ? "" : pct(r.ch, true)) + "</span></a>";
          }).join("");
          if (!row.innerHTML) box.remove();
        }).catch(function () { box.remove(); });
      }
    }).catch(function () { /* at-a-glance blocks stay absent; article unaffected */ });
    var stripHost = related || null;
    getJSON("/nepse-chart/data/wave1.json").then(function (w) {
      var m = w.market || {}, ix = m.index || {};
      var html = "<section class=\"bl-mkt-strip\" data-bl-market>"
        + "<span class=\"bl-mkt-label\">NEPSE</span>"
        + "<span class=\"bl-mkt-value\">" + (ix.value == null ? "—" : Number(ix.value).toFixed(2)) + "</span>"
        + "<span class=\"" + (ix.change > 0 ? "up" : (ix.change < 0 ? "down" : "")) + "\">"
        + (ix.change == null ? "" : (ix.change > 0 ? "+" : "") + Number(ix.change).toFixed(2) + " (" + pct(ix.pct, true) + ")") + "</span>"
        + "<span class=\"bl-mkt-note\">" + (m.close ? "Session closed" : "Session open") + " · as of " + esc(fmtDate(m.date || w.asof)) + " · delayed feed</span></section>";
      if (stripHost && stripHost.parentNode) stripHost.parentNode.insertBefore(
        (function () { var t = document.createElement("div"); t.innerHTML = html; return t.firstElementChild; })(),
        stripHost.nextSibling);
      else if (inner) inner.insertAdjacentHTML("beforeend", html);
    }).catch(function () { /* no market strip; article unaffected */ });
  }

  try {
    initReveal();
    initMarket();
    /* Mode by markup, not body attributes: articles carry a bare <body>
       and the chain-swap adds no attributes. */
    if (document.getElementById("blGrid")) initLanding();
    if (document.querySelector(".article")) initArticle();
  } catch (e) { /* never break the article: blocks stay absent */ }
})();

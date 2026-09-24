/* =========================================
   Shirjan Khadka — Finance Portfolio
   Interactions: candlestick canvas, typed roles,
   count-up stats, reveals, tilt, nav, forms
   ========================================= */
(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- no-JS class removal (JS is running) ---------- */
  document.documentElement.classList.remove("no-js");

  /* =========================================
     1. Animated candlestick canvas (hero)
     ========================================= */
  (function initCandles() {
    var canvas = document.getElementById("chartCanvas");
    if (!canvas || prefersReducedMotion) return;

    var ctx = canvas.getContext("2d");
    var candles = [];
    var running = true;
    var lastTime = 0;
    var CANDLE_MS = 900; // time per candle advance
    var MAX_CANDLES = 90;

    var UP = "rgba(16, 185, 129, 0.85)";
    var UP_DIM = "rgba(16, 185, 129, 0.28)";
    var DOWN = "rgba(239, 68, 68, 0.85)";
    var DOWN_DIM = "rgba(239, 68, 68, 0.28)";

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(canvas.offsetWidth * dpr);
      canvas.height = Math.floor(canvas.offsetHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function rand(min, max) {
      return min + Math.random() * (max - min);
    }

    function newCandle(prevClose, w, h) {
      var open = prevClose;
      var drift = rand(-1, 1.15); // slight upward bias
      var close = open + drift * h * 0.05;
      var high = Math.max(open, close) + Math.random() * h * 0.045;
      var low = Math.min(open, close) - Math.random() * h * 0.045;
      return { open: open, close: close, high: high, low: low, born: performance.now() };
    }

    function seed() {
      candles = [];
      var w = canvas.offsetWidth;
      var h = canvas.offsetHeight;
      var price = h * 0.52;
      for (var i = 0; i < MAX_CANDLES; i++) {
        var c = newCandle(price, w, h);
        c.born = 0; // fully formed
        candles.push(c);
        price = c.close;
      }
    }

    function draw(now) {
      if (!running) return;
      var w = canvas.offsetWidth;
      var h = canvas.offsetHeight;
      if (!w || !h) {
        requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      var n = candles.length;
      var slot = w / MAX_CANDLES;
      var bodyW = Math.max(2, slot * 0.55);

      // faint grid
      ctx.strokeStyle = "rgba(148, 163, 184, 0.07)";
      ctx.lineWidth = 1;
      for (var g = 1; g < 6; g++) {
        var gy = (h / 6) * g;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      for (var i = 0; i < n; i++) {
        var c = candles[i];
        var age = (now - c.born) / CANDLE_MS;
        if (c.born === 0) age = 1;
        var progress = Math.min(age, 1);

        var x = i * slot + slot / 2;
        var up = c.close >= c.open;
        var color = up ? UP : DOWN;
        var dim = up ? UP_DIM : DOWN_DIM;

        // wick
        ctx.strokeStyle = progress < 1 ? dim : color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, c.high);
        ctx.lineTo(x, c.low);
        ctx.stroke();

        // body grows from open toward close
        var bodyTop = Math.min(c.open, c.open + (c.close - c.open) * progress);
        var bodyH = Math.max(1.5, Math.abs((c.close - c.open) * progress));
        ctx.fillStyle = progress < 1 ? dim : color;
        ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
      }

      // advance: append a new candle when the newest is mature
      var newest = candles[n - 1];
      if (now - newest.born >= CANDLE_MS && newest.born !== 0) {
        candles.push(newCandle(newest.close, w, h));
        if (candles.length > MAX_CANDLES) candles.shift();
      } else if (newest.born === 0 && n <= MAX_CANDLES) {
        // seed case: kick off live stream
        newest.born = now - CANDLE_MS;
      }

      requestAnimationFrame(draw);
    }

    // pause when hero is off-screen or tab hidden
    var hero = canvas.closest(".hero");
    if ("IntersectionObserver" in window && hero) {
      new IntersectionObserver(function (entries) {
        running = entries[0].isIntersecting && !document.hidden;
        if (running) {
          lastTime = performance.now();
          requestAnimationFrame(draw);
        }
      }).observe(hero);
    }
    document.addEventListener("visibilitychange", function () {
      running = !document.hidden && (!hero || running);
      if (running) requestAnimationFrame(draw);
    });

    window.addEventListener("resize", function () {
      resize();
      seed();
    });

    resize();
    seed();
    requestAnimationFrame(draw);
  })();

  /* =========================================
     2. Typed role rotator
     ========================================= */
  (function initTyped() {
    var el = document.getElementById("typed");
    if (!el) return;

    var roles = [
      "Aspiring Financial Analyst",
      "Investment Banking Aspirant",
      "Credit Analysis Trainee",
      "NEPSE Market Researcher",
      "BBM Graduate · 3.82 CGPA"
    ];

    if (prefersReducedMotion) {
      el.textContent = roles[0];
      var cursor = document.querySelector(".typed-cursor");
      if (cursor) cursor.style.display = "none";
      return;
    }

    var roleIdx = 0;
    var charIdx = 0;
    var deleting = false;

    function tick() {
      var word = roles[roleIdx];
      if (!deleting) {
        charIdx++;
        el.textContent = word.slice(0, charIdx);
        if (charIdx === word.length) {
          deleting = true;
          setTimeout(tick, 1900);
          return;
        }
        setTimeout(tick, 55 + Math.random() * 60);
      } else {
        charIdx--;
        el.textContent = word.slice(0, charIdx);
        if (charIdx === 0) {
          deleting = false;
          roleIdx = (roleIdx + 1) % roles.length;
          setTimeout(tick, 420);
          return;
        }
        setTimeout(tick, 28);
      }
    }

    setTimeout(tick, 600);
  })();

  /* =========================================
     3. Count-up stats
     ========================================= */
  (function initCounters() {
    var nums = document.querySelectorAll(".stat-num[data-count]");
    if (!nums.length) return;

    function animate(el) {
      var target = parseFloat(el.getAttribute("data-count"));
      var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
      if (prefersReducedMotion) {
        el.textContent = target.toFixed(decimals);
        return;
      }
      var dur = 1600;
      var start = null;
      function frame(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * eased).toFixed(decimals);
        if (p < 1) requestAnimationFrame(frame);
        else el.textContent = target.toFixed(decimals);
      }
      requestAnimationFrame(frame);
    }

    if ("IntersectionObserver" in window) {
      var seen = new WeakSet();
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !seen.has(e.target)) {
            seen.add(e.target);
            animate(e.target);
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.4 });
      nums.forEach(function (n) { io.observe(n); });
    } else {
      nums.forEach(animate);
    }
  })();

  /* =========================================
     4. Scroll reveal + skill bars + timeline
     ========================================= */
  (function initScrollFX() {
    var revealEls = document.querySelectorAll(".reveal");
    var skillFills = document.querySelectorAll(".skill-fill[data-width]");
    var timelineProgress = document.querySelector(".timeline-progress");
    var timeline = document.getElementById("timeline");

    if (prefersReducedMotion) {
      revealEls.forEach(function (el) { el.classList.add("visible"); });
      skillFills.forEach(function (f) {
        f.style.setProperty("--fill-target", f.getAttribute("data-width") + "%");
        f.style.width = f.getAttribute("data-width") + "%";
      });
      return;
    }

    if ("IntersectionObserver" in window) {
      var rio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            rio.unobserve(e.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      revealEls.forEach(function (el) { rio.observe(el); });

      var sio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            var w = e.target.getAttribute("data-width") + "%";
            e.target.style.setProperty("--fill-target", w);
            e.target.style.width = w;
            sio.unobserve(e.target);
          }
        });
      }, { threshold: 0.4 });
      skillFills.forEach(function (f) { sio.observe(f); });
    } else {
      revealEls.forEach(function (el) { el.classList.add("visible"); });
      skillFills.forEach(function (f) {
        f.style.width = f.getAttribute("data-width") + "%";
      });
    }

    // timeline progress fills as the timeline scrolls through view
    if (timeline && timelineProgress && !prefersReducedMotion) {
      var line = timeline.querySelector(".timeline-line");
      function update() {
        var rect = timeline.getBoundingClientRect();
        var vh = window.innerHeight;
        var total = rect.height;
        var passed = Math.min(Math.max(vh * 0.6 - rect.top, 0), total);
        var pct = total > 0 ? (passed / total) * 100 : 0;
        timelineProgress.style.height = Math.min(pct, 100) + "%";
        if (line) line.style.setProperty("--p", pct);
      }
      var ticking = false;
      window.addEventListener("scroll", function () {
        if (!ticking) {
          window.requestAnimationFrame(function () {
            update();
            ticking = false;
          });
          ticking = true;
        }
      }, { passive: true });
      window.addEventListener("resize", update);
      update();
    }
  })();

  /* =========================================
     5. Nav: scrolled state, mobile toggle,
        active link, smooth anchor offset
     ========================================= */
  (function initNav() {
    var nav = document.getElementById("nav");
    var toggle = document.getElementById("navToggle");
    var links = document.getElementById("navLinks");

    function onScroll() {
      if (window.scrollY > 24) nav.classList.add("scrolled");
      else nav.classList.remove("scrolled");
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (toggle && links) {
      toggle.addEventListener("click", function () {
        var open = links.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      });
      links.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", function () {
          links.classList.remove("open");
          toggle.setAttribute("aria-expanded", "false");
          toggle.setAttribute("aria-label", "Open menu");
        });
      });
      document.addEventListener("click", function (e) {
        if (links.classList.contains("open") &&
            !links.contains(e.target) &&
            !toggle.contains(e.target)) {
          links.classList.remove("open");
          toggle.setAttribute("aria-expanded", "false");
        }
      });
    }
  })();

  /* =========================================
     6. Scroll progress bar
     ========================================= */
  (function initProgress() {
    var bar = document.getElementById("progressBar");
    if (!bar || prefersReducedMotion) return;
    function update() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
      bar.style.width = pct + "%";
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  })();

  /* =========================================
     7. Cursor glow (desktop pointers)
     ========================================= */
  (function initGlow() {
    var glow = document.getElementById("cursorGlow");
    if (!glow || prefersReducedMotion) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    var x = window.innerWidth / 2;
    var y = window.innerHeight / 3;
    var tx = x, ty = y;
    document.addEventListener("mousemove", function (e) {
      tx = e.clientX;
      ty = e.clientY;
    });
    (function follow() {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      glow.style.left = x + "px";
      glow.style.top = y + "px";
      requestAnimationFrame(follow);
    })();
  })();

  /* =========================================
     8. 3D tilt cards
     ========================================= */
  (function initTilt() {
    if (prefersReducedMotion) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var cards = document.querySelectorAll(".tilt");
    cards.forEach(function (card) {
      var raf = null;
      card.addEventListener("mousemove", function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          var r = card.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width - 0.5;
          var py = (e.clientY - r.top) / r.height - 0.5;
          card.style.transform =
            "perspective(900px) rotateX(" + (-py * 7).toFixed(2) + "deg)" +
            " rotateY(" + (px * 9).toFixed(2) + "deg) translateY(-4px)";
          raf = null;
        });
      });
      card.addEventListener("mouseleave", function () {
        card.style.transform = "";
      });
    });
  })();

  /* =========================================
     9. Magnetic buttons (subtle)
     ========================================= */
  (function initMagnetic() {
    if (prefersReducedMotion) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var btns = document.querySelectorAll(".magnetic");
    btns.forEach(function (btn) {
      btn.addEventListener("mousemove", function (e) {
        var r = btn.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = "translate(" + (dx * 0.08).toFixed(1) + "px," + (dy * 0.12).toFixed(1) + "px)";
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.transform = "";
      });
    });
  })();

  /* =========================================
     10. Contact form (Formspree AJAX)
     ========================================= */
  (function initForm() {
    var form = document.querySelector(".contact-form");
    if (!form) return;
    var note = document.getElementById("formNote");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (note) {
        note.textContent = "Sending…";
        note.className = "form-note";
      }
      var data = new FormData(form);
      fetch(form.action, {
        method: "POST",
        body: data,
        headers: { "Accept": "application/json" }
      }).then(function (resp) {
        if (resp.ok) {
          form.reset();
          if (note) {
            note.textContent = "Message sent — I usually reply within a day. Thank you!";
            note.className = "form-note success";
          }
        } else {
          throw new Error("bad response");
        }
      }).catch(function () {
        if (note) {
          note.textContent = "Something went wrong sending. Please email me directly at shirjan.2.khadka@gmail.com.";
          note.className = "form-note error";
        }
      });
    });
  })();

  /* =========================================
     11. Footer year
     ========================================= */
  (function initYear() {
    var el = document.querySelector(".footer-copy");
    if (el) {
      el.textContent = "© " + new Date().getFullYear() + " Shirjan Khadka. All rights reserved.";
    }
  })();
})();

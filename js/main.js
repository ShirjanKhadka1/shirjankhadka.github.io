/* ============================================================
   Shirjan Khadka — Portfolio interactions (vanilla JS)
   Reveals, counters, carousels, parallax, lightbox, menu.
   All motion disabled under prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Progressive enhancement flag (no-JS-safe reveals) ---------- */
  document.documentElement.classList.add("js");

  /* ---------- Hero masked headline: start the line reveal on load ---------- */
  function markLoaded() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.body.classList.add("loaded");
      });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markLoaded);
  } else {
    markLoaded();
  }

  /* ---------- Magnetic buttons (fine pointers only) ---------- */
  if (window.matchMedia("(pointer: fine)").matches && !prefersReduced) {
    document.querySelectorAll(".magnetic").forEach(function (btn) {
      btn.addEventListener("pointermove", function (e) {
        var r = btn.getBoundingClientRect();
        var x = e.clientX - (r.left + r.width / 2);
        var y = e.clientY - (r.top + r.height / 2);
        btn.style.transform = "translate(" + (x * 0.22).toFixed(1) + "px," + (y * 0.22).toFixed(1) + "px)";
      });
      btn.addEventListener("pointerleave", function () { btn.style.transform = ""; });
    });
  }

  /* ---------- Scroll-spy: highlight the nav link of the section in view ---------- */
  var navAnchors = {};
  document.querySelectorAll('.nav-links a[href^="#"]').forEach(function (a) {
    navAnchors[a.getAttribute("href").slice(1)] = a;
  });
  var spyTargets = Object.keys(navAnchors)
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);
  if ("IntersectionObserver" in window && spyTargets.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          Object.keys(navAnchors).forEach(function (k) { navAnchors[k].removeAttribute("aria-current"); });
          var a = navAnchors[en.target.id];
          if (a) a.setAttribute("aria-current", "true");
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    spyTargets.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- Scroll-drawn timeline ---------- */
  var timeline = document.querySelector(".timeline");
  if (timeline && "IntersectionObserver" in window && !prefersReduced) {
    var tlObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          timeline.classList.add("in");
          tlObs.disconnect();
        }
      });
    }, { threshold: 0.2 });
    tlObs.observe(timeline);
  } else if (timeline) {
    timeline.classList.add("in");
  }

  /* ---------- Scroll progress bar (fallback when CSS scroll timelines unsupported) ---------- */
  var prog = document.getElementById("scrollProgress");
  if (prog && !(window.CSS && CSS.supports && CSS.supports("animation-timeline: scroll()")) && !prefersReduced) {
    var progTicking = false;
    var progUpdate = function () {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      prog.style.transform = "scaleX(" + (max > 0 ? h.scrollTop / max : 0) + ")";
      progTicking = false;
    };
    window.addEventListener("scroll", function () {
      if (!progTicking) { progTicking = true; requestAnimationFrame(progUpdate); }
    }, { passive: true });
    progUpdate();
  }

  /* ---------- Ticker: pause when the tab is hidden (battery) ---------- */
  var tickerTrack = document.querySelector(".ticker-track");
  if (tickerTrack) {
    document.addEventListener("visibilitychange", function () {
      tickerTrack.classList.toggle("paused", document.hidden);
    });
  }

  /* ---------- Sticky nav state (blur intensifies on scroll) ---------- */
  var nav = document.getElementById("nav");
  function onScrollNav() {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 24);
  }
  window.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();

  /* ---------- Mobile menu ---------- */
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.style.overflow = open ? "hidden" : "";
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("open");
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
        document.body.style.overflow = "";
      });
    });
  }

  /* ---------- Staggered entrances: children of [data-stagger] rise in sequence ---------- */
  document.querySelectorAll("[data-stagger]").forEach(function (group) {
    var step = parseInt(group.getAttribute("data-stagger"), 10) || 90;
    group.querySelectorAll(".reveal").forEach(function (el, i) {
      el.style.transitionDelay = (i * step) + "ms";
    });
  });

  /* ---------- Scroll reveals: drag up from below + settle ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !prefersReduced) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          revealObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    revealEls.forEach(function (el) { revealObs.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Animated counters ---------- */
  function formatCount(value, decimals) {
    var s = value.toFixed(decimals);
    if (decimals === 0) {
      s = Number(s).toLocaleString("en-US");
    }
    return s;
  }
  function animateCount(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
    var suffix = el.getAttribute("data-suffix") || "";
    if (prefersReduced) {
      el.textContent = formatCount(target, decimals) + suffix;
      return;
    }
    var duration = 1400;
    var start = null;
    function tick(now) {
      if (!start) start = now;
      var p = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatCount(target * eased, decimals) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  var counters = document.querySelectorAll(".count");
  if (counters.length && "IntersectionObserver" in window) {
    var countObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          animateCount(e.target);
          countObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { countObs.observe(el); });
  } else {
    counters.forEach(animateCount);
  }

  /* ---------- Carousels: drag to scroll (all .carousel) ---------- */
  document.querySelectorAll(".carousel").forEach(function (carousel) {
    var isDown = false, startX = 0, startLeft = 0, moved = false;
    carousel.addEventListener("pointerdown", function (e) {
      isDown = true; moved = false;
      startX = e.clientX; startLeft = carousel.scrollLeft;
      carousel.classList.add("dragging");
    });
    carousel.addEventListener("pointermove", function (e) {
      if (!isDown) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 6) moved = true;
      carousel.scrollLeft = startLeft - dx;
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (evt) {
      carousel.addEventListener(evt, function () {
        isDown = false;
        carousel.classList.remove("dragging");
      });
    });
    /* Swallow the click that ends a drag so it never opens the lightbox. */
    carousel.addEventListener("click", function (e) {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
    }, true);
  });

  /* ---------- Gentle parallax via rAF (data-parallax = speed) ---------- */
  var pxEls = document.querySelectorAll("[data-parallax]");
  if (pxEls.length && !prefersReduced) {
    var pxTicking = false;
    function updateParallax() {
      pxTicking = false;
      var vh = window.innerHeight;
      pxEls.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        var speed = parseFloat(el.getAttribute("data-parallax")) || 0.08;
        var offset = (r.top + r.height / 2 - vh / 2) * speed;
        el.style.setProperty("--py", (-offset).toFixed(1) + "px");
      });
    }
    function requestParallax() {
      if (!pxTicking) { pxTicking = true; requestAnimationFrame(updateParallax); }
    }
    window.addEventListener("scroll", requestParallax, { passive: true });
    window.addEventListener("resize", requestParallax);
    updateParallax();
  }

  /* ---------- Article reading progress ---------- */
  var progress = document.getElementById("progressBar");
  if (progress) {
    var article = document.querySelector(".article-body");
    function onScrollProgress() {
      var target = article || document.body;
      var total = target.scrollHeight - window.innerHeight;
      var p = total > 0 ? Math.min(Math.max(window.scrollY / total, 0), 1) : 0;
      progress.style.transform = "scaleX(" + p + ")";
    }
    window.addEventListener("scroll", onScrollProgress, { passive: true });
    onScrollProgress();
  }

  /* ---------- Events lightbox ---------- */
  (function () {
    var groups = document.querySelectorAll(".event-gallery");
    if (!groups.length) return;

    var overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Photo viewer");
    overlay.innerHTML =
      '<button class="lightbox-close" aria-label="Close">✕</button>' +
      '<button class="lightbox-btn lightbox-prev" aria-label="Previous photo">‹</button>' +
      '<img alt="">' +
      '<button class="lightbox-btn lightbox-next" aria-label="Next photo">›</button>' +
      '<p class="lightbox-caption"></p>';
    document.body.appendChild(overlay);

    var lbImg = overlay.querySelector("img");
    var lbCap = overlay.querySelector(".lightbox-caption");
    var current = [];
    var index = 0;

    function show(i) {
      index = (i + current.length) % current.length;
      var item = current[index];
      lbImg.src = item.src;
      lbImg.alt = item.alt;
      lbCap.textContent = item.cap;
    }
    function open(group, i) {
      current = [];
      group.querySelectorAll(".event-photo").forEach(function (fig) {
        var img = fig.querySelector("img");
        var cap = fig.querySelector("figcaption");
        current.push({ src: img.src, alt: img.alt, cap: cap ? cap.textContent : "" });
      });
      if (!current.length) return;
      overlay.classList.add("open");
      document.body.style.overflow = "hidden";
      show(i);
    }
    function close() {
      overlay.classList.remove("open");
      document.body.style.overflow = "";
    }

    groups.forEach(function (group) {
      group.querySelectorAll(".event-photo img").forEach(function (img, i) {
        img.addEventListener("click", function () { open(group, i); });
      });
    });

    overlay.querySelector(".lightbox-close").addEventListener("click", close);
    overlay.querySelector(".lightbox-prev").addEventListener("click", function (e) { e.stopPropagation(); show(index - 1); });
    overlay.querySelector(".lightbox-next").addEventListener("click", function (e) { e.stopPropagation(); show(index + 1); });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function (e) {
      if (!overlay.classList.contains("open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(index - 1);
      if (e.key === "ArrowRight") show(index + 1);
    });
  })();

  /* ---------- Footer year ---------- */
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  /* ---------- Giant background section numerals (kinetic typography) ---------- */
  (function () {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll("section.section").forEach(function (sec) {
      var numEl = sec.querySelector(".sec-num");
      if (!numEl) return;
      var giant = document.createElement("span");
      giant.className = "sec-giant";
      giant.setAttribute("aria-hidden", "true");
      giant.textContent = numEl.textContent.trim();
      sec.insertBefore(giant, sec.firstChild);
      if (reduce || !("IntersectionObserver" in window)) {
        giant.classList.add("in");
        return;
      }
      new IntersectionObserver(function (entries, io) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { giant.classList.add("in"); io.disconnect(); }
        });
      }, { threshold: 0.12 }).observe(sec);
    });
  })();
})();

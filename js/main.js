/* ============================================================
   Shirjan Khadka — Portfolio interactions (vanilla JS)
   Lightweight: reveals, counters, carousel, progress, menu.
   ============================================================ */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Sticky nav state ---------- */
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
        document.body.style.overflow = "";
      });
    });
  }

  /* ---------- Scroll reveals ---------- */
  var revealEls = document.querySelectorAll(".reveal, .reveal-stagger");
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

  /* ---------- Work carousel: buttons + drag ---------- */
  var carousel = document.getElementById("workCarousel");
  if (carousel) {
    var prev = document.getElementById("workPrev");
    var next = document.getElementById("workNext");
    function cardStep() {
      var card = carousel.querySelector(".work-card");
      return card ? card.getBoundingClientRect().width + 24 : 320;
    }
    if (prev) prev.addEventListener("click", function () {
      carousel.scrollBy({ left: -cardStep(), behavior: prefersReduced ? "auto" : "smooth" });
    });
    if (next) next.addEventListener("click", function () {
      carousel.scrollBy({ left: cardStep(), behavior: prefersReduced ? "auto" : "smooth" });
    });

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
    carousel.addEventListener("click", function (e) {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
    }, true);
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
        img.style.cursor = "zoom-in";
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
})();

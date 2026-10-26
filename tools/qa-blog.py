#!/usr/bin/env python3
"""Playwright QA for the blog rebuild (landing + sampled articles).

Serves the worktree on localhost and checks, against the live DOM:
  landing dark/light/390px: canvas rgb, overflow, counts, market strip,
  sector block, pager, featured/rail titles vs the index;
  articles: injected at-a-glance / figures / related-symbol blocks,
  progress bar on scroll, footer cream override (sf background rgb);
  refresh gate: mutated index -> new items + "N new" notice;
  unchanged tick -> DOM probe stable; failed fetch -> old feed kept.
Screenshots land in qa/ (evidence only, never deployed).
Usage: python3 tools/qa-blog.py --base http://localhost:8931
"""
import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
QA = ROOT / "qa"
QA.mkdir(exist_ok=True)

FAILURES = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" :: {detail}" if detail else ""))
    if not cond:
        FAILURES.append(name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8931")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    idx = json.loads((ROOT / "data/blog-index.json").read_text())
    arts = idx["articles"]
    newest, second = arts[0], arts[1]
    soybean = next(a for a in arts if a["slug"] == "nepal-soybean-oil-reexport-trade")
    api = next(a for a in arts if a["slug"] == "api-equity-research")
    verdicts = json.loads((ROOT / "nepse-chart/data/verdicts.json").read_text())
    sectors = sorted({(v.get("sec") or "Others") for v in verdicts["verdicts"].values()})

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ---------- landing, dark ----------
        page.add_init_script("try{localStorage.setItem('sk-theme','dark')}catch(e){}")
        page.goto(base + "/blog/", wait_until="networkidle")
        page.wait_for_selector("#blGrid .mag-card")
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        check("landing dark canvas", bg == "rgb(10, 12, 16)", bg)
        over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("landing dark no overflow @1280", over == 0, f"overflow={over}px")
        feat = page.text_content("#blFeatured h3") or ""
        check("landing featured = newest index title", newest["title"] in feat, feat[:60])
        vis = page.evaluate("Array.from(document.querySelectorAll('#blGrid .mag-card')).filter(e=>e.style.display!=='none').length")
        check("landing grid page 1 shows 12", vis == 12, f"visible={vis}")
        countline = page.text_content("#blCountline") or ""
        check("landing countline total", str(len(arts)) in countline, countline)
        mkt = page.text_content(".bl-market .bl-mkt-value") or ""
        check("landing market strip value", "2629.83" in mkt, mkt)
        sec_opts = page.evaluate("document.querySelectorAll('#blSecSelect option').length")
        check("landing sector options = sectors+1", sec_opts == len(sectors) + 1,
              f"options={sec_opts} sectors={len(sectors)}")
        sec_sum = page.text_content("#blSecSum") or ""
        check("landing sector sum 412", "412 stocks" in sec_sum, sec_sum)
        page.screenshot(path=str(QA / "landing-dark-1280.png"))

        # pager: Next -> page 2 shows different cards
        first_page_first = page.evaluate(
            "document.querySelector('#blGrid .mag-card:not([style*=\"none\"]) h3').textContent")
        page.click("#blNext")
        page.wait_for_timeout(300)
        second_page_first = page.evaluate(
            "document.querySelector('#blGrid .mag-card:not([style*=\"none\"]) h3').textContent")
        showing = page.text_content("#blShowing") or ""
        check("landing pager Next changes page", first_page_first != second_page_first,
              f"{first_page_first[:40]} -> {second_page_first[:40]}")
        check("landing pager Showing 13-24", "Showing 13–24 of" in showing, showing)
        page.click("#blPrev")
        page.wait_for_timeout(300)

        # sector filter: Hydropower
        if "Hydropower" in sectors:
            page.select_option("#blSecSelect", "Hydropower")
            page.wait_for_timeout(300)
            ssum = page.text_content("#blSecSum") or ""
            check("sector filter Hydropower count", "113 stocks" in ssum, ssum)
            first_sym = page.text_content("#blSecBody tr:first-child td:first-child a") or ""
            check("sector row links to /stocks/", first_sym != "", first_sym)

        # ---------- landing, light (fresh context: the dark init script
        # would otherwise re-apply 'dark' on every navigation) ----------
        ctx2 = browser.new_context(viewport={"width": 1280, "height": 900})
        page2 = ctx2.new_page()
        page2.add_init_script("try{localStorage.setItem('sk-theme','light')}catch(e){}")
        page2.goto(base + "/blog/", wait_until="networkidle")
        page2.wait_for_selector("#blGrid .mag-card")
        bg = page2.evaluate("getComputedStyle(document.body).backgroundColor")
        check("landing light canvas", bg == "rgb(246, 247, 249)", bg)
        page2.screenshot(path=str(QA / "landing-light-1280.png"))
        ctx2.close()

        # ---------- landing, 390px ----------
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("landing no overflow @390", over == 0, f"overflow={over}px")
        page.screenshot(path=str(QA / "landing-dark-390.png"))

        # ---------- refresh gate: mutated index (boot real, then mutate
        # via visibilitychange — the same path the 60s tick uses) ----------
        page.set_viewport_size({"width": 1280, "height": 900})
        mutated = json.loads(json.dumps(idx))
        fake = dict(mutated["articles"][0])
        fake["slug"] = "qa-fake-article"
        fake["title"] = "QA FAKE: mutated index article"
        mutated["articles"] = [fake] + mutated["articles"]

        def route_index(route):
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps(mutated))

        page.route("**/data/blog-index.json", route_index)
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(1500)
        feat2 = page.text_content("#blFeatured h3") or ""
        check("mutated index -> featured is fake article", "QA FAKE" in feat2, feat2[:60])
        fresh = page.text_content("#blFreshLine") or ""
        check("mutated index -> 'N new' notice", "1 new" in fresh, fresh)
        # unchanged tick: same payload again -> DOM probe stable
        probe = page.evaluate("document.querySelector('#blGrid .mag-card').outerHTML")
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(1500)
        probe2 = page.evaluate("document.querySelector('#blGrid .mag-card').outerHTML")
        check("unchanged tick keeps DOM probe", probe == probe2)
        # failure: 500 -> old feed kept
        page.unroute("**/data/blog-index.json")

        def route_fail(route):
            route.fulfill(status=500, content_type="text/plain", body="boom")

        page.route("**/data/blog-index.json", route_fail)
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(1500)
        feat3 = page.text_content("#blFeatured h3") or ""
        fresh3 = page.text_content("#blFreshLine") or ""
        check("failed refresh keeps old feed", "QA FAKE" in feat3, feat3[:60])
        check("failed refresh marks freshness failed", "failed" in fresh3, fresh3)
        page.unroute("**/data/blog-index.json")

        # ---------- articles ----------
        for slug, expect_fig in [(soybean["slug"], "76.59"), (api["slug"], None)]:
            page.goto(base + f"/blog/{slug}/", wait_until="networkidle")
            page.wait_for_timeout(1200)
            bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
            check(f"article {slug[:20]} dark canvas", bg == "rgb(10, 12, 16)", bg)
            over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check(f"article {slug[:20]} no overflow @1280", over == 0, f"overflow={over}px")
            glance = page.text_content(".bl-glance") or ""
            check(f"article {slug[:20]} at-a-glance", "Published" in glance, glance[:80].replace("\n", " "))
            if expect_fig:
                figs = page.text_content(".bl-figures") or ""
                check(f"article {slug[:20]} figures strip", expect_fig in figs, figs[:100].replace("\n", " "))
            if slug == api["slug"]:
                syms = page.text_content(".bl-syms") or ""
                check("article api related symbol API", "API" in syms, syms[:100].replace("\n", " "))
            bar = page.evaluate("document.getElementById('progressBar') !== null")
            if not bar:
                # Upstream template variance (4 research articles ship no
                # progress div; main.js also only used it when present).
                print(f"NOTE article {slug[:20]} has no progress div upstream")
            else:
                before = page.evaluate(
                    "getComputedStyle(document.getElementById('progressBar')).transform")
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                page.wait_for_timeout(400)
                after = page.evaluate(
                    "getComputedStyle(document.getElementById('progressBar')).transform")
                check(f"article {slug[:20]} progress advances on scroll",
                      before != after and after == "matrix(1, 0, 0, 1, 0, 0)",
                      f"{before} -> {after}")
            sf_bg = page.evaluate(
                "(()=>{var f=document.querySelector('footer.sf');return f?getComputedStyle(f).backgroundColor:'no-sf'})()")
            check(f"article {slug[:20]} sf footer token bg (not cream)",
                  sf_bg in ("rgb(22, 26, 35)", "no-sf"), sf_bg)
            page.screenshot(path=str(QA / f"article-{slug[:24]}-dark.png"))

        # article light (fresh context, same init-script reason as above)
        ctx3 = browser.new_context(viewport={"width": 1280, "height": 900})
        page3 = ctx3.new_page()
        page3.add_init_script("try{localStorage.setItem('sk-theme','light')}catch(e){}")
        page3.goto(base + f"/blog/{soybean['slug']}/", wait_until="networkidle")
        page3.wait_for_timeout(1000)
        bg = page3.evaluate("getComputedStyle(document.body).backgroundColor")
        check("article light canvas", bg == "rgb(246, 247, 249)", bg)
        sf_bg = page3.evaluate(
            "(()=>{var f=document.querySelector('footer.sf');return f?getComputedStyle(f).backgroundColor:'no-sf'})()")
        check("article light sf footer token bg", sf_bg in ("rgb(239, 241, 245)", "no-sf"), sf_bg)
        page3.screenshot(path=str(QA / "article-soybean-light.png"))
        ctx3.close()

        # article 390px (back to soybean on the dark page)
        page.goto(base + f"/blog/{soybean['slug']}/", wait_until="networkidle")
        page.wait_for_timeout(800)
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("article no overflow @390", over == 0, f"overflow={over}px")
        page.screenshot(path=str(QA / "article-soybean-390.png"))

        print("---")
        print(f"console errors: {len(errors)}")
        for e in errors[:10]:
            print("  CONSOLE: " + e[:200])
        browser.close()

    print(f"== QA done: {len(FAILURES)} failures ==")
    for f in FAILURES:
        print("FAILED: " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())

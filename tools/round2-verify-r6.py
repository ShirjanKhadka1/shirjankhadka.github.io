#!/usr/bin/env python3
"""ROUND 2 / R6 verifier — measurement and accessibility.

Default mode (no arguments, CI-safe, no browser needed) asserts:
  * both R6 workflows exist and are valid YAML with a push trigger;
  * tools/round2-budgets-r6.json defines LCP/CLS/INP + axe budgets;
  * the R6 light-theme contrast overrides exist in the component CSS;
  * every R6-touched CSS pin in the 5 core pages equals the raw-content
    SHA-1 first-8 of that file (the site's cache-token rule);
  * BASELINE GUARDS (must not regress): the daily summary table's
    synced top scrollbar (dsTopScroll) is still in nepse-daily, and
    the 4 header-baseline pages still link nd-chrome.css.

  --axe-json FILE  additionally asserts axe color-contrast nodes == 0
  on all 5 core pages x 2 themes (report from tools/round2-axe-r6.js).

  --lighthouse-dir DIR  additionally asserts Lighthouse budgets on the
  per-page *.report.json files: LCP <= budget, CLS <= budget, and INP
  <= budget WHEN Lighthouse reports a numeric INP. Lab Lighthouse often
  reports no numeric INP (it needs real interaction); that case is
  reported as INP=unmeasured-in-lab and does NOT fail the run, and
  must never be reported as an INP pass.

Exit 0 = all asserted checks pass. Any failure exits 1 with the list.
"""
import argparse
import hashlib
import json
import os
import re
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PAGES = {
    "decode": "nepse-decode/index.html",
    "screener": "nepse-screener/index.html",
    "sectors": "nepse-sectors/index.html",
    "brokers": "nepse-brokers/index.html",
    "daily": "nepse-daily/index.html",
}
# CSS files R6 touched, mapped to the pages that pin them.
R6_CSS = {
    "css/nd-editorial-theme.css": list(PAGES.values()),
    "css/nd-chrome.css": list(PAGES.values()),
    "css/nd-home.css": ["nepse-decode/index.html"],
    "css/sig-pro.css": ["nepse-decode/index.html", "nepse-screener/index.html"],
    "css/nd-cinema.css": list(PAGES.values()),
    "css/nd-daily.css": ["nepse-daily/index.html"],
    "nepse-screener/screener.css": ["nepse-screener/index.html"],
    "nepse-sectors/sectors.css": ["nepse-sectors/index.html"],
}
# (file, snippet) pairs proving the R6 light overrides exist.
R6_MARKERS = [
    ("css/nd-editorial-theme.css", '[data-theme="light"] .nd-eyebrow'),
    ("css/nd-chrome.css", '[data-theme="light"] #nd-footer .nd-footcol h3'),
    ("css/nd-home.css", '[data-theme="light"] .nd-verdict.buy'),
    ("css/nd-home.css", '[data-theme="light"] .nd-btn-lime'),
    ("css/nd-cinema.css", "#166534"),
    ("css/nd-cinema.css", "#B91C1C"),
    ("nepse-screener/screener.css", "html[data-theme=\"light\"] .cx-chip.up{color:#166534}"),
    ("css/sig-pro.css", '[data-theme="light"] .rpill.rp-trail'),
    ("nepse-sectors/sectors.css", '[data-theme="light"] .pillrow button.active'),
    ("css/nd-daily.css", '[data-theme="light"] .ds-table thead th.sorted'),
]
HEADER_BASELINE_PAGES = [
    "nepse-index/index.html",
    "nepse-compare/index.html",
    "nepse-floorsheet/index.html",
    "nepse-scripting/index.html",
]
WORKFLOWS = [
    ".github/workflows/round2-r6-a11y.yml",
    ".github/workflows/round2-r6-perf.yml",
]


def fail(errors, msg):
    errors.append(msg)
    print("FAIL:", msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--axe-json", default=None)
    ap.add_argument("--lighthouse-dir", default=None)
    args = ap.parse_args()
    errors = []

    # --- workflows present + valid YAML + push trigger ---
    for wf in WORKFLOWS:
        p = os.path.join(ROOT, wf)
        if not os.path.exists(p):
            fail(errors, f"missing workflow {wf}")
            continue
        try:
            doc = yaml.safe_load(open(p))
        except Exception as e:  # noqa: BLE001
            fail(errors, f"{wf} is not valid YAML: {e}")
            continue
        on = doc.get(True, doc.get("on", {})) if isinstance(doc, dict) else {}
        # PyYAML parses `on:` as boolean True key.
        if "push" not in on:
            fail(errors, f"{wf} has no push trigger")
        else:
            print(f"OK: {wf} valid YAML, runs on push")

    # --- budgets defined ---
    bpath = os.path.join(ROOT, "tools/round2-budgets-r6.json")
    try:
        budgets = json.load(open(bpath))["r6_budgets"]
    except Exception as e:  # noqa: BLE001
        fail(errors, f"budgets unreadable: {e}")
        budgets = {}
    for key, want in (("lcp_ms", 2500), ("cls", 0.1), ("inp_ms", 200),
                      ("axe_max_contrast_nodes", 0)):
        if budgets.get(key) != want:
            fail(errors, f"budget {key} = {budgets.get(key)!r}, want {want}")
    if budgets.get("pages") != ["decode", "screener", "sectors", "brokers", "daily"]:
        fail(errors, "budget pages list is not the 5 core pages")
    if budgets.get("themes") != ["dark", "light"]:
        fail(errors, "budget themes list is not [dark, light]")
    if not errors:
        print(f"OK: budgets LCP<={budgets['lcp_ms']}ms CLS<={budgets['cls']} "
              f"INP<={budgets['inp_ms']}ms axe_nodes<={budgets['axe_max_contrast_nodes']}")

    # --- R6 markers present ---
    for rel, snippet in R6_MARKERS:
        text = open(os.path.join(ROOT, rel)).read()
        if snippet not in text:
            fail(errors, f"R6 marker missing in {rel}: {snippet}")
    print("OK: R6 light-contrast markers present" if not errors else "")

    # --- pin consistency (raw-content SHA-1 first-8) ---
    for css, pages in R6_CSS.items():
        data = open(os.path.join(ROOT, css), "rb").read()
        pin = hashlib.sha1(data).hexdigest()[:8]
        base = os.path.basename(css)
        for page in pages:
            html = open(os.path.join(ROOT, page)).read()
            m = re.search(re.escape(base) + r"\?v=([0-9a-f]{8})", html)
            if not m:
                fail(errors, f"{page} does not pin {base}")
            elif m.group(1) != pin:
                fail(errors, f"{page} pins {base} at {m.group(1)}, content SHA-1 is {pin}")
    print("OK: R6 CSS pins match raw-content SHA-1 first-8")

    # --- baseline guards ---
    daily = open(os.path.join(ROOT, PAGES["daily"])).read()
    if "dsTopScroll" not in daily:
        fail(errors, "BASELINE REGRESSION: dsTopScroll missing from nepse-daily")
    else:
        print("OK: baseline guard: daily dsTopScroll present")
    for page in HEADER_BASELINE_PAGES:
        html = open(os.path.join(ROOT, page)).read()
        if "nd-chrome.css" not in html:
            fail(errors, f"BASELINE REGRESSION: {page} lost its nd-chrome.css link")
    print("OK: baseline guard: 4 header pages still link nd-chrome.css")

    # --- axe report ---
    if args.axe_json:
        try:
            rep = json.load(open(args.axe_json))
        except Exception as e:  # noqa: BLE001
            fail(errors, f"axe report unreadable: {e}")
            rep = {}
        for page in PAGES:
            for theme in ("dark", "light"):
                key = f"{page}/{theme}"
                entry = rep.get(key)
                if entry is None:
                    fail(errors, f"axe report missing {key}")
                elif entry.get("error"):
                    fail(errors, f"axe run errored on {key}: {entry['error']}")
                elif entry.get("nodes") != 0:
                    fail(errors, f"axe contrast nodes on {key}: {entry.get('nodes')} "
                                 f"(want 0; AA fail)")
                else:
                    print(f"OK: axe contrast {key} = 0 nodes (AA pass)")

    # --- lighthouse budgets ---
    if args.lighthouse_dir:
        for page in PAGES:
            p = os.path.join(args.lighthouse_dir, f"{page}.report.json")
            if not os.path.exists(p):
                fail(errors, f"missing Lighthouse report for {page}")
                continue
            rep = json.load(open(p))
            audits = rep.get("audits", {})
            lcp = audits.get("largest-contentful-paint", {}).get("numericValue")
            cls = audits.get("cumulative-layout-shift", {}).get("numericValue")
            inp = audits.get("interaction-to-next-paint", {}).get("numericValue")
            before = len(errors)
            if lcp is not None and lcp > budgets["lcp_ms"]:
                fail(errors, f"Lighthouse LCP {page} = {lcp:.0f}ms > {budgets['lcp_ms']}ms")
            if cls is not None and cls > budgets["cls"]:
                fail(errors, f"Lighthouse CLS {page} = {cls} > {budgets['cls']}")
            if inp is None:
                print(f"NOTE: Lighthouse INP {page} = unmeasured-in-lab "
                      f"(not claimed as a pass; budget is {budgets['inp_ms']}ms)")
            elif inp > budgets["inp_ms"]:
                fail(errors, f"Lighthouse INP {page} = {inp:.0f}ms > {budgets['inp_ms']}ms")
            if len(errors) == before:
                print(f"OK: Lighthouse {page} LCP={lcp} CLS={cls} INP={inp}")

    if errors:
        print(f"R6 VERIFY FAIL: {len(errors)} failure(s)")
        return 1
    print("R6 VERIFY PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

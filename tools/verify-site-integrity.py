#!/usr/bin/env python3
"""
Site integrity verification — run before claiming anything is "live and verified."
Checks:
1. Every symbol in universe.json has a stock page (no missing pages)
2. Every stock page has a symbol in universe.json (no orphaned pages)
3. No merged/delisted symbols in universe or pages
4. Sitemap matches actual pages
"""
import json, os, sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors = []

# Load universe
with open(os.path.join(SITE, 'nepse-chart/data/universe.json')) as f:
    universe = json.load(f)
universe_syms = {s['s'] for s in universe['symbols']}

# Load merger tracker
merger_path = os.path.join(SITE, 'tools/verdict-engine-v2/manual/merger-tracker.json')
merged = set()
if os.path.exists(merger_path):
    with open(merger_path) as f:
        mt = json.load(f)
    for m in mt.get('completed_mergers', []):
        merged.add(m['absorbed'])

# 1. Check merged symbols not in universe
for m in merged:
    if m in universe_syms:
        errors.append(f"MERGED_IN_UNIVERSE: {m} is merged but still in universe.json")

# 2. Check stock pages (symbols with / use - in page paths)
stocks_dir = os.path.join(SITE, 'stocks')
page_syms = set()
page_dirs = {}  # dir name -> symbol
if os.path.isdir(stocks_dir):
    for d in os.listdir(stocks_dir):
        if os.path.isdir(os.path.join(stocks_dir, d)) and os.path.exists(os.path.join(stocks_dir, d, 'index.html')):
            # Map dir back to symbol: - could be / in original
            sym = d.replace('-', '/')
            # Also try as-is
            page_syms.add(d)
            page_dirs[d] = sym

# Build universe symbol -> page dir mapping
def sym_to_dir(s):
    return s.replace('/', '-')

universe_dirs = {sym_to_dir(s) for s in universe_syms}

# Orphaned pages (page exists, not in universe)
for p in sorted(page_syms - universe_dirs):
    if p in ('index.html',):
        continue
    errors.append(f"ORPHANED_PAGE: stocks/{p}/ exists but no matching symbol in universe.json")

# Missing pages (in universe, no page) — only warn for equities
for s in sorted(universe_syms):
    d = sym_to_dir(s)
    if d not in page_syms:
        sym_data = next((x for x in universe['symbols'] if x['s'] == s), {})
        if sym_data.get('t') == 'Equity':
            errors.append(f"MISSING_PAGE: {s} in universe but no stocks/{d}/ page")

# Merged symbols with pages
for m in merged:
    if m in page_syms:
        errors.append(f"MERGED_HAS_PAGE: {m} is merged but stocks/{m}/ page still exists")

# 3. Check sitemap
sitemap_path = os.path.join(SITE, 'sitemap.xml')
if os.path.exists(sitemap_path):
    with open(sitemap_path) as f:
        sitemap = f.read()
    import re
    sitemap_stocks = set(re.findall(r'/stocks/([A-Z0-9]+)/', sitemap))
    for s in sorted(sitemap_stocks - universe_syms - page_syms):
        errors.append(f"STALE_SITEMAP: /stocks/{s}/ in sitemap but no page and not in universe")
    for m in merged:
        if m in sitemap_stocks:
            errors.append(f"MERGED_IN_SITEMAP: {m} is merged but still in sitemap.xml")

# Report
if errors:
    print(f"FAILED: {len(errors)} integrity errors found:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print(f"PASSED: {len(universe_syms)} symbols, {len(page_syms)} pages, {len(merged)} merged tracked — no integrity errors")
    sys.exit(0)

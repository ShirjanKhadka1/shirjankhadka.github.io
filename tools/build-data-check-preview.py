#!/usr/bin/env python3
"""Build the standalone data-check preview artifact.

Reads nepse-chart/data-check.html, inlines nepse-chart/chart.css, and embeds
nepse-chart/data/audit.json so the page works as a single file before publish.
Output: workspace/your_files/nepse-data-check-preview.html
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path('/home/hatch/workspace/portfolio')
SRC = ROOT / 'nepse-chart' / 'data-check.html'
CSS = ROOT / 'nepse-chart' / 'chart.css'
AUDIT = ROOT / 'nepse-chart' / 'data' / 'audit.json'
OUT = pathlib.Path('/home/hatch/workspace/your_files/nepse-data-check-preview.html')

html = SRC.read_text()
css = CSS.read_text()
audit = AUDIT.read_text()
a = json.loads(audit)
print(f'audit: asof={a["asof"]} rows={len(a["rows"])}')

# Inline the shared stylesheet.
html = html.replace(
    '<link rel="stylesheet" href="chart.css?v=20260924f">',
    '<style>\n' + css + '\n</style>',
    1,
)

# Replace the audit fetch with the embedded snapshot + preview banner.
fetch_block = re.compile(
    r"  //__AUDIT_PROMISE__\n"
    r"  fetch\('data/audit\.json'.*?"
    r"  //__AUDIT_THEN__\n",
    re.DOTALL,
)
replacement = (
    "  isPreview = true;\n"
    "  prevEl.innerHTML = 'You are viewing a <strong>preview copy</strong> with the audit embedded. '\n"
    "    + '“Run live check” verifies files against the <strong>live site</strong> — LTP files show '\n"
    "    + '“not published yet” until this batch is published.';\n"
    "  prevEl.classList.add('show');\n"
    "  Promise.resolve(" + audit + ").then(loadAudit);\n"
)
html2, n = fetch_block.subn(replacement, html)
if n != 1:
    sys.exit('ERROR: audit fetch block not found exactly once')
html = html2

OUT.write_text(html)
print(f'wrote {OUT} ({len(html)} bytes)')
